import assert from "node:assert/strict";
import test from "node:test";
import { buildQueueModel, formatQueueReportLines, queueCounts } from "../extensions/queue-core.ts";
import { makeBenchState, makeDecision, makeSnapshotFile, makeSnapshotPr } from "../testdata/fixtures.ts";

test("buildQueueModel puts missing and stale decisions in TRIAGE and excludes stale saved buckets", () => {
	const snapshot = makeSnapshotFile([
		makeSnapshotPr({ number: 1, meaningfulUpdatedAt: "2026-01-03T00:00:00Z" }),
		makeSnapshotPr({ number: 2, meaningfulUpdatedAt: "2026-01-04T00:00:00Z" }),
		makeSnapshotPr({ number: 3, meaningfulUpdatedAt: "2026-01-01T00:00:00Z" }),
	]);
	const model = buildQueueModel({
		snapshot,
		decisions: [
			makeDecision(2, { bucket: "watch", decidedAt: "2026-01-02T00:00:00Z", reason: "old wait" }),
			makeDecision(3, { bucket: "review", decidedAt: "2026-01-02T00:00:00Z", reason: "ready" }),
		],
		benches: [],
	});

	assert.deepEqual(model.rowsByBucket.triage.map((row) => row.pr), [2, 1]);
	assert.deepEqual(model.rowsByBucket.watch.map((row) => row.pr), []);
	assert.deepEqual(model.rowsByBucket.review.map((row) => row.pr), [3]);
	assert.equal(model.rowsByBucket.triage[0].reason, "saved decision is stale after commit/human activity");
});

test("buildQueueModel groups decisions, sorts by priority, and computes PR Bench rows", () => {
	const snapshot = makeSnapshotFile([
		makeSnapshotPr({ number: 10, title: "Low", meaningfulUpdatedAt: "2026-01-03T00:00:00Z" }),
		makeSnapshotPr({ number: 11, title: "High", meaningfulUpdatedAt: "2026-01-02T00:00:00Z" }),
	]);
	const model = buildQueueModel({
		snapshot,
		decisions: [
			makeDecision(10, { bucket: "review", priority: 1, decidedAt: "2026-01-04T00:00:00Z" }),
			makeDecision(11, { bucket: "review", priority: 7, decidedAt: "2026-01-04T00:00:00Z" }),
		],
		benches: [makeBenchState({ pr: 11, title: "Bench fallback", benchPath: "/var/lib/maglev-maintainer/checkouts/pr-11", freshness: "fresh", fresh: true })],
	});

	assert.deepEqual(model.rowsByBucket.review.map((row) => row.pr), [11, 10]);
	assert.deepEqual(model.rowsByBucket.bench.map((row) => ({ pr: row.pr, title: row.title, path: row.bench?.benchPath })), [
		{ pr: 11, title: "High", path: "/var/lib/maglev-maintainer/checkouts/pr-11" },
	]);
	assert.deepEqual(queueCounts(model), { triage: 0, review: 2, chase: 0, pinned: 0, watch: 0, bench: 1 });
});

test("formatQueueReportLines uses read-only queue and PR Bench terminology", () => {
	const model = buildQueueModel({
		snapshot: makeSnapshotFile([makeSnapshotPr({ number: 20, title: "Needs decision" })]),
		decisions: [],
		benches: [makeBenchState({ pr: 20, benchPath: "/var/lib/maglev-maintainer/checkouts/pr-20", tmuxExists: true, freshness: "stale", dirty: true })],
	});

	const lines = formatQueueReportLines(model, { maxRowsPerBucket: 5 });
	assert.equal(lines[0], "Maglev PRs • snapshot 2026-01-10T00:00:00Z");
	assert(lines.some((line) => line === "PR Benches (1)"));
	assert(lines.some((line) => line.includes("tmux pr-20") && line.includes("/var/lib/maglev-maintainer/checkouts/pr-20") && line.includes("dirty")));
	assert(lines.at(-1)?.includes("read-only"));
});
