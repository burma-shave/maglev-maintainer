import assert from "node:assert/strict";
import test from "node:test";
import { runClaudeCodeReview, type CodeReviewDeps } from "../extensions/code-review.ts";

function harness(repositoryRoot?: string) {
	const commands: { cmd: string; args: string[]; cwd?: string; timeoutMs: number }[] = [];
	const logs: string[] = [];
	const probes: string[] = [];
	const deps: CodeReviewDeps = {
		processCwd: () => "/maintainer",
		now: () => new Date("2026-10-07T19:00:00Z"),
		runText: async (_cmd, _args, cwd) => {
			probes.push(cwd!);
			if (!repositoryRoot) throw new Error("not a repository");
			return repositoryRoot;
		},
		runCommand: async (cmd, args, options) => {
			commands.push({ cmd, args, cwd: options.cwd, timeoutMs: options.timeoutMs });
			return { stdout: "review findings", stderr: "", exitCode: 0 };
		},
		writeFile: async (_path, content) => { logs.push(content); },
	};
	return { deps, commands, logs, probes };
}

test("PR-only review needs no git repository, Bench, or checkout", async () => {
	const h = harness();
	const result = await runClaudeCodeReview({ pr: 1460 }, h.deps);
	assert.equal(result.success, true);
	assert.equal(result.workingDirectory, "/maintainer");
	assert.equal(result.repositoryRoot, undefined);
	assert.deepEqual(h.probes, []);
	assert.equal(h.commands.length, 2);
	assert.equal(h.commands[1].args.at(-1), "/code-review https://github.com/OneBusAway/maglev/pull/1460");
	assert.ok(h.commands[1].args.includes("Bash(gh pr comment:*)"));
	assert.ok(h.commands[1].args.includes("Bash(gh pr review:*)"));
	assert.ok(!h.commands[1].args.includes("--append-system-prompt"));
	assert.equal(h.logs.length, 1);
});

test("explicit checkout review resolves its root and preserves timeout", async () => {
	const h = harness("/checkout");
	const result = await runClaudeCodeReview({ pr: 1460, workingDirectory: "/checkout/subdir", timeoutSeconds: 60 }, h.deps);
	assert.equal(result.success, true);
	assert.equal(result.repositoryRoot, "/checkout");
	assert.equal(h.commands[1].cwd, "/checkout");
	assert.equal(h.commands[1].timeoutMs, 60000);
});

test("invalid explicit checkout fails rather than silently switching modes", async () => {
	const h = harness();
	const result = await runClaudeCodeReview({ pr: 1460, workingDirectory: "/missing" }, h.deps);
	assert.equal(result.success, false);
	assert.match(result.error!, /Omit workingDirectory/);
	assert.equal(h.commands.length, 1);
});

test("missing Claude CLI is reported and logged without requiring git", async () => {
	const h = harness();
	h.deps.runCommand = async () => { throw new Error("ENOENT"); };
	const result = await runClaudeCodeReview({ pr: 1460 }, h.deps);
	assert.equal(result.success, false);
	assert.match(result.error!, /claude CLI/);
	assert.equal(h.logs.length, 1);
});

test("timed out review is not successful", async () => {
	const h = harness();
	h.deps.runCommand = async () => ({ stdout: "partial", stderr: "", exitCode: null, timedOut: true });
	const result = await runClaudeCodeReview({ pr: 1460 }, h.deps);
	assert.equal(result.success, false);
	assert.equal(result.timedOut, true);
});
