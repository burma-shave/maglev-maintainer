import assert from "node:assert/strict";
import test from "node:test";
import { getDecision, listDecisions } from "../extensions/decisions.ts";
import { listPrsNeedingInference, loadPrMetadata } from "../extensions/triage.ts";
import { decisionGetToolResult, decisionListToolResult, loadMetadataToolResult, needsInferenceToolResult } from "../extensions/triage-tool-results.ts";
import { toolResult } from "../extensions/utils.ts";
import { makeDecision, makeDecisionsFile, makeSnapshotFile, makeSnapshotPr } from "../testdata/fixtures.ts";

const snapshotFile = "/isolated-fixture/state/github-snapshot.json";
const decisionsFile = "/isolated-fixture/state/decisions.json";
const comment = { author: "contributor", createdAt: "2026-01-05T00:00:00Z", body: "Maintainer, should I retain the legacy route lookup?" };
const review = { author: "maintainer", state: "CHANGES_REQUESTED", submittedAt: "2026-01-04T00:00:00Z", body: "Please test the fallback lookup before merging." };
const commit = { oid: "abc123fullsha", committedDate: "2026-01-06T00:00:00Z", messageHeadline: "Add fallback route lookup tests" };
const pr = makeSnapshotPr({
	number: 42,
	title: "Fallback route lookup",
	headOid: commit.oid,
	meaningfulUpdatedAt: commit.committedDate,
	comments: [comment],
	reviews: [review],
	commits: [commit],
	files: ["src/lookup.ts"],
	lastHumanComment: { author: comment.author, at: comment.createdAt, body: comment.body },
	lastHumanReview: { author: review.author, at: review.submittedAt, body: review.body, state: review.state },
	lastCommit: { at: commit.committedDate, oid: commit.oid, body: commit.messageHeadline },
});
const savedDecision = makeDecision(42, {
	bucket: "pinned",
	priority: 8,
	reason: "Maintainer direction needed on fallback lookup",
	observations: ["Contributor asked for direction on 2026-01-05"],
	source: "user",
	basis: { snapshotFetchedAt: "2026-01-03T00:00:00Z", meaningfulUpdatedAt: "2026-01-01T00:00:00Z", headOid: "oldsha" },
});

function deps(pullRequests = [pr], decisions = [savedDecision]) {
	return {
		loadSnapshot: async () => makeSnapshotFile(pullRequests),
		loadDecisions: async () => ({ file: makeDecisionsFile(decisions), importedFromOld: false }),
	};
}

function contentText(result: ReturnType<typeof toolResult>): string {
	// Pi sends content to the model, not details. Exercise the same result builders
	// returned by the registered adapters, with injected deterministic state.
	return result.content.map((block) => block.text).join("\n");
}

function assertNoDiscussions(text: string) {
	for (const fact of [comment.body, review.body, commit.messageHeadline]) assert.ok(!text.includes(fact));
	for (const field of ["comments", "reviews", "commits", "lastHumanComment", "lastHumanReview"]) assert.ok(!text.includes(`"${field}"`));
}

test("loadMetadataToolResult exposes one selected PR's complete evidence and snapshot identity in content", async () => {
	const result = loadMetadataToolResult(await loadPrMetadata({ prs: [42, 999] }, deps([
		pr, makeSnapshotPr({ number: 43, comments: [{ ...comment, body: "Unselected discussion" }] }),
	])), snapshotFile);
	const payload = JSON.parse(contentText(result));
	assert.equal(payload.snapshotFile, snapshotFile);
	assert.equal(payload.snapshotFetchedAt, "2026-01-10T00:00:00Z");
	assert.equal(payload.repo, "OneBusAway/maglev");
	assert.deepEqual(payload.missing, [999]);
	assert.deepEqual(payload.pullRequests, JSON.parse(JSON.stringify([pr])));
	assert.deepEqual(payload.pullRequests[0].comments, [comment]);
	assert.deepEqual(payload.pullRequests[0].reviews, [review]);
	assert.deepEqual(payload.pullRequests[0].commits, [commit]);
	assert.equal(payload.pullRequests[0].headOid, commit.oid);
	assert.ok(!contentText(result).includes("Unselected discussion"));
	assert.deepEqual(result.details.pullRequests, [pr]);
});

