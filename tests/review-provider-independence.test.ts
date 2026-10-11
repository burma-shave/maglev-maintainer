import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("maintainer does not register or advertise a review runner or kickoff loader", async () => {
	const source = await read("extensions/index.ts");
	assert.doesNotMatch(source, /maglev_pr_code_review|maglev_pr_review_instructions_load/);
	assert.doesNotMatch(source, /runClaudeCodeReview|loadBenchKickoff|claude_code_review/);
	assert.doesNotMatch(await read("extensions/schemas.ts"), /CodeReviewParams|BenchKickoffParamsSchema/);
	for (const path of ["extensions/code-review.ts", "extensions/bench-kickoff.ts", "prompts/bench-kickoff.md", "skills/maglev-pr-code-review", ".pi/agents/maglev-batch-code-reviewer.md"]) {
		await assert.rejects(access(new URL(path, root)), { code: "ENOENT" });
	}
});

test("retained review policies do not require a provider-specific launch resource", async () => {
	for (const path of ["AGENTS.md", "skills/maglev-bench/SKILL.md", "skills/maglev-pr-analysis-record/SKILL.md", "skills/maglev-pr-review-draft/SKILL.md"]) {
		assert.doesNotMatch(await read(path), /maglev_pr_code_review|maglev_pr_review_instructions_load|maglev-pr-code-review|Claude/);
	}
	const pkg = JSON.parse(await read("package.json"));
	assert.doesNotMatch(JSON.stringify(pkg), /claude/i);
});
