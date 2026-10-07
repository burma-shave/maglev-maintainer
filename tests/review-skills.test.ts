import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skill = (name: string) => readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");

test("review skills are discoverable through the package skills directory", async () => {
	const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	assert.ok(pkg.pi.skills.includes("./skills"));
	for (const name of ["maglev-pr-code-review", "maglev-pr-review-draft"]) {
		const text = await skill(name);
		assert.ok(text.startsWith(`---\nname: ${name}\n`));
		assert.match(text, /\ndescription: .+\n/);
		assert.match(text, /maglev_pr_workspace_context/);
	}
});

test("code-review skill separates review validation from draft mutation", async () => {
	const text = await skill("maglev-pr-code-review");
	assert.match(text, /maglev_pr_code_review.*explicit `workingDirectory`/);
	assert.match(text, /with `pr` alone by default/);
	assert.match(text, /Do not inspect or start Benches or require an existing checkout/);
	assert.match(text, /Do not add instructions limiting checkouts, dependency installation, builds or tests/);
	assert.match(text, /do not require a reviewed SHA or perform SHA checks/);
	assert.match(text, /failed, timed-out, or incomplete run is not a clean review/);
	assert.match(text, /Whenever settled actionable PR findings emerge/);
	assert.match(text, /there is no review-only mode/);
	assert.match(text, /\.\.\/maglev-pr-review-draft\/SKILL.md/);
});

test("draft skill accepts settled findings from any source and uses validated tools", async () => {
	const text = await skill("maglev-pr-review-draft");
	for (const tool of ["maglev_pr_review_json", "maglev_pr_review_json_clear", "maglev_pr_review_json_list", "maglev_pr_review_json_load"]) {
		assert.ok(text.includes(tool));
	}
	assert.match(text, /Do not invent findings, run a new review/);
	assert.match(text, /Whenever settled actionable PR review findings emerge in any context/);
	assert.match(text, /no findings alone is not approval/);
	assert.match(text, /never use shell redirection, `write`, or `edit`/);
	assert.match(text, /do not silently attach stale findings to a new commit/);
	assert.match(text, /For Claude Code reviews, assume findings apply to the PR it reviewed/);
	assert.match(text, /Never call GitHub write APIs/);
});
