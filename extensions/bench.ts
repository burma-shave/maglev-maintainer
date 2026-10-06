import { lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BenchStartExecutionError, classifyBenchDirtyStatus, executeBenchReset, executeBenchStart, formatBenchClosePlan, formatBenchResetPlan, formatBenchStartPlan, freshnessFor, planBenchClose, planBenchReset, planBenchStart, prFromBenchPath, verifyBenchStart } from "./bench-core.ts";
import type { BenchCloseOptions, BenchClosePlan, BenchListInput, BenchResetOptions, BenchResetPlan, BenchStartOptions, BenchStartPlan, BenchStartVerification } from "./bench-core.ts";
import { branchBenchDefinition, loadBenchDefinitions, prBenchDefinition, saveBenchDefinition, validBenchId, type BenchDefinition } from "./bench-registry.ts";
import { BENCH_CHECKOUTS_DIR, BENCH_STATE_DIR } from "./paths.ts";
import { REPO } from "./constants.ts";
import { isMaglevOrigin } from "./maglev-checkout.ts";
import { writeBenchContext } from "./bench-context.ts";
import { decisionMap } from "./decisions.ts";
import { loadDecisions, loadSnapshotOptional } from "./state.ts";
import { computeNeedsInference } from "./triage.ts";
import type { BenchState, GeneralBenchState, SnapshotFile, TmuxSessionInfo, TmuxWindowInfo } from "./types.ts";
import { commandSucceeds, isNotFoundError, runText, shortOid } from "./utils.ts";

export interface BenchCloseResult {
	plan: BenchClosePlan;
	snapshotWarning?: string;
	applied: boolean;
	executed: string[];
}
export interface BenchStartResult {
	plan: BenchStartPlan;
	contextPath?: string;
	snapshotWarning?: string;
	applied: boolean;
	executed: string[];
	mutationWarning?: string;
	verification?: BenchStartVerification;
}
export interface BenchResetResult {
	plan: BenchResetPlan;
	snapshotWarning?: string;
	applied: boolean;
	executed: string[];
	mutationWarning?: string;
}

async function listTmuxSessions(): Promise<TmuxSessionInfo[]> {
	try {
		const output = await runText("tmux", ["list-sessions", "-F", "#S\t#{session_path}\t#{pane_current_command}\t#{pane_current_path}"]);
		return output.split("\n").flatMap((line) => {
			if (!line.trim()) return [];
			const [name, path, paneCommand, panePath] = line.split("\t");
			return name ? [{ name, path: path || undefined, paneCommand: paneCommand || undefined, panePath: panePath || undefined }] : [];
		});
	} catch { return []; }
}
async function listTmuxWindows(): Promise<TmuxWindowInfo[]> {
	try {
		const output = await runText("tmux", ["list-windows", "-a", "-F", "#S\t#W\t#{pane_current_command}\t#{pane_current_path}"]);
		return output.split("\n").flatMap((line) => {
			if (!line.trim()) return [];
			const [sessionName, windowName, paneCommand, panePath] = line.split("\t");
			return sessionName && windowName ? [{ sessionName, windowName, paneCommand: paneCommand || undefined, panePath: panePath || undefined }] : [];
		});
	} catch { return []; }
}

