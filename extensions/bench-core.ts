import { join, relative, resolve } from "node:path";
import { REPO, SNAPSHOT_STALE_AFTER_HOURS } from "./constants.ts";
import { BENCH_CHECKOUTS_DIR } from "./paths.ts";
import { prBenchDefinition, validateBenchDefinition, type BenchDefinition } from "./bench-registry.ts";
import type { BenchDirtyFile, BenchDirtyStatus, BenchState, GeneralBenchState, SnapshotPR, TriageDecision, WorktreeInfo } from "./types.ts";
import { shortOid } from "./utils.ts";

export function parseWorktrees(output: string): WorktreeInfo[] {
	if (!output.trim()) return [];
	return output.trim().split(/\n\n+/).flatMap((block) => {
		const path = block.match(/^worktree (.+)$/m)?.[1];
		if (!path) return [];
		return [{
			path,
			head: block.match(/^HEAD (.+)$/m)?.[1],
			branch: block.match(/^branch (.+)$/m)?.[1],
		}];
	});
}

export function prFromBranch(branch?: string): number | undefined {
	const match = branch?.match(/^(?:refs\/heads\/)?pr-(\d+)$/);
	return match ? Number(match[1]) : undefined;
}

export function prFromBenchPath(path?: string): number | undefined {
	const match = path?.match(/(?:^|\/)pr-(\d+)$/);
	return match ? Number(match[1]) : undefined;
}

export function freshnessFor(localHead?: string, snapshotHead?: string): Pick<BenchState, "freshness" | "fresh"> {
	if (!localHead || !snapshotHead) return { freshness: "unknown" };
	const fresh = localHead === snapshotHead;
	return { freshness: fresh ? "fresh" : "stale", fresh };
}

export interface BenchDirtySummary {
	status: BenchDirtyStatus;
	dirty: boolean;
	files: BenchDirtyFile[];
	total: number;
}

const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

function porcelainPath(line: string): string {
	const raw = line.slice(3);
	const renameSeparator = " -> ";
	const renameIndex = raw.indexOf(renameSeparator);
	return renameIndex >= 0 ? raw.slice(renameIndex + renameSeparator.length) : raw;
}

export function classifyBenchDirtyStatus(statusPorcelain: string): BenchDirtySummary {
	const lines = statusPorcelain.split("\n").filter((line) => line.trim().length > 0);
	if (!lines.length) return { status: "clean", dirty: false, files: [], total: 0 };
	let hasUntracked = false;
	let hasModified = false;
	let hasStaged = false;
	let hasConflicted = false;
	const files = lines.map((line) => {
		const code = line.slice(0, 2);
		if (code === "??") {
			hasUntracked = true;
		} else if (CONFLICT_CODES.has(code)) {
			hasConflicted = true;
		} else {
			const indexStatus = code[0];
			const worktreeStatus = code[1];
			if (indexStatus && indexStatus !== " " && indexStatus !== "?") hasStaged = true;
			if (worktreeStatus && worktreeStatus !== " " && worktreeStatus !== "?") hasModified = true;
		}
		return { code, path: porcelainPath(line) };
	});
	const status: BenchDirtyStatus = hasConflicted
		? "conflicted"
		: hasStaged
			? "staged"
			: hasModified
				? "modified"
				: hasUntracked
					? "untracked-only"
					: "unknown";
	return { status, dirty: status !== "clean", files, total: files.length };
}

export function formatBenchLine(bench: GeneralBenchState): string {
	const dirtyLabel = bench.dirtyStatus && bench.dirtyStatus !== "clean" ? bench.dirtyStatus : bench.dirty ? "dirty" : undefined;
	const parts = [
		bench.tmuxExists ? `tmux ${bench.sessionName}` : "no tmux",
		bench.benchPath ?? "no bench path",
		bench.localHeadShort ? `HEAD ${bench.localHeadShort}` : undefined,
		bench.freshness !== "unknown" ? bench.freshness : undefined,
		dirtyLabel,
	].filter(Boolean);
	return `${bench.pr ? `#${bench.pr}` : bench.id ?? bench.branchName}${bench.title ? ` ${bench.title}` : ""} — ${!bench.pr || bench.id?.startsWith("branch-") ? `${bench.branchName} • ` : ""}${parts.join(" • ")}`;
}

