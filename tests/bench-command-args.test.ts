import assert from "node:assert/strict";
import test from "node:test";
import { parseBenchStartArgs, parseIdFlags } from "../extensions/bench-command-args.ts";
import { validateBenchStartTarget } from "../extensions/bench.ts";

test("start accepts a branch or explicit PR entry point and defaults to planning", () => {
	assert.deepEqual(parseBenchStartArgs("feature/routing"), { branch: "feature/routing", apply: false });
	assert.deepEqual(parseBenchStartArgs("--pr #123"), { pr: 123, apply: false });
	assert.deepEqual(parseBenchStartArgs("123"), { branch: "123", apply: false });
	assert.deepEqual(parseBenchStartArgs("new-work --from origin/main --apply"), { branch: "new-work", createFrom: "origin/main", apply: true });
	assert.deepEqual(parseBenchStartArgs("--pr 123 --apply --allow-stale-snapshot --allow-head-mismatch"), { pr: 123, apply: true, allowStaleSnapshot: true, allowHeadMismatch: true });
});

test("start rejects ambiguous, missing, invalid, and unsupported targets", () => {
	for (const input of ["", "--pr", "--pr 0", "--pr -1", "--pr 1.5", "--pr 9007199254740992", "main --pr 123", "--pr 123 --from origin/main", "main --from", "main --from origin/main --from origin/dev", "main --bogus", "main other", "--pr 123 --pr 124"]) {
		assert.ok(parseBenchStartArgs(input).error, input);
	}
	for (const input of [{}, { branch: "main", pr: 123 }, { pr: 0 }, { pr: 1.5 }, { pr: 123, createFrom: "origin/main" }, { branch: "../unsafe" }]) {
		assert.throws(() => validateBenchStartTarget(input));
	}
});

test("ID-based commands reject PR numbers, branch names, and unknown flags", () => {
	const parsed = parseIdFlags("pr-123 --apply --keep-checkout", ["--apply", "--keep-checkout"]);
	assert.equal(parsed.id, "pr-123");
	assert.deepEqual([...parsed.flags], ["--apply", "--keep-checkout"]);
	for (const input of ["", "123", "feature/routing", "pr-0", "pr-123 --unknown", "pr-123 another-id"]) {
		assert.throws(() => parseIdFlags(input, ["--apply"]), undefined, input);
	}
});
