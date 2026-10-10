import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MAGLEV_TOOL_NAMESPACE } from "./tool-namespace.ts";
import { Type } from "typebox";
import { associateBenchPr, closeGeneralBench, collectAllBenchStates, formatBenchClosePlan, formatBenchLine, formatBenchResetPlan, formatBenchStartPlan, formatBenchStartVerification, inspectGeneralBench, resetGeneralBench, resolveBenchPr, startGeneralBench, type BenchStartResult } from "./bench.ts";
import { BENCH_STATE_DIR } from "./paths.ts";
import { parseBenchStartArgs, parseIdFlags } from "./bench-command-args.ts";
import { toolResult } from "./utils.ts";

const id = Type.String({ minLength: 1, description: "Stable Bench ID returned by start, list, or PR resolution; not a branch name or PR number." });
const pr = Type.Integer({ minimum: 1, description: "GitHub PR number." });
const apply = Type.Optional(Type.Boolean({ description: "Execute only on explicit user request. Defaults to false/dry-run." }));
const context = Type.Optional(Type.String({ description: "Background startup context for a new Pi window only; no task or automatic review. Refused for an existing Pi window." }));
const allowDirty = Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("untracked"), Type.Literal("any")]));
const safety = { allowStaleSnapshot: Type.Optional(Type.Boolean()), allowHeadMismatch: Type.Optional(Type.Boolean()) };
const snapshotMaxAgeHours = Type.Optional(Type.Number({ minimum: 0 }));
const mutate = <T>(operation: () => Promise<T>) => withFileMutationQueue(BENCH_STATE_DIR, operation);

function startText(result: BenchStartResult): string {
	return [`Bench ID: ${result.plan.target.id}`, ...formatBenchStartPlan(result.plan), `Applied: ${result.applied}`, ...result.executed,
		...(result.verification ? formatBenchStartVerification(result.verification) : []),
		...(result.contextPath ? [`Startup context: ${result.contextPath}`] : []),
		...(result.mutationWarning ? [result.mutationWarning] : []),
		...(result.snapshotWarning ? [result.snapshotWarning] : []),
	].join("\n");
}
function resetText(result: Awaited<ReturnType<typeof resetGeneralBench>>): string {
	return [`Bench ID: ${result.id}`, ...formatBenchResetPlan(result.plan), "Warning: reset does not protect displaced unpushed commits; preserve them first.", `Applied: ${result.applied}`, ...result.executed,
		...(result.snapshotWarning ? [result.snapshotWarning] : []), ...(result.mutationWarning ? [result.mutationWarning] : []),
	].join("\n");
}
function closeText(result: Awaited<ReturnType<typeof closeGeneralBench>>): string {
	return [...formatBenchClosePlan(result.plan), `Applied: ${result.applied}`, ...result.executed, ...(result.snapshotWarning ? [result.snapshotWarning] : [])].join("\n");
}

