import { readFile } from "node:fs/promises";
import { buildBenchKickoffPromptFromTemplate } from "./bench-core.ts";
import { decisionMap } from "./decisions.ts";
import { loadDecisions, loadSnapshot } from "./state.ts";
import type { DecisionsFile, SnapshotFile } from "./types.ts";

export interface BenchKickoffParams {
	pr: number;
	context?: string;
	/** Resolved Bench path, including a branch Bench associated with this PR. */
	benchPath?: string;
}

export interface BenchKickoffDeps {
	loadSnapshot: () => Promise<SnapshotFile>;
	loadDecisions: () => Promise<{ file: DecisionsFile }>;
	readTemplate: () => Promise<string>;
}

// On-demand context for the calling agent; never writes files or sends input to tmux.
export async function loadBenchKickoff(params: BenchKickoffParams, deps: BenchKickoffDeps = {
	loadSnapshot,
	loadDecisions,
	readTemplate: () => readFile(new URL("../prompts/bench-kickoff.md", import.meta.url), "utf8"),
}) {
	if (!Number.isInteger(params.pr) || params.pr < 1) throw new Error("PR number must be a positive integer.");
	const snapshot = await deps.loadSnapshot();
	const pr = snapshot.pullRequests.find((item) => item.number === params.pr);
	if (!pr) throw new Error(`PR #${params.pr} is not present in the GitHub snapshot. Run maglev_pr_refresh_metadata first.`);
	const [{ file }, template] = await Promise.all([deps.loadDecisions(), deps.readTemplate()]);
	return {
		pr: params.pr,
		snapshotFetchedAt: snapshot.fetchedAt,
		prompt: buildBenchKickoffPromptFromTemplate(template, pr, decisionMap(file.decisions).get(params.pr), params.context, params.benchPath),
	};
}