test("loadMetadataToolResult preserves explicit selection semantics without a display cap", async () => {
	const prs = Array.from({ length: 35 }, (_, i) => makeSnapshotPr({ number: i + 1 }));
	const state = deps(prs, [makeDecision(1)]);
	for (const [params, expected] of [
		[{ selection: "numbers", prs: [2, 3] }, [2, 3]],
		[{ selection: "needs-inference", prs: [1, 2] }, [2]],
		[{ selection: "all", prs: [2] }, prs.map((item) => item.number)],
	] as const) {
		const result = loadMetadataToolResult(await loadPrMetadata({ ...params, prs: [...params.prs] }, state), snapshotFile);
		assert.deepEqual(JSON.parse(contentText(result)).pullRequests.map((item: { number: number }) => item.number), expected);
	}
});

test("decisionListToolResult exposes compact saved queues, reasons, provenance and basis, not PR discussions", async () => {
	const result = decisionListToolResult(await listDecisions(deps([pr], [savedDecision, makeDecision(7)])), decisionsFile);
	const text = contentText(result);
	assert.match(text, /^Loaded 2 decisions/);
	const rows = text.split("\n").slice(1).map((line) => JSON.parse(line));
	assert.deepEqual(rows.map((row) => row.pr), [7, 42]);
	assert.deepEqual(rows[1], {
		pr: 42, bucket: "pinned", priority: 8, reason: savedDecision.reason,
		decidedAt: savedDecision.decidedAt, source: "user", basis: savedDecision.basis,
	});
	assert.ok(!text.includes('"observations"'));
	assertNoDiscussions(text);
	assert.deepEqual(result.details.decisions, [makeDecision(7), savedDecision]);
});

test("decisionGetToolResult exposes the exact saved decision including observations without PR facts", async () => {
	const result = decisionGetToolResult(await getDecision(42, deps()), 42, decisionsFile);
	const payload = JSON.parse(contentText(result));
	assert.deepEqual(payload.decision, savedDecision);
	assert.equal(payload.decisionsFile, decisionsFile);
	assert.equal(payload.importedFromOld, false);
	assertNoDiscussions(contentText(result));
	const missing = decisionGetToolResult(await getDecision(999, deps()), 999, decisionsFile);
	assert.equal(contentText(missing), "No decision for #999.");
	assert.equal(missing.details.decision, null);
});

test("needsInferenceToolResult exposes every selected backlog identity and snapshot basis, without discussions", async () => {
	const prs = [pr, ...Array.from({ length: 40 }, (_, i) => makeSnapshotPr({ number: i + 100 }))];
	const domainResult = await listPrsNeedingInference({}, deps(prs));
	const result = needsInferenceToolResult(domainResult, snapshotFile, decisionsFile);
	const text = contentText(result);
	assert.match(text, /^41 PRs need inference/);
	const lines = text.split("\n");
	assert.deepEqual(JSON.parse(lines[1]), { snapshotFile, decisionsFile, snapshotFetchedAt: "2026-01-10T00:00:00Z" });
	const rows = lines.slice(2).map((line) => JSON.parse(line));
	assert.deepEqual(rows.map((row) => row.number), domainResult.prs.map((row) => row.number));
	assert.equal(rows[0].title, pr.title);
	assert.equal(rows[0].author, pr.author);
	assert.equal(rows[0].headOid, pr.headOid);
	assert.equal(rows[0].meaningfulUpdatedAt, pr.meaningfulUpdatedAt);
	assert.equal(rows[0].reason, "saved decision is stale after commit/human activity");
	assert.equal(rows[0].decision.bucket, "pinned");
	assert.equal(rows[0].decision.source, "user");
	assert.deepEqual(rows[0].decision.basis, savedDecision.basis);
	assert.ok(!text.includes('"observations"'));
	assertNoDiscussions(text);
	assert.deepEqual(result.details.prs, domainResult.prs);

	const filtered = needsInferenceToolResult(await listPrsNeedingInference({ prs: [42, 139] }, deps(prs)), snapshotFile, decisionsFile);
	assert.deepEqual(contentText(filtered).split("\n").slice(2).map((line) => JSON.parse(line).number), [42, 139]);
});

test("empty compact queues remain explicit and arbitrary tool details remain UI-only", async () => {
	assert.match(contentText(decisionListToolResult(await listDecisions(deps([], [])), decisionsFile)), /^Loaded 0 decisions/);
	assert.match(contentText(needsInferenceToolResult(await listPrsNeedingInference({}, deps([], [])), snapshotFile, decisionsFile)), /^0 PRs need inference/);
	const result = toolResult("Intentional compact UI report", { hidden: "UI-only secret" });
	assert.equal(contentText(result), "Intentional compact UI report");
	assert.equal(result.details.hidden, "UI-only secret");
});
