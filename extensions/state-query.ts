import { decisionMap } from "./decisions.ts";
import { computeNeedsInference } from "./triage.ts";
import type { BenchState, NeedsInferenceRow, SnapshotFile, SnapshotPR, TriageDecision } from "./types.ts";

export interface StateQueryInput {
	snapshot: SnapshotFile;
	decisions: TriageDecision[];
	benches: BenchState[];
	selection?: "all" | "numbers" | "needs-inference";
	prs?: number[];
	limit?: number;
}

export interface StateQueryRow {
	pr: number;
	snapshot: SnapshotPR | null;
	decision: TriageDecision | null;
	needsInference: NeedsInferenceRow | null;
	bench: BenchState | null;
}

export interface StateQueryResult {
	repo: string;
	snapshotFetchedAt: string;
	selection: "all" | "numbers" | "needs-inference";
	totalSelected: number;
	returned: number;
	truncated: boolean;
	missingFromSnapshot: number[];
	rows: StateQueryRow[];
}

function uniqueNumbers(numbers: number[]): number[] {
	const seen = new Set<number>();
	return numbers.filter((number) => {
		if (seen.has(number)) return false;
		seen.add(number);
		return true;
	});
}

export function buildStateQuery(input: StateQueryInput): StateQueryResult {
	const selection = input.selection ?? (input.prs?.length ? "numbers" : "all");
	const snapshotByPr = new Map(input.snapshot.pullRequests.map((pr) => [pr.number, pr]));
	const decisionByPr = decisionMap(input.decisions);
	const benchByPr = new Map(input.benches.map((bench) => [bench.pr, bench]));
	const needsRows = computeNeedsInference(input.snapshot, input.decisions, input.prs);
	const needsByPr = new Map(needsRows.map((row) => [row.number, row]));

	const selectedPrs = uniqueNumbers(selection === "needs-inference"
		? needsRows.map((row) => row.number)
		: selection === "numbers"
			? input.prs ?? []
			: input.snapshot.pullRequests.map((pr) => pr.number));
	const totalSelected = selectedPrs.length;
	const limit = typeof input.limit === "number" ? Math.max(0, Math.floor(input.limit)) : undefined;
	const limitedPrs = typeof limit === "number" ? selectedPrs.slice(0, limit) : selectedPrs;

	return {
		repo: input.snapshot.repo,
		snapshotFetchedAt: input.snapshot.fetchedAt,
		selection,
		totalSelected,
		returned: limitedPrs.length,
		truncated: limitedPrs.length < totalSelected,
		missingFromSnapshot: selectedPrs.filter((pr) => !snapshotByPr.has(pr)),
		rows: limitedPrs.map((pr) => ({
			pr,
			snapshot: snapshotByPr.get(pr) ?? null,
			decision: decisionByPr.get(pr) ?? null,
			needsInference: needsByPr.get(pr) ?? null,
			bench: benchByPr.get(pr) ?? null,
		})),
	};
}

export function formatStateQueryJson(result: StateQueryResult): string {
	return JSON.stringify(result, null, 2);
}