export function parseBenchCommandArgs(args: string): { clear: boolean; prs?: number[]; error?: string } {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	const clear = tokens.some((token) => token === "clear" || token === "--clear");
	const prs: number[] = [];
	for (const token of tokens) {
		if (token === "clear" || token === "--clear") continue;
		const normalized = token.replace(/^#/, "");
		if (!/^\d+$/.test(normalized)) return { clear, error: `Invalid PR number argument: ${token}` };
		prs.push(Number(normalized));
	}
	return { clear, prs: prs.length ? prs : undefined };
}

export function formatBenchReportLines(benches: BenchState[], snapshotWarning?: string): string[] {
	return [
		`PR Benches (${benches.length})`,
		snapshotWarning ? `Snapshot freshness unavailable: ${snapshotWarning}` : undefined,
		...(benches.length ? benches.map(formatBenchLine) : ["No local PR Benches found."]),
	].filter((line): line is string => !!line);
}

export interface BenchListInput {
	prs?: number[];
}

export interface BenchListResult {
	benches: BenchState[];
	snapshotWarning?: string;
}

export type BenchCloseAllowDirty = "none" | "untracked" | "any";

export interface BenchStartInput {
	target?: BenchDefinition;
	requestedPr?: number;
	pr?: SnapshotPR;
	existingBench?: GeneralBenchState | null;
	decision?: TriageDecision;
	needsInference?: boolean;
	activeBenchPrs?: number[];
	snapshotFetchedAt?: string;
}

export interface BenchStartOptions {
	apply?: boolean;
	context?: string;
	allowDraft?: boolean;
	allowBadChecks?: boolean;
	allowConflicts?: boolean;
	allowPinned?: boolean;
	allowNeedsInference?: boolean;
	allowStaleSnapshot?: boolean;
	allowHeadMismatch?: boolean;
	allowStackParentMissing?: boolean;
	reuseExisting?: boolean;
	snapshotMaxAgeHours?: number;
	now?: string;
	currentWorkingDirectory?: string;
}

export interface BenchStartFinding {
	severity: "info" | "warning" | "refusal";
	code: string;
	message: string;
	acknowledged?: boolean;
}

export interface BenchStartPlan {
	target: BenchDefinition;
	pr?: number;
	apply: boolean;
	status: "ready" | "reusable" | "needs-override" | "refused";
	benchPath: string;
	branchName: string;
	sessionName: string;
	headRemoteName?: string;
	headRemoteUrl?: string;
	actions: string[];
	findings: BenchStartFinding[];
	refusals: BenchStartFinding[];
	warnings: BenchStartFinding[];
	unacknowledgedWarnings: BenchStartFinding[];
	options: Required<Pick<BenchStartOptions, "apply" | "allowDraft" | "allowBadChecks" | "allowConflicts" | "allowPinned" | "allowNeedsInference" | "allowStaleSnapshot" | "allowHeadMismatch" | "allowStackParentMissing" | "reuseExisting" | "snapshotMaxAgeHours">> & Pick<BenchStartOptions, "context">;
}

export interface BenchStartExecutionDeps {
	writeContext?: (context: string) => Promise<string>;
	runText: (cmd: string, args: string[], cwd?: string) => Promise<string>;
	commandSucceeds: (cmd: string, args: string[], cwd?: string) => Promise<boolean>;
}

export interface BenchStartExecutionInput {
	pr?: SnapshotPR;
	plan: BenchStartPlan;
	existingBench?: GeneralBenchState | null;
}

export interface BenchStartVerificationFinding {
	code: string;
	message: string;
	expected?: string;
	actual?: string;
}

export interface BenchStartVerification {
	ok: boolean;
	findings: BenchStartVerificationFinding[];
}

export class BenchStartExecutionError extends Error {
	executed: string[];
	constructor(message: string, executed: string[]) {
		super(message);
		this.name = "BenchStartExecutionError";
		this.executed = executed;
	}
}

export const PI_TMUX_WINDOW_NAME = "pi";

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function piTmuxCommand(target: number | BenchDefinition, contextPath?: string): string {
	const contextArg = contextPath ? ` --append-system-prompt ${shellQuote(contextPath)}` : "";
	const name = typeof target === "number" ? `Review PR #${target}` : target.pr ? `Review PR #${target.pr}` : `Bench ${target.branchName}`;
	return `pi --name ${shellQuote(name)}${contextArg}; exec \${SHELL:-/bin/bash} -l`;
}

function formatOptionalList(items: string[] | undefined, empty = "none"): string {
	return items?.length ? items.map((item) => `- ${item}`).join("\n") : empty;
}

function formatActivity(activity: SnapshotPR["lastCommit"]): string {
	if (!activity) return "none";
	const parts = [activity.at, activity.author, activity.state, activity.oid ? shortOid(activity.oid) : undefined, activity.body].filter(Boolean);
	return parts.join(" — ");
}

function truncateForKickoff(value?: string, max = 1200): string {
	if (!value?.trim()) return "";
	const trimmed = value.trim();
	return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function formatExistingReviews(pr: SnapshotPR, max = 12): string {
	const reviews = [...pr.reviews]
		.sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt))
		.slice(-max);
	if (!reviews.length) return "none";
	return reviews.map((review) => {
		const body = truncateForKickoff(review.body);
		return `- ${review.submittedAt} — ${review.author} — ${review.state}${body ? `\n  ${body.replace(/\n/g, "\n  ")}` : ""}`;
	}).join("\n");
}

function formatExistingComments(pr: SnapshotPR, max = 20): string {
	const comments = [...pr.comments]
		.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
		.slice(-max);
	if (!comments.length) return "none";
	return comments.map((comment) => {
		const body = truncateForKickoff(comment.body);
		return `- ${comment.createdAt} — ${comment.author}${body ? `\n  ${body.replace(/\n/g, "\n  ")}` : ""}`;
	}).join("\n");
}

function renderTemplate(template: string, values: Record<string, string>): string {
	return `${template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (match, key: string) => values[key] ?? match).trim()}\n`;
}

export function buildBenchKickoffPromptFromTemplate(template: string, pr: SnapshotPR, decision?: TriageDecision, handoffContext?: string, benchPath = expectedBenchPath(pr.number)): string {
	const stackMetadata = [
		pr.stackBasePR ? `- Stack parent PR: #${pr.stackBasePR}` : undefined,
		pr.stackChildren?.length ? `- Stack child PRs: ${pr.stackChildren.map((child) => `#${child}`).join(", ")}` : undefined,
	].filter(Boolean).join("\n");
	const changedFiles = `${formatOptionalList(pr.files.slice(0, 80))}${pr.files.length > 80 ? `\n- …${pr.files.length - 80} more` : ""}`;
	return renderTemplate(template, {
		prNumber: String(pr.number),
		benchPath,
		title: pr.title,
		author: pr.author,
		url: pr.url,
		baseRef: pr.baseRefName ?? "unknown",
		headRef: `${pr.headRepositoryNameWithOwner ?? "unknown"}:${pr.headRefName ?? "unknown"}`,
		draft: pr.isDraft ? "yes" : "no",
		reviewDecision: pr.reviewDecision || "none",
		mergeState: pr.mergeStateStatus || "unknown",
		badChecks: pr.badChecks.length ? pr.badChecks.join(", ") : "none",
		meaningfulUpdatedAt: pr.meaningfulUpdatedAt,
		headOid: pr.headOid ?? "unknown",
		stackMetadata: stackMetadata ? `${stackMetadata}\n` : "",
		decisionBucket: decision?.bucket ?? "none",
		decisionPriority: decision?.priority !== undefined ? String(decision.priority) : "none",
		decisionReason: decision?.reason ?? "none",
		decisionObservations: formatOptionalList(decision?.observations),
		lastCommit: formatActivity(pr.lastCommit),
		lastHumanReview: formatActivity(pr.lastHumanReview),
		lastChangeRequest: formatActivity(pr.lastChangeRequest),
		lastHumanComment: formatActivity(pr.lastHumanComment),
		lastChase: formatActivity(pr.lastChase),
		existingReviews: formatExistingReviews(pr),
		existingComments: formatExistingComments(pr),
		changedFiles,
		handoffSection: handoffContext?.trim() ? `\nAdditional handoff context from the triage session:\n${handoffContext.trim()}\n` : "",
	});
}

