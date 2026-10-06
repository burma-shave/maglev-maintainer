import assert from "node:assert/strict";
import test from "node:test";
import { getMaintainerStatus } from "../extensions/status.ts";
import { makeDecision, makeDecisionsFile, makeSnapshotFile, makeSnapshotPr } from "../testdata/fixtures.ts";

test("getMaintainerStatus returns structured ok status", async () => {
	const status = await getMaintainerStatus({
		loadSnapshotOptional: async () => ({ snapshot: makeSnapshotFile([
			makeSnapshotPr({ number: 1 }),
			makeSnapshotPr({ number: 2 }),
		], { fetchedAt: "2026-01-10T00:00:00Z" }) }),
		loadDecisions: async () => ({ file: makeDecisionsFile([
			makeDecision(1),
		], { updatedAt: "2026-01-11T00:00:00Z" }), importedFromOld: false }),
		listBenches: async () => ({ benches: [{ pr: 1 }] }),
		checkRoot: async () => true,
		checkGh: async () => true,
		checkTmux: async () => true,
		rootDir: "/var/lib/maglev-pr-maintainer",
		snapshotFile: "/var/lib/maglev-pr-maintainer/state/github-snapshot.json",
		decisionsFile: "/var/lib/maglev-pr-maintainer/state/decisions.json",
		checkoutDir: "/var/lib/maglev-pr-maintainer/checkouts",
	});

	assert.deepEqual(status, {
		root: {
			path: "/var/lib/maglev-pr-maintainer",
			ok: true,
		},
		snapshot: {
			path: "/var/lib/maglev-pr-maintainer/state/github-snapshot.json",
			ok: true,
			fetchedAt: "2026-01-10T00:00:00Z",
			prCount: 2,
		},
		decisions: {
			path: "/var/lib/maglev-pr-maintainer/state/decisions.json",
			ok: true,
			count: 1,
		},
		benches: {
			checkoutDir: "/var/lib/maglev-pr-maintainer/checkouts",
			ok: true,
			count: 1,
			warning: undefined,
		},
		gh: { ok: true },
		tmux: { ok: true },
	});
});

test("getMaintainerStatus reports missing snapshot, bench warning, and failed checks", async () => {
	const status = await getMaintainerStatus({
		loadSnapshotOptional: async () => ({ warning: "snapshot missing" }),
		loadDecisions: async () => ({ file: makeDecisionsFile([makeDecision(3)]), importedFromOld: false }),
		listBenches: async () => ({ benches: [], snapshotWarning: "no snapshot freshness" }),
		checkRoot: async () => false,
		checkGh: async () => false,
		checkTmux: async () => false,
		rootDir: "/var/lib/maglev-pr-maintainer",
		snapshotFile: "/var/lib/maglev-pr-maintainer/state/github-snapshot.json",
		decisionsFile: "/var/lib/maglev-pr-maintainer/state/decisions.json",
		checkoutDir: "/var/lib/maglev-pr-maintainer/checkouts",
	});

	assert.equal(status.root.ok, false);
	assert.equal(status.snapshot.ok, false);
	assert.equal(status.snapshot.warning, "snapshot missing");
	assert.equal(status.decisions.path, "/var/lib/maglev-pr-maintainer/state/decisions.json");
	assert.equal(status.benches.warning, "no snapshot freshness");
	assert.equal(status.gh.ok, false);
	assert.equal(status.tmux.ok, false);
});

test("getMaintainerStatus catches decision and bench errors", async () => {
	const status = await getMaintainerStatus({
		loadSnapshotOptional: async () => ({ snapshot: makeSnapshotFile([]) }),
		loadDecisions: async () => { throw new Error("bad decisions json"); },
		listBenches: async () => { throw new Error("tmux exploded"); },
		checkRoot: async () => true,
		checkGh: async () => true,
		checkTmux: async () => true,
		rootDir: "/var/lib/maglev-pr-maintainer",
		snapshotFile: "/var/lib/maglev-pr-maintainer/state/github-snapshot.json",
		decisionsFile: "/var/lib/maglev-pr-maintainer/state/decisions.json",
		checkoutDir: "/var/lib/maglev-pr-maintainer/checkouts",
	});

	assert.deepEqual(status.decisions, {
		path: "/var/lib/maglev-pr-maintainer/state/decisions.json",
		ok: false,
		warning: "bad decisions json",
	});
	assert.deepEqual(status.benches, {
		checkoutDir: "/var/lib/maglev-pr-maintainer/checkouts",
		ok: false,
		warning: "tmux exploded",
	});
});
