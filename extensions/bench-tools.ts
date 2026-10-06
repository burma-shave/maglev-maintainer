import { withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { associateBenchPr, closeGeneralBench, collectAllBenchStates, formatBenchClosePlan, formatBenchLine, formatBenchStartPlan, formatBenchStartVerification, inspectGeneralBench, startBranchBench, type BenchStartResult } from "./bench.ts";
import { BENCH_STATE_DIR } from "./paths.ts";
import { toolResult } from "./utils.ts";

const id = Type.String({ minLength: 1, description: "Stable Bench ID returned by list/start; not a Git branch name." });
const apply = Type.Optional(Type.Boolean({ description: "Execute only on explicit user request. Defaults to false/dry-run." }));
const context = Type.Optional(Type.String({ description: "Background startup context appended to a newly launched Pi system prompt; no task or automatic review. Refused for an already-running Pi window." }));
const allowDirty = Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("untracked"), Type.Literal("any")]));
const safety = {
	allowStaleSnapshot: Type.Optional(Type.Boolean()),
	allowHeadMismatch: Type.Optional(Type.Boolean()),
};
function startText(result: BenchStartResult): string {
	return [...formatBenchStartPlan(result.plan), `Applied: ${result.applied}`, ...result.executed,
		...(result.verification ? formatBenchStartVerification(result.verification) : []),
		...(result.contextPath ? [`Startup context: ${result.contextPath}`] : []),
		...(result.mutationWarning ? [result.mutationWarning] : []),
		...(result.snapshotWarning ? [result.snapshotWarning] : []),
	].join("\n");
}
export function registerGeneralBenchTools(pi: ExtensionAPI) {
	pi.registerTool({
		name: "maglev_bench_list", label: "Maglev Bench List", description: "List all local branch-based Maglev Benches, including PR specializations. Read-only.",
		parameters: Type.Object({ ids: Type.Optional(Type.Array(id)) }),
		async execute(_id, params) {
			const result = await collectAllBenchStates(params);
			return toolResult([`Benches (${result.benches.length})`, ...result.benches.map(formatBenchLine)].join("\n"), result);
		},
	});
	pi.registerTool({
		name: "maglev_bench_inspect", label: "Maglev Bench Inspect", description: "Inspect any Maglev Bench by stable ID, including dirty files, upstream, and local-only commit safety. Read-only.",
		parameters: Type.Object({ id }),
		async execute(_id, params) {
			const result = await inspectGeneralBench(params.id);
			return toolResult(JSON.stringify(result, null, 2), result);
		},
	});
	pi.registerTool({
		name: "maglev_bench_start", label: "Maglev Bench Start", description: "Plan or execute opening/recovering a Maglev Bench on an existing remote branch, or explicitly creating a branch from createFrom. Shared lifecycle with PR Benches; never pulls or resets an existing branch.",
		promptGuidelines: ["Use maglev_pr_workspace_context first. Dry-run by default; apply only on explicit request. No PR snapshot required for an unassociated branch Bench. Pass startup context only when launching a new Pi window."],
		parameters: Type.Object({ branch: Type.String({ minLength: 1 }), createFrom: Type.Optional(Type.String({ minLength: 1, description: "Explicitly create a new branch from this ref, e.g. origin/main. Omit to open an existing origin branch." })), apply, context, reuseExisting: Type.Optional(Type.Boolean()), ...safety }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const result = await withFileMutationQueue(BENCH_STATE_DIR, () => startBranchBench(params.branch, { ...params, currentWorkingDirectory: ctx?.cwd ?? process.cwd() }));
			return toolResult(startText(result), { ...result });
		},
	});
	pi.registerTool({
		name: "maglev_bench_close", label: "Maglev Bench Close", description: "Plan or execute closing any Maglev Bench. Protects dirty/ignored files, local-only commits across live refs (including HEAD/stash), and unknown preservation state. Remote-ref checks use locally cached refs, not a fetch.",
		promptGuidelines: ["Inspect first. Dry-run by default. Show warnings and obtain explicit acknowledgement before discarding files or committed work. Set removeCheckout false to stop tmux while preserving the checkout and artifacts."],
		parameters: Type.Object({ id, apply, allowDirty, allowStale: Type.Optional(Type.Boolean()), allowLocalCommits: Type.Optional(Type.Boolean({ description: "Explicitly acknowledge losing committed work or unverified preservation." })), closeTmux: Type.Optional(Type.Boolean()), removeCheckout: Type.Optional(Type.Boolean()) }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const result = await withFileMutationQueue(BENCH_STATE_DIR, () => closeGeneralBench(params.id, { ...params, currentWorkingDirectory: ctx?.cwd ?? process.cwd() }));
			return toolResult([...formatBenchClosePlan(result.plan), `Applied: ${result.applied}`, ...result.executed].join("\n"), { ...result });
		},
	});
	pi.registerTool({
		name: "maglev_bench_associate_pr", label: "Associate Bench PR", description: "Associate an existing Maglev branch Bench with a matching PR from the local snapshot. Preserves identity, checkout, tmux, Pi, and artifacts; does not start review or modify an active session.",
		promptGuidelines: ["Check snapshot staleness and refresh when needed before association. Dry-run by default; apply only on explicit request. PR must have the same head repository and branch, and cannot already have another Bench."],
		parameters: Type.Object({ id, pr: Type.Integer({ minimum: 1 }), apply, ...safety }),
		async execute(_id, params) {
			const result = await withFileMutationQueue(BENCH_STATE_DIR, () => associateBenchPr(params.id, params.pr, params));
			return toolResult(startText(result), { ...result });
		},
	});

	// Commands deliberately default to plans; --apply is explicit mutation authorization.
	pi.registerCommand("maglev-benches", {
		description: "List all Maglev Benches (branches and PRs)",
		handler: async (_args, ctx) => {
			const result = await collectAllBenchStates();
			ctx.ui.notify([`Benches (${result.benches.length})`, ...result.benches.map(formatBenchLine)].join("\n"), "info");
		},
	});
	pi.registerCommand("maglev-bench-start", {
		description: "Open/recover a branch Bench: <branch> [--from <base-ref>] [--apply]",
		handler: async (args, ctx) => {
			const parsed = parseBranchStartArgs(args);
			if (parsed.error) { ctx.ui.notify(parsed.error, "error"); return; }
			try { ctx.ui.notify(startText(await withFileMutationQueue(BENCH_STATE_DIR, () => startBranchBench(parsed.branch!, { apply: parsed.apply, createFrom: parsed.createFrom, currentWorkingDirectory: ctx.cwd }))), "info"); }
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
	pi.registerCommand("maglev-bench-close", {
		description: "Close a Bench: <bench-id> [--apply] [--keep-checkout] [--allow-dirty] [--allow-local-commits] [--allow-stale]",
		handler: async (args, ctx) => {
			const tokens = args.trim().split(/\s+/);
			if (!tokens[0] || tokens.slice(1).some((token) => !["--apply", "--keep-checkout", "--allow-dirty", "--allow-local-commits", "--allow-stale"].includes(token))) { ctx.ui.notify("Invalid close arguments; see /maglev-bench-close help.", "error"); return; }
			try {
				const result = await withFileMutationQueue(BENCH_STATE_DIR, () => closeGeneralBench(tokens[0], {
					currentWorkingDirectory: ctx.cwd, apply: tokens.includes("--apply"), removeCheckout: !tokens.includes("--keep-checkout"), allowDirty: tokens.includes("--allow-dirty") ? "any" : "none",
					allowLocalCommits: tokens.includes("--allow-local-commits"), allowStale: tokens.includes("--allow-stale"),
				}));
				ctx.ui.notify([...formatBenchClosePlan(result.plan), `Applied: ${result.applied}`, ...result.executed].join("\n"), result.plan.status === "ready" ? "info" : "warning");
			} catch (err) { ctx.ui.notify(String(err), "error"); }
		},
	});
	pi.registerCommand("maglev-bench-associate-pr", {
		description: "Associate a branch Bench with a PR: <bench-id> <PR> [--apply] [--allow-stale-snapshot] [--allow-head-mismatch]",
		handler: async (args, ctx) => {
			const [benchId, pr, ...flags] = args.trim().split(/\s+/);
			if (!benchId || !/^[1-9]\d*$/.test(pr ?? "") || flags.some((flag) => !["--apply", "--allow-stale-snapshot", "--allow-head-mismatch"].includes(flag))) { ctx.ui.notify("Invalid association arguments.", "error"); return; }
			try { ctx.ui.notify(startText(await withFileMutationQueue(BENCH_STATE_DIR, () => associateBenchPr(benchId, Number(pr), { apply: flags.includes("--apply"), allowStaleSnapshot: flags.includes("--allow-stale-snapshot"), allowHeadMismatch: flags.includes("--allow-head-mismatch") }))), "info"); }
			catch (err) { ctx.ui.notify(String(err), "error"); }
		},
	});
}

export function parseBranchStartArgs(args: string): { branch?: string; createFrom?: string; apply: boolean; error?: string } {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	const branch = tokens.shift();
	let apply = false;
	let createFrom: string | undefined;
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i] === "--apply") apply = true;
		else if (tokens[i] === "--from" && !createFrom && tokens[i + 1] && !tokens[i + 1].startsWith("--")) createFrom = tokens[++i];
		else return { apply, error: "Usage: /maglev-bench-start <branch> [--from <base-ref>] [--apply]" };
	}
	return branch ? { branch, createFrom, apply } : { apply, error: "Usage: /maglev-bench-start <branch> [--from <base-ref>] [--apply]" };
}
