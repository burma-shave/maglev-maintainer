import assert from "node:assert/strict";
import test from "node:test";
import { buildStateQuery, formatStateQueryJson } from "../extensions/state-query.ts";
import { makeBenchState, makeDecision, makeSnapshotFile, makeSnapshotPr } from "../testdata/fixtures.ts";

test("buildStateQuery joins full snapshot, decision, needs-inference, and PR Bench state", () => {
	const snapshot = makeSnapshotFile([
		makeSnapshotPr({ number: 7, title: "stale", meaningfulUpdatedAt: "2026-01-04T00:00:00Z", headOid: "new" }),
		makeSnapshotPr({ number: 8, title: "fresh", meaningfulUpdatedAt: "2026-01-01T00:00:00Z", headOid: "same" }),
	]);
	const decisions = [
		makeDecision(7, { bucket: "watch", reason: "old", decidedAt: "2026-01-02T00:00:00Z", basis: { headOid: "old" } }),
		makeDecision(8, { bucket: "review", reason: "ready", decidedAt: "2026-01-02T00:00:00Z" }),
	];
	const benches = [makeBenchState({ pr: 8, benchPath: "/var/lib/maglev-pr-maintainer/checkouts/pr-8", freshness: "fresh" })];

	const result = buildStateQuery({ snapshot, decisions, benches, prs: [8, 7, 8, 99] });

	assert.equal(result.selection, "numbers");
	assert.deepEqual(result.rows.map((row) => row.pr), [8, 7, 99]);
	assert.equal(result.rows[0].snapshot?.title, "fresh");
	assert.equal(result.rows[0].decision?.bucket, "review");
	assert.equal(result.rows[0].bench?.benchPath, "/var/lib/maglev-pr-maintainer/checkouts/pr-8");
	assert.equal(result.rows[1].needsInference?.reason, "saved decision is stale after commit/human activity");
	assert.equal(result.rows[2].snapshot, null);
	assert.deepEqual(result.missingFromSnapshot, [99]);
});

test("buildStateQuery supports needs-inference selection and limits without dropping total counts", () => {
	const snapshot = makeSnapshotFile([
		makeSnapshotPr({ number: 1, meaningfulUpdatedAt: "2026-01-03T00:00:00Z" }),
		makeSnapshotPr({ number: 2, meaningfulUpdatedAt: "2026-01-04T00:00:00Z" }),
		makeSnapshotPr({ number: 3, meaningfulUpdatedAt: "2026-01-01T00:00:00Z" }),
	]);
	const decisions = [makeDecision(3, { decidedAt: "2026-01-02T00:00:00Z" })];

	const result = buildStateQuery({ snapshot, decisions, benches: [], selection: "needs-inference", limit: 1 });

	assert.equal(result.totalSelected, 2);
	assert.equal(result.returned, 1);
	assert.equal(result.truncated, true);
	assert.deepEqual(result.rows.map((row) => row.pr), [2]);
	assert.match(formatStateQueryJson(result), /"snapshotFetchedAt"/);
});
