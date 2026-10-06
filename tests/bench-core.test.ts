import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildBenchKickoffPromptFromTemplate, classifyBenchDirtyStatus, formatBenchLine, formatBenchReportLines, freshnessFor, parseBenchCommandArgs, parseWorktrees, planBenchClose, planBenchReset, planBenchStart, prFromBenchPath, prFromBranch } from "../extensions/bench-core.ts";
import { makeBenchState, makeDecision, makeSnapshotPr } from "../testdata/fixtures.ts";

test("parseWorktrees parses porcelain worktree output", () => {
	const worktrees = parseWorktrees(`worktree /workspace/maglev\nHEAD abcdef123456\nbranch refs/heads/main\n\nworktree /var/lib/maglev-pr-maintainer/checkouts/pr-1416\nHEAD 123456abcdef\nbranch refs/heads/pr-1416\n`);

	assert.deepEqual(worktrees, [
		{ path: "/workspace/maglev", head: "abcdef123456", branch: "refs/heads/main" },
		{ path: "/var/lib/maglev-pr-maintainer/checkouts/pr-1416", head: "123456abcdef", branch: "refs/heads/pr-1416" },
	]);
});

test("PR number parsing recognizes branch and bench path conventions", () => {
	assert.equal(prFromBranch("pr-123"), 123);
	assert.equal(prFromBranch("refs/heads/pr-456"), 456);
	assert.equal(prFromBranch("feature/pr-456"), undefined);
	assert.equal(prFromBenchPath("/var/lib/maglev-pr-maintainer/checkouts/pr-789"), 789);
	assert.equal(prFromBenchPath("/var/lib/maglev-pr-maintainer/checkouts/pr-789/subdir"), undefined);
});

test("freshnessFor compares local and snapshot heads", () => {
	assert.deepEqual(freshnessFor(undefined, "abc"), { freshness: "unknown" });
	assert.deepEqual(freshnessFor("abc", undefined), { freshness: "unknown" });
	assert.deepEqual(freshnessFor("abc", "abc"), { freshness: "fresh", fresh: true });
	assert.deepEqual(freshnessFor("abc", "def"), { freshness: "stale", fresh: false });
});

test("parseBenchCommandArgs supports clear, PR filters, # prefixes, and errors", () => {
	assert.deepEqual(parseBenchCommandArgs(""), { clear: false, prs: undefined });
	assert.deepEqual(parseBenchCommandArgs("#12 13"), { clear: false, prs: [12, 13] });
	assert.deepEqual(parseBenchCommandArgs("clear #12"), { clear: true, prs: [12] });
	assert.deepEqual(parseBenchCommandArgs("abc"), { clear: false, error: "Invalid PR number argument: abc" });
});

test("classifyBenchDirtyStatus distinguishes clean, untracked, modified, staged, and conflicted state", () => {
	assert.deepEqual(classifyBenchDirtyStatus(""), { status: "clean", dirty: false, files: [], total: 0 });
	assert.deepEqual(classifyBenchDirtyStatus("?? scratch.md\n?? tmp/log.txt\n"), {
		status: "untracked-only",
		dirty: true,
		files: [{ code: "??", path: "scratch.md" }, { code: "??", path: "tmp/log.txt" }],
		total: 2,
	});
	assert.equal(classifyBenchDirtyStatus(" M src/file.ts\n").status, "modified");
	assert.equal(classifyBenchDirtyStatus("M  src/file.ts\n").status, "staged");
	assert.equal(classifyBenchDirtyStatus("UU src/file.ts\n").status, "conflicted");
});

test("planBenchClose returns ready close actions for a clean PR Bench", () => {
	const plan = planBenchClose(makeBenchState({ pr: 1416, benchPath: "/var/lib/maglev-pr-maintainer/checkouts/pr-1416", dirtyStatus: "clean", dirty: false }));

	assert.equal(plan.status, "ready");
	assert.deepEqual(plan.actions, ["kill tmux session pr-1416", "remove bench path /var/lib/maglev-pr-maintainer/checkouts/pr-1416", "remove PR Bench state directory for #1416"]);
	assert.equal(plan.refusals.length, 0);
	assert.equal(plan.unacknowledgedWarnings.length, 0);
});