export function registerGeneralBenchTools(pi: ExtensionAPI) {
	pi.registerTool({
		namespace: MAGLEV_TOOL_NAMESPACE,
		name: "maglev_bench_list", label: "Maglev Bench List", description: "List local Maglev Benches by stable identity, optionally filtering by IDs or PR associations. Read-only.",
		parameters: Type.Object({ ids: Type.Optional(Type.Array(id)), prs: Type.Optional(Type.Array(pr)) }),
		async execute(_id, params) {
			const result = await collectAllBenchStates(params);
			return toolResult([`Benches (${result.benches.length})`, ...result.benches.map(formatBenchLine), ...(result.snapshotWarning ? [result.snapshotWarning] : [])].join("\n"), result);
		},
	});
	pi.registerTool({
		namespace: MAGLEV_TOOL_NAMESPACE,
		name: "maglev_bench_resolve_pr", label: "Resolve PR Bench ID", description: "Resolve a PR number to an existing local Bench ID. Read-only; returns id null when absent. Does not start a Bench or invent an ID.",
		promptGuidelines: ["Resolve a PR number once, then use the returned stable Bench ID for inspect, close, or reset. Resolution uses local associations and legacy discovery; no snapshot refresh is needed."],
		parameters: Type.Object({ pr }),
		async execute(_id, params) {
			const result = await resolveBenchPr(params.pr);
			return toolResult(JSON.stringify(result, null, 2), result);
		},
	});
	pi.registerTool({
		namespace: MAGLEV_TOOL_NAMESPACE,
		name: "maglev_bench_inspect", label: "Maglev Bench Inspect", description: "Inspect any Maglev Bench by stable ID, including dirty files, upstream, and local-only commit safety. Read-only.",
		parameters: Type.Object({ id }),
		async execute(_id, params) {
			const result = await inspectGeneralBench(params.id);
			return toolResult(JSON.stringify(result, null, 2), result);
		},
	});
	pi.registerTool({
		namespace: MAGLEV_TOOL_NAMESPACE,
		name: "maglev_bench_start", label: "Maglev Bench Start", description: "Plan or execute opening/recovering a Maglev Bench by branch or PR number. Specify exactly one of branch or pr; createFrom is branch-only. Returns the stable Bench ID, preserving existing PR associations and identity.",
		promptGuidelines: ["Use maglev_workspace_context first. Dry-run by default; apply only on explicit request. Inspect existing work first. No PR snapshot is required for an unassociated branch Bench; refresh stale metadata for PR-dependent work. Pass startup context only when launching a new Pi window; never automatically invoke review instructions. Draft/failing/conflicted/pinned PRs and stack-parent gaps are informational; stale/incomplete snapshots and HEAD mismatches require acknowledgement."],
		parameters: Type.Object({ branch: Type.Optional(Type.String({ minLength: 1 })), pr: Type.Optional(pr), createFrom: Type.Optional(Type.String({ minLength: 1, description: "Explicit new branch base, e.g. origin/main; only supported with branch." })), apply, context, reuseExisting: Type.Optional(Type.Boolean()), snapshotMaxAgeHours, ...safety }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const result = await mutate(() => startGeneralBench(params, { ...params, currentWorkingDirectory: ctx?.cwd ?? process.cwd() }));
			return toolResult(startText(result), result);
		},
	});
	pi.registerTool({
		namespace: MAGLEV_TOOL_NAMESPACE,
		name: "maglev_bench_reset", label: "Maglev Bench Reset", description: "Plan or execute resetting a Bench by stable ID to its associated PR snapshot head. Refuses unassociated Benches. Does not protect displaced unpushed commits; preserve them first.",
		promptGuidelines: ["Inspect first and refresh stale PR metadata. Apply only on explicit request after showing warnings and acknowledging discarded files. Preserve displaced committed work before reset; reset does not have close's commit safeguards."],
		parameters: Type.Object({ id, apply, allowDirty, allowStaleSnapshot: safety.allowStaleSnapshot, snapshotMaxAgeHours }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const result = await mutate(() => resetGeneralBench(params.id, { ...params, currentWorkingDirectory: ctx?.cwd ?? process.cwd() }));
			return toolResult(resetText(result), result);
		},
	});
	pi.registerTool({
		namespace: MAGLEV_TOOL_NAMESPACE,
		name: "maglev_bench_close", label: "Maglev Bench Close", description: "Plan or execute closing any Maglev Bench by stable ID. Protects dirty/ignored files, local-only commits across live refs (including HEAD/stash), and unknown preservation. Remote-ref checks use cached refs, not a fetch.",
		promptGuidelines: ["Inspect first. Dry-run by default. Fetch/prune and inspect again before deletion unless network calls are prohibited. Show warnings and obtain explicit acknowledgement before discarding files or committed work. Set removeCheckout false to stop tmux while preserving checkout and artifacts; stop Docker runtimes separately."],
		parameters: Type.Object({ id, apply, allowDirty, allowStale: Type.Optional(Type.Boolean()), allowLocalCommits: Type.Optional(Type.Boolean({ description: "Explicitly acknowledge losing committed work or unverified preservation." })), closeTmux: Type.Optional(Type.Boolean()), removeCheckout: Type.Optional(Type.Boolean()) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const result = await mutate(() => closeGeneralBench(params.id, { ...params, currentWorkingDirectory: ctx?.cwd ?? process.cwd() }));
			return toolResult(closeText(result), { id: params.id, ...result });
		},
	});
	pi.registerTool({
		namespace: MAGLEV_TOOL_NAMESPACE,
		name: "maglev_bench_associate_pr", label: "Associate Bench PR", description: "Associate a Bench with a matching PR from the local snapshot. Preserves identity, branch, checkout, tmux/Pi, and artifacts; does not start review.",
		promptGuidelines: ["Check snapshot staleness and refresh when needed before association. Dry-run by default; apply only on explicit request. PR must have the same head repository and branch, and cannot already have another Bench."],
		parameters: Type.Object({ id, pr, apply, ...safety }),
		async execute(_id, params) {
			const result = await mutate(() => associateBenchPr(params.id, params.pr, params));
			return toolResult(startText(result), { id: params.id, ...result });
		},
	});

	// Mutating commands default to plans; --apply explicitly authorizes execution.
	pi.registerCommand("maglev-benches", {
		description: "List all Maglev Benches (branches and PRs)",
		handler: async (_args, ctx) => {
			try {
				const result = await collectAllBenchStates();
				ctx.ui.notify([`Benches (${result.benches.length})`, ...result.benches.map(formatBenchLine), ...(result.snapshotWarning ? [result.snapshotWarning] : [])].join("\n"), "info");
			}
			catch (err) { ctx.ui.notify(String(err), "error"); }
		},
	});
	pi.registerCommand("maglev-bench-resolve-pr", {
		description: "Resolve an existing Bench ID: <PR number>",
		handler: async (args, ctx) => {
			try {
				if (!/^#?[1-9]\d*$/.test(args.trim())) throw new Error("Usage: /maglev-bench-resolve-pr <PR number>");
				const result = await resolveBenchPr(Number(args.trim().replace(/^#/, "")));
				ctx.ui.notify(JSON.stringify(result, null, 2), "info");
			}
			catch (err) { ctx.ui.notify(String(err), "error"); }
		},
	});
	pi.registerCommand("maglev-bench-start", {
		description: "Open/recover: <branch> [--from <base>] or --pr <PR>; [--apply] [--allow-stale-snapshot] [--allow-head-mismatch]",
		handler: async (args, ctx) => {
			const parsed = parseBenchStartArgs(args);
			if (parsed.error) { ctx.ui.notify(parsed.error, "error"); return; }
			try { ctx.ui.notify(startText(await mutate(() => startGeneralBench(parsed, { ...parsed, currentWorkingDirectory: ctx.cwd }))), "info"); }
			catch (err) { ctx.ui.notify(String(err), "error"); }
		},
	});
	pi.registerCommand("maglev-bench-inspect", {
		description: "Inspect a Bench: <bench-id>",
		handler: async (args, ctx) => {
			try { ctx.ui.notify(JSON.stringify(await inspectGeneralBench(args.trim()), null, 2), "info"); }
			catch (err) { ctx.ui.notify(String(err), "error"); }
		},
	});
	pi.registerCommand("maglev-bench-reset", {
		description: "Reset to associated PR head: <bench-id> [--apply] [--allow-dirty] [--allow-stale-snapshot]. Preserve unpushed commits first.",
		handler: async (args, ctx) => {
			try {
				const { id, flags } = parseIdFlags(args, ["--apply", "--allow-dirty", "--allow-stale-snapshot"]);
				const result = await mutate(() => resetGeneralBench(id, {
					apply: flags.has("--apply"),
					allowDirty: flags.has("--allow-dirty") ? "any" : "none",
					allowStaleSnapshot: flags.has("--allow-stale-snapshot"),
					currentWorkingDirectory: ctx.cwd,
				}));
				ctx.ui.notify(resetText(result), result.plan.status === "ready" ? "info" : "warning");
			}
			catch (err) { ctx.ui.notify(String(err), "error"); }
		},
	});
	pi.registerCommand("maglev-bench-close", {
		description: "Close: <bench-id> [--apply] [--keep-checkout] [--allow-dirty] [--allow-local-commits] [--allow-stale]",
		handler: async (args, ctx) => {
			try {
				const { id, flags } = parseIdFlags(args, ["--apply", "--keep-checkout", "--allow-dirty", "--allow-local-commits", "--allow-stale"]);
				const result = await mutate(() => closeGeneralBench(id, {
					currentWorkingDirectory: ctx.cwd,
					apply: flags.has("--apply"),
					removeCheckout: !flags.has("--keep-checkout"),
					allowDirty: flags.has("--allow-dirty") ? "any" : "none",
					allowLocalCommits: flags.has("--allow-local-commits"),
					allowStale: flags.has("--allow-stale"),
				}));
				ctx.ui.notify(closeText(result), result.plan.status === "ready" ? "info" : "warning");
			}
			catch (err) { ctx.ui.notify(String(err), "error"); }
		},
	});
	pi.registerCommand("maglev-bench-associate-pr", {
		description: "Associate: <bench-id> <PR> [--apply] [--allow-stale-snapshot] [--allow-head-mismatch]",
		handler: async (args, ctx) => {
			const [benchId, number, ...flags] = args.trim().split(/\s+/);
			if (!benchId || !/^[1-9]\d*$/.test(number ?? "") || flags.some((flag) => !["--apply", "--allow-stale-snapshot", "--allow-head-mismatch"].includes(flag))) { ctx.ui.notify("Invalid association arguments.", "error"); return; }
			try {
				const result = await mutate(() => associateBenchPr(benchId, Number(number), {
					apply: flags.includes("--apply"),
					allowStaleSnapshot: flags.includes("--allow-stale-snapshot"),
					allowHeadMismatch: flags.includes("--allow-head-mismatch"),
				}));
				ctx.ui.notify(startText(result), "info");
			}
			catch (err) { ctx.ui.notify(String(err), "error"); }
		},
	});
}
