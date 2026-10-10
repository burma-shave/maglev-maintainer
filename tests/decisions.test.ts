import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteDecision, decisionMap, getDecision, listDecisions, normalizeDecision, relativeTimePhraseInDecisionText, saveDecision } from "../extensions/decisions.ts";
import { assessRecommendation, computeNeedsInference } from "../extensions/triage.ts";
import { loadDecisionsFromFile, writeDecisionsToFile } from "../extensions/state-core.ts";
import { makeDecision, makeDecisionsFile, makeSnapshotFile, makeSnapshotPr } from "../testdata/fixtures.ts";

test("normalizeDecision accepts valid decisions and applies a source override", () => {
	const normalized = normalizeDecision({
		pr: 1362,
		bucket: "review",
		priority: 7,
		reason: "ready for maintainer review",
		observations: ["human update", 123, "tests pass"],
		decidedAt: "2026-09-05T01:24:43.957Z",
		source: "skill",
		basis: {
			snapshotFetchedAt: "2026-09-05T01:21:51.636Z",
			meaningfulUpdatedAt: "2026-09-05T01:05:38Z",
			discussionUpdatedAt: "2026-09-05T01:00:00Z",
			headOid: "3bc474b",
			ignored: true,
		},
	}, "migration");

	assert.deepEqual(normalized, {
		pr: 1362,
		bucket: "review",
		priority: 7,
		reason: "ready for maintainer review",
		observations: ["human update", "tests pass"],
		decidedAt: "2026-09-05T01:24:43.957Z",
		source: "migration",
		basis: {
			snapshotFetchedAt: "2026-09-05T01:21:51.636Z",
			meaningfulUpdatedAt: "2026-09-05T01:05:38Z",
			discussionUpdatedAt: "2026-09-05T01:00:00Z",
			headOid: "3bc474b",
		},
	});
});

test("normalizeDecision rejects invalid bucket, PR number, reason, and timestamp", () => {
	assert.equal(normalizeDecision({ pr: 1, bucket: "triage", reason: "x", decidedAt: "2026-01-01T00:00:00Z" }), undefined);
	assert.equal(normalizeDecision({ pr: 0, bucket: "review", reason: "x", decidedAt: "2026-01-01T00:00:00Z" }), undefined);
	assert.equal(normalizeDecision({ pr: 1, bucket: "review", reason: 123, decidedAt: "2026-01-01T00:00:00Z" }), undefined);
	assert.equal(normalizeDecision({ pr: 1, bucket: "review", reason: "x", decidedAt: "not a date" }), undefined);
});

test("decision operations list, get, delete, and save structured decisions", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "maglev-decisions-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	let file = makeDecisionsFile([
		makeDecision(7, { bucket: "watch", reason: "wait" }),
		makeDecision(3, { bucket: "review", reason: "ready" }),
	]);
	const deps = {
		decisionsFile: join(root, "decisions.json"),
		loadDecisions: async () => ({ file, importedFromOld: false }),
		writeDecisions: async (next: typeof file) => { file = next; },
		loadSnapshot: async () => makeSnapshotFile([
			makeSnapshotPr({ number: 5, meaningfulUpdatedAt: "2026-01-05T00:00:00Z", headOid: "abc123" }),
		]),
		now: () => new Date("2026-01-06T00:00:00Z"),
	};

	assert.deepEqual((await listDecisions(deps)).decisions.map((decision) => decision.pr), [3, 7]);
	assert.equal((await getDecision(3, deps)).decision?.reason, "ready");
	assert.deepEqual(await deleteDecision(7, deps), { pr: 7, deleted: true });
	assert.deepEqual(file.decisions.map((decision) => decision.pr), [3]);

	const saved = await saveDecision(5, {
		bucket: "chase",
		priority: 4,
		reason: "  contributor response overdue  ",
		observations: [" requested changes open ", "", "ping later"],
		source: "user",
		basis: { snapshotFetchedAt: "old", meaningfulUpdatedAt: "old", headOid: "old" },
	}, deps);

	assert.deepEqual(saved, {
		pr: 5,
		bucket: "chase",
		priority: 4,
		reason: "contributor response overdue",
		observations: ["requested changes open", "ping later"],
		decidedAt: "2026-01-06T00:00:00.000Z",
		source: "user",
		basis: {
			snapshotFetchedAt: "old",
			meaningfulUpdatedAt: "old",
			headOid: "old",
		},
	});
});