export interface BenchResetOptions {
	requestedPr?: number;
	apply?: boolean;
	allowDirty?: BenchCloseAllowDirty;
	allowStaleSnapshot?: boolean;
	snapshotMaxAgeHours?: number;
	now?: string;
	currentWorkingDirectory?: string;
}

export interface BenchResetFinding {
	severity: "info" | "warning" | "refusal";
	code: string;
	message: string;
	acknowledged?: boolean;
}

export interface BenchResetPlan {
	pr: number;
	apply: boolean;
	status: "ready" | "needs-override" | "refused";
	actions: string[];
	findings: BenchResetFinding[];
	refusals: BenchResetFinding[];
	warnings: BenchResetFinding[];
	unacknowledgedWarnings: BenchResetFinding[];
	benchPath?: string;
	branchName: string;
	options: Required<Pick<BenchResetOptions, "apply" | "allowDirty" | "allowStaleSnapshot" | "snapshotMaxAgeHours">>;
}

export interface BenchCloseOptions {
	requestedPr?: number;
	apply?: boolean;
	allowDirty?: BenchCloseAllowDirty;
	allowStale?: boolean;
	allowLocalCommits?: boolean;
	closeTmux?: boolean;
	removeCheckout?: boolean;
	deleteBranch?: boolean;
	currentWorkingDirectory?: string;
}

export interface BenchCloseFinding {
	severity: "info" | "warning" | "refusal";
	code: string;
	message: string;
	acknowledged?: boolean;
}

export interface BenchClosePlan {
	id?: string;
	pr?: number;
	apply: boolean;
	status: "ready" | "needs-override" | "refused";
	actions: string[];
	findings: BenchCloseFinding[];
	refusals: BenchCloseFinding[];
	warnings: BenchCloseFinding[];
	unacknowledgedWarnings: BenchCloseFinding[];
	options: Required<Pick<BenchCloseOptions, "apply" | "allowDirty" | "allowStale" | "allowLocalCommits" | "closeTmux" | "removeCheckout" | "deleteBranch">>;
}

function isInsidePath(child: string, parent: string): boolean {
	const relativePath = relative(resolve(parent), resolve(child));
	return relativePath === "" || (!!relativePath && !relativePath.startsWith("..") && !relativePath.startsWith("/"));
}

export function expectedBenchPath(pr: number): string {
	return join(BENCH_CHECKOUTS_DIR, `pr-${pr}`);
}

function acknowledgedFinding(severity: "warning", code: string, message: string, acknowledged: boolean): BenchStartFinding {
	return { severity, code, message, acknowledged };
}

function snapshotAgeHours(fetchedAt?: string, now?: string): number | undefined {
	if (!fetchedAt) return undefined;
	const fetchedMs = Date.parse(fetchedAt);
	const nowMs = Date.parse(now ?? new Date().toISOString());
	if (!Number.isFinite(fetchedMs) || !Number.isFinite(nowMs)) return undefined;
	return (nowMs - fetchedMs) / (60 * 60 * 1000);
}

function mergeStateIsClean(pr: SnapshotPR): boolean {
	return !pr.mergeStateStatus || pr.mergeStateStatus === "CLEAN";
}

function safeRemotePart(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]/g, "-");
}

function headRepoFullName(pr: SnapshotPR): string | undefined {
	return pr.headRepositoryNameWithOwner ?? (pr.headRepositoryOwner && pr.headRepositoryName ? `${pr.headRepositoryOwner}/${pr.headRepositoryName}` : undefined);
}

function headRemoteUrl(pr: SnapshotPR): string | undefined {
	const fullName = headRepoFullName(pr);
	return fullName ? `https://github.com/${fullName}.git` : undefined;
}

function headRemoteName(prNumber: number, pr: SnapshotPR): string | undefined {
	return pr.headRepositoryOwner ? `pr-${prNumber}-${safeRemotePart(pr.headRepositoryOwner)}` : undefined;
}

