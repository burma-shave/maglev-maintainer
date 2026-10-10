import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDecision, saveDecision } from "../extensions/decisions.ts";
import { buildQueueModel, formatQueueReportLines } from "../extensions/queue-core.ts";
import { buildStateQuery } from "../extensions/state-query.ts";
import { loadDecisionsFromFile, loadSnapshotFromFile, writeDecisionsToFile } from "../extensions/state-core.ts";
import { listPrsNeedingInference, loadPrMetadata } from "../extensions/triage.ts";
import { needsInferenceToolResult } from "../extensions/triage-tool-results.ts";
import { atomicWriteJson } from "../extensions/utils.ts";
import { makeSnapshotFile, makeSnapshotPr } from "../testdata/fixtures.ts";
import type { DecisionBasis, DecisionsFile } from "../extensions/types.ts";

test("freshness lifecycle retains superseded evidence and failed attempts until explicit reevaluation", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "maglev-freshness-lifecycle-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const snapshotPath = join(root, "snapshot.json");
	const decisionPath = join(root, "decisions.json");
	const A = "a".repeat(40);
	const B = "b".repeat(40);
	const D1 = "2026-01-02T00:00:00Z";
	const D2 = "2026-01-04T00:00:00Z";
	const deps = {
		decisionsFile: decisionPath,
		loadDecisions: () => loadDecisionsFromFile(decisionPath),
		writeDecisions: (file: DecisionsFile) => writeDecisionsToFile(decisionPath, file),
		loadSnapshot: () => loadSnapshotFromFile(snapshotPath),
		now: () => new Date("2026-01-10T00:00:00Z"),
	};
	await atomicWriteJson(snapshotPath, makeSnapshotFile([makeSnapshotPr({ number: 1, headOid: A, discussionUpdatedAt: D1 })], { fetchedAt: "2026-01-03T00:00:00Z" }));
	const evaluated = await loadPrMetadata({ prs: [1] }, deps);
	const basis: DecisionBasis = { snapshotFetchedAt: evaluated.snapshotFetchedAt, headOid: evaluated.pullRequests[0].headOid, discussionUpdatedAt: evaluated.pullRequests[0].discussionUpdatedAt };
	const originalRecord = `analysis: at=2026-01-03T01:00:00Z; type=metadata-triage; sha=${A}; status=completed; outcome=not-applicable; summary=wait for contributor`;
	await saveDecision(1, { bucket: "watch", reason: "2026-01-03 wait for contributor", basis, observations: [originalRecord] }, deps);

	async function check(status: "current" | "superseded") {
		const snapshot = await deps.loadSnapshot();
		const decisions = (await deps.loadDecisions()).file.decisions;
		const focused = buildStateQuery({ snapshot, decisions, benches: [], prs: [1] });
		assert.equal(focused.rows[0].applicability.status, status);
		const discovery = await listPrsNeedingInference({ prs: [1] }, deps);
		assert.equal(discovery.prs.length, status === "current" ? 0 : 1);
		const queue = buildQueueModel({ snapshot, decisions, benches: [] });
		const row = (status === "current" ? queue.rowsByBucket.watch : queue.rowsByBucket.triage)[0];
		assert.equal(row.applicability?.status, status);
		assert.deepEqual(row.decision, decisions[0]);
		if (status === "superseded") {
			assert.deepEqual(discovery.prs[0].applicability, focused.rows[0].applicability);
			const text = needsInferenceToolResult(discovery, snapshotPath, decisionPath).content[0].text;
			const compact = JSON.parse(text.split("\n")[2]);
			assert.equal(compact.applicability.status, status);
			assert.equal(compact.decision.basis.headOid, A);
			assert.equal(compact.discussionUpdatedAt, D2);
			assert.ok(formatQueueReportLines(queue).some((line) => line.includes("previous watch")));
		}
		return focused.rows[0];
	}

	await check("current");
	// Commit date precedes both saves; it cannot conceal a different head.
	await atomicWriteJson(snapshotPath, makeSnapshotFile([makeSnapshotPr({ number: 1, headOid: B, discussionUpdatedAt: D2, lastCommit: { oid: B, at: "2025-01-01T00:00:00Z" } })], { fetchedAt: "2026-01-05T00:00:00Z" }));
	await check("superseded");
	// A delayed, accepted result is retained rather than rejected or attributed to B.
	const supersededRecord = `analysis: at=2026-01-06T00:00:00Z; type=metadata-triage; sha=${A}; status=completed; outcome=not-applicable; summary=accepted result superseded by B`;
	await saveDecision(1, { bucket: "watch", reason: "2026-01-06 historical wait recommendation", basis, observations: [originalRecord, supersededRecord] }, deps);
	const saved = await getDecision(1, deps);
	assert.deepEqual(JSON.parse(JSON.stringify(saved.decision!.basis)), basis);
	const beforeAttempt = saved.decision!;
	await check("superseded");
	const failedRecord = `analysis: at=2026-01-07T00:00:00Z; type=metadata-triage; sha=${B}; status=failed; outcome=unconfirmed; summary=evidence unavailable`;
	await saveDecision(1, { mode: "record-only", bucket: "review", reason: "2026-01-07 stale caller recommendation", basis: { headOid: B, discussionUpdatedAt: D2 }, observations: [failedRecord] }, deps);
	assert.deepEqual((await getDecision(1, deps)).decision, { ...beforeAttempt, observations: [...beforeAttempt.observations!, failedRecord] });
	await check("superseded");

	const reevaluated = await loadPrMetadata({ prs: [1] }, deps);
	const currentBasis = { snapshotFetchedAt: reevaluated.snapshotFetchedAt, headOid: reevaluated.pullRequests[0].headOid, discussionUpdatedAt: reevaluated.pullRequests[0].discussionUpdatedAt };
	const allRecords = (await getDecision(1, deps)).decision!.observations!;
	await saveDecision(1, { bucket: "watch", reason: "2026-01-10 reevaluated; wait for contributor", basis: currentBasis, observations: [...allRecords, `analysis: at=2026-01-10T00:00:00Z; type=metadata-triage; sha=${B}; status=completed; outcome=not-applicable; summary=reevaluated`] }, deps);
	const row = await check("current");
	assert.equal(row.decision!.observations!.length, 4);
	assert.ok(row.decision!.observations!.includes(originalRecord));
	assert.ok(row.decision!.observations!.includes(supersededRecord));
	assert.ok(row.decision!.observations!.includes(failedRecord));
	assert.deepEqual(JSON.parse(JSON.stringify(row.decision!.basis)), currentBasis);
});
