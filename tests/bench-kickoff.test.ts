import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadBenchKickoff, type BenchKickoffDeps } from "../extensions/bench-kickoff.ts";
import { makeDecision, makeDecisionsFile, makeSnapshotFile, makeSnapshotPr } from "../testdata/fixtures.ts";

function kickoffDeps(): BenchKickoffDeps {
	return {
		loadSnapshot: async () => makeSnapshotFile([makeSnapshotPr({ number: 1416, title: "Fix stop ordering" })]),
		loadDecisions: async () => ({ file: makeDecisionsFile([makeDecision(1416, { bucket: "review", reason: "Ready for ordering review" })]) }),
		readTemplate: () => readFile(new URL("../prompts/bench-kickoff.md", import.meta.url), "utf8"),
	};
}

test("on-demand kickoff returns review instructions with PR, decision, and caller context", async () => {
	const result = await loadBenchKickoff({ pr: 1416, context: "Focus on stop ordering tests." }, kickoffDeps());
	assert.equal(result.pr, 1416);
	assert.equal(result.snapshotFetchedAt, "2026-01-10T00:00:00Z");
	assert.match(result.prompt, /Fix stop ordering/);
	assert.match(result.prompt, /Ready for ordering review/);
	assert.match(result.prompt, /Focus on stop ordering tests\./);
	assert.match(result.prompt, /maglev_pr_code_review/);
	assert.match(result.prompt, /standalone `maglev-pr-code-review` and `maglev-pr-review-draft` skills/);
	assert.match(result.prompt, /not run automatically when a Bench starts or recovers/);
	assert.match(result.prompt, /maglev_pr_review_draft_clear/);
	assert.match(result.prompt, /failed or incomplete review does not justify clearing/);
	assert.match(result.prompt, /workingDirectory.*\/checkouts\/pr-1416/);
	assert.doesNotMatch(result.prompt, /\{\{[A-Za-z0-9_]+\}\}/);
	assert.equal("kickoffPromptPath" in result, false);
});

test("on-demand kickoff works without a saved triage decision or extra context", async () => {
	const deps = kickoffDeps();
	deps.loadDecisions = async () => ({ file: makeDecisionsFile([]) });
	const result = await loadBenchKickoff({ pr: 1416 }, deps);
	assert.match(result.prompt, /Bucket: none/);
	assert.doesNotMatch(result.prompt, /Additional handoff context/);
});

test("on-demand kickoff rejects a PR absent from the snapshot", async () => {
	const deps = kickoffDeps();
	deps.loadDecisions = async () => { throw new Error("should not load decisions"); };
	deps.readTemplate = async () => { throw new Error("should not read template"); };
	await assert.rejects(() => loadBenchKickoff({ pr: 999 }, deps), /PR #999 is not present.*maglev_pr_refresh_metadata/);
});

test("on-demand kickoff rejects invalid PR identifiers", async () => {
	for (const pr of [0, -1, 1.5, NaN]) {
		await assert.rejects(() => loadBenchKickoff({ pr }, kickoffDeps()), /positive integer/);
	}
});

test("on-demand kickoff propagates unavailable snapshot errors", async () => {
	const deps = kickoffDeps();
	deps.loadSnapshot = async () => { throw new Error("No snapshot. Run maglev_pr_refresh_metadata first."); };
	await assert.rejects(() => loadBenchKickoff({ pr: 1416 }, deps), /No snapshot/);
});