export function planBenchStart(input: BenchStartInput, options: BenchStartOptions = {}): BenchStartPlan {
	const prNumber = input.pr?.number ?? input.target?.pr ?? input.existingBench?.pr ?? input.requestedPr ?? 0;
	const target = input.target ?? (prNumber ? prBenchDefinition(prNumber) : { id: "pr-?", repo: REPO, branchName: "pr-?" });
	const branchName = target.branchName;
	const sessionName = target.id;
	const benchPath = join(BENCH_CHECKOUTS_DIR, target.id);
	const normalized = {
		apply: options.apply ?? false,
		context: options.context?.trim() ? options.context : undefined,
		allowDraft: options.allowDraft ?? false,
		allowBadChecks: options.allowBadChecks ?? false,
		allowConflicts: options.allowConflicts ?? false,
		allowPinned: options.allowPinned ?? false,
		allowNeedsInference: options.allowNeedsInference ?? false,
		allowStaleSnapshot: options.allowStaleSnapshot ?? false,
		allowHeadMismatch: options.allowHeadMismatch ?? false,
		allowStackParentMissing: options.allowStackParentMissing ?? false,
		reuseExisting: options.reuseExisting ?? true,
		snapshotMaxAgeHours: options.snapshotMaxAgeHours ?? SNAPSHOT_STALE_AFTER_HOURS,
	};
	const actions: string[] = [];
	const findings: BenchStartFinding[] = [];
	const pr = input.pr;
	const bench = input.existingBench ?? null;
	const checkoutExists = !!(bench && (bench.checkoutExists || bench.worktreeRegistered));
	if (input.target || prNumber) {
		try { validateBenchDefinition(target); }
		catch (err) { findings.push({ severity: "refusal", code: "invalid-target", message: String(err) }); }
	}

	if (!pr && (target.pr || !input.target)) {
		findings.push({ severity: "refusal", code: "missing-snapshot-pr", message: "PR is not present in the GitHub snapshot." });
	} else if (pr) {
		if (pr.isDraft) findings.push({ severity: "info", code: "draft-pr", message: "PR is marked draft." });
		if (!mergeStateIsClean(pr)) findings.push({ severity: "info", code: "non-clean-merge-state", message: `PR merge state is ${pr.mergeStateStatus || "unknown"}; a PR Bench can still be created for review or fixes.` });
		if (pr.badChecks.length) findings.push({ severity: "info", code: "bad-checks", message: `PR has failing/problem checks: ${pr.badChecks.slice(0, 5).join(", ")}${pr.badChecks.length > 5 ? `, …${pr.badChecks.length - 5} more` : ""}.` });
		if (!pr.headOid) findings.push(acknowledgedFinding("warning", "missing-snapshot-head", "Snapshot does not include a PR head OID, so start cannot verify exact code without refreshing.", normalized.allowStaleSnapshot));
		findings.push({ severity: "info", code: "gh-pr-checkout", message: `PR #${pr.number} will be checked out with gh pr checkout into branch ${branchName}; gh manages fork remotes and push configuration inside the PR Bench checkout.` });
		if (input.needsInference) findings.push({ severity: "info", code: "needs-inference", message: "PR has no current triage decision or its saved decision is stale." });
		if (input.decision?.bucket === "pinned") findings.push({ severity: "info", code: "pinned", message: `PR is pinned: ${input.decision.reason}` });
		if (pr.stackBasePR && !(input.activeBenchPrs ?? []).includes(pr.stackBasePR)) findings.push({ severity: "info", code: "stack-parent-missing", message: `PR is stacked on #${pr.stackBasePR}, which does not have a local PR Bench.` });
		const age = snapshotAgeHours(input.snapshotFetchedAt, options.now);
		if (age !== undefined && age > normalized.snapshotMaxAgeHours) findings.push(acknowledgedFinding("warning", "stale-snapshot", `Snapshot is ${age.toFixed(1)} hours old; refresh before starting unless intentionally using stale facts.`, normalized.allowStaleSnapshot));
	}

	const piWindowKnown = bench?.piWindowExists !== undefined;
	const hasRequiredPiWindow = !bench?.tmuxExists || !piWindowKnown || bench.piWindowExists;
	const needsPiWindow = !!bench?.tmuxExists && piWindowKnown && !bench.piWindowExists;
	const willStartPi = !bench?.tmuxExists || needsPiWindow;
	if (normalized.context && !willStartPi) findings.push({ severity: "refusal", code: "context-requires-new-pi", message: "Caller context can only be injected when launching a new Pi window; start will not replace or send input to an existing Pi session. Omit context to reuse the Bench." });

	if (bench) {
		if (bench.currentBranch && bench.branchExists && bench.currentBranch !== branchName) findings.push({ severity: "refusal", code: "current-branch-mismatch", message: `Checkout is on ${bench.currentBranch}, not ${branchName}; start will not switch an existing Bench.` });
		if (checkoutExists && !bench.branchExists && ((bench.dirtyStatus && bench.dirtyStatus !== "clean") || (bench.localOnlyCommits ?? 0) > 0)) findings.push({ severity: "refusal", code: "unsafe-checkout-recovery", message: "Missing Bench branch cannot be recovered over local work." });
		if (bench.tmuxPath && resolve(bench.tmuxPath) !== resolve(benchPath)) findings.push({ severity: "refusal", code: "tmux-path-mismatch", message: "Tmux session belongs to a different checkout." });
		if (bench.branchName !== branchName) findings.push({ severity: "refusal", code: "branch-name-mismatch", message: `Branch name ${bench.branchName} does not match expected ${branchName}.` });
		if (bench.sessionName !== sessionName) findings.push({ severity: "refusal", code: "session-name-mismatch", message: `Tmux session name ${bench.sessionName} does not match expected ${sessionName}.` });
		if (bench.benchPath && bench.benchPath !== benchPath) findings.push({ severity: "refusal", code: "bench-path-mismatch", message: `Bench path ${bench.benchPath} does not match expected ${benchPath}.` });
		if (checkoutExists && bench.checkoutKind === "unknown") findings.push({ severity: "refusal", code: "invalid-checkout", message: `Bench path ${bench.benchPath ?? benchPath} exists but is not a usable git checkout.` });
		if (options.currentWorkingDirectory && bench.benchPath && isInsidePath(options.currentWorkingDirectory, bench.benchPath)) findings.push({ severity: "info", code: "current-directory", message: `Current working directory is already inside PR Bench ${bench.benchPath}.` });
		if (bench.dirtyStatus && bench.dirtyStatus !== "clean") findings.push({ severity: "info", code: `dirty-${bench.dirtyStatus}`, message: `Existing PR Bench has ${bench.dirtyStatus} local file state.` });
		if ((bench.fresh === false || bench.freshness === "stale") && pr?.headOid) findings.push(acknowledgedFinding("warning", "head-mismatch", "Existing PR Bench local HEAD differs from the snapshot PR head.", normalized.allowHeadMismatch));
		if (bench.branchExists && checkoutExists && bench.tmuxExists && hasRequiredPiWindow) {
			findings.push({ severity: "info", code: "reuse-existing", message: "A local PR Bench already exists and can be reused." });
		} else {
			if (bench.branchExists) findings.push({ severity: "info", code: "existing-branch", message: `Branch ${branchName} already exists.` });
			if (checkoutExists) findings.push({ severity: "info", code: "existing-checkout", message: `Bench path ${bench.benchPath ?? benchPath} already exists.` });
			if (bench.tmuxExists) findings.push({ severity: "info", code: "existing-tmux", message: `Tmux session ${sessionName} already exists.` });
			if (needsPiWindow) findings.push({ severity: "info", code: "missing-pi-window", message: `Tmux session ${sessionName} does not have a ${PI_TMUX_WINDOW_NAME} window yet.` });
		}
	}

	if (!checkoutExists) actions.push(`clone ${REPO} into ${target.pr ? "PR Bench" : "Bench"} checkout ${benchPath}`);
	if (!bench?.branchExists || !checkoutExists) actions.push(target.pr ? `check out PR #${prNumber || "?"} with gh pr checkout into branch ${branchName}` : target.createFrom ? `create branch ${branchName} from ${target.createFrom}` : `check out existing remote branch ${branchName}`);
	if (normalized.context && willStartPi) actions.push("save caller context and append it to the new Pi session's system prompt (no automatic task)");
	if (!bench?.tmuxExists) actions.push(`start tmux session ${sessionName} with ${PI_TMUX_WINDOW_NAME} window at ${benchPath}`);
	if (needsPiWindow) actions.push(`start pi in tmux window ${PI_TMUX_WINDOW_NAME} for session ${sessionName} at ${benchPath}`);
	if (bench?.branchExists && checkoutExists && bench.tmuxExists && hasRequiredPiWindow) {
		if (normalized.reuseExisting) actions.push(`reuse existing PR Bench ${benchPath}`);
		else findings.push({ severity: "refusal", code: "bench-already-exists", message: "A local PR Bench already exists; start will not recreate it destructively." });
	}

	const refusals = findings.filter((finding) => finding.severity === "refusal");
	const warnings = findings.filter((finding) => finding.severity === "warning");
	const unacknowledgedWarnings = warnings.filter((finding) => !finding.acknowledged);
	const allExisting = !!bench?.branchExists && checkoutExists && bench.tmuxExists && hasRequiredPiWindow && normalized.reuseExisting;
	return {
		pr: prNumber || undefined,
		apply: normalized.apply,
		status: refusals.length ? "refused" : unacknowledgedWarnings.length ? "needs-override" : allExisting ? "reusable" : "ready",
		target,
		benchPath,
		branchName,
		sessionName,
		headRemoteName: undefined,
		headRemoteUrl: undefined,
		actions,
		findings,
		refusals,
		warnings,
		unacknowledgedWarnings,
		options: normalized,
	};
}

