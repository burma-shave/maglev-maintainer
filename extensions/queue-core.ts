import { VALID_BUCKET_SET } from "./constants.ts";
import { decisionMap } from "./decisions.ts";
import { computeNeedsInference } from "./triage.ts";
import type { BenchState, DecisionBucket, SnapshotFile, SnapshotPR, TriageDecision } from "./types.ts";

export type QueueBucket = "triage" | DecisionBucket | "bench";

export interface QueueRow {
	bucket: QueueBucket;
	pr: number;
	title: string;
	author?: string;
	url?: string;
	priority?: number;
	reason?: string;
	decidedAt?: string;
	meaningfulUpdatedAt?: string;
	bench?: BenchState;
}

export interface QueueModel {
	snapshotFetchedAt: string;
	rowsByBucket: Record<QueueBucket, QueueRow[]>;
}

export interface BuildQueueInput {
	snapshot: SnapshotFile;
	decisions: TriageDecision[];
	benches: BenchState[];
	prs?: number[];
}

export const QUEUE_BUCKETS: QueueBucket[] = ["triage", "review", "chase", "pinned", "watch", "bench"];

function emptyRowsByBucket(): Record<QueueBucket, QueueRow[]> {
	return { triage: [], review: [], chase: [], pinned: [], watch: [], bench: [] };
}

function sortDecisionRows(a: QueueRow, b: QueueRow): number {
	return (b.priority ?? -1) - (a.priority ?? -1)
		|| Date.parse(b.meaningfulUpdatedAt ?? "") - Date.parse(a.meaningfulUpdatedAt ?? "")
		|| a.pr - b.pr;
}

function snapshotRow(pr: SnapshotPR, bucket: QueueBucket, extras: Partial<QueueRow> = {}): QueueRow {
	return {
		bucket,
		pr: pr.number,
		title: pr.title,
		author: pr.author,
		url: pr.url,
		meaningfulUpdatedAt: pr.meaningfulUpdatedAt,
		...extras,
	};
}

export function buildQueueModel(input: BuildQueueInput): QueueModel {
	const rowsByBucket = emptyRowsByBucket();
	const filterSet = input.prs?.length ? new Set(input.prs) : undefined;
	const snapshotPrs = input.snapshot.pullRequests.filter((pr) => !filterSet || filterSet.has(pr.number));
	const prByNumber = new Map(snapshotPrs.map((pr) => [pr.number, pr]));
	const needs = computeNeedsInference(input.snapshot, input.decisions, input.prs);
	const needsSet = new Set(needs.map((row) => row.number));
	for (const row of needs) {
		const pr = prByNumber.get(row.number);
		if (pr) rowsByBucket.triage.push(snapshotRow(pr, "triage", { reason: row.reason }));
	}

	for (const decision of decisionMap(input.decisions).values()) {
		if (filterSet && !filterSet.has(decision.pr)) continue;
		if (needsSet.has(decision.pr)) continue;
		if (!VALID_BUCKET_SET.has(decision.bucket)) continue;
		const pr = prByNumber.get(decision.pr);
		if (!pr) continue;
		rowsByBucket[decision.bucket].push(snapshotRow(pr, decision.bucket, {
			priority: decision.priority,
			reason: decision.reason,
			decidedAt: decision.decidedAt,
		}));
	}

	for (const bench of input.benches) {
		if (filterSet && !filterSet.has(bench.pr)) continue;
		const pr = prByNumber.get(bench.pr);
		rowsByBucket.bench.push({
			bucket: "bench",
			pr: bench.pr,
			title: pr?.title ?? bench.title ?? `PR #${bench.pr}`,
			author: pr?.author ?? bench.author,
			url: pr?.url ?? bench.url,
			meaningfulUpdatedAt: pr?.meaningfulUpdatedAt,
			bench,
		});
	}

	for (const bucket of QUEUE_BUCKETS) {
		rowsByBucket[bucket].sort(bucket === "bench" ? (a, b) => a.pr - b.pr : sortDecisionRows);
	}
	return { snapshotFetchedAt: input.snapshot.fetchedAt, rowsByBucket };
}

export function queueCounts(model: QueueModel): Record<QueueBucket, number> {
	return {
		triage: model.rowsByBucket.triage.length,
		review: model.rowsByBucket.review.length,
		chase: model.rowsByBucket.chase.length,
		pinned: model.rowsByBucket.pinned.length,
		watch: model.rowsByBucket.watch.length,
		bench: model.rowsByBucket.bench.length,
	};
}

function formatBucketName(bucket: QueueBucket): string {
	return bucket === "triage" ? "TRIAGE" : bucket === "bench" ? "PR Benches" : bucket.toUpperCase();
}

function formatQueueRow(row: QueueRow): string {
	const parts = [
		row.author,
		typeof row.priority === "number" ? `p${row.priority}` : undefined,
		row.reason,
		row.bucket === "bench" && row.bench?.tmuxExists ? `tmux ${row.bench.sessionName}` : undefined,
		row.bucket === "bench" ? row.bench?.benchPath : undefined,
		row.bucket === "bench" && row.bench?.freshness !== "unknown" ? row.bench?.freshness : undefined,
		row.bucket === "bench" && row.bench?.dirty ? "dirty" : undefined,
	].filter(Boolean);
	return `#${row.pr} ${row.title}${parts.length ? ` — ${parts.join(" • ")}` : ""}`;
}

export interface FormatQueueReportOptions {
	maxRowsPerBucket?: number;
}

export function formatQueueReportLines(model: QueueModel, options: FormatQueueReportOptions = {}): string[] {
	const maxRowsPerBucket = options.maxRowsPerBucket ?? 8;
	const counts = queueCounts(model);
	const lines = [
		`Maglev PRs • snapshot ${model.snapshotFetchedAt}`,
		`TRIAGE ${counts.triage} • REVIEW ${counts.review} • CHASE ${counts.chase} • PINNED ${counts.pinned} • WATCH ${counts.watch} • BENCH ${counts.bench}`,
	];
	for (const bucket of QUEUE_BUCKETS) {
		const rows = model.rowsByBucket[bucket];
		if (!rows.length) continue;
		lines.push(`${formatBucketName(bucket)} (${rows.length})`);
		lines.push(...rows.slice(0, maxRowsPerBucket).map(formatQueueRow));
		if (rows.length > maxRowsPerBucket) lines.push(`…${rows.length - maxRowsPerBucket} more`);
	}
	lines.push("TRIAGE means run skill inference; this report is read-only.");
	return lines;
}
