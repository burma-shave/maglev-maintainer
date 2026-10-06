import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { loadDecisionsFromFile, loadSnapshotFromFile, writeDecisionsToFile } from "../extensions/state-core.ts";
import { makeDecision, makeDecisionsFile, makeSnapshotFile } from "../testdata/fixtures.ts";

async function tempFiles() {
	const dir = await mkdtemp(join(tmpdir(), "maglev-pr-maintainer-test-"));
	return {
		dir,
		snapshot: join(dir, "snapshot.json"),
		decisions: join(dir, "decisions.json"),
	};
}

test("loadSnapshotFromFile validates schema and reports missing snapshots clearly", async () => {
	const files = await tempFiles();
	await assert.rejects(() => loadSnapshotFromFile(files.snapshot), /Run maglev_pr_refresh_metadata first/);

	await writeFile(files.snapshot, JSON.stringify({ schemaVersion: 999, pullRequests: [] }), "utf8");
	await assert.rejects(() => loadSnapshotFromFile(files.snapshot), /Unsupported Maglev PR snapshot schema/);

	await writeFile(files.snapshot, JSON.stringify(makeSnapshotFile([], { fetchedAt: "2026-01-01T00:00:00Z" })), "utf8");
	const loaded = await loadSnapshotFromFile(files.snapshot);
	assert.equal(loaded.repo, "OneBusAway/maglev");
	assert.deepEqual(loaded.pullRequests, []);
});

test("loadDecisionsFromFile returns empty decisions when absent and normalizes an existing file", async () => {
	const files = await tempFiles();

	const missing = await loadDecisionsFromFile(files.decisions);
	assert.equal(missing.importedFromOld, false);
	assert.deepEqual(missing.file.decisions, []);

	await writeFile(files.decisions, JSON.stringify(makeDecisionsFile([
		makeDecision(3, { bucket: "watch", reason: "new file wins", decidedAt: "2026-01-02T00:00:00Z", source: "user" }),
	], { updatedAt: "bad date" })), "utf8");
	const loaded = await loadDecisionsFromFile(files.decisions);
	assert.equal(loaded.importedFromOld, false);
	assert.deepEqual(loaded.file.decisions.map((decision) => decision.pr), [3]);
	assert.equal(loaded.file.updatedAt, new Date(0).toISOString());
});

test("writeDecisionsToFile writes normalized schema and sorts decisions by PR number", async () => {
	const files = await tempFiles();
	const file = makeDecisionsFile([
		makeDecision(10, { bucket: "watch", reason: "later", decidedAt: "2026-01-01T00:00:00Z" }),
		makeDecision(2, { bucket: "review", reason: "earlier", decidedAt: "2026-01-01T00:00:00Z" }),
	]);

	await writeDecisionsToFile(files.decisions, file);
	const written = JSON.parse(await readFile(files.decisions, "utf8"));

	assert.equal(written.schemaVersion, 1);
	assert.equal(written.repo, "OneBusAway/maglev");
	assert.ok(Number.isFinite(Date.parse(written.updatedAt)));
	assert.deepEqual(written.decisions.map((decision: { pr: number }) => decision.pr), [2, 10]);
});
