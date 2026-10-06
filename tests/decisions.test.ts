import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { deleteDecision, decisionMap, getDecision, listDecisions, normalizeDecision, relativeTimePhraseInDecisionText, saveDecision } from "../extensions/decisions.ts";
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

test("decision operations list, get, delete, and save structured decisions", async () => {
	let file = makeDecisionsFile([
		makeDecision(7, { bucket: "watch", reason: "wait" }),
		makeDecision(3, { bucket: "review", reason: "ready" }),
	]);
	const deps = {
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
			snapshotFetchedAt: "2026-01-10T00:00:00Z",
			meaningfulUpdatedAt: "2026-01-05T00:00:00Z",
			headOid: "abc123",
		},
	});
});

test("saveDecision rejects relative time phrases in durable text", async () => {
	let file = makeDecisionsFile([]);
	const deps = {
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

test("concurrent saveDecision calls are serialized so decisions are not lost", async () => {
	let file = makeDecisionsFile([]);
	const deps = {
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

test("decisionMap keeps the latest entry for a PR by array order", () => {
	const first = makeDecision(1, { bucket: "watch", reason: "old", decidedAt: "2026-01-01T00:00:00Z" });
	const second = makeDecision(1, { bucket: "review", reason: "new", decidedAt: "2026-01-02T00:00:00Z" });
	const byPr = decisionMap([first, second]);

	assert.equal(byPr.size, 1);
	assert.equal(byPr.get(1), second);
});