export function formatBenchStartPlan(plan: BenchStartPlan): string[] {
	const headingPr = plan.pr ? `#${plan.pr}` : "requested PR";
	return [
		`${plan.pr ? "PR Bench" : "Bench"} start plan for ${plan.pr ? headingPr : plan.target.id}: ${plan.status}`,
		plan.apply ? "Apply requested; execution proceeds only when the plan is ready." : "Dry run only; no changes were made.",
		`Bench path: ${plan.benchPath}`,
		`Branch: ${plan.branchName}`,
		`Tmux session: ${plan.sessionName}`,
		...(plan.actions.length ? ["Actions:", ...plan.actions.map((action) => `- ${action}`)] : ["Actions: none"]),
		...(plan.findings.length ? ["Findings:", ...plan.findings.map((finding) => `- ${finding.severity.toUpperCase()}${finding.acknowledged ? " (acknowledged)" : ""}: ${finding.message}`)] : []),
		...(plan.status === "needs-override" ? ["Re-run with explicit start-safety acknowledgements before applying."] : []),
	].filter(Boolean);
}

function assertStartInputs(pr: SnapshotPR | undefined, plan: BenchStartPlan, needsCheckout = true): void {
	if (plan.status !== "ready") throw new Error(`PR Bench start plan is ${plan.status}, not ready.`);
	if (!plan.apply) throw new Error("PR Bench start plan is a dry run; execution requires apply.");
	validateBenchDefinition(plan.target);
	if (plan.branchName !== plan.target.branchName || plan.sessionName !== plan.target.id || plan.benchPath !== join(BENCH_CHECKOUTS_DIR, plan.target.id)) throw new Error("Bench start identity/path mismatch.");
	if (plan.target.pr && plan.target.pr !== pr?.number) throw new Error("PR association does not match requested PR.");
	if (needsCheckout && plan.target.pr && !pr?.headOid) throw new Error("Snapshot PR is missing headOid.");
}

