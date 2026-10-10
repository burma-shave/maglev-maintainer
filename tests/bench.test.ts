import assert from "node:assert/strict";
import test from "node:test";
import { BenchStartExecutionError, executeBenchReset, executeBenchStart, executePristineBenchStart, planBenchReset, planBenchStart, verifyBenchStart } from "../extensions/bench-core.ts";
import { makeBenchState, makeSnapshotPr } from "../testdata/fixtures.ts";

function recordingDeps(options: { head?: string; failCommand?: string; commandSucceeds?: (cmd: string, args: string[], cwd?: string) => boolean } = {}) {
	const calls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
	return {
		calls,
		deps: {
			commandSucceeds: async (cmd: string, args: string[], cwd?: string) => {
				calls.push({ cmd, args, cwd });
				return options.commandSucceeds?.(cmd, args, cwd) ?? false;
			},
			runText: async (cmd: string, args: string[], cwd?: string) => {
				calls.push({ cmd, args, cwd });
				const joined = [cmd, ...args].join(" ");
				if (options.failCommand && joined.includes(options.failCommand)) throw new Error(`boom: ${joined}`);
				if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD") return `${options.head ?? "abc123"}\n`;
				return "";
			},
		},
	};
}

test("executePristineBenchStart clones a plain PR Bench and uses gh pr checkout", async () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123", headRefName: "feature-1416" });
	const plan = planBenchStart({ pr }, { apply: true });
	const { calls, deps } = recordingDeps({ head: "abc123" });

	const executed = await executePristineBenchStart({ pr, plan }, deps);

	assert.deepEqual(executed, [
		"clone OneBusAway/maglev into /var/lib/maglev-maintainer/checkouts/pr-1416",
		"check out PR #1416 with gh pr checkout",
		"start tmux session pr-1416 with pi window",
	]);
	assert.deepEqual(calls.map((call) => [call.cmd, ...call.args]), [
		["gh", "repo", "clone", "OneBusAway/maglev", "/var/lib/maglev-maintainer/checkouts/pr-1416"],
		["gh", "pr", "checkout", "1416", "--repo", "OneBusAway/maglev", "--branch", "pr-1416"],
		["git", "rev-parse", "HEAD"],
		["tmux", "new-session", "-d", "-s", "pr-1416", "-c", "/var/lib/maglev-maintainer/checkouts/pr-1416", "-n", "pi", "pi --name 'Review PR #1416'; exec ${SHELL:-/bin/bash} -l"],
	]);
});

test("executeBenchStart recovers a partial checkout by checking out the PR and starting tmux", async () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123" });
	const existingBench = makeBenchState({ pr: 1416, branchExists: false, checkoutExists: true, tmuxExists: false, benchPath: "/var/lib/maglev-maintainer/checkouts/pr-1416" });
	const plan = planBenchStart({ pr, existingBench }, { apply: true });
	const { calls, deps } = recordingDeps({ head: "abc123" });

	const executed = await executeBenchStart({ pr, plan, existingBench }, deps);

	assert.deepEqual(executed, [
		"check out PR #1416 with gh pr checkout",
		"start tmux session pr-1416 with pi window",
	]);
	assert.deepEqual(calls.map((call) => [call.cmd, ...call.args]), [
		["gh", "pr", "checkout", "1416", "--repo", "OneBusAway/maglev", "--branch", "pr-1416"],
		["git", "rev-parse", "HEAD"],
		["tmux", "new-session", "-d", "-s", "pr-1416", "-c", "/var/lib/maglev-maintainer/checkouts/pr-1416", "-n", "pi", "pi --name 'Review PR #1416'; exec ${SHELL:-/bin/bash} -l"],
	]);
});

test("executeBenchStart only starts tmux for a complete checkout with missing tmux", async () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123" });
	const existingBench = makeBenchState({ pr: 1416, checkoutExists: true, branchExists: true, tmuxExists: false, localHead: "abc123", benchPath: "/var/lib/maglev-maintainer/checkouts/pr-1416" });
	const plan = planBenchStart({ pr, existingBench }, { apply: true });
	const { calls, deps } = recordingDeps({ head: "abc123" });

	const executed = await executeBenchStart({ pr, plan, existingBench }, deps);

	assert.deepEqual(executed, ["start tmux session pr-1416 with pi window"]);
	assert.deepEqual(calls.map((call) => [call.cmd, ...call.args]), [
		["git", "rev-parse", "HEAD"],
		["tmux", "new-session", "-d", "-s", "pr-1416", "-c", "/var/lib/maglev-maintainer/checkouts/pr-1416", "-n", "pi", "pi --name 'Review PR #1416'; exec ${SHELL:-/bin/bash} -l"],
	]);
});

