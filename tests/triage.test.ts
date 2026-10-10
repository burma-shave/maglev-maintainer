import assert from "node:assert/strict";
import test from "node:test";
import { assessRecommendation, compactPrLine, computeNeedsInference, listPrsNeedingInference, loadPrMetadata, selectSnapshotPrs } from "../extensions/triage.ts";
import { makeDecision, makeSnapshotFile, makeSnapshotPr } from "../testdata/fixtures.ts";

test("applicability uses evidence identity rather than commit or write time", () => {
	const discussion = "2026-01-02T00:00:00Z";
	const pr = makeSnapshotPr({ number: 1, headOid: "B", discussionUpdatedAt: discussion, lastCommit: { at: "2025-01-01T00:00:00Z" } });
	const decision = makeDecision(1, { decidedAt: "2026-01-10T00:00:00Z", basis: { headOid: "A", discussionUpdatedAt: discussion } });
	assert.equal(assessRecommendation(pr, decision).status, "superseded");
	assert.equal(computeNeedsInference(makeSnapshotFile([pr]), [decision])[0].applicability.head.status, "changed");
	decision.basis!.headOid = "B";
	assert.equal(assessRecommendation(pr, decision).status, "current");
	assert.deepEqual(computeNeedsInference(makeSnapshotFile([pr], { fetchedAt: "2026-01-20T00:00:00Z" }), [decision]), []);
	for (const changedDiscussion of ["2026-01-03T00:00:00Z", "2026-01-01T00:00:00Z"]) {
		const result = assessRecommendation({ ...pr, discussionUpdatedAt: changedDiscussion }, decision);
		assert.equal(result.status, "superseded");
		assert.equal(result.discussion.status, "changed");
	}
	assert.equal(assessRecommendation(pr, { ...decision, basis: { headOid: "B" } }).status, "unknown");
	assert.equal(assessRecommendation(pr, { ...decision, basis: { headOid: "B", discussionUpdatedAt: "invalid" } }).status, "unknown");
	const partial = assessRecommendation(pr, { ...decision, basis: { headOid: "A" } });
	assert.equal(partial.status, "superseded");
	assert.equal(partial.discussion.status, "unknown");
	assert.equal(partial.reasons.length, 2);
	assert.equal(assessRecommendation({ ...pr, headOid: undefined }, decision).status, "unknown");
	assert.equal(assessRecommendation(pr, { ...decision, basis: { headOid: "unknown", discussionUpdatedAt: discussion } }).status, "unknown");
	assert.equal(assessRecommendation(pr, { ...decision, basis: { headOid: "B", discussionUpdatedAt: "2026-01-02T00:00:00.000Z" } }).status, "current");
});

test("computeNeedsInference returns PRs with no saved decision sorted by meaningful activity", () => {
	const rows = computeNeedsInference(makeSnapshotFile([
		makeSnapshotPr({ number: 1, meaningfulUpdatedAt: "2026-01-02T00:00:00Z" }),
		makeSnapshotPr({ number: 2, meaningfulUpdatedAt: "2026-01-04T00:00:00Z" }),
	]), []);

	assert.deepEqual(rows.map((row) => row.number), [2, 1]);
	assert.equal(rows[0].reason, "no saved bucket decision");
});

test("computeNeedsInference treats captured discussion changes as superseding evidence", () => {
	const snap = makeSnapshotFile([
		makeSnapshotPr({
			number: 10,
			headOid: "same",
			discussionUpdatedAt: "2026-01-02T00:00:00Z",
			updatedAt: "2026-01-05T00:00:00Z",
			meaningfulUpdatedAt: "2026-01-02T00:00:00Z",
		}),
		makeSnapshotPr({
			number: 11,
			headOid: "same",
			discussionUpdatedAt: "2026-01-04T00:00:00Z",
			updatedAt: "2026-01-05T00:00:00Z",
			meaningfulUpdatedAt: "2026-01-04T00:00:00Z",
		}),
	]);

	const rows = computeNeedsInference(snap, [
		makeDecision(10, { decidedAt: "2026-01-03T00:00:00Z", basis: { headOid: "same", discussionUpdatedAt: "2026-01-02T00:00:00Z" } }),
		makeDecision(11, { decidedAt: "2026-01-03T00:00:00Z", basis: { headOid: "same", discussionUpdatedAt: "2026-01-02T00:00:00Z" } }),
	]);

	assert.deepEqual(rows.map((row) => row.number), [11]);
	assert.equal(rows[0].reason, "captured human discussion differs from evaluated discussion");
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
		makeSnapshotPr({ number: 30, meaningfulUpdatedAt: "2026-01-02T00:00:00Z", headOid: "same" }),
		makeSnapshotPr({ number: 31, meaningfulUpdatedAt: "2026-01-04T00:00:00Z" }),
	]);
	const decisions = [makeDecision(30, { decidedAt: "2026-01-03T00:00:00Z", basis: { headOid: "same", discussionUpdatedAt: "2026-01-01T00:00:00Z" } })];

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
	assert.equal(result.pullRequests[0].discussionUpdatedAt, "2026-01-01T00:00:00Z", "old snapshot current-side evidence reaches analysts");
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

test("readiness churn is not applicability, and invalid decisions still need inference", () => {
	const pr = makeSnapshotPr({ number: 1, headOid: "same" });
	const decision = makeDecision(1, { basis: { headOid: "same", discussionUpdatedAt: pr.createdAt } });
	for (const ready of [pr, { ...pr, reviewDecision: "APPROVED", mergeStateStatus: "DIRTY", badChecks: ["tests"], updatedAt: "2026-01-20T00:00:00Z" }]) {
		assert.deepEqual(computeNeedsInference(makeSnapshotFile([ready]), [decision]), []);
	}
	assert.equal(computeNeedsInference(makeSnapshotFile([pr]), [])[0].reason, "no saved bucket decision");
	assert.match(computeNeedsInference(makeSnapshotFile([pr]), [{ ...decision, bucket: "invalid" as any }])[0].reason, /invalid saved bucket/);
	assert.match(computeNeedsInference(makeSnapshotFile([pr]), [{ ...decision, decidedAt: "bad" }])[0].reason, /invalid decidedAt/);
	assert.equal(computeNeedsInference(makeSnapshotFile([pr]), [makeDecision(1)])[0].applicability.status, "unknown");
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
