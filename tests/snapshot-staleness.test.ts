import assert from "node:assert/strict";
import test from "node:test";
import { SNAPSHOT_STALE_AFTER_HOURS } from "../extensions/constants.ts";
import { checkSnapshotStaleness, computeSnapshotStaleness, formatSnapshotStaleness } from "../extensions/snapshot-staleness.ts";
import { makeSnapshotFile } from "../testdata/fixtures.ts";

test("computeSnapshotStaleness reports fresh snapshots within the package threshold", () => {
	const result = computeSnapshotStaleness({
		snapshot: makeSnapshotFile([], { fetchedAt: "2026-01-10T00:00:00Z" }),
		now: "2026-01-10T03:59:00Z",
		snapshotFile: "/agent/snapshot.json",
	});

	assert.equal(SNAPSHOT_STALE_AFTER_HOURS, 4);
	assert.equal(result.status, "fresh");
	assert.equal(result.fresh, true);
	assert.equal(result.stale, false);
	assert.equal(result.shouldRefresh, false);
	assert.equal(result.maxAgeHours, 4);
	assert.equal(result.snapshotFile, "/agent/snapshot.json");
	assert.ok(result.ageHours! < 4);
	assert.match(formatSnapshotStaleness(result), /Snapshot: fresh/);
});

test("computeSnapshotStaleness reports stale snapshots after the package threshold", () => {
	const result = computeSnapshotStaleness({
		snapshot: makeSnapshotFile([], { fetchedAt: "2026-01-10T00:00:00Z" }),
		now: "2026-01-10T04:01:00Z",
	});

	assert.equal(result.status, "stale");
	assert.equal(result.fresh, false);
	assert.equal(result.stale, true);
	assert.equal(result.shouldRefresh, true);
	assert.ok(result.ageHours! > 4);
	assert.match(formatSnapshotStaleness(result), /refresh required/);
});

test("computeSnapshotStaleness treats missing or invalid snapshots as refresh-required", () => {
	const missing = computeSnapshotStaleness({ warning: "No snapshot" });
	assert.equal(missing.status, "missing");
	assert.equal(missing.shouldRefresh, true);
	assert.equal(missing.stale, true);

	const invalid = computeSnapshotStaleness({
		snapshot: makeSnapshotFile([], { fetchedAt: "not a date" }),
		now: "2026-01-10T00:00:00Z",
	});
	assert.equal(invalid.status, "invalid");
	assert.equal(invalid.shouldRefresh, true);
	assert.equal(invalid.stale, true);
});

test("checkSnapshotStaleness loads snapshot through injected dependency", async () => {
	const result = await checkSnapshotStaleness({
		loadSnapshotOptional: async () => ({ snapshot: makeSnapshotFile([], { fetchedAt: "2026-01-10T00:00:00Z" }) }),
		now: () => new Date("2026-01-10T05:00:00Z"),
		snapshotFile: "/agent/snapshot.json",
	});

	assert.equal(result.status, "stale");
	assert.equal(result.snapshotFile, "/agent/snapshot.json");
});
