import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeBenchContext } from "../extensions/bench-context.ts";
import { BenchStartExecutionError, executeBenchStart, piTmuxCommand, planBenchStart, type BenchStartExecutionDeps } from "../extensions/bench-core.ts";
import { makeBenchState, makeSnapshotPr } from "../testdata/fixtures.ts";

const context = "Parent findings:\nKeep Alice's changes. Don't review yet. $(touch /tmp/should-not-run)";
const contextPath = "/tmp/bench context's file.md";

function recordingDeps(head = "abc123") {
	const events: string[] = [];
	const commands: Array<{ cmd: string; args: string[] }> = [];
	const deps: BenchStartExecutionDeps = {
		commandSucceeds: async () => false,
		runText: async (cmd, args) => {
			commands.push({ cmd, args });
			events.push(`${cmd} ${args[0]}`);
			return cmd === "git" ? head : "";
		},
		writeContext: async (text) => {
			assert.equal(text, context);
			events.push("write context");
			return contextPath;
		},
	};
	return { deps, events, commands };
}

test("start plans caller context independently of kickoff without mutating files", () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123" });
	const plan = planBenchStart({ pr }, { context });
	assert.equal(plan.apply, false);
	assert.equal(plan.status, "ready");
	assert.equal(plan.options.context, context);
	assert.ok(plan.actions.some((action) => action.includes("append it to the new Pi session's system prompt")));
	assert.equal("kickoff" in plan.options, false);
	assert.equal("kickoffContext" in plan.options, false);
	assert.doesNotMatch(plan.actions.join("\n"), /Parent findings/);
	assert.deepEqual(planBenchStart({ pr }, { context: " \n\t" }), planBenchStart({ pr }));
});

test("start refuses context for an existing Pi window, even for a partial checkout", () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123" });
	for (const piWindowExists of [true, undefined]) {
		for (const branchExists of [true, false]) {
			const existingBench = makeBenchState({ benchPath: "/var/lib/maglev-pr-maintainer/checkouts/pr-1416", piWindowExists, branchExists });
			const plan = planBenchStart({ pr, existingBench }, { context });
			assert.equal(plan.status, "refused");
			assert.ok(plan.refusals.some((finding) => finding.code === "context-requires-new-pi"));
			assert.notEqual(planBenchStart({ pr, existingBench }).status, "refused");
		}
	}
});

test("new benches and recovered Pi windows receive caller context only after HEAD validation", async () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123" });
	for (const existingBench of [
		undefined,
		makeBenchState({ tmuxExists: false, benchPath: "/var/lib/maglev-pr-maintainer/checkouts/pr-1416" }),
		makeBenchState({ tmuxExists: true, piWindowExists: false, benchPath: "/var/lib/maglev-pr-maintainer/checkouts/pr-1416" }),
	]) {
		const plan = planBenchStart({ pr, existingBench }, { apply: true, context });
		const { deps, events, commands } = recordingDeps();
		const executed = await executeBenchStart({ pr, plan, existingBench }, deps);
		assert.deepEqual(events.slice(-3), ["git rev-parse", "write context", `tmux ${existingBench?.tmuxExists ? "new-window" : "new-session"}`]);
		assert.ok(executed.includes(`saved caller context at ${contextPath}`));
		const command = commands.at(-1)!.args.at(-1)!;
		assert.equal(command, piTmuxCommand(1416, contextPath));
		assert.match(command, /--append-system-prompt/);
		assert.doesNotMatch(command, /Parent findings|kickoff|maglev_pr_code_review/);
	}
});

test("context persistence does not run after failed checkout head verification", async () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123" });
	const plan = planBenchStart({ pr }, { apply: true, context });
	const { deps, events } = recordingDeps("different");
	await assert.rejects(() => executeBenchStart({ pr, plan }, deps), /does not match snapshot head/);
	assert.deepEqual(events, ["gh repo", "gh pr", "git rev-parse"]);
});

test("failure to persist context prevents launching Pi and reports partial work", async () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123" });
	const plan = planBenchStart({ pr }, { apply: true, context });
	const { deps, events } = recordingDeps();
	deps.writeContext = async () => { throw new Error("disk full"); };
	await assert.rejects(() => executeBenchStart({ pr, plan }, deps), (err) => {
		assert.ok(err instanceof BenchStartExecutionError);
		assert.match(err.message, /Failed to save caller context: disk full/);
		assert.equal(err.executed.length, 2);
		return true;
	});
	assert.deepEqual(events, ["gh repo", "gh pr", "git rev-parse"]);
});

test("context is never written for dry-run, refused, or reused execution plans", async () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123" });
	const { deps, events } = recordingDeps();
	const existingBench = makeBenchState({ benchPath: "/var/lib/maglev-pr-maintainer/checkouts/pr-1416" });
	const plan = planBenchStart({ pr, existingBench }, { apply: true, context });
	await assert.rejects(() => executeBenchStart({ pr, plan, existingBench }, deps), /not ready/);
	// Independently guard the executor if a caller passes an inconsistent plan.
	plan.status = "ready";
	await assert.rejects(() => executeBenchStart({ pr, plan, existingBench }, deps), /requires a new Pi window/);
	const dryRun = planBenchStart({ pr }, { context });
	await assert.rejects(() => executeBenchStart({ pr, plan: dryRun }, deps), /dry run/);
	const newPlan = planBenchStart({ pr }, { apply: true, context });
	const noWriter = { ...deps, writeContext: undefined };
	await assert.rejects(() => executeBenchStart({ pr, plan: newPlan }, noWriter), /context writer/);
	assert.deepEqual(events, []);
});

test("context files preserve exact content, use private permissions, and never overwrite earlier context", async () => {
	const root = await mkdtemp(join(tmpdir(), "bench-context-"));
	try {
		const stateDir = join(root, "pr-1416");
		const first = await writeBenchContext(stateDir, context);
		const second = await writeBenchContext(stateDir, "Different handoff\n");
		assert.notEqual(first, second);
		assert.equal(await readFile(first, "utf8"), context);
		assert.equal(await readFile(second, "utf8"), "Different handoff\n");
		assert.equal((await stat(first)).mode & 0o777, 0o600);
		assert.equal((await readdir(stateDir)).length, 2);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("Pi receives a quoted context file flag, not an initial user prompt", () => {
	for (const path of [undefined, contextPath, "/tmp/$(echo injected); context.md"]) {
		const result = spawnSync("bash", ["-c", `function pi() { printf '%s\\0' "$@"; }; ${piTmuxCommand(1416, path)}`], { encoding: "utf8", env: { ...process.env, SHELL: "/bin/true" } });
		assert.equal(result.status, 0, result.stderr);
		const args = result.stdout.split("\0").slice(0, -1);
		assert.deepEqual(args, ["--name", "Review PR #1416", ...(path ? ["--append-system-prompt", path] : [])]);
	}
});
