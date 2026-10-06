import assert from "node:assert/strict";
import test from "node:test";
import { addStackMetadata, parseBadChecks, snapshotFromGh } from "../extensions/github-core.ts";
import { makeGhPr } from "../testdata/fixtures.ts";

function snapshotPr(number: number, headRefName: string, baseRefName = "main") {
	return snapshotFromGh(makeGhPr({ number, headRefName, baseRefName }));
}

test("parseBadChecks returns failed checks/statuses and ignores successful checks", () => {
	assert.deepEqual(parseBadChecks([
		{ __typename: "CheckRun", name: "tests", conclusion: "SUCCESS" },
		{ __typename: "CheckRun", name: "lint", conclusion: "FAILURE" },
		{ __typename: "CheckRun", name: "build", conclusion: "TIMED_OUT" },
		{ __typename: "StatusContext", context: "legacy-ci", state: "PENDING" },
		{ __typename: "StatusContext", context: "deploy", state: "SUCCESS" },
	]), ["lint", "build", "legacy-ci"]);
});

test("snapshotFromGh derives meaningful activity from commits and non-bot human activity", () => {
	const pr = snapshotFromGh(makeGhPr({
		commits: [
			{ oid: "1111111aaaa", committedDate: "2026-01-02T00:00:00Z", messageHeadline: "Initial work" },
			{ oid: "2222222bbbb", committedDate: "2026-01-04T00:00:00Z", messageHeadline: "Address feedback" },
		],
		reviews: [
			{ author: { login: "coderabbitai" }, state: "COMMENTED", submittedAt: "2026-01-09T00:00:00Z", body: "Automated review" },
			{ author: { login: "bob" }, state: "CHANGES_REQUESTED", submittedAt: "2026-01-05T00:00:00Z", body: "Please fix this" },
		],
		comments: [
			{ author: { login: "github-actions" }, createdAt: "2026-01-10T00:00:00Z", body: "CI update" },
			{ author: { login: "burma-shave" }, createdAt: "2026-01-06T00:00:00Z", body: "Checking in on this PR" },
			{ author: { login: "alice" }, createdAt: "2026-01-07T00:00:00Z", body: "I pushed a response" },
		],
		files: [{ path: "src/main.ts" }],
		statusCheckRollup: [{ __typename: "CheckRun", name: "tests", conclusion: "FAILURE" }],
	}));

	assert.equal(pr.headOid, "2222222bbbb");
	assert.equal(pr.headRepositoryNameWithOwner, "OneBusAway/maglev");
	assert.equal(pr.commitSummary.count, 2);
	assert.equal(pr.meaningfulUpdatedAt, "2026-01-07T00:00:00Z");
	assert.equal(pr.lastHumanReview?.author, "bob");
	assert.equal(pr.lastChangeRequest?.author, "bob");
	assert.equal(pr.lastCodeRabbitReview?.author, "coderabbitai");
	assert.equal(pr.lastHumanComment?.author, "alice");
	assert.equal(pr.lastChase?.author, "burma-shave");
	assert.deepEqual(pr.badChecks, ["tests"]);
	assert.deepEqual(pr.files, ["src/main.ts"]);
});

test("snapshotFromGh uses headRefOid as the PR head when commit dates tie", () => {
	const pr = snapshotFromGh(makeGhPr({
		headRefOid: "3333333cccc",
		commits: [
			{ oid: "1111111aaaa", committedDate: "2026-01-02T00:00:00Z", messageHeadline: "Base stack change" },
			{ oid: "2222222bbbb", committedDate: "2026-01-04T00:00:00Z", messageHeadline: "Sibling stack change" },
			{ oid: "3333333cccc", committedDate: "2026-01-04T00:00:00Z", messageHeadline: "Actual head" },
		],
	}));

	assert.equal(pr.headOid, "3333333cccc");
	assert.equal(pr.commitSummary.lastOid, "3333333cccc");
	assert.equal(pr.lastCommit?.body, "Actual head");
});

test("addStackMetadata links stacked PRs by base/head branch refs", () => {
	const prs = addStackMetadata([
		snapshotPr(200, "feature-base", "main"),
		snapshotPr(201, "feature-child", "feature-base"),
		snapshotPr(202, "feature-grandchild", "feature-child"),
	]);

	assert.equal(prs[0].stackBasePR, undefined);
	assert.deepEqual(prs[0].stackChildren, [201]);
	assert.equal(prs[1].stackBasePR, 200);
	assert.deepEqual(prs[1].stackChildren, [202]);
	assert.equal(prs[2].stackBasePR, 201);
});