/** Read-only preservation check against cached remote refs. All live local refs (including HEAD and stash) count. */
export async function inspectCommitSafety(path: string): Promise<Pick<GeneralBenchState, "upstream" | "localOnlyCommits" | "commitSafety" | "ignoredFiles">> {
	try {
		const ignored = await runText("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], path);
		const ignoredFiles = ignored.split("\0").filter(Boolean).length;
		let upstream: string | undefined;
		try { upstream = (await runText("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], path)).trim(); } catch { /* no upstream */ }
		// Reflogs include obsolete remote tips after pruning/force-pushes and abandoned
		// local history. They are not live local refs whose work must be preserved.
		const output = (await runText("git", ["rev-list", "--count", "--all", "--not", "--remotes"], path)).trim();
		const count = Number(output);
		if (!/^\d+$/.test(output) || !Number.isSafeInteger(count)) throw new Error("Cannot count local-only commits.");
		return { upstream, localOnlyCommits: count, ignoredFiles, commitSafety: count ? "local-only" : "safe" };
	} catch { return { commitSafety: "unknown" }; }
}

async function inspectLocalBench(target: BenchDefinition, tmuxSessions: TmuxSessionInfo[], tmuxWindows: TmuxWindowInfo[], snapshot?: SnapshotFile): Promise<GeneralBenchState> {
	const benchPath = join(BENCH_CHECKOUTS_DIR, target.id);
	const tmux = tmuxSessions.find((item) => item.name === target.id);
	const tmuxExists = !!tmux || await commandSucceeds("tmux", ["has-session", "-t", `=${target.id}`]);
	const piWindow = tmuxWindows.find((item) => item.sessionName === target.id && item.windowName === "pi");
	const snapshotPr = snapshot?.pullRequests.find((item) => item.number === target.pr);
	const checkoutExists = await pathExists(benchPath);
	const bench: GeneralBenchState = {
		id: target.id, repo: target.repo, pr: target.pr, branchName: target.branchName, sessionName: target.id, benchPath,
		branchExists: false, checkoutExists, checkoutKind: checkoutExists ? "unknown" : undefined, worktreeRegistered: false,
		tmuxExists, tmuxPath: tmux?.path, tmuxPaneCommand: tmux?.paneCommand, tmuxPanePath: tmux?.panePath,
		piWindowExists: tmuxExists ? !!piWindow : false, piWindowPaneCommand: piWindow?.paneCommand, piWindowPanePath: piWindow?.panePath,
		dirtyStatus: checkoutExists ? "unknown" : undefined, freshness: "unknown", snapshotHeadOid: snapshotPr?.headOid,
		title: snapshotPr?.title, author: snapshotPr?.author, url: snapshotPr?.url, warnings: [],
	};
	if (checkoutExists) {
		try {
			if ((await lstat(benchPath)).isSymbolicLink()) throw new Error("Checkout path is a symlink.");
			const topLevel = (await runText("git", ["rev-parse", "--show-toplevel"], benchPath)).trim();
			if (await realpath(benchPath) !== await realpath(topLevel)) throw new Error("Path is not a git checkout root.");
			if (!isMaglevOrigin(await runText("git", ["config", "--get", "remote.origin.url"], benchPath))) throw new Error("Checkout origin is not OneBusAway/maglev.");
			bench.checkoutKind = "plain";
			bench.localHead = (await runText("git", ["rev-parse", "HEAD"], benchPath)).trim();
			bench.localHeadShort = shortOid(bench.localHead);
			bench.currentBranch = (await runText("git", ["rev-parse", "--abbrev-ref", "HEAD"], benchPath)).trim();
			bench.branchExists = await commandSucceeds("git", ["show-ref", "--verify", "--quiet", `refs/heads/${target.branchName}`], benchPath);
			const dirty = classifyBenchDirtyStatus(await runText("git", ["status", "--porcelain", "--untracked-files=all"], benchPath));
			bench.dirty = dirty.dirty; bench.dirtyStatus = dirty.status; bench.dirtyFiles = dirty.files;
			Object.assign(bench, await inspectCommitSafety(benchPath), freshnessFor(bench.localHead, snapshotPr?.headOid));
		} catch (err) {
			bench.warnings.push(`Could not fully inspect ${benchPath}: ${err instanceof Error ? err.message : String(err)}`);
			bench.commitSafety = "unknown";
		}
	}
	return bench;
}

export async function collectAllBenchStates(params: { ids?: string[]; prs?: number[] } = {}): Promise<{ benches: GeneralBenchState[]; snapshotWarning?: string }> {
	const [{ snapshot, warning: snapshotWarning }, definitions, sessions, windows] = await Promise.all([
		loadSnapshotOptional(), loadBenchDefinitions(), listTmuxSessions(), listTmuxWindows(),
	]);
	const targets = new Map(definitions.map((target) => [target.id, target]));
	const legacyPrs = new Set<number>();
	try {
		for (const entry of await readdir(BENCH_CHECKOUTS_DIR, { withFileTypes: true })) {
			const pr = prFromBenchPath(entry.name);
			if (pr) legacyPrs.add(pr);
		}
	} catch (err) { if (!isNotFoundError(err)) throw err; }
	for (const session of sessions) {
		const pr = prFromBenchPath(session.name);
		if (pr && session.path && resolve(session.path) === resolve(join(BENCH_CHECKOUTS_DIR, `pr-${pr}`))) legacyPrs.add(pr);
	}
	for (const pr of legacyPrs) {
		const target = prBenchDefinition(pr);
		if (!targets.has(target.id)) targets.set(target.id, target);
	}
	const benches = await Promise.all([...targets.values()]
		.filter((target) => (!params.ids?.length || params.ids.includes(target.id)) && (!params.prs?.length || (target.pr !== undefined && params.prs.includes(target.pr))))
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((target) => inspectLocalBench(target, sessions, windows, snapshot)));
	const associated = benches.flatMap((bench) => bench.pr === undefined ? [] : [bench.pr]);
	if (new Set(associated).size !== associated.length) throw new Error("Multiple local benches are associated with the same PR; resolve the identity conflict first.");
	return { benches, snapshotWarning };
}

/** Compatibility view: PR queue consumers must not receive unassociated benches. */
export async function collectBenchStates(params: BenchListInput = {}): Promise<{ benches: BenchState[]; snapshotWarning?: string }> {
	const result = await collectAllBenchStates(params);
	return { ...result, benches: result.benches.filter((bench): bench is BenchState => bench.pr !== undefined) };
}
export async function listBenches(params: BenchListInput = {}) { return collectBenchStates(params); }
export async function inspectBench(pr: number): Promise<{ bench: BenchState | null; snapshotWarning?: string }> {
	const result = await collectBenchStates({ prs: [pr] });
	return { bench: result.benches.find((item) => item.pr === pr) ?? null, snapshotWarning: result.snapshotWarning };
}
export async function inspectGeneralBench(id: string) {
	if (!validBenchId(id)) throw new Error("Invalid bench ID.");
	const result = await collectAllBenchStates({ ids: [id] });
	return { bench: result.benches[0] ?? null, snapshotWarning: result.snapshotWarning };
}
async function pathExists(path: string): Promise<boolean> {
	try { await lstat(path); return true; }
	catch (err) { if (isNotFoundError(err)) return false; throw err; }
}

async function startTarget(target: BenchDefinition, options: BenchStartOptions = {}): Promise<BenchStartResult> {
	const benchResult = await collectAllBenchStates();
	const existingBench = benchResult.benches.find((bench) => bench.id === target.id) ?? null;
	const { snapshot, warning: snapshotWarning } = target.pr ? await loadSnapshotOptional() : { snapshot: undefined, warning: undefined };
	const snapshotPr = snapshot?.pullRequests.find((pr) => pr.number === target.pr);
	const decisions = target.pr ? (await loadDecisions()).file.decisions : [];
	const plan = planBenchStart({
		target, requestedPr: target.pr, pr: snapshotPr, existingBench,
		decision: target.pr ? decisionMap(decisions).get(target.pr) : undefined,
		needsInference: target.pr && snapshot ? computeNeedsInference(snapshot, decisions, [target.pr]).some((row) => row.number === target.pr) : undefined,
		activeBenchPrs: benchResult.benches.flatMap((bench) => bench.pr ? [bench.pr] : []), snapshotFetchedAt: snapshot?.fetchedAt,
	}, { ...options, apply: options.apply ?? false, currentWorkingDirectory: options.currentWorkingDirectory ?? process.cwd() });
	if (!existingBench && await pathExists(plan.benchPath)) {
		const refusal = { severity: "refusal" as const, code: "unregistered-path", message: `Bench path ${plan.benchPath} already exists outside the known registry.` };
		plan.findings.push(refusal); plan.refusals.push(refusal); plan.status = "refused";
	}
	const common = { plan, snapshotWarning: target.pr ? snapshotWarning ?? benchResult.snapshotWarning : undefined };
	if (!options.apply) return { ...common, applied: false, executed: [] };
	if (plan.status !== "ready" && plan.status !== "reusable") return { ...common, applied: false, executed: [], mutationWarning: "Bench start was not applied because the plan is not ready." };
	if (!existingBench && await pathExists(plan.benchPath)) return { ...common, applied: false, executed: [], mutationWarning: `Bench path ${plan.benchPath} already exists outside the known registry.` };
	let contextPath: string | undefined;
	try {
		const deps = { runText, commandSucceeds, writeContext: async (context: string) => {
			contextPath = await writeBenchContext(join(BENCH_STATE_DIR, target.id), context); return contextPath;
		} };
		if (plan.status === "reusable") {
			const verification = await verifyBenchStart({ pr: snapshotPr, plan, existingBench }, deps);
			return { ...common, applied: verification.ok, executed: [], verification };
		}
		await mkdir(BENCH_CHECKOUTS_DIR, { recursive: true });
		// Persist before cloning so interrupted starts are discoverable and recoverable.
		await saveBenchDefinition(target);
		const executed = await executeBenchStart({ pr: snapshotPr, plan, existingBench }, deps);
		const verification = await verifyBenchStart({ pr: snapshotPr, plan, existingBench }, deps);
		return { ...common, applied: true, executed, contextPath, verification, mutationWarning: verification.ok ? undefined : "Bench start applied, but verification found partial or unexpected local state." };
	} catch (err) {
		return { ...common, applied: false, executed: err instanceof BenchStartExecutionError ? err.executed : [], contextPath, mutationWarning: err instanceof Error ? err.message : String(err) };
	}
}

export async function startBranchBench(branch: string, options: BenchStartOptions & { createFrom?: string } = {}): Promise<BenchStartResult> {
	const requested = branchBenchDefinition(branch, options.createFrom);
	const targets = await loadBenchDefinitions();
	const target = targets.find((bench) => bench.id === requested.id);
	if (target && options.createFrom && target.createFrom !== options.createFrom) throw new Error("Existing Bench has a different base ref; start will not change it.");
	return startTarget(target ?? requested, options);
}
export async function startBench(pr: number, options: BenchStartOptions = {}): Promise<BenchStartResult> {
	const { bench } = await inspectBench(pr);
	const definitions = await loadBenchDefinitions();
	return startTarget(definitions.find((target) => target.id === bench?.id) ?? prBenchDefinition(pr), options);
}

export async function associateBenchPr(id: string, pr: number, options: BenchStartOptions = {}): Promise<BenchStartResult> {
	const { bench } = await inspectGeneralBench(id);
	if (!bench?.checkoutExists || !bench.branchExists || bench.currentBranch !== bench.branchName) throw new Error("Association requires an existing Bench on its expected branch.");
	const definitions = await loadBenchDefinitions();
	const definition = definitions.find((target) => target.id === id);
	if (!definition) throw new Error("Bench has no manifest.");
	if (definition.pr && definition.pr !== pr) throw new Error("Bench is already associated with a different PR.");
	const existing = await inspectBench(pr);
	if (existing.bench && existing.bench.id !== id) throw new Error("PR already has another Bench.");
	const { snapshot, warning: snapshotWarning } = await loadSnapshotOptional();
	const snapshotPr = snapshot?.pullRequests.find((item) => item.number === pr);
	const headRepo = snapshotPr?.headRepositoryNameWithOwner ?? (snapshotPr?.headRepositoryOwner && snapshotPr?.headRepositoryName ? `${snapshotPr.headRepositoryOwner}/${snapshotPr.headRepositoryName}` : undefined);
	if (!snapshotPr || snapshotPr.headRefName !== definition.branchName || headRepo !== REPO) throw new Error("PR head repository/branch does not match this Maglev branch Bench.");
	const target = { ...definition, pr };
	const plan = planBenchStart({ target, pr: snapshotPr, existingBench: { ...bench, pr, ...freshnessFor(bench.localHead, snapshotPr.headOid) }, snapshotFetchedAt: snapshot?.fetchedAt }, { ...options, context: undefined });
	plan.actions = [`associate Bench ${id} with PR #${pr}; preserve checkout, tmux, Pi, and artifact paths`];
	if (plan.status === "reusable") plan.status = "ready";
	const applied = !!options.apply && plan.status === "ready";
	if (applied) await saveBenchDefinition(target);
	return { plan, snapshotWarning, applied, executed: applied ? plan.actions : [] };
}

export async function resetBench(pr: number, options: BenchResetOptions = {}): Promise<BenchResetResult> {
	const [{ snapshot, warning: snapshotWarning }, benchResult] = await Promise.all([loadSnapshotOptional(), inspectBench(pr)]);
	const snapshotPr = snapshot?.pullRequests.find((item) => item.number === pr);
	const plan = planBenchReset(benchResult.bench, snapshotPr, snapshot?.fetchedAt, { ...options, requestedPr: pr, currentWorkingDirectory: options.currentWorkingDirectory ?? process.cwd(), apply: options.apply ?? false });
	const common = { plan, snapshotWarning: snapshotWarning ?? benchResult.snapshotWarning };
	if (!options.apply || plan.status !== "ready") return { ...common, applied: false, executed: [] };
	try { return { ...common, applied: true, executed: await executeBenchReset(benchResult.bench, snapshotPr, plan, { runText, commandSucceeds }) }; }
	catch (err) { return { ...common, applied: false, executed: err instanceof BenchStartExecutionError ? err.executed : [], mutationWarning: err instanceof Error ? err.message : String(err) }; }
}

export async function closeGeneralBench(id: string, options: BenchCloseOptions = {}): Promise<BenchCloseResult> {
	const { bench, snapshotWarning } = await inspectGeneralBench(id);
	const plan = planBenchClose(bench, { ...options, currentWorkingDirectory: options.currentWorkingDirectory ?? process.cwd(), apply: options.apply ?? false });
	const executed: string[] = [];
	if (!plan.apply || plan.status !== "ready" || !bench) return { plan, snapshotWarning: bench?.pr ? snapshotWarning : undefined, applied: false, executed };
	if (plan.options.closeTmux && bench.tmuxExists) {
		await runText("tmux", ["kill-session", "-t", `=${bench.sessionName}`]); executed.push(`killed tmux session ${bench.sessionName}`);
	}
	if (plan.options.removeCheckout && bench.benchPath) {
		// Recheck after stopping Pi so edits made during planning cannot be silently discarded.
		const latest = await inspectGeneralBench(id);
		const finalPlan = planBenchClose(latest.bench, { ...options, currentWorkingDirectory: options.currentWorkingDirectory ?? process.cwd(), apply: true });
		if (finalPlan.status !== "ready") return { plan: finalPlan, snapshotWarning, applied: false, executed };
		await rm(bench.benchPath, { recursive: true, force: true }); executed.push(`removed bench path ${bench.benchPath}`);
		const stateDir = join(BENCH_STATE_DIR, id);
		await rm(stateDir, { recursive: true, force: true }); executed.push(`removed Bench state directory ${stateDir}`);
	}
	return { plan, snapshotWarning: bench.pr ? snapshotWarning : undefined, applied: true, executed };
}
export async function closeBench(pr: number, options: BenchCloseOptions = {}): Promise<BenchCloseResult> {
	const { bench } = await inspectBench(pr);
	return closeGeneralBench(bench?.id ?? prBenchDefinition(pr).id, { ...options, requestedPr: pr });
}
export async function closeBenchPlan(pr: number, options: BenchCloseOptions = {}) {
	const result = await closeBench(pr, { ...options, apply: false });
	return { plan: result.plan, snapshotWarning: result.snapshotWarning };
}
export { formatBenchClosePlan, formatBenchLine, formatBenchReportLines, formatBenchResetPlan, formatBenchStartPlan, formatBenchStartVerification, parseBenchCommandArgs, planBenchClose, planBenchReset, planBenchStart } from "./bench-core.ts";
