import assert from "node:assert/strict";
import test from "node:test";
import { parseUnifiedDiff, validateCommentsAgainstDiff, writeReviewJson } from "../extensions/review-json.ts";

const diff = `diff --git a/internal/foo.go b/internal/foo.go
index 1111111..2222222 100644
--- a/internal/foo.go
+++ b/internal/foo.go
@@ -10,4 +10,5 @@ func foo() {
 	keep()
-	oldCall()
+	newCall()
+	addedCall()
 	stillHere()
}
diff --git a/internal/bar.go b/internal/bar.go
index 3333333..4444444 100644
--- a/internal/bar.go
+++ b/internal/bar.go
@@ -1,2 +1,2 @@
-old
+new
 context
`;

test("parseUnifiedDiff records commentable old and new lines", () => {
	const files = parseUnifiedDiff(diff);
	assert.equal(files.length, 2);
	assert.equal(files[0]?.newPath, "internal/foo.go");
	assert.ok(files[0]?.lines.some((line) => line.type === "add" && line.newLine === 11));
	assert.ok(files[0]?.lines.some((line) => line.type === "del" && line.oldLine === 11));
});

test("validateCommentsAgainstDiff accepts right, left, and context lines", () => {
	validateCommentsAgainstDiff([
		{ path: "internal/foo.go", line: 11, side: "RIGHT", body: "new line" },
		{ path: "internal/foo.go", line: 11, side: "LEFT", body: "old line" },
		{ path: "internal/bar.go", line: 2, side: "RIGHT", body: "context line" },
	], diff);
});

test("validateCommentsAgainstDiff rejects paths and lines outside the diff", () => {
	assert.throws(() => validateCommentsAgainstDiff([{ path: "missing.go", line: 1, side: "RIGHT", body: "x" }], diff), /does not appear/);
	assert.throws(() => validateCommentsAgainstDiff([{ path: "internal/foo.go", line: 99, side: "RIGHT", body: "x" }], diff), /not a commentable line/);
});

test("writeReviewJson fetches PR head, validates comments, and writes stable review JSON", async () => {
	let wrotePath = "";
	let wroteValue: unknown;
	let diffFetched = false;
	const result = await writeReviewJson({
		pr: 1416,
		event: "REQUEST_CHANGES",
		body: "Please address the inline issue.",
		comments: [{ path: "internal/foo.go", line: 11, body: "This changes behavior." }],
	}, {
		runJson: async (_cmd, args) => {
			assert.deepEqual(args, ["pr", "view", "1416", "--repo", "OneBusAway/maglev", "--json", "number,headRefOid,title"]);
			return { number: 1416, headRefOid: "abc123", title: "Fix foo" };
		},
		runText: async (_cmd, args) => {
			diffFetched = true;
			assert.deepEqual(args, ["pr", "diff", "1416", "--repo", "OneBusAway/maglev"]);
			return diff;
		},
		writeReviewJson: async (path, value) => {
			wrotePath = path;
			wroteValue = value;
		},
		reviewJsonDir: "/home/test/.pi/agent/maglev-maintainer/review-json",
	});

	assert.equal(diffFetched, true);
	assert.equal(wrotePath, "/home/test/.pi/agent/maglev-maintainer/review-json/pr-1416.json");
	assert.deepEqual(wroteValue, {
		owner: "OneBusAway",
		repo: "maglev",
		pr: 1416,
		commit: "abc123",
		event: "REQUEST_CHANGES",
		body: "Please address the inline issue.",
		comments: [{ path: "internal/foo.go", line: 11, side: "RIGHT", body: "This changes behavior." }],
	});
	assert.equal(result.outputPath, wrotePath);
	assert.equal(result.commentCount, 1);
});

test("writeReviewJson omits comments and diff fetch for verdict-only reviews", async () => {
	let diffFetched = false;
	let wroteValue: any;
	const result = await writeReviewJson({ pr: 5, event: "COMMENT", body: "Summary only" }, {
		runJson: async () => ({ number: 5, headRefOid: "def456", title: "Summary" }),
		runText: async () => {
			diffFetched = true;
			return diff;
		},
		writeReviewJson: async (_path, value) => { wroteValue = value; },
		reviewJsonDir: "/home/test/.pi/agent/maglev-maintainer/review-json",
	});

	assert.equal(diffFetched, false);
	assert.equal("comments" in wroteValue, false);
	assert.equal(result.outputPath, "/home/test/.pi/agent/maglev-maintainer/review-json/pr-5.json");
});