test("decision saves preserve explicit, partial, omitted and unknown evaluation basis", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "maglev-basis-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	let file = makeDecisionsFile([]);
	const deps = {
		decisionsFile: join(root, "decisions.json"),
		loadDecisions: async () => ({ file, importedFromOld: false }),
		writeDecisions: async (next: typeof file) => { file = next; },
		loadSnapshot: async () => makeSnapshotFile([makeSnapshotPr({ number: 1, headOid: "B", discussionUpdatedAt: "2026-01-04T00:00:00Z" })]),
	};
	const basis = { headOid: "A", discussionUpdatedAt: "2026-01-02T00:00:00Z", snapshotFetchedAt: "2026-01-03T00:00:00Z" };
	const input = { bucket: "watch" as const, reason: "wait for contributor" };
	assert.deepEqual((await saveDecision(1, { ...input, basis }, deps)).basis, basis);
	assert.deepEqual((await saveDecision(1, input, deps)).basis, basis);
	assert.deepEqual((await saveDecision(1, { ...input, basis: { headOid: "A" } }, deps)).basis, { headOid: "A" });
	assert.equal((await saveDecision(2, input, deps)).basis, undefined);
	assert.deepEqual((await saveDecision(3, { ...input, basis }, { ...deps, loadSnapshot: undefined })).basis, basis);
	assert.deepEqual((await saveDecision(1, { ...input, basis: {} }, deps)).basis, {});
});

test("record-only merges observations but preserves recommendation fields from the locked read", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "maglev-record-only-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const previous = makeDecision(1, { bucket: "pinned", priority: 9, reason: "spec hold", source: "user", observations: ["older analysis"], basis: { headOid: "A", discussionUpdatedAt: "2026-01-01T00:00:00Z" } });
	let file = makeDecisionsFile([previous]);
	const deps = {
		decisionsFile: join(root, "decisions.json"),
		loadDecisions: async () => ({ file, importedFromOld: false }),
		writeDecisions: async (next: typeof file) => { file = next; },
		now: () => new Date("2026-01-10T00:00:00Z"),
	};
	const input = { mode: "record-only" as const, bucket: "watch" as const, priority: 0, reason: "outdated caller", source: "skill" as const, basis: { headOid: "B" }, observations: ["older analysis", " new attempt "] };
	assert.deepEqual(await saveDecision(1, input, deps), { ...previous, observations: ["older analysis", "new attempt"] });
	const placeholder = await saveDecision(2, input, deps);
	assert.equal(placeholder.bucket, "review");
	assert.match(placeholder.reason, /blocked analysis; no completed recommendation evaluation/);
	assert.equal(placeholder.basis, undefined);
	assert.equal(placeholder.priority, undefined);
	assert.deepEqual(placeholder.observations, ["older analysis", "new attempt"]);
	await assert.rejects(saveDecision(1, { ...input, mode: "bad" as any }, deps), /Invalid decision mutation mode/);
});

test("saveDecision rejects relative time phrases in durable text", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "maglev-decisions-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	let file = makeDecisionsFile([]);
	const deps = {
		decisionsFile: join(root, "decisions.json"),
		loadDecisions: async () => ({ file, importedFromOld: false }),
		writeDecisions: async (next: typeof file) => { file = next; },
		now: () => new Date("2026-01-06T00:00:00Z"),
	};

	await assert.rejects(
		saveDecision(5, { bucket: "watch", reason: "chased today; wait for contributor" }, deps),
		/Durable decisions must use absolute dates/,
	);
	await assert.rejects(
		saveDecision(5, { bucket: "watch", reason: "wait", observations: ["reviewed this morning"] }, deps),
		/Decision observation 1 contains relative time phrase/,
	);
	assert.equal(relativeTimePhraseInDecisionText("maintainer chased on 2026-09-05"), undefined);
	assert.equal(file.decisions.length, 0);
});