test("executeBenchStart adds pi window to an existing tmux session", async () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123" });
	const existingBench = makeBenchState({ pr: 1416, checkoutExists: true, branchExists: true, tmuxExists: true, piWindowExists: false, localHead: "abc123", benchPath: "/var/lib/maglev-maintainer/checkouts/pr-1416" });
	const plan = planBenchStart({ pr, existingBench }, { apply: true });
	const { calls, deps } = recordingDeps({ head: "abc123" });

	const executed = await executeBenchStart({ pr, plan, existingBench }, deps);

	assert.equal(plan.status, "ready");
	assert.deepEqual(executed, ["start pi in tmux window pi"]);
	assert.deepEqual(calls.map((call) => [call.cmd, ...call.args]), [
		["git", "rev-parse", "HEAD"],
		["tmux", "new-window", "-d", "-t", "=pr-1416", "-n", "pi", "-c", "/var/lib/maglev-maintainer/checkouts/pr-1416", "pi --name 'Review PR #1416'; exec ${SHELL:-/bin/bash} -l"],
	]);
});

test("executeBenchStart recovers a stale checkout with missing tmux when acknowledged", async () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123" });
	const existingBench = makeBenchState({ pr: 1416, checkoutExists: true, branchExists: true, tmuxExists: false, localHead: "def456", freshness: "stale", fresh: false, benchPath: "/var/lib/maglev-maintainer/checkouts/pr-1416" });
	const plan = planBenchStart({ pr, existingBench }, { apply: true, allowHeadMismatch: true });
	const { calls, deps } = recordingDeps({ head: "def456" });

	const executed = await executeBenchStart({ pr, plan, existingBench }, deps);

	assert.equal(plan.status, "ready");
	assert.deepEqual(executed, ["start tmux session pr-1416 with pi window"]);
	assert.deepEqual(calls.map((call) => [call.cmd, ...call.args]), [
		["git", "rev-parse", "HEAD"],
		["tmux", "new-session", "-d", "-s", "pr-1416", "-c", "/var/lib/maglev-maintainer/checkouts/pr-1416", "-n", "pi", "pi --name 'Review PR #1416'; exec ${SHELL:-/bin/bash} -l"],
	]);
});

test("executeBenchReset resets a stale checkout to the snapshot head", async () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123" });
	const bench = makeBenchState({ pr: 1416, checkoutExists: true, branchExists: true, localHead: "def456", freshness: "stale", fresh: false, benchPath: "/var/lib/maglev-maintainer/checkouts/pr-1416" });
	const plan = planBenchReset(bench, pr, "2026-01-10T00:00:00Z", { apply: true, now: "2026-01-10T01:00:00Z" });
	const { calls, deps } = recordingDeps({ head: "abc123" });

	const executed = await executeBenchReset(bench, pr, plan, deps);

	assert.equal(plan.status, "ready");
	assert.deepEqual(executed, ["reset PR Bench checkout to PR #1416 snapshot head"]);
	assert.deepEqual(calls.map((call) => [call.cmd, ...call.args]), [
		["gh", "pr", "checkout", "1416", "--repo", "OneBusAway/maglev", "--branch", "pr-1416", "--force"],
		["git", "rev-parse", "HEAD"],
	]);
});

test("executeBenchStart still rejects stale checkout recovery without acknowledgement", async () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123" });
	const existingBench = makeBenchState({ pr: 1416, checkoutExists: true, branchExists: true, tmuxExists: false, localHead: "def456", freshness: "stale", fresh: false, benchPath: "/var/lib/maglev-maintainer/checkouts/pr-1416" });
	const plan = planBenchStart({ pr, existingBench }, { apply: true, allowHeadMismatch: true });
	plan.options.allowHeadMismatch = false;
	const { deps } = recordingDeps({ head: "def456" });

	await assert.rejects(
		() => executeBenchStart({ pr, plan, existingBench }, deps),
		(err: unknown) => err instanceof BenchStartExecutionError && err.executed.length === 0,
	);
});

test("verifyBenchStart reports ok when plain checkout, branch, head, and tmux match", async () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123", headRefName: "feature-1416" });
	const plan = planBenchStart({ pr }, { apply: true });
	const verification = await verifyBenchStart({ pr, plan, repoPath: "/repo" }, {
		commandSucceeds: async (cmd, args, cwd) => cmd === "git" && args[0] === "rev-parse" && args[1] === "--is-inside-work-tree" && cwd === "/var/lib/maglev-maintainer/checkouts/pr-1416"
			|| cmd === "git" && args[0] === "show-ref" && cwd === "/var/lib/maglev-maintainer/checkouts/pr-1416"
			|| cmd === "tmux" && args[0] === "has-session",
		runText: async (cmd, args, cwd) => {
			if (cmd === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref" && cwd === "/var/lib/maglev-maintainer/checkouts/pr-1416") return "pr-1416\n";
			if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD" && cwd === "/var/lib/maglev-maintainer/checkouts/pr-1416") return "abc123\n";
			if (cmd === "tmux" && args[0] === "list-windows") return "pi\n";
			throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
		},
	});

	assert.equal(verification.ok, true);
	assert.deepEqual(verification.findings, []);
});