test("planBenchClose treats untracked files as an overridable warning", () => {
	const bench = makeBenchState({
		pr: 1416,
		benchPath: "/var/lib/maglev-pr-maintainer/checkouts/pr-1416",
		dirty: true,
		dirtyStatus: "untracked-only",
		dirtyFiles: [{ code: "??", path: "scratch.md" }],
	});

	assert.equal(planBenchClose(bench).status, "needs-override");
	const acknowledged = planBenchClose(bench, { allowDirty: "untracked" });
	assert.equal(acknowledged.status, "ready");
	assert.equal(acknowledged.warnings[0].acknowledged, true);
});

test("planBenchClose requires stronger dirty override for modified/staged state", () => {
	const bench = makeBenchState({ pr: 1416, benchPath: "/var/lib/maglev-pr-maintainer/checkouts/pr-1416", dirty: true, dirtyStatus: "modified" });

	assert.equal(planBenchClose(bench, { allowDirty: "untracked" }).status, "needs-override");
	assert.equal(planBenchClose(bench, { allowDirty: "any" }).status, "ready");
});

test("planBenchClose treats stale HEAD as an overridable warning", () => {
	const bench = makeBenchState({ pr: 1416, benchPath: "/var/lib/maglev-pr-maintainer/checkouts/pr-1416", freshness: "stale", fresh: false });

	assert.equal(planBenchClose(bench).status, "needs-override");
	assert.equal(planBenchClose(bench, { allowStale: true }).status, "ready");
});

test("planBenchClose refuses missing, path-mismatched, and current-directory PR Benches", () => {
	const missing = planBenchClose(null, { requestedPr: 1416 });
	assert.equal(missing.status, "refused");
	assert.equal(missing.pr, 1416);

	const mismatched = planBenchClose(makeBenchState({ pr: 1416, benchPath: "/var/lib/maglev-pr-maintainer/checkouts/pr-999" }));
	assert.equal(mismatched.status, "refused");
	assert.equal(mismatched.refusals[0].code, "bench-path-mismatch");

	const currentDirectory = planBenchClose(makeBenchState({ pr: 1416, benchPath: "/var/lib/maglev-pr-maintainer/checkouts/pr-1416" }), { currentWorkingDirectory: "/var/lib/maglev-pr-maintainer/checkouts/pr-1416/subdir" });
	assert.equal(currentDirectory.status, "refused");
	assert.equal(currentDirectory.refusals[0].code, "current-directory");
});

test("planBenchStart returns a ready plan for a safe new PR Bench", () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123" });
	const plan = planBenchStart({ pr, snapshotFetchedAt: "2026-01-10T00:00:00Z" }, { now: "2026-01-10T01:00:00Z" });

	assert.equal(plan.status, "ready");
	assert.equal(plan.benchPath, "/var/lib/maglev-pr-maintainer/checkouts/pr-1416");
	assert.deepEqual(plan.actions, [
		"clone OneBusAway/maglev into PR Bench checkout /var/lib/maglev-pr-maintainer/checkouts/pr-1416",
		"check out PR #1416 with gh pr checkout into branch pr-1416",
		"start tmux session pr-1416 with pi window at /var/lib/maglev-pr-maintainer/checkouts/pr-1416",
	]);
	assert.equal(plan.refusals.length, 0);
	assert.equal(plan.unacknowledgedWarnings.length, 0);
	assert.equal("kickoff" in plan.options, false);
	assert.equal("kickoffContext" in plan.options, false);
});

test("planBenchStart refuses missing snapshot PRs and mismatched existing Bench state", () => {
	const missing = planBenchStart({});
	assert.equal(missing.status, "refused");
	assert.equal(missing.refusals[0].code, "missing-snapshot-pr");

	const mismatched = planBenchStart({
		pr: makeSnapshotPr({ number: 1416, headOid: "abc123" }),
		existingBench: makeBenchState({ pr: 1416, benchPath: "/var/lib/maglev-pr-maintainer/checkouts/pr-999" }),
	});
	assert.equal(mismatched.status, "refused");
	assert.equal(mismatched.refusals[0].code, "bench-path-mismatch");
});