test("concurrent saveDecision calls are serialized so decisions are not lost", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "maglev-decisions-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	let file = makeDecisionsFile([]);
	const deps = {
		decisionsFile: join(root, "decisions.json"),
		loadDecisions: async () => ({ file, importedFromOld: false }),
		writeDecisions: async (next: typeof file) => {
			await delay(5);
			file = next;
		},
		now: () => new Date("2026-01-06T00:00:00Z"),
	};

	await Promise.all([
		saveDecision(5, { bucket: "watch", reason: "wait for contributor" }, deps),
		saveDecision(6, { bucket: "review", reason: "ready for maintainer" }, deps),
	]);

	assert.deepEqual(file.decisions.map((decision) => decision.pr).sort((a, b) => a - b), [5, 6]);
});

test("recorded unsuccessful attempts cannot refresh stale or unknown recommendations", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "maglev-attempts-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, "decisions.json");
	const previous = makeDecision(1, { bucket: "pinned", priority: 8, source: "user", reason: "spec decision required", basis: { headOid: "A", discussionUpdatedAt: "2026-01-01T00:00:00Z" }, observations: ["old result"] });
	await writeDecisionsToFile(path, makeDecisionsFile([previous, makeDecision(2)]));
	const deps = { decisionsFile: path, loadDecisions: () => loadDecisionsFromFile(path), writeDecisions: (file: ReturnType<typeof makeDecisionsFile>) => writeDecisionsToFile(path, file) };
	const pr = makeSnapshotPr({ number: 1, headOid: "B", discussionUpdatedAt: "2026-01-03T00:00:00Z" });
	for (const status of ["failed", "incomplete", "blocked"]) {
		for (const number of [1, 2, 3]) {
			const before = (await getDecision(number, deps)).decision;
			const result = await saveDecision(number, { mode: "record-only", bucket: "review", reason: "outdated caller ready", basis: { headOid: "B", discussionUpdatedAt: pr.discussionUpdatedAt }, observations: [`analysis: at=2026-01-10T00:00:00Z; status=${status}; sha=B`] }, deps);
			assert.equal(assessRecommendation({ ...pr, number }, result).status, number === 1 ? "superseded" : "unknown");
			assert.equal(computeNeedsInference(makeSnapshotFile([{ ...pr, number }]), [result]).length, 1);
			if (before) {
				assert.equal(result.decidedAt, before.decidedAt);
				assert.deepEqual(result.basis, before.basis);
				assert.equal(result.bucket, before.bucket);
			}
		}
	}
	await Promise.all(["concurrent A", "concurrent B"].map((observation) => saveDecision(1, { mode: "record-only", bucket: "watch", reason: "caller", observations: [observation] }, deps)));
	const saved = (await getDecision(1, deps)).decision!;
	assert.equal(saved.source, "user");
	assert.equal(saved.reason, previous.reason);
	assert.equal(saved.priority, previous.priority);
	assert.equal(saved.observations!.length, 6);
	assert.ok(saved.observations!.includes("concurrent A"));
	assert.ok(saved.observations!.includes("concurrent B"));
});

test("decisionMap keeps the latest entry for a PR by array order", () => {
	const first = makeDecision(1, { bucket: "watch", reason: "old", decidedAt: "2026-01-01T00:00:00Z" });
	const second = makeDecision(1, { bucket: "review", reason: "new", decidedAt: "2026-01-02T00:00:00Z" });
	const byPr = decisionMap([first, second]);

	assert.equal(byPr.size, 1);
	assert.equal(byPr.get(1), second);
});