test("verifyBenchStart reports partial state when pi window is missing", async () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123", headRefName: "feature-1416" });
	const plan = planBenchStart({ pr }, { apply: true });
	const verification = await verifyBenchStart({ pr, plan, repoPath: "/repo" }, {
		commandSucceeds: async (cmd, args, cwd) => cmd === "git" && args[0] === "rev-parse" && args[1] === "--is-inside-work-tree" && cwd === "/var/lib/maglev-maintainer/checkouts/pr-1416"
			|| cmd === "git" && args[0] === "show-ref" && cwd === "/var/lib/maglev-maintainer/checkouts/pr-1416"
			|| cmd === "tmux" && args[0] === "has-session",
		runText: async (cmd, args, cwd) => {
			if (cmd === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref" && cwd === "/var/lib/maglev-maintainer/checkouts/pr-1416") return "pr-1416\n";
			if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD" && cwd === "/var/lib/maglev-maintainer/checkouts/pr-1416") return "abc123\n";
			if (cmd === "tmux" && args[0] === "list-windows") return "shell\n";
			throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
		},
	});

	assert.equal(verification.ok, false);
	assert.deepEqual(verification.findings.map((finding) => finding.code), ["missing-pi-window"]);
});

test("verifyBenchStart accepts an acknowledged stale checkout when recovering tmux", async () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123", headRefName: "feature-1416" });
	const existingBench = makeBenchState({ pr: 1416, checkoutExists: true, branchExists: true, tmuxExists: false, freshness: "stale", fresh: false, benchPath: "/var/lib/maglev-maintainer/checkouts/pr-1416" });
	const plan = planBenchStart({ pr, existingBench }, { apply: true, allowHeadMismatch: true });
	const verification = await verifyBenchStart({ pr, plan, existingBench, repoPath: "/repo" }, {
		commandSucceeds: async (cmd, args, cwd) => cmd === "git" && args[0] === "rev-parse" && args[1] === "--is-inside-work-tree" && cwd === "/var/lib/maglev-maintainer/checkouts/pr-1416"
			|| cmd === "git" && args[0] === "show-ref" && cwd === "/var/lib/maglev-maintainer/checkouts/pr-1416"
			|| cmd === "tmux" && args[0] === "has-session",
		runText: async (cmd, args, cwd) => {
			if (cmd === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref" && cwd === "/var/lib/maglev-maintainer/checkouts/pr-1416") return "pr-1416\n";
			if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD" && cwd === "/var/lib/maglev-maintainer/checkouts/pr-1416") return "def456\n";
			if (cmd === "tmux" && args[0] === "list-windows") return "pi\n";
			throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
		},
	});

	assert.equal(verification.ok, true);
	assert.deepEqual(verification.findings, []);
});

test("verifyBenchStart reports partial state when expected local state is missing", async () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123", headRefName: "feature-1416" });
	const plan = planBenchStart({ pr }, { apply: true });
	const verification = await verifyBenchStart({ pr, plan, repoPath: "/repo" }, {
		commandSucceeds: async () => false,
		runText: async (cmd, args) => {
			if (cmd === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref") return "main\n";
			if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD") return "def456\n";
			throw new Error("missing");
		},
	});

	assert.equal(verification.ok, false);
	assert.deepEqual(verification.findings.map((finding) => finding.code), [
		"missing-checkout",
		"missing-branch",
		"branch-mismatch",
		"head-mismatch",
		"missing-tmux",
	]);
});

test("executePristineBenchStart reports a partial checkout when gh checkout head differs from snapshot", async () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123", headRefName: "feature-1416" });
	const plan = planBenchStart({ pr }, { apply: true });
	const { calls, deps } = recordingDeps({ head: "def456" });

	await assert.rejects(
		() => executePristineBenchStart({ pr, plan }, deps),
		(err: unknown) => err instanceof BenchStartExecutionError && err.executed.length === 2,
	);
	assert.deepEqual(calls.map((call) => [call.cmd, ...call.args]), [
		["gh", "repo", "clone", "OneBusAway/maglev", "/var/lib/maglev-maintainer/checkouts/pr-1416"],
		["gh", "pr", "checkout", "1416", "--repo", "OneBusAway/maglev", "--branch", "pr-1416"],
		["git", "rev-parse", "HEAD"],
	]);
});
