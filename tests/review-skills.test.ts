import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skill = (name: string) => readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");

test("review skills are discoverable through the package skills directory", async () => {
	const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	assert.ok(pkg.pi.skills.includes("./skills"));
	for (const name of ["maglev-pr-code-review", "maglev-pr-review-draft", "maglev-pr-analysis-record"]) {
		const text = await skill(name);
		assert.ok(text.startsWith(`---\nname: ${name}\n`));
		assert.match(text, /\ndescription: .+\n/);
		assert.match(text, /maglev_workspace_context/);
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
	for (const tool of ["maglev_pr_review_draft_save", "maglev_pr_review_draft_clear", "maglev_pr_review_draft_list", "maglev_pr_review_draft_load"]) {
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

test("analysis policy retains SHA-attributed clean, failed, and historical results", async () => {
	const text = await skill("maglev-pr-analysis-record");
	assert.match(text, /Every analysis of an identified PR must leave a durable record/);
	assert.match(text, /`maglev_pr_decisions`/);
	assert.match(text, /SHA in the observation itself/);
	assert.match(text, /sha=unknown/);
	assert.match(text, /Preserve \*\*all\*\* existing/);
	assert.match(text, /not coverage of the current revision/);
	assert.match(text, /no durable record found/);
	assert.match(text, /potential\s+merge candidate/);
	assert.match(text, /No findings alone is not approval/);
	assert.match(text, /explicit user pins/);
	assert.match(text, /not a separate[\s\S]*get\/merge\/upsert transaction/);
});

test("all PR analysis entry points require durable result handoff", async () => {
	for (const name of ["maglev-pr-code-review", "maglev-pr-review-draft", "maglev-pr-triage", "oba-api-change-review", "oba-api-pr-spec-review", "oba-api-client-impact", "oba-api-goal-check", "oba-api-spec-check"]) {
		assert.match(await skill(name), /\.\.\/maglev-pr-analysis-record\/SKILL.md/, name);
	}
	const code = await skill("maglev-pr-code-review");
	assert.match(code, /every outcome/);
	assert.match(code, /potential merge candidate/);
	assert.match(code, /parent owns serialized decision saves/);
	const draft = await skill("maglev-pr-review-draft");
	assert.match(draft, /Deleting a draft does not delete/);
});

test("pre-launch history guardrail prevents redundant review selection and dispatch", async () => {
	const history = await skill("maglev-pr-analysis-record");
	assert.match(history, /Before selecting a PR for review \*\*and before launching\*\*/);
	assert.match(history, /fresh metadata/);
	assert.match(history, /operation `get`/);
	assert.match(history, /same-SHA, same-scope/);
	assert.match(history, /whether it found issues or found none/);
	assert.match(history, /Changed SHA, failed\/incomplete prior review/);
	assert.match(history, /explicit user request to re-review/);
	assert.match(history, /Missing\/unknown SHA/);
	assert.match(history, /not a new code review/);
	assert.match(history, /not a new post-review SHA gate/);
	const code = await skill("maglev-pr-code-review");
	assert.ok(code.indexOf("pre-review history guardrail") < code.indexOf("2. Call `maglev_pr_code_review`"));
	assert.match(code, /A generic request to review more PRs is not an override/);
	const triage = await skill("maglev-pr-triage");
	assert.match(triage, /with or without findings/);
	assert.match(triage, /choose other eligible PRs/);
	assert.match(triage, /pass the guardrail evidence to review children/);
	const analyst = await readFile(new URL("../agents/pr-triage-analyst.md", import.meta.url), "utf8");
	assert.match(analyst, /always load exact saved analysis observations/);
	assert.match(analyst, /"reviewHistory"/);
	assert.match(analyst, /after successfully inspecting exact analysis observations/);
});
