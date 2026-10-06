import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { clearReviewJsonArtifact, formatReviewJsonMarkdown, listReviewJsonArtifacts, loadReviewJsonArtifact, resolveReviewJsonArtifactPath, resolveReviewJsonDraftPathForPr } from "../extensions/review-json-store.ts";
import type { ReviewJsonFile } from "../extensions/review-json.ts";

async function withTempDir(fn: (dir: string) => Promise<void>) {
	const dir = await mkdtemp(join(tmpdir(), "review-json-store-"));
	try {
		await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

const review = (pr: number, event = "REQUEST_CHANGES"): ReviewJsonFile => ({
	owner: "OneBusAway",
	repo: "maglev",
	pr,
	commit: `commit-${pr}`,
	event: event as ReviewJsonFile["event"],
	body: `Review body ${pr}`,
	comments: [{ path: "file.go", line: pr, side: "RIGHT", body: `Comment ${pr}` }],
});

test("listReviewJsonArtifacts lists valid review JSON drafts sorted newest first", async () => {
	await withTempDir(async (dir) => {
		await writeFile(join(dir, "pr-1.json"), JSON.stringify(review(1)), "utf8");
		await new Promise((resolve) => setTimeout(resolve, 5));
		await writeFile(join(dir, "pr-2.json"), JSON.stringify(review(2, "COMMENT")), "utf8");
		await writeFile(join(dir, "pr-2-20260102-030405.json"), JSON.stringify(review(2, "REQUEST_CHANGES")), "utf8");
		await writeFile(join(dir, "bad.json"), "not json", "utf8");
		await writeFile(join(dir, "note.txt"), "ignored", "utf8");

		const artifacts = await listReviewJsonArtifacts({}, { reviewJsonDir: dir });
		assert.deepEqual(artifacts.map((artifact) => artifact.pr), [2, 1]);
		assert.equal(artifacts[0]?.event, "COMMENT");
		assert.equal(artifacts[0]?.commentCount, 1);

		const filtered = await listReviewJsonArtifacts({ pr: 1 }, { reviewJsonDir: dir });
		assert.deepEqual(filtered.map((artifact) => artifact.pr), [1]);
	});
});

test("loadReviewJsonArtifact loads by canonical PR path or explicit path and formats markdown", async () => {
	await withTempDir(async (dir) => {
		const canonical = join(dir, "pr-7.json");
		const custom = join(dir, "custom.json");
		await writeFile(canonical, JSON.stringify(review(7, "REQUEST_CHANGES")), "utf8");
		await writeFile(custom, JSON.stringify(review(8, "COMMENT")), "utf8");

		const loadedByPr = await loadReviewJsonArtifact({ pr: 7 }, { reviewJsonDir: dir });
		assert.equal(loadedByPr.path, canonical);
		assert.match(loadedByPr.markdown, /PR review draft for OneBusAway\/maglev#7/);
		assert.match(loadedByPr.markdown, /file.go:7 RIGHT/);

		const loadedByRelativePath = await loadReviewJsonArtifact({ path: "custom.json" }, { reviewJsonDir: dir });
		assert.equal(loadedByRelativePath.path, custom);
		assert.equal(loadedByRelativePath.event, "COMMENT");
	});
});

test("resolveReviewJsonArtifactPath resolves relative paths under the centralized directory", () => {
	assert.equal(resolveReviewJsonArtifactPath("custom.json", "/agent/review-json"), "/agent/review-json/custom.json");
	assert.equal(resolveReviewJsonArtifactPath("/tmp/custom.json", "/agent/review-json"), "/tmp/custom.json");
	assert.equal(resolveReviewJsonDraftPathForPr(12, "/agent/review-json"), "/agent/review-json/pr-12.json");
});

test("clearReviewJsonArtifact deletes the canonical PR draft", async () => {
	await withTempDir(async (dir) => {
		const path = join(dir, "pr-11.json");
		await writeFile(path, JSON.stringify(review(11)), "utf8");

		const deleted = await clearReviewJsonArtifact({ pr: 11 }, { reviewJsonDir: dir });
		assert.deepEqual(deleted, { path, deleted: true });
		await assert.rejects(() => stat(path), /ENOENT/);

		const missing = await clearReviewJsonArtifact({ pr: 11 }, { reviewJsonDir: dir });
		assert.deepEqual(missing, { path, deleted: false });
	});
});

test("formatReviewJsonMarkdown handles verdict-only reviews", () => {
	const verdictOnly: ReviewJsonFile = { owner: "OneBusAway", repo: "maglev", pr: 9, commit: "abc", event: "APPROVE", body: "Looks good" };
	const markdown = formatReviewJsonMarkdown({
		path: "/agent/review-json/pr-9.json",
		fileName: "pr-9.json",
		mtimeMs: 1,
		owner: "OneBusAway",
		repo: "maglev",
		pr: 9,
		commit: "abc",
		event: "APPROVE",
		body: "Looks good",
		commentCount: 0,
	}, verdictOnly);
	assert.match(markdown, /No inline comments\./);
});
