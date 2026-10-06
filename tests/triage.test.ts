import assert from "node:assert/strict";
import test from "node:test";
import { compactPrLine, computeNeedsInference, listPrsNeedingInference, loadPrMetadata, selectSnapshotPrs } from "../extensions/triage.ts";
import { makeDecision, makeSnapshotFile, makeSnapshotPr } from "../testdata/fixtures.ts";

test("computeNeedsInference returns PRs with no saved decision sorted by meaningful activity", () => {
	const rows = computeNeedsInference(makeSnapshotFile([
		makeSnapshotPr({ number: 1, meaningfulUpdatedAt: "2026-01-02T00:00:00Z" }),
		makeSnapshotPr({ number: 2, meaningfulUpdatedAt: "2026-01-04T00:00:00Z" }),
	]), []);

	assert.deepEqual(rows.map((row) => row.number), [2, 1]);
	assert.equal(rows[0].reason, "no saved bucket decision");
});

test("computeNeedsInference treats decisions as stale only after meaningful activity", () => {
	const snap = makeSnapshotFile([
		makeSnapshotPr({
			number: 10,
			updatedAt: "2026-01-05T00:00:00Z",
			meaningfulUpdatedAt: "2026-01-02T00:00:00Z",
		}),
		makeSnapshotPr({
			number: 11,
			updatedAt: "2026-01-05T00:00:00Z",
			meaningfulUpdatedAt: "2026-01-04T00:00:00Z",
		}),
	]);

	const rows = computeNeedsInference(snap, [
		makeDecision(10, { decidedAt: "2026-01-03T00:00:00Z" }),
		makeDecision(11, { decidedAt: "2026-01-03T00:00:00Z" }),
	]);

	assert.deepEqual(rows.map((row) => row.number), [11]);
	assert.equal(rows[0].reason, "saved decision is stale after commit/human activity");
});

test("computeNeedsInference supports PR filters", () => {
	const rows = computeNeedsInference(makeSnapshotFile([
		makeSnapshotPr({ number: 20, meaningfulUpdatedAt: "2026-01-02T00:00:00Z" }),
		makeSnapshotPr({ number: 21, meaningfulUpdatedAt: "2026-01-03T00:00:00Z" }),
	]), [], [20]);

	assert.deepEqual(rows.map((row) => row.number), [20]);
});

test("selectSnapshotPrs supports all, numbers, and needs-inference selections", () => {
	const snap = makeSnapshotFile([
		makeSnapshotPr({ number: 30, meaningfulUpdatedAt: "2026-01-02T00:00:00Z" }),
		makeSnapshotPr({ number: 31, meaningfulUpdatedAt: "2026-01-04T00:00:00Z" }),
	]);
	const decisions = [makeDecision(30, { decidedAt: "2026-01-03T00:00:00Z" })];

	assert.deepEqual(selectSnapshotPrs(snap, {}, decisions).map((item) => item.number), [30, 31]);
	assert.deepEqual(selectSnapshotPrs(snap, { prs: [31] }, decisions).map((item) => item.number), [31]);
	assert.deepEqual(selectSnapshotPrs(snap, { selection: "needs-inference" }, decisions).map((item) => item.number), [31]);
});

test("loadPrMetadata returns selected PRs and missing requested PR numbers", async () => {
	const result = await loadPrMetadata({ prs: [60, 62] }, {
		loadSnapshot: async () => makeSnapshotFile([
			makeSnapshotPr({ number: 60, title: "Load me" }),
			makeSnapshotPr({ number: 61, title: "Skip me" }),
		]),
		loadDecisions: async () => ({ file: { schemaVersion: 1, repo: "OneBusAway/maglev", updatedAt: "2026-01-01T00:00:00Z", decisions: [] }, importedFromOld: false }),
	});

	assert.equal(result.snapshotFetchedAt, "2026-01-10T00:00:00Z");
	assert.equal(result.repo, "OneBusAway/maglev");
	assert.deepEqual(result.pullRequests.map((pr) => pr.number), [60]);
	assert.deepEqual(result.missing, [62]);
});

test("listPrsNeedingInference returns structured rows and old-decision import status", async () => {
	const result = await listPrsNeedingInference({}, {
		loadSnapshot: async () => makeSnapshotFile([
			makeSnapshotPr({ number: 50, title: "Needs triage", meaningfulUpdatedAt: "2026-01-04T00:00:00Z" }),
		]),
		loadDecisions: async () => ({ file: { schemaVersion: 1, repo: "OneBusAway/maglev", updatedAt: "2026-01-01T00:00:00Z", decisions: [] }, importedFromOld: true }),
	});

	assert.equal(result.snapshotFetchedAt, "2026-01-10T00:00:00Z");
	assert.equal(result.importedFromOld, true);
	assert.deepEqual(result.prs.map((pr) => ({ number: pr.number, reason: pr.reason })), [
		{ number: 50, reason: "no saved bucket decision" },
	]);
});

test("compactPrLine includes review, check, and stack flags", () => {
	const line = compactPrLine(makeSnapshotPr({
		number: 40,
		title: "Add GTFS support",
		author: "alice",
		isDraft: true,
		reviewDecision: "CHANGES_REQUESTED",
		mergeStateStatus: "DIRTY",
		badChecks: ["test", "lint"],
		stackBasePR: 39,
		stackChildren: [41],
	}));

	assert.equal(line, "#40 Add GTFS support — alice (draft; CHANGES_REQUESTED; DIRTY; 2 bad checks; stack base #39; stack children #41)");
});