export async function executeBenchStart(input: BenchStartExecutionInput, deps: BenchStartExecutionDeps): Promise<string[]> {
	const { pr, plan, existingBench } = input;
	const checkoutExists = !!(existingBench && (existingBench.checkoutExists || existingBench.worktreeRegistered));
	const needsCheckout = !checkoutExists || !existingBench?.branchExists;
	const needsPiWindow = !!existingBench?.tmuxExists && existingBench.piWindowExists === false;
	const willStartPi = !existingBench?.tmuxExists || needsPiWindow;
	const completingExistingCheckoutOnly = !!existingBench && checkoutExists && existingBench.branchExists && !needsCheckout && willStartPi;
	assertStartInputs(pr, plan, needsCheckout);
	if (plan.options.context && (!willStartPi || !deps.writeContext)) throw new Error("Caller context requires a new Pi window and a context writer.");
	const executed: string[] = [];
	const run = async (label: string, cmd: string, args: string[], cwd?: string): Promise<string> => {
		try {
			const output = await deps.runText(cmd, args, cwd);
			executed.push(label);
			return output;
		} catch (err) {
			throw new BenchStartExecutionError(`Failed to ${label}: ${err instanceof Error ? err.message : String(err)}`, executed);
		}
	};
	if (!checkoutExists) await run(`clone ${REPO} into ${plan.benchPath}`, "gh", ["repo", "clone", REPO, plan.benchPath]);
	if (needsCheckout) {
		if (plan.target.pr) {
			await run(`check out PR #${pr!.number} with gh pr checkout`, "gh", ["pr", "checkout", String(pr!.number), "--repo", REPO, "--branch", plan.branchName], plan.benchPath);
		} else if (plan.target.createFrom) {
			if (await deps.commandSucceeds("git", ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${plan.branchName}`], plan.benchPath)) throw new BenchStartExecutionError("Branch already exists on origin; omit createFrom to open it.", executed);
			await run(`create branch ${plan.branchName}`, "git", ["switch", "--no-track", "-c", plan.branchName, plan.target.createFrom], plan.benchPath);
		} else {
			const localBranch = await deps.commandSucceeds("git", ["show-ref", "--verify", "--quiet", `refs/heads/${plan.branchName}`], plan.benchPath);
			await run(`check out branch ${plan.branchName}`, "git", localBranch ? ["switch", plan.branchName] : ["switch", "--track", "-c", plan.branchName, `origin/${plan.branchName}`], plan.benchPath);
		}
	}
	const head = (await run("read PR Bench checkout HEAD", "git", ["rev-parse", "HEAD"], plan.benchPath)).trim();
	executed.pop();
	const acknowledgedExistingHeadMismatch = completingExistingCheckoutOnly && plan.options.allowHeadMismatch;
	if (pr?.headOid && head !== pr.headOid && !acknowledgedExistingHeadMismatch) throw new BenchStartExecutionError(`PR Bench checkout HEAD ${shortOid(head) ?? head} does not match snapshot head ${shortOid(pr.headOid) ?? pr.headOid}. Refresh metadata before starting.`, executed);
	let contextPath: string | undefined;
	if (plan.options.context) {
		try {
			contextPath = await deps.writeContext!(plan.options.context);
			executed.push(`saved caller context at ${contextPath}`);
		} catch (err) {
			throw new BenchStartExecutionError(`Failed to save caller context: ${err instanceof Error ? err.message : String(err)}`, executed);
		}
	}
	const command = piTmuxCommand(plan.target, contextPath);
	if (!existingBench?.tmuxExists) await run(`start tmux session ${plan.sessionName} with ${PI_TMUX_WINDOW_NAME} window`, "tmux", ["new-session", "-d", "-s", plan.sessionName, "-c", plan.benchPath, "-n", PI_TMUX_WINDOW_NAME, command]);
	else if (needsPiWindow) await run(`start pi in tmux window ${PI_TMUX_WINDOW_NAME}`, "tmux", ["new-window", "-d", "-t", `=${plan.sessionName}`, "-n", PI_TMUX_WINDOW_NAME, "-c", plan.benchPath, command]);
	return executed;
}

export async function executePristineBenchStart(input: BenchStartExecutionInput, deps: BenchStartExecutionDeps): Promise<string[]> {
	return executeBenchStart(input, deps);
}

async function readOptional(deps: BenchStartExecutionDeps, cmd: string, args: string[], cwd?: string): Promise<string | undefined> {
	try {
		return (await deps.runText(cmd, args, cwd)).trim();
	} catch {
		return undefined;
	}
}

function addMismatch(findings: BenchStartVerificationFinding[], code: string, message: string, expected?: string, actual?: string): void {
	if (expected !== actual) findings.push({ code, message, expected, actual });
}

export async function verifyBenchStart(input: BenchStartExecutionInput, deps: BenchStartExecutionDeps): Promise<BenchStartVerification> {
	const { pr, plan, existingBench } = input;
	const checkoutExists = !!(existingBench && (existingBench.checkoutExists || existingBench.worktreeRegistered));
	const acknowledgedExistingHeadMismatch = !!existingBench && checkoutExists && existingBench.branchExists && plan.options.allowHeadMismatch;
	const findings: BenchStartVerificationFinding[] = [];
	const checkoutOk = await deps.commandSucceeds("git", ["rev-parse", "--is-inside-work-tree"], plan.benchPath);
	if (!checkoutOk) findings.push({ code: "missing-checkout", message: `Bench path ${plan.benchPath} is not a usable git checkout.` });
	const branchExists = await deps.commandSucceeds("git", ["show-ref", "--verify", "--quiet", `refs/heads/${plan.branchName}`], plan.benchPath);
	if (!branchExists) findings.push({ code: "missing-branch", message: `Branch ${plan.branchName} does not exist in ${plan.benchPath}.` });
	const currentBranch = await readOptional(deps, "git", ["rev-parse", "--abbrev-ref", "HEAD"], plan.benchPath);
	addMismatch(findings, "branch-mismatch", "Bench checkout is not on the expected PR branch.", plan.branchName, currentBranch);
	const head = await readOptional(deps, "git", ["rev-parse", "HEAD"], plan.benchPath);
	if (pr?.headOid && !acknowledgedExistingHeadMismatch) addMismatch(findings, "head-mismatch", "Bench checkout HEAD does not match snapshot PR head.", pr.headOid, head);
	const tmuxExists = await deps.commandSucceeds("tmux", ["has-session", "-t", `=${plan.sessionName}`]);
	if (!tmuxExists) findings.push({ code: "missing-tmux", message: `Tmux session ${plan.sessionName} does not exist.` });
	else {
		const windowNames = await readOptional(deps, "tmux", ["list-windows", "-t", `=${plan.sessionName}`, "-F", "#W"]);
		if (!windowNames?.split("\n").includes(PI_TMUX_WINDOW_NAME)) findings.push({ code: "missing-pi-window", message: `Tmux session ${plan.sessionName} does not have a ${PI_TMUX_WINDOW_NAME} window.` });
	}
	return { ok: findings.length === 0, findings };
}

export function formatBenchStartVerification(verification: BenchStartVerification): string[] {
	return verification.ok
		? ["Verification: ok"]
		: ["Verification: failed/partial state", ...verification.findings.map((finding) => `- ${finding.message}${finding.expected !== undefined || finding.actual !== undefined ? ` Expected ${finding.expected ?? "<missing>"}; got ${finding.actual ?? "<missing>"}.` : ""}`)];
}

function dirtyFinding(bench: GeneralBenchState, allowDirty: BenchCloseAllowDirty): BenchCloseFinding | undefined {
	const status = bench.dirtyStatus ?? (bench.dirty ? "unknown" : "clean");
	if (status === "clean") return undefined;
	const total = bench.dirtyFiles?.length;
	const sample = bench.dirtyFiles?.slice(0, 3).map((file) => file.path).join(", ");
	const extra = sample ? `: ${sample}${total && total > 3 ? `, …${total - 3} more` : ""}` : "";
	const acknowledged = allowDirty === "any" || (allowDirty === "untracked" && status === "untracked-only");
	return {
		severity: "warning",
		code: `dirty-${status}`,
		message: `Bench has ${status} local file state${extra}`,
		acknowledged,
	};
}

function dirtyResetFinding(bench: BenchState, allowDirty: BenchCloseAllowDirty): BenchResetFinding | undefined {
	const closeFinding = dirtyFinding(bench, allowDirty);
	if (!closeFinding) return undefined;
	return {
		...closeFinding,
		message: `${closeFinding.message}; resetting will discard those changes.`,
	};
}

export function planBenchReset(bench: BenchState | null, pr: SnapshotPR | undefined, snapshotFetchedAt?: string, options: BenchResetOptions = {}): BenchResetPlan {
	const normalized = {
		apply: options.apply ?? false,
		allowDirty: options.allowDirty ?? "none" as BenchCloseAllowDirty,
		allowStaleSnapshot: options.allowStaleSnapshot ?? false,
		snapshotMaxAgeHours: options.snapshotMaxAgeHours ?? SNAPSHOT_STALE_AFTER_HOURS,
	};
	const prNumber = pr?.number ?? bench?.pr ?? options.requestedPr ?? 0;
	const branchName = bench?.branchName ?? `pr-${prNumber || "?"}`;
	const actions: string[] = [];
	const findings: BenchResetFinding[] = [];
	if (!bench) {
		findings.push({ severity: "refusal", code: "missing-bench", message: "No local PR Bench found to reset." });
	} else {
		const id = bench.id ?? `pr-${bench.pr}`;
		const expectedBranch = id.startsWith("branch-") ? bench.branchName : `pr-${bench.pr}`;
		try { validateBenchDefinition({ id, repo: bench.repo ?? REPO, branchName: bench.branchName, pr: bench.pr }); }
		catch (err) { findings.push({ severity: "refusal", code: "invalid-identity", message: String(err) }); }
		if (bench.currentBranch && bench.currentBranch !== bench.branchName) findings.push({ severity: "refusal", code: "current-branch-mismatch", message: "Checkout is not on the Bench branch." });
		if (!bench.checkoutExists && !bench.worktreeRegistered) findings.push({ severity: "refusal", code: "missing-checkout", message: "PR Bench checkout does not exist." });
		if (bench.checkoutKind === "unknown") findings.push({ severity: "refusal", code: "invalid-checkout", message: `Bench path ${bench.benchPath ?? expectedBenchPath(bench.pr)} exists but is not a usable git checkout.` });
		if (bench.branchName !== expectedBranch) findings.push({ severity: "refusal", code: "branch-name-mismatch", message: `Branch name ${bench.branchName} does not match expected ${expectedBranch}.` });
		if (bench.benchPath) {
			if (bench.benchPath !== join(BENCH_CHECKOUTS_DIR, id)) findings.push({ severity: "refusal", code: "bench-path-mismatch", message: `Bench path ${bench.benchPath} does not match Bench ${id}.` });
			if (options.currentWorkingDirectory && isInsidePath(options.currentWorkingDirectory, bench.benchPath)) findings.push({ severity: "info", code: "current-directory", message: `Current working directory is inside PR Bench ${bench.benchPath}; reset may affect open files.` });
		}
		const dirty = dirtyResetFinding(bench, normalized.allowDirty);
		if (dirty) findings.push(dirty);
		if (bench.fresh === true || bench.freshness === "fresh") findings.push({ severity: "info", code: "already-fresh", message: "PR Bench local HEAD already matches the snapshot PR head." });
		else if (bench.fresh === false || bench.freshness === "stale") findings.push({ severity: "info", code: "head-mismatch", message: "PR Bench local HEAD differs from the snapshot PR head and can be reset." });
	}
	if (!pr) {
		findings.push({ severity: "refusal", code: "missing-snapshot-pr", message: "PR is not present in the GitHub snapshot." });
	} else {
		if (!pr.headOid) findings.push({ severity: "refusal", code: "missing-snapshot-head", message: "Snapshot does not include a PR head OID, so reset cannot verify exact code without refreshing." });
		const age = snapshotAgeHours(snapshotFetchedAt, options.now);
		if (age !== undefined && age > normalized.snapshotMaxAgeHours) findings.push({ severity: "warning", code: "stale-snapshot", message: `Snapshot is ${age.toFixed(1)} hours old; refresh before resetting unless intentionally using stale facts.`, acknowledged: normalized.allowStaleSnapshot });
	}
	if (bench && pr?.headOid && !(bench.fresh === true || bench.freshness === "fresh")) actions.push(`reset PR Bench checkout to PR #${prNumber || "?"} snapshot head with gh pr checkout --force`);
	const refusals = findings.filter((finding) => finding.severity === "refusal");
	const warnings = findings.filter((finding) => finding.severity === "warning");
	const unacknowledgedWarnings = warnings.filter((finding) => !finding.acknowledged);
	return {
		pr: prNumber,
		apply: normalized.apply,
		status: refusals.length ? "refused" : unacknowledgedWarnings.length ? "needs-override" : "ready",
		actions,
		findings,
		refusals,
		warnings,
		unacknowledgedWarnings,
		benchPath: bench?.benchPath ?? (prNumber ? expectedBenchPath(prNumber) : undefined),
		branchName,
		options: normalized,
	};
}

function assertResetInputs(bench: BenchState | null, pr: SnapshotPR | undefined, plan: BenchResetPlan): asserts bench is BenchState {
	if (plan.status !== "ready") throw new Error(`PR Bench reset plan is ${plan.status}, not ready.`);
	if (!plan.apply) throw new Error("PR Bench reset execution requires apply.");
	if (!bench) throw new Error("No local PR Bench found to reset.");
	if (!pr) throw new Error("PR is not present in the GitHub snapshot.");
	if (!pr.headOid) throw new Error("Snapshot PR is missing headOid.");
	if (!bench.benchPath) throw new Error("PR Bench path is unknown.");
}

export async function executeBenchReset(bench: BenchState | null, pr: SnapshotPR | undefined, plan: BenchResetPlan, deps: BenchStartExecutionDeps): Promise<string[]> {
	assertResetInputs(bench, pr, plan);
	const executed: string[] = [];
	const run = async (label: string, cmd: string, args: string[], cwd?: string): Promise<string> => {
		try {
			const output = await deps.runText(cmd, args, cwd);
			executed.push(label);
			return output;
		} catch (err) {
			throw new BenchStartExecutionError(`Failed to ${label}: ${err instanceof Error ? err.message : String(err)}`, executed);
		}
	};
	if (bench.dirtyStatus && bench.dirtyStatus !== "clean") {
		if (plan.options.allowDirty === "any" && bench.dirtyStatus !== "untracked-only") await run("discard local tracked changes", "git", ["reset", "--hard"], bench.benchPath);
		if (plan.options.allowDirty === "any" || plan.options.allowDirty === "untracked") await run("remove untracked files", "git", ["clean", "-fd"], bench.benchPath);
	}
	if (plan.actions.length) await run(`reset PR Bench checkout to PR #${pr.number} snapshot head`, "gh", ["pr", "checkout", String(pr.number), "--repo", REPO, "--branch", plan.branchName, "--force"], bench.benchPath);
	const head = (await run("read PR Bench checkout HEAD", "git", ["rev-parse", "HEAD"], bench.benchPath)).trim();
	executed.pop();
	if (head !== pr.headOid) throw new BenchStartExecutionError(`PR Bench checkout HEAD ${shortOid(head) ?? head} does not match snapshot head ${shortOid(pr.headOid) ?? pr.headOid}. Refresh metadata before resetting.`, executed);
	return executed;
}

export function formatBenchResetPlan(plan: BenchResetPlan): string[] {
	const headingPr = plan.pr ? `#${plan.pr}` : "requested PR";
	return [
		`PR Bench reset plan for ${headingPr}: ${plan.status}`,
		plan.apply ? "Apply requested; execution proceeds only when the plan is ready." : "Dry run only; no changes were made.",
		plan.benchPath ? `Bench path: ${plan.benchPath}` : undefined,
		`Branch: ${plan.branchName}`,
		...(plan.actions.length ? ["Actions:", ...plan.actions.map((action) => `- ${action}`)] : ["Actions: none"]),
		...(plan.findings.length ? ["Findings:", ...plan.findings.map((finding) => `- ${finding.severity.toUpperCase()}${finding.acknowledged ? " (acknowledged)" : ""}: ${finding.message}`)] : []),
		...(plan.status === "needs-override" ? ["Re-run with reset-safety acknowledgements before applying."] : []),
	].filter((line): line is string => !!line);
}

export function planBenchClose(bench: GeneralBenchState | null, options: BenchCloseOptions = {}): BenchClosePlan {
	const normalized = {
		apply: options.apply ?? false,
		allowDirty: options.allowDirty ?? "none",
		allowStale: options.allowStale ?? false,
		allowLocalCommits: options.allowLocalCommits ?? false,
		closeTmux: options.closeTmux ?? true,
		removeCheckout: options.removeCheckout ?? true,
		deleteBranch: options.deleteBranch ?? true,
	};
	const pr = bench?.pr ?? options.requestedPr;
	const actions: string[] = [];
	const findings: BenchCloseFinding[] = [];
	if (!bench) {
		findings.push({ severity: "refusal", code: "missing-bench", message: "No local PR Bench found." });
	} else {
		if (normalized.closeTmux && bench.tmuxExists) actions.push(`kill tmux session ${bench.sessionName}`);
		if (normalized.removeCheckout && bench.benchPath) {
			actions.push(`remove bench path ${bench.benchPath}`);
			actions.push(bench.id?.startsWith("branch-") ? `remove Bench state directory for ${bench.id}` : `remove PR Bench state directory for #${bench.pr}`);
		}
		if (normalized.deleteBranch && bench.branchExists && bench.checkoutKind === "worktree") actions.push(`delete branch ${bench.branchName}`);
		if (!actions.length) findings.push({ severity: "refusal", code: "nothing-to-close", message: "No tmux session, bench path, or branch was found to close." });
		const id = bench.id ?? `pr-${bench.pr}`;
		try { validateBenchDefinition({ id, repo: bench.repo ?? REPO, branchName: bench.branchName, pr: bench.pr }); }
		catch (err) { findings.push({ severity: "refusal", code: "branch-name-mismatch", message: String(err) }); }
		if (bench.sessionName !== id) findings.push({ severity: "refusal", code: "session-name-mismatch", message: `Tmux session name ${bench.sessionName} does not match expected ${id}.` });
		if (bench.tmuxPath && bench.benchPath && resolve(bench.tmuxPath) !== resolve(bench.benchPath)) findings.push({ severity: "refusal", code: "tmux-path-mismatch", message: "Tmux session belongs to a different checkout." });
		if (bench.benchPath) {
			if (bench.benchPath !== join(BENCH_CHECKOUTS_DIR, id)) findings.push({ severity: "refusal", code: "bench-path-mismatch", message: `Bench path ${bench.benchPath} does not match Bench ${id}.` });
			if (normalized.removeCheckout && options.currentWorkingDirectory && isInsidePath(options.currentWorkingDirectory, bench.benchPath)) findings.push({ severity: "refusal", code: "current-directory", message: `Refusing to remove the current working directory: ${bench.benchPath}.` });
		}
		if (normalized.removeCheckout && bench.checkoutKind === "unknown") findings.push({ severity: "refusal", code: "invalid-checkout", message: "Refusing to delete an unverified checkout." });
		if (normalized.removeCheckout && bench.checkoutExists) {
			if ((bench.commitSafety && bench.commitSafety !== "safe") || (bench.id && !bench.commitSafety)) findings.push({ severity: "warning", code: "local-commits", message: `Commit preservation is ${bench.commitSafety ?? "unknown"}${bench.localOnlyCommits !== undefined ? ` (${bench.localOnlyCommits} local-only commits across all refs)` : ""}; removing this checkout may lose committed work. Push or preserve it first.`, acknowledged: normalized.allowLocalCommits });
			if (bench.ignoredFiles) findings.push({ severity: "warning", code: "ignored-files", message: `Removing this checkout also discards ${bench.ignoredFiles} ignored files.`, acknowledged: normalized.allowDirty === "any" });
		}
		if (bench.tmuxExists) findings.push({ severity: "info", code: "tmux-active", message: `Tmux session ${bench.sessionName} is active.` });
		const dirty = normalized.removeCheckout ? dirtyFinding(bench, normalized.allowDirty) : undefined;
		if (dirty) findings.push(dirty);
		if (normalized.removeCheckout && (bench.fresh === false || bench.freshness === "stale")) findings.push({ severity: "warning", code: "stale-head", message: "Bench local HEAD differs from the snapshot PR head.", acknowledged: normalized.allowStale });
		for (const warning of bench.warnings) findings.push({ severity: "info", code: "bench-warning", message: warning });
	}
	const refusals = findings.filter((finding) => finding.severity === "refusal");
	const warnings = findings.filter((finding) => finding.severity === "warning");
	const unacknowledgedWarnings = warnings.filter((finding) => !finding.acknowledged);
	return {
		id: bench?.id,
		pr,
		apply: normalized.apply,
		status: refusals.length ? "refused" : unacknowledgedWarnings.length ? "needs-override" : "ready",
		actions,
		findings,
		refusals,
		warnings,
		unacknowledgedWarnings,
		options: normalized,
	};
}

export function formatBenchClosePlan(plan: BenchClosePlan): string[] {
	const headingPr = plan.pr ? `#${plan.pr}` : "requested PR";
	return [
		`${plan.pr ? "PR Bench" : "Bench"} close plan for ${plan.pr ? headingPr : plan.id ?? "requested Bench"}: ${plan.status}`,
		plan.apply ? "Apply requested; execution proceeds only when the plan is ready." : "Dry run only; no changes were made.",
		...(plan.actions.length ? ["Actions:", ...plan.actions.map((action) => `- ${action}`)] : ["Actions: none"]),
		...(plan.findings.length ? ["Findings:", ...plan.findings.map((finding) => `- ${finding.severity.toUpperCase()}${finding.acknowledged ? " (acknowledged)" : ""}: ${finding.message}`)] : []),
		...(plan.status === "needs-override" ? ["Re-run with allowDirty, allowStale, and/or allowLocalCommits to acknowledge the specific warnings before applying."] : []),
	].filter(Boolean);
}