test("planBenchStart reports review readiness as informational but guards stale snapshots", () => {
	const pr = makeSnapshotPr({
		number: 1416,
		isDraft: true,
		mergeStateStatus: "DIRTY",
		badChecks: ["ci", "lint"],
		headOid: "abc123",
		stackBasePR: 1400,
	});
	const plan = planBenchStart({
		pr,
		decision: makeDecision(1416, { bucket: "pinned", reason: "blocked on upstream" }),
		needsInference: true,
		activeBenchPrs: [],
		snapshotFetchedAt: "2026-01-10T00:00:00Z",
	}, { now: "2026-01-10T12:00:00Z" });

	assert.equal(plan.status, "needs-override");
	assert.deepEqual(plan.unacknowledgedWarnings.map((warning) => warning.code), [
		"stale-snapshot",
	]);
	assert.equal(plan.findings.find((finding) => finding.code === "non-clean-merge-state")?.severity, "info");

	const acknowledged = planBenchStart({
		pr,
		decision: makeDecision(1416, { bucket: "pinned", reason: "blocked on upstream" }),
		needsInference: true,
		activeBenchPrs: [],
		snapshotFetchedAt: "2026-01-10T00:00:00Z",
	}, {
		now: "2026-01-10T12:00:00Z",
		allowStaleSnapshot: true,
	});
	assert.equal(acknowledged.status, "ready");
	assert.equal(acknowledged.unacknowledgedWarnings.length, 0);
	for (const code of ["draft-pr", "bad-checks", "needs-inference", "pinned", "stack-parent-missing"]) {
		assert.equal(acknowledged.findings.find((finding) => finding.code === code)?.severity, "info");
	}

	const fresh = planBenchStart({
		pr,
		decision: makeDecision(1416, { bucket: "pinned", reason: "blocked on upstream" }),
		needsInference: true,
		activeBenchPrs: [],
		snapshotFetchedAt: "2026-01-10T00:00:00Z",
	}, { now: "2026-01-10T01:00:00Z" });
	assert.equal(fresh.status, "ready");
	assert.equal(fresh.warnings.length, 0);
	assert.ok(fresh.actions.includes("start tmux session pr-1416 with pi window at /var/lib/maglev-pr-maintainer/checkouts/pr-1416"));

	const missingHead = planBenchStart({ pr: makeSnapshotPr({ headOid: "" }) });
	assert.equal(missingHead.status, "needs-override");
	assert.equal(missingHead.unacknowledgedWarnings[0].code, "missing-snapshot-head");
});

test("buildBenchKickoffPrompt includes existing PR reviews and comments", () => {
	const pr = makeSnapshotPr({
		number: 1416,
		reviews: [{ author: "maintainer", state: "CHANGES_REQUESTED", submittedAt: "2026-01-03T00:00:00Z", body: "Please fix stop ordering." }],
		comments: [{ author: "contributor", createdAt: "2026-01-04T00:00:00Z", body: "Pushed an update for the ordering issue." }],
	});

	const template = readFileSync(new URL("../prompts/bench-kickoff.md", import.meta.url), "utf8");
	const prompt = buildBenchKickoffPromptFromTemplate(template, pr);

	assert.match(prompt, /maglev_pr_code_review/);
	assert.doesNotMatch(prompt, /\/skill:claude-code-pr-review 1416/);
	assert.match(prompt, /Existing PR reviews to account for:/);
	assert.match(prompt, /maintainer — CHANGES_REQUESTED/);
	assert.match(prompt, /Please fix stop ordering/);
	assert.match(prompt, /Existing PR comments to account for:/);
	assert.match(prompt, /which prior feedback appears addressed, which appears still unaddressed, and which is unclear/);
	assert.match(prompt, /contributor/);
	assert.match(prompt, /Pushed an update for the ordering issue/);
});

test("planBenchStart uses gh pr checkout instead of manual PR head remote configuration", () => {
	const plan = planBenchStart({ pr: makeSnapshotPr({ number: 1415, headOid: "abc123", headRefName: "same-repo-branch" }) });
	assert.equal(plan.headRemoteName, undefined);
	assert.equal(plan.headRemoteUrl, undefined);
	assert.ok(plan.actions.includes("check out PR #1415 with gh pr checkout into branch pr-1415"));
	assert.equal(plan.findings.find((finding) => finding.code === "gh-pr-checkout")?.severity, "info");
});

