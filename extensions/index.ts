import { DISPLAY_NAME, INFO_COMMAND, STATUS_COMMAND } from "./identity.ts";
import { MAGLEV_TOOL_NAMESPACE } from "./tool-namespace.ts";
import { unlink } from "node:fs/promises";
import { formatMaglevCheckout, resolveMaglevCheckout } from "./maglev-checkout.ts";
import { registerApiRuntimeTools } from "./api-runtime-tools.ts";
import { registerGeneralBenchTools } from "./bench-tools.ts";
import { loadBenchDefinitions } from "./bench-registry.ts";
import { type ExtensionAPI, type ExtensionCommandContext, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Box, matchesKey, Text, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { collectAllBenchStates, inspectBench, listBenches } from "./bench.ts";
import { loadBenchKickoff } from "./bench-kickoff.ts";
import { deleteDecision, getDecision, listDecisions, saveDecision } from "./decisions.ts";
import { refreshMetadata } from "./github.ts";
import { buildQueueModel, formatQueueReportLines, queueCounts } from "./queue-core.ts";
import { BenchKickoffParamsSchema, CodeReviewParamsSchema, CompanionReposParamsSchema, DecisionsParamsSchema, LoadMetadataParamsSchema, MaglevCheckoutParamsSchema, NeedsInferenceParamsSchema, RefreshMetadataParamsSchema, ReviewJsonClearParamsSchema, ReviewJsonListParamsSchema, ReviewJsonLoadParamsSchema, ReviewJsonParamsSchema, SnapshotStalenessParamsSchema, StateQueryParamsSchema, WorkspaceContextParamsSchema } from "./schemas.ts";
import { BENCH_CHECKOUTS_DIR, BENCH_STATE_DIR, COMPANION_REPOS_DIR, DECISIONS_FILE, MAINTAINER_ROOT, REVIEW_JSON_DIR, SNAPSHOT_FILE, STATE_DIR } from "./paths.ts";
import { loadDecisions, loadSnapshot, loadSnapshotOptional, writeDecisions } from "./state.ts";
import { writeReviewJson } from "./review-json.ts";
import { clearReviewJsonArtifact, formatReviewJsonArtifactLine, listReviewJsonArtifacts, loadReviewJsonArtifact, type LoadedReviewJsonArtifact } from "./review-json-store.ts";
import { checkSnapshotStaleness, formatSnapshotStaleness } from "./snapshot-staleness.ts";
import { buildStateQuery, formatStateQueryJson } from "./state-query.ts";
import { getMaintainerStatus, type MaintainerStatus } from "./status.ts";
import { compactPrLine, computeNeedsInference, listPrsNeedingInference, loadPrMetadata } from "./triage.ts";
import { decisionGetToolResult, decisionListToolResult, loadMetadataToolResult, needsInferenceToolResult } from "./triage-tool-results.ts";
import { atomicWriteJson, commandSucceeds, runJson, runText, toolResult } from "./utils.ts";
import { buildWorkspaceContext, formatWorkspaceContext } from "./workspace-context.ts";
import { formatCompanionReposReport, resolveCompanionRepos } from "./companion-repos.ts";
import { formatCodeReviewResult, runClaudeCodeReview } from "./code-review.ts";

interface MaglevReportEntryData {
	lines: string[];
	generatedAt: string;
}

function renderReportEntry(lines: string[], theme: { bg: (color: "customMessageBg", text: string) => string }) {
	const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
	box.addChild(new Text(lines.join("\n"), 0, 0));
	return box;
}

function formatMaintainerStatus(status: MaintainerStatus): string {
	return [
		`${DISPLAY_NAME} status`,
		status.snapshot.ok
			? `Snapshot: ok • ${status.snapshot.prCount} PRs • fetched ${status.snapshot.fetchedAt} • ${status.snapshot.path}`
			: `Snapshot: missing/error • ${status.snapshot.warning ?? "unknown error"} • ${status.snapshot.path}`,
		`Root: ${status.root.ok ? "writable" : "missing/not writable"} • ${status.root.path}`,
		status.decisions.ok
			? `Decisions: ok • ${status.decisions.count} decisions • ${status.decisions.path}`
			: `Decisions: error • ${status.decisions.warning ?? "unknown error"} • ${status.decisions.path}`,
		status.benches.ok
			? `Benches: ${status.benches.count} • ${status.benches.checkoutDir}${status.benches.warning ? ` • snapshot warning: ${status.benches.warning}` : ""}`
			: `Benches: error • ${status.benches.warning ?? "unknown error"} • ${status.benches.checkoutDir}`,
		`gh auth: ${status.gh.ok ? "ok" : "unavailable/not authenticated"}`,
		`tmux: ${status.tmux.ok ? "ok" : "unavailable"}`,
	].join("\n");
}

function parseReviewJsonCommandArgs(args: string): { pr?: number; path?: string; error?: string } {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return {};
	if (tokens.length > 1) return { error: "Usage: /maglev-pr-review-draft [PR number | path]" };
	const token = tokens[0]!;
	const normalized = token.replace(/^#/, "");
	if (/^\d+$/.test(normalized)) return { pr: Number(normalized) };
	return { path: token };
}

function wrapReviewViewerLines(markdown: string, width: number): string[] {
	const innerWidth = Math.max(20, width);
	return markdown.split("\n").flatMap((line) => line.trim() ? wrapTextWithAnsi(line, innerWidth) : [""]);
}

async function showReviewJsonViewer(loaded: LoadedReviewJsonArtifact, ctx: ExtensionCommandContext): Promise<"discuss" | undefined> {
	const viewport = 28;
	let scroll = 0;
	let cachedWidth = 0;
	let cachedLines: string[] = [];
	return ctx.ui.custom<"discuss" | undefined>((tui, theme, _kb, done) => ({
		render: (width: number) => {
			const bodyWidth = Math.max(20, width - 2);
			if (cachedWidth !== bodyWidth) {
				cachedWidth = bodyWidth;
				cachedLines = wrapReviewViewerLines(loaded.markdown, bodyWidth);
				scroll = Math.min(scroll, Math.max(0, cachedLines.length - viewport));
			}
			const maxScroll = Math.max(0, cachedLines.length - viewport);
			const visible = cachedLines.slice(scroll, scroll + viewport).map((line) => truncateToWidth(line, bodyWidth));
			return [
				theme.fg("accent", theme.bold(`PR review JSON #${loaded.pr} • ${loaded.event} • ${loaded.commentCount} inline comment${loaded.commentCount === 1 ? "" : "s"}`)),
				theme.fg("dim", truncateToWidth(loaded.path, bodyWidth)),
				theme.fg("dim", "j/k or arrows scroll • pgup/pgdn page • d discuss with agent • q/esc close"),
				theme.fg("dim", "─".repeat(Math.min(bodyWidth, 120))),
				...visible,
				theme.fg("dim", "─".repeat(Math.min(bodyWidth, 120))),
				theme.fg("dim", `Lines ${Math.min(scroll + 1, cachedLines.length || 1)}-${Math.min(scroll + viewport, cachedLines.length)} of ${cachedLines.length} • ${maxScroll ? `scroll ${scroll}/${maxScroll}` : "no scroll"}`),
			];
		},
		invalidate: () => { cachedWidth = 0; },
		handleInput: (data: string) => {
			const maxScroll = Math.max(0, cachedLines.length - viewport);
			const setScroll = (next: number) => {
				scroll = Math.max(0, Math.min(maxScroll, next));
				tui.requestRender();
			};
			if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || matchesKey(data, "q")) done(undefined);
			else if (matchesKey(data, "d")) done("discuss");
			else if (matchesKey(data, "down") || matchesKey(data, "j")) setScroll(scroll + 1);
			else if (matchesKey(data, "up") || matchesKey(data, "k")) setScroll(scroll - 1);
			else if (matchesKey(data, "pagedown") || matchesKey(data, "space")) setScroll(scroll + viewport);
			else if (matchesKey(data, "pageup")) setScroll(scroll - viewport);
			else if (matchesKey(data, "g")) setScroll(0);
			else if (matchesKey(data, "G")) setScroll(maxScroll);
		},
	}));
}

export default function maglevMaintainer(pi: ExtensionAPI) {
	registerApiRuntimeTools(pi);
	registerGeneralBenchTools(pi);
	pi.registerEntryRenderer<MaglevReportEntryData>("maglev-pr-queue-report", (entry, _options, theme) => renderReportEntry(entry.data?.lines ?? ["Maglev PR queue report unavailable."], theme));
	// Retain renderers for historical transcript entries, not retired commands.
	pi.registerEntryRenderer<MaglevReportEntryData>("maglev-pr-benches-report", (entry, _options, theme) => renderReportEntry(entry.data?.lines ?? ["PR Benches report unavailable."], theme));
	pi.registerEntryRenderer<MaglevReportEntryData>("maglev-pr-bench-start-report", (entry, _options, theme) => renderReportEntry(entry.data?.lines ?? ["PR Bench start report unavailable."], theme));
	pi.registerEntryRenderer<MaglevReportEntryData>("maglev-pr-bench-reset-report", (entry, _options, theme) => renderReportEntry(entry.data?.lines ?? ["PR Bench reset report unavailable."], theme));
	pi.registerEntryRenderer<MaglevReportEntryData>("maglev-pr-bench-close-report", (entry, _options, theme) => renderReportEntry(entry.data?.lines ?? ["PR Bench close report unavailable."], theme));

	pi.registerCommand(INFO_COMMAND, {
		description: `Show info for the in-development ${DISPLAY_NAME} package`,
		handler: async (_args, ctx) => {
			ctx.ui.notify(`${DISPLAY_NAME} loaded. Commands: /maglev-benches, /maglev-bench-start, /maglev-bench-inspect, /maglev-bench-close, /maglev-bench-associate-pr, /maglev-bench-resolve-pr, /maglev-bench-reset, /maglev-prs, /maglev-pr-review-draft, /${STATUS_COMMAND}. Tools: maglev_bench_list, maglev_bench_inspect, maglev_bench_start, maglev_bench_close, maglev_bench_associate_pr, maglev_workspace_context, maglev_checkout, maglev_companion_repos_resolve, maglev_api_runtime_start, maglev_api_runtime_stop, maglev_api_runtime_status, maglev_pr_snapshot_staleness, maglev_pr_refresh_metadata, maglev_pr_load_metadata, maglev_pr_state_query, maglev_pr_needs_inference, maglev_pr_decisions, maglev_bench_resolve_pr, maglev_bench_reset, maglev_pr_review_instructions_load, maglev_pr_code_review, maglev_pr_review_draft_save, maglev_pr_review_draft_clear, maglev_pr_review_draft_list, maglev_pr_review_draft_load. Snapshot: ${SNAPSHOT_FILE}`, "info");
		},
	});

	pi.registerCommand(STATUS_COMMAND, {
		description: `Show ${DISPLAY_NAME} snapshot, decisions, PR Bench, and dependency status`,
		handler: async (_args, ctx) => {
			const status = await getMaintainerStatus({
				loadSnapshotOptional,
				loadDecisions,
				listBenches: () => collectAllBenchStates(),
				checkRoot: () => commandSucceeds("test", ["-w", MAINTAINER_ROOT]),
				checkGh: () => commandSucceeds("gh", ["auth", "status"]),
				checkTmux: () => commandSucceeds("tmux", ["-V"]),
				rootDir: MAINTAINER_ROOT,
				snapshotFile: SNAPSHOT_FILE,
				decisionsFile: DECISIONS_FILE,
				checkoutDir: BENCH_CHECKOUTS_DIR,
			});
			const level = status.root.ok && status.snapshot.ok && status.decisions.ok && status.gh.ok && status.tmux.ok ? "info" : "warning";
			ctx.ui.notify(formatMaintainerStatus(status), level);
		},
	});

	pi.registerCommand("maglev-pr-review-draft", {
		description: "Open a scrollable viewer for a current prospective PR review JSON draft. Usage: /maglev-pr-review-draft [PR number | path]",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/maglev-pr-review-draft requires interactive TUI mode.", "error");
				return;
			}
			const parsed = parseReviewJsonCommandArgs(args ?? "");
			if (parsed.error) {
				ctx.ui.notify(parsed.error, "error");
				return;
			}
			try {
				let loaded: LoadedReviewJsonArtifact;
				if (parsed.pr || parsed.path) {
					loaded = await loadReviewJsonArtifact({ pr: parsed.pr, path: parsed.path }, { reviewJsonDir: REVIEW_JSON_DIR });
				} else {
					const artifacts = await listReviewJsonArtifacts({ limit: 30 }, { reviewJsonDir: REVIEW_JSON_DIR });
					if (!artifacts.length) {
						ctx.ui.notify(`No review JSON drafts found in ${REVIEW_JSON_DIR}.`, "warning");
						return;
					}
					const choices = artifacts.map((artifact) => `${formatReviewJsonArtifactLine(artifact)} • ${artifact.path}`);
					const choice = await ctx.ui.select("Open review JSON draft", ["Cancel", ...choices]);
					if (!choice || choice === "Cancel") {
						ctx.ui.notify("Cancelled opening review JSON draft.", "info");
						return;
					}
					const artifact = artifacts[choices.indexOf(choice)];
					if (!artifact) throw new Error("Selected review JSON draft was not found");
					loaded = await loadReviewJsonArtifact({ path: artifact.path }, { reviewJsonDir: REVIEW_JSON_DIR });
				}
				const action = await showReviewJsonViewer(loaded, ctx);
				if (action === "discuss") {
					pi.sendUserMessage(`Please load and review the PR review JSON draft at ${loaded.path} so we can discuss the comments.`, { deliverAs: "followUp" });
				} else {
					ctx.ui.notify(`Closed review JSON draft for #${loaded.pr}.`, "info");
				}
			} catch (err) {
				ctx.ui.notify(`Failed to open review JSON draft: ${err instanceof Error ? err.message : String(err)}`, "error");
			}
		},
	});

	pi.registerCommand("maglev-prs", {
		description: "Print a read-only Maglev PR queue report from snapshot, decisions, and local PR Benches. Optional args: PR numbers.",
		handler: async (args, ctx) => {
			const tokens = (args ?? "").trim().split(/\s+/).filter(Boolean);
			if (tokens.some((token) => token === "clear" || token === "--clear")) {
				ctx.ui.notify("/maglev-prs no longer uses a persistent widget, so there is nothing to clear.", "info");
				return;
			}
			const invalid = tokens.find((token) => !/^#?\d+$/.test(token));
			if (invalid) {
				ctx.ui.notify(`Invalid PR number argument: ${invalid}`, "error");
				return;
			}
			const prs = tokens.length ? tokens.map((token) => Number(token.replace(/^#/, ""))) : undefined;
			const [snapshot, decisionsResult, benchResult] = await Promise.all([loadSnapshot(), loadDecisions(), listBenches({ prs })]);
			const model = buildQueueModel({ snapshot, decisions: decisionsResult.file.decisions, benches: benchResult.benches, prs });
			const lines = formatQueueReportLines(model);
			pi.appendEntry<MaglevReportEntryData>("maglev-pr-queue-report", { lines, generatedAt: new Date().toISOString() });
			const counts = queueCounts(model);
			const warning = benchResult.snapshotWarning ? ` Snapshot freshness unavailable for PR Benches: ${benchResult.snapshotWarning}` : "";
			ctx.ui.notify(`Printed Maglev PR queue: TRIAGE ${counts.triage}, REVIEW ${counts.review}, CHASE ${counts.chase}, PINNED ${counts.pinned}, WATCH ${counts.watch}, BENCH ${counts.bench}.${warning}`, benchResult.snapshotWarning ? "warning" : "info");
		},
	});

	pi.registerTool({
		name: "maglev_workspace_context",
		namespace: MAGLEV_TOOL_NAMESPACE,
		label: "Maglev Workspace Context",
		description: `Return ${DISPLAY_NAME} configuration, paths, branch or PR Bench context, and tool capability names for config-aware skills.`,
		promptSnippet: `Load ${DISPLAY_NAME} workspace configuration and Bench context.`,
		promptGuidelines: [
			`Use maglev_workspace_context before ${DISPLAY_NAME}-integrated skills need paths, artifact directories, or Bench context.`,
			"Prefer returned maintainer-root paths over hard-coded /workspace assumptions.",
		],
		parameters: WorkspaceContextParamsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const context = buildWorkspaceContext({ pr: params.pr, benchId: params.benchId, benchDefinitions: await loadBenchDefinitions(), cwd: ctx?.cwd ?? process.cwd() }, {
				maintainerRoot: MAINTAINER_ROOT,
				stateDir: STATE_DIR,
				snapshotFile: SNAPSHOT_FILE,
				decisionsFile: DECISIONS_FILE,
				benchStateDir: BENCH_STATE_DIR,
				checkoutDir: BENCH_CHECKOUTS_DIR,
				reviewJsonDir: REVIEW_JSON_DIR,
				companionReposDir: COMPANION_REPOS_DIR,
				obaWorkspace: process.env.OBA_WORKSPACE,
			});
			return toolResult(formatWorkspaceContext(context), context);
		},
	});

	pi.registerTool({
		name: "maglev_checkout",
		namespace: MAGLEV_TOOL_NAMESPACE,
		label: "Maglev Checkout",
		description: "Resolve or clone OneBusAway/maglev independently of a PR Bench. Dry-run by default; existing checkouts are inspected without fetching, switching, or resetting.",
		promptSnippet: "Resolve or clone the main Maglev source checkout safely.",
		promptGuidelines: [
			"Use maglev_workspace_context first, then maglev_checkout when Maglev source is needed outside a PR Bench.",
			"Set apply true only when the user explicitly requests a clone/checkout. Existing local work is always preserved; report returned warnings.",
		],
		parameters: MaglevCheckoutParamsSchema,
		async execute(_toolCallId, params) {
			const result = await withFileMutationQueue("maglev-pr-checkout", () => resolveMaglevCheckout(params, {
				checkoutDir: BENCH_CHECKOUTS_DIR,
				obaWorkspace: process.env.OBA_WORKSPACE,
			}));
			return { ...toolResult(formatMaglevCheckout(result), result), isError: !result.ok };
		},
	});

	pi.registerTool({
		name: "maglev_companion_repos_resolve",
		namespace: MAGLEV_TOOL_NAMESPACE,
		label: "Maglev Companion Repos Resolve",
		description: `Resolve OBA companion repositories such as maglev.wiki, clients, and legacy Java under the ${DISPLAY_NAME} framework.`,
		promptSnippet: "Resolve local OBA companion repos for Maglev API/spec review skills.",
		promptGuidelines: [
			`Use maglev_companion_repos_resolve from ${DISPLAY_NAME}-integrated OBA API skills instead of shell resolver scripts.`,
			"Include returned warnings or notes as caveats in the final analysis.",
			"Reference-only repos may be cloned or fast-forwarded; maglev.wiki is editable and is not pulled automatically after clone.",
		],
		parameters: CompanionReposParamsSchema,
		async execute(_toolCallId, params) {
			const result = await resolveCompanionRepos(params, {
				companionReposDir: COMPANION_REPOS_DIR,
				obaWorkspace: process.env.OBA_WORKSPACE,
			});
			return toolResult(formatCompanionReposReport(result), result);
		},
	});

	pi.registerTool({
		name: "maglev_pr_snapshot_staleness",
		namespace: MAGLEV_TOOL_NAMESPACE,
		label: "Maglev PR Snapshot Staleness",
		description: "Check whether the local Maglev PR GitHub snapshot is missing or older than the package staleness threshold. No live GitHub calls.",
		promptSnippet: "Check whether the local Maglev PR GitHub snapshot is missing or older than 4 hours.",
		promptGuidelines: ["Use maglev_pr_snapshot_staleness before Maglev PR triage or PR Bench work that relies on remote PR metadata; if shouldRefresh is true, call maglev_pr_refresh_metadata unless the maintainer asked not to make live GitHub calls."],
		parameters: SnapshotStalenessParamsSchema,
		async execute() {
			const result = await checkSnapshotStaleness({ loadSnapshotOptional, snapshotFile: SNAPSHOT_FILE });
			return toolResult(formatSnapshotStaleness(result), result);
		},
	});

	pi.registerTool({
		name: "maglev_pr_refresh_metadata",
		namespace: MAGLEV_TOOL_NAMESPACE,
		label: "Maglev PR Refresh Metadata",
		description: "Fetch all open OneBusAway/maglev PR metadata from GitHub and write the facts-only snapshot file.",
		promptSnippet: "Refresh the facts-only GitHub PR snapshot for OneBusAway/maglev.",
		promptGuidelines: ["Use maglev_pr_refresh_metadata before Maglev PR triage when the local GitHub snapshot is missing or explicitly stale."],
		parameters: RefreshMetadataParamsSchema,
		async execute(_toolCallId, params, signal) {
			const snapshot = await refreshMetadata(params, {
				runJson: (cmd, args) => runJson(cmd, args, signal),
				writeSnapshot: (value) => atomicWriteJson(SNAPSHOT_FILE, value),
			});
			const needsSummary = computeNeedsInference(snapshot, (await loadDecisions()).file.decisions);
			const lines = [
				`Fetched ${snapshot.pullRequests.length} open PRs from ${snapshot.repo}.`,
				`Wrote facts-only snapshot: ${SNAPSHOT_FILE}`,
				`${needsSummary.length} PRs currently need inference.`,
				...snapshot.pullRequests.slice(0, 12).map(compactPrLine),
			];
			if (snapshot.pullRequests.length > 12) lines.push(`…${snapshot.pullRequests.length - 12} more PRs in snapshot`);
			return toolResult(lines.join("\n"), { snapshotFile: SNAPSHOT_FILE, fetchedAt: snapshot.fetchedAt, repo: snapshot.repo, count: snapshot.pullRequests.length, needsInferenceCount: needsSummary.length });
		},
	});

	pi.registerTool({
		name: "maglev_pr_load_metadata",
		namespace: MAGLEV_TOOL_NAMESPACE,
		label: "Maglev PR Load Metadata",
		description: "Read full selected PR facts, including discussions, reviews, commits, and snapshot identity, into model context from the local Maglev PR GitHub snapshot. No live GitHub calls.",
		promptSnippet: "Load PR facts from the local Maglev PR snapshot by number, all PRs, or needs-inference selection.",
		promptGuidelines: ["Use maglev_pr_load_metadata for Maglev PR inference instead of calling gh directly.", "For backlog triage, delegate one PR per fresh-context analyst; keep the parent on compact needs-inference and decision-list output. Focused parent inspection of an intentionally selected PR remains available."],
		parameters: LoadMetadataParamsSchema,
		async execute(_toolCallId, params) {
			const result = await loadPrMetadata(params, { loadSnapshot, loadDecisions });
			return loadMetadataToolResult(result, SNAPSHOT_FILE);
		},
	});

	pi.registerTool({
		name: "maglev_pr_state_query",
		namespace: MAGLEV_TOOL_NAMESPACE,
		label: "Maglev PR State Query",
		description: "Dump selected PR snapshot facts, durable decision, stale-inference status, and local PR Bench state as JSON text. No live GitHub calls.",
		promptSnippet: "Query joined Maglev PR state from local snapshot, decisions, and PR Benches without shell/Python/JQ scripts.",
		promptGuidelines: [
			"Use maglev_pr_state_query when you need exact PR fields in the session instead of crafting ad-hoc scripts to read JSON files.",
			"Use prs to keep output focused, or selection needs-inference for stale/missing decisions.",
		],
		parameters: StateQueryParamsSchema,
		async execute(_toolCallId, params) {
			const [snapshot, decisionsResult, benchResult] = await Promise.all([loadSnapshot(), loadDecisions(), listBenches({ prs: params.prs })]);
			const result = buildStateQuery({
				snapshot,
				decisions: decisionsResult.file.decisions,
				benches: benchResult.benches,
				selection: params.selection,
				prs: params.prs,
				limit: params.limit,
			});
			const payload = {
				snapshotFile: SNAPSHOT_FILE,
				decisionsFile: DECISIONS_FILE,
				snapshotWarning: benchResult.snapshotWarning,
				...result,
			};
			const warning = benchResult.snapshotWarning ? `\nSnapshot freshness unavailable for PR Benches: ${benchResult.snapshotWarning}` : "";
			return toolResult(`${formatStateQueryJson(payload)}${warning}`, payload);
		},
	});

	pi.registerTool({
		name: "maglev_pr_needs_inference",
		namespace: MAGLEV_TOOL_NAMESPACE,
		label: "Maglev PR Needs Inference",
		description: "Return PRs with no saved decision or stale decisions based only on local snapshot facts and decisions.",
		promptSnippet: "Find Maglev PRs needing LLM triage inference from durable local state.",
		promptGuidelines: ["Use maglev_pr_needs_inference to choose Maglev PRs needing triage; it intentionally makes no live GitHub calls."],
		parameters: NeedsInferenceParamsSchema,
		async execute(_toolCallId, params) {
			const result = await listPrsNeedingInference(params, { loadSnapshot, loadDecisions });
			return needsInferenceToolResult(result, SNAPSHOT_FILE, DECISIONS_FILE);
		},
	});

	pi.registerTool({
		name: "maglev_pr_review_instructions_load",
		namespace: MAGLEV_TOOL_NAMESPACE,
		label: "Maglev PR Review Instructions Load",
		description: "Load the on-demand read-only PR review kickoff instructions and snapshot context for the calling agent. Does not start a bench, write a prompt file, or send input to another Pi session.",
		promptSnippet: "Load PR Bench review kickoff instructions on demand.",
		promptGuidelines: [
			"Use maglev_pr_review_instructions_load only when the maintainer explicitly requests a review kickoff, never automatically after starting or recovering a bench.",
			"The returned instructions apply to the calling agent; use the specified PR Bench checkout for review. No review is executed by this tool itself.",
		],
		parameters: BenchKickoffParamsSchema,
		async execute(_toolCallId, params) {
			const { bench } = await inspectBench(params.pr);
			const result = await loadBenchKickoff({ ...params, benchPath: bench?.benchPath });
			return toolResult(`Snapshot: ${result.snapshotFetchedAt}\n\n${result.prompt}`, result);
		},
	});

	pi.registerTool({
		name: "maglev_pr_code_review",
		namespace: MAGLEV_TOOL_NAMESPACE,
		label: "Maglev PR Code Review",
		description: "Run Claude Code /code-review for a Maglev PR by number, without requiring a Bench or checkout. Optionally use an explicit checkout.",
		promptSnippet: "Run a prospective Claude Code review by PR number or from an explicit checkout.",
		promptGuidelines: [
			"Use maglev_pr_code_review for the initial PR Bench review instead of manually invoking Claude Code or the claude-code-pr-review skill.",
			"Pass pr alone for remote review: no Bench lookup, clone, or checkout is required. Pass workingDirectory explicitly only for checkout-based review.",
			`This tool captures Claude Code stdout/stderr and writes a full log under the ${DISPLAY_NAME} bench state directory; it does not submit GitHub reviews.`,
		],
		parameters: CodeReviewParamsSchema,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const result = await runClaudeCodeReview(params, {
				processCwd: () => ctx?.cwd ?? process.cwd(),
				runText: (cmd, args, cwd) => runText(cmd, args, cwd, signal),
			}, signal);
			return toolResult(formatCodeReviewResult(result), { rootDir: MAINTAINER_ROOT, benchStateDir: BENCH_STATE_DIR, ...result });
		},
	});

	pi.registerTool({
		name: "maglev_pr_review_draft_save",
		namespace: MAGLEV_TOOL_NAMESPACE,
		label: "Maglev PR Review Draft Save",
		description: "Validate an already-decided GitHub PR review and write or overwrite the current prospective review JSON draft for the PR. Never submits to GitHub.",
		promptSnippet: "Write the current validated prospective PR review JSON draft for OneBusAway/maglev.",
		promptGuidelines: [
			"Use maglev_pr_review_draft_save when the maintainer asks to package already-decided PR review comments as JSON.",
			"Do not invent review findings in this tool flow; run review analysis first, then pass the settled event, summary body, and inline comments to this tool.",
			"This tool overwrites the current pr-<N>.json draft and validates inline comment locations against the current PR diff; it never submits a GitHub review.",
		],
		parameters: ReviewJsonParamsSchema,
		async execute(_toolCallId, params, signal) {
			const result = await writeReviewJson(params, {
				runJson: (cmd, args) => runJson(cmd, args, signal),
				runText: (cmd, args) => runText(cmd, args, undefined, signal),
				writeReviewJson: async (path, value) => {
					await withFileMutationQueue(path, async () => atomicWriteJson(path, value));
				},
				reviewJsonDir: REVIEW_JSON_DIR,
			});
			const text = [
				`Wrote prospective PR review JSON for #${result.pr} (${result.review.event}) against ${result.commit}.`,
				`Output: ${result.outputPath}`,
				`${result.commentCount} inline comment${result.commentCount === 1 ? "" : "s"} validated.`,
				JSON.stringify(result.review, null, 2),
			].join("\n");
			return toolResult(text, result);
		},
	});

	pi.registerTool({
		name: "maglev_pr_review_draft_clear",
		namespace: MAGLEV_TOOL_NAMESPACE,
		label: "Maglev PR Review Draft Clear",
		description: "Delete the current prospective PR review JSON draft for a PR. Never submits to GitHub.",
		promptSnippet: "Delete the current prospective PR review JSON draft for OneBusAway/maglev.",
		promptGuidelines: ["Use maglev_pr_review_draft_clear when the settled outcome is no prospective review comments for the PR."],
		parameters: ReviewJsonClearParamsSchema,
		async execute(_toolCallId, params) {
			const result = await clearReviewJsonArtifact(params, {
				reviewJsonDir: REVIEW_JSON_DIR,
				unlink: async (path) => {
					await withFileMutationQueue(path, async () => unlink(path));
				},
			});
			const text = result.deleted
				? `Deleted prospective PR review JSON draft for #${params.pr}: ${result.path}`
				: `No prospective PR review JSON draft found for #${params.pr}: ${result.path}`;
			return toolResult(text, result);
		},
	});

	pi.registerTool({
		name: "maglev_pr_review_draft_list",
		namespace: MAGLEV_TOOL_NAMESPACE,
		label: "Maglev PR Review Draft List",
		description: `List current prospective PR review JSON drafts from the centralized ${DISPLAY_NAME} directory.`,
		promptSnippet: "List current prospective PR review JSON drafts.",
		promptGuidelines: ["Use maglev_pr_review_draft_list to find current review JSON drafts before loading one for discussion."],
		parameters: ReviewJsonListParamsSchema,
		async execute(_toolCallId, params) {
			const artifacts = await listReviewJsonArtifacts(params, { reviewJsonDir: REVIEW_JSON_DIR });
			const lines = [
				`Found ${artifacts.length} review JSON draft${artifacts.length === 1 ? "" : "s"} in ${REVIEW_JSON_DIR}.`,
				...artifacts.map((artifact) => `${formatReviewJsonArtifactLine(artifact)}\n  ${artifact.path}`),
			];
			return toolResult(lines.join("\n"), { reviewJsonDir: REVIEW_JSON_DIR, artifacts });
		},
	});

	pi.registerTool({
		name: "maglev_pr_review_draft_load",
		namespace: MAGLEV_TOOL_NAMESPACE,
		label: "Maglev PR Review Draft Load",
		description: "Load a current prospective PR review JSON draft into model context for discussion. Never submits to GitHub.",
		promptSnippet: "Load a current prospective PR review JSON draft for discussion.",
		promptGuidelines: [
			"Use maglev_pr_review_draft_load when the maintainer wants to discuss or revise a current prospective PR review JSON draft.",
			"Loading a draft is read-only and does not submit a GitHub review.",
		],
		parameters: ReviewJsonLoadParamsSchema,
		async execute(_toolCallId, params) {
			const loaded = await loadReviewJsonArtifact(params, { reviewJsonDir: REVIEW_JSON_DIR });
			return toolResult(loaded.markdown, { reviewJsonDir: REVIEW_JSON_DIR, ...loaded });
		},
	});

	pi.registerTool({
		name: "maglev_pr_decisions",
		namespace: MAGLEV_TOOL_NAMESPACE,
		label: "Maglev PR Decisions",
		description: "List, get, upsert, or delete Maglev PR triage decisions in the durable decisions file.",
		promptSnippet: "Read or update durable Maglev PR triage decisions.",
		promptGuidelines: ["Use maglev_pr_decisions to persist Maglev PR buckets; do not edit decision JSON files directly.", "Use absolute dates in durable decision text; avoid relative temporal phrases like today, yesterday, recently, or this morning."],
		parameters: DecisionsParamsSchema,
		async execute(_toolCallId, params, signal) {
			if (params.operation === "list") {
				const result = await listDecisions({ loadDecisions });
				return decisionListToolResult(result, DECISIONS_FILE);
			}
			if (!Number.isInteger(params.pr) || params.pr <= 0) throw new Error(`operation ${params.operation} requires a positive integer pr`);
			if (params.operation === "get") {
				const result = await getDecision(params.pr, { loadDecisions });
				return decisionGetToolResult(result, params.pr, DECISIONS_FILE);
			}
			if (params.operation === "delete") {
				const result = await deleteDecision(params.pr, { decisionsFile: DECISIONS_FILE, signal, loadDecisions, writeDecisions });
				return toolResult(result.deleted ? `Deleted decision for #${params.pr}.` : `No decision existed for #${params.pr}; wrote normalized decisions file.`, { decisionsFile: DECISIONS_FILE, deleted: result.deleted, pr: result.pr });
			}
			if (params.operation === "upsert") {
				if (!params.decision) throw new Error("operation upsert requires decision");
				const decision = await saveDecision(params.pr, params.decision, { decisionsFile: DECISIONS_FILE, signal, loadDecisions, writeDecisions, loadSnapshot });
				return toolResult(`Saved decision for #${params.pr}: ${decision.bucket} — ${decision.reason}`, { decisionsFile: DECISIONS_FILE, decision });
			}
			throw new Error(`Unknown decision operation: ${(params as { operation: string }).operation}`);
		},
	});
}
