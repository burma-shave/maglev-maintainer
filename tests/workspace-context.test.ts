import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceContext, formatWorkspaceContext } from "../extensions/workspace-context.ts";

const paths = {
	maintainerRoot: "/var/lib/maglev-pr-maintainer",
	stateDir: "/var/lib/maglev-pr-maintainer/state",
	snapshotFile: "/var/lib/maglev-pr-maintainer/state/github-snapshot.json",
	decisionsFile: "/var/lib/maglev-pr-maintainer/state/decisions.json",
	benchStateDir: "/var/lib/maglev-pr-maintainer/benches",
	checkoutDir: "/var/lib/maglev-pr-maintainer/checkouts",
	reviewJsonDir: "/var/lib/maglev-pr-maintainer/review-json",
	companionReposDir: "/var/lib/maglev-pr-maintainer/companion-repos",
};

test("buildWorkspaceContext detects current PR Bench from cwd", () => {
	const context = buildWorkspaceContext({ cwd: "/var/lib/maglev-pr-maintainer/checkouts/pr-1416/internal/restapi" }, paths);

	assert.equal(context.schemaVersion, 1);
	assert.equal(context.maglevCheckout.path, "/var/lib/maglev-pr-maintainer/checkouts/maglev");
	assert.equal(context.maglevCheckout.resolverTool, "maglev_pr_checkout");
	assert.equal(context.capabilities.checkoutTool, "maglev_pr_checkout");
	assert.equal(context.benches.currentPr, 1416);
	assert.equal(context.benches.isCurrentCheckoutPrBench, true);
	assert.equal(context.benches.currentCheckoutPath, "/var/lib/maglev-pr-maintainer/checkouts/pr-1416");
	assert.equal(context.benches.targetPr, 1416);
	assert.equal(context.benches.targetCheckoutPath, "/var/lib/maglev-pr-maintainer/checkouts/pr-1416");
	assert.equal(context.benches.targetBenchStateDir, "/var/lib/maglev-pr-maintainer/benches/pr-1416");
	assert.equal(context.artifacts.targetReportsDir, "/var/lib/maglev-pr-maintainer/benches/pr-1416/reports");
	assert.equal(context.companionRepos.companionReposDir, "/var/lib/maglev-pr-maintainer/companion-repos");
	assert.equal(context.runtimes.runtimeDir, "/var/lib/maglev-pr-maintainer/runtimes");
	assert.equal(context.capabilities.apiStartTool, "maglev_pr_api_start");
	assert.equal(context.capabilities.apiStopTool, "maglev_pr_api_stop");
	assert.equal(context.capabilities.apiStatusTool, "maglev_pr_api_status");
});

test("buildWorkspaceContext allows explicit target PR outside a PR Bench", () => {
	const context = buildWorkspaceContext({ pr: 2000, cwd: "/workspace/maglev" }, paths);

	assert.equal(context.benches.currentPr, undefined);
	assert.equal(context.benches.isCurrentCheckoutPrBench, false);
	assert.equal(context.benches.targetPr, 2000);
	assert.equal(context.benches.targetBranchName, "pr-2000");
	assert.equal(context.artifacts.targetReportsDir, "/var/lib/maglev-pr-maintainer/benches/pr-2000/reports");
});

test("buildWorkspaceContext honors OBA_WORKSPACE for Maglev source", () => {
	const context = buildWorkspaceContext({}, { ...paths, obaWorkspace: "/custom/oba" });
	assert.equal(context.maglevCheckout.path, "/custom/oba/maglev");
});

test("generated scripts use the configured shared root, independently of Bench", () => {
	const context = buildWorkspaceContext({ pr: 7 }, { ...paths, maintainerRoot: "/custom/maintainer" });
	assert.equal(context.artifacts.generatedScriptsDir, "/custom/maintainer/scripts");
	assert.match(context.conventions.generatedScripts, /0755/);
	assert.equal(buildWorkspaceContext({}, paths).artifacts.generatedScriptsDir, "/var/lib/maglev-pr-maintainer/scripts");
});

test("formatWorkspaceContext summarizes key paths", () => {
	const text = formatWorkspaceContext(buildWorkspaceContext({ pr: 7, cwd: "/workspace/maglev" }, paths));

	assert.match(text, /Maglev PR Maintainer workspace context/);
	assert.match(text, /Target PR: #7/);
	assert.match(text, /Target reports: \/var\/lib\/maglev-pr-maintainer\/benches\/pr-7\/reports/);
	assert.match(text, /Snapshot: \/var\/lib\/maglev-pr-maintainer\/state\/github-snapshot.json/);
	assert.match(text, /Generated scripts dir: \/var\/lib\/maglev-pr-maintainer\/scripts/);
	assert.match(text, /Companion repos dir: \/var\/lib\/maglev-pr-maintainer\/companion-repos/);
});