test("planBenchStart reuses complete Benches and warns on head mismatch", () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123" });
	const bench = makeBenchState({ pr: 1416, benchPath: "/var/lib/maglev-pr-maintainer/checkouts/pr-1416", freshness: "stale", fresh: false });

	const plan = planBenchStart({ pr, existingBench: bench });
	assert.equal(plan.status, "needs-override");
	assert.equal(plan.unacknowledgedWarnings[0].code, "head-mismatch");
	assert.deepEqual(plan.actions, ["reuse existing PR Bench /var/lib/maglev-pr-maintainer/checkouts/pr-1416"]);

	const acknowledged = planBenchStart({ pr, existingBench: bench }, { allowHeadMismatch: true });
	assert.equal(acknowledged.status, "reusable");
});

test("planBenchStart completes an existing tmux session missing its pi window", () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123" });
	const bench = makeBenchState({ pr: 1416, benchPath: "/var/lib/maglev-pr-maintainer/checkouts/pr-1416", piWindowExists: false });

	const plan = planBenchStart({ pr, existingBench: bench });

	assert.equal(plan.status, "ready");
	assert.deepEqual(plan.actions, ["start pi in tmux window pi for session pr-1416 at /var/lib/maglev-pr-maintainer/checkouts/pr-1416"]);
	assert.equal(plan.findings.find((finding) => finding.code === "missing-pi-window")?.severity, "info");
});

test("planBenchReset plans resetting a stale existing Bench to the snapshot head", () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123" });
	const bench = makeBenchState({ pr: 1416, benchPath: "/var/lib/maglev-pr-maintainer/checkouts/pr-1416", freshness: "stale", fresh: false, tmuxExists: true });

	const plan = planBenchReset(bench, pr, "2026-01-10T00:00:00Z", { now: "2026-01-10T01:00:00Z" });

	assert.equal(plan.status, "ready");
	assert.deepEqual(plan.actions, ["reset PR Bench checkout to PR #1416 snapshot head with gh pr checkout --force"]);
	assert.equal(plan.findings.find((finding) => finding.code === "head-mismatch")?.severity, "info");
});

test("planBenchReset requires dirty acknowledgement before discarding local state", () => {
	const pr = makeSnapshotPr({ number: 1416, headOid: "abc123" });
	const bench = makeBenchState({ pr: 1416, benchPath: "/var/lib/maglev-pr-maintainer/checkouts/pr-1416", freshness: "stale", fresh: false, dirty: true, dirtyStatus: "modified" });

	const plan = planBenchReset(bench, pr, "2026-01-10T00:00:00Z", { now: "2026-01-10T01:00:00Z" });
	assert.equal(plan.status, "needs-override");
	assert.equal(plan.unacknowledgedWarnings[0].code, "dirty-modified");

	const acknowledged = planBenchReset(bench, pr, "2026-01-10T00:00:00Z", { allowDirty: "any", now: "2026-01-10T01:00:00Z" });
	assert.equal(acknowledged.status, "ready");
	assert.equal(acknowledged.warnings[0].acknowledged, true);
});

test("formatBenchLine and report lines use PR Bench terminology", () => {
	const bench = makeBenchState({
		pr: 1416,
		benchPath: "/var/lib/maglev-pr-maintainer/checkouts/pr-1416",
		localHeadShort: "abc1234",
		freshness: "fresh",
		fresh: true,
		dirty: true,
		title: "Fix realtime updates",
	});

	assert.equal(formatBenchLine(bench), "#1416 Fix realtime updates — tmux pr-1416 • /var/lib/maglev-pr-maintainer/checkouts/pr-1416 • HEAD abc1234 • fresh • dirty");
	assert.deepEqual(formatBenchReportLines([bench]), [
		"PR Benches (1)",
		"#1416 Fix realtime updates — tmux pr-1416 • /var/lib/maglev-pr-maintainer/checkouts/pr-1416 • HEAD abc1234 • fresh • dirty",
	]);
	assert.deepEqual(formatBenchReportLines([], "missing snapshot"), [
		"PR Benches (0)",
		"Snapshot freshness unavailable: missing snapshot",
		"No local PR Benches found.",
	]);
});
