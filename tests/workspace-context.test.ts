import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceContext, formatWorkspaceContext } from "../extensions/workspace-context.ts";

const paths = {
	maintainerRoot: "/var/lib/maglev-maintainer",
	stateDir: "/var/lib/maglev-maintainer/state",
	snapshotFile: "/var/lib/maglev-maintainer/state/github-snapshot.json",
	decisionsFile: "/var/lib/maglev-maintainer/state/decisions.json",
	benchStateDir: "/var/lib/maglev-maintainer/benches",
	checkoutDir: "/var/lib/maglev-maintainer/checkouts",
	reviewJsonDir: "/var/lib/maglev-maintainer/review-json",
	companionReposDir: "/var/lib/maglev-maintainer/companion-repos",
};

test("buildWorkspaceContext detects current PR Bench from cwd", () => {
	const context = buildWorkspaceContext({ cwd: "/var/lib/maglev-maintainer/checkouts/pr-1416/internal/restapi" }, paths);

	assert.equal(context.schemaVersion, 1);
	assert.equal(context.maglevCheckout.path, "/var/lib/maglev-maintainer/checkouts/maglev");
	assert.equal(context.package.name, "maglev-maintainer");
	assert.equal(context.package.rootEnvVar, "MAGLEV_MAINTAINER_ROOT");
	assert.equal(context.package.triageAgent, "maglev-maintainer.pr-triage-analyst");
	assert.equal(context.package.statusCommand, "maglev-maintainer-status");
	assert.equal(context.maglevCheckout.resolverTool, "maglev_checkout");
	assert.equal(context.capabilities.checkoutTool, "maglev_checkout");
	assert.equal(context.capabilities.workspaceContextTool, "maglev_workspace_context");
	assert.equal(context.capabilities.benchResolvePrTool, "maglev_bench_resolve_pr");
	assert.equal(context.capabilities.benchStartTool, "maglev_bench_start");
	assert.equal(context.capabilities.benchInspectTool, "maglev_bench_inspect");
	assert.equal(context.capabilities.benchCloseTool, "maglev_bench_close");
	assert.equal(context.capabilities.benchResetTool, "maglev_bench_reset");
	assert.ok(!("generalBenchStartTool" in context.capabilities));
	assert.equal(context.capabilities.companionReposTool, "maglev_companion_repos_resolve");
	assert.equal(context.capabilities.reviewInstructionsLoadTool, "maglev_pr_review_instructions_load");
	assert.equal(context.capabilities.reviewDraftSaveTool, "maglev_pr_review_draft_save");
	assert.equal(context.capabilities.reviewDraftClearTool, "maglev_pr_review_draft_clear");
	assert.equal(context.capabilities.reviewDraftListTool, "maglev_pr_review_draft_list");
	assert.equal(context.capabilities.reviewDraftLoadTool, "maglev_pr_review_draft_load");
	assert.ok(!("benchKickoffTool" in context.capabilities));
	assert.ok(!("reviewJsonTool" in context.capabilities));
	assert.ok(!("reviewJsonLoadTool" in context.capabilities));
	assert.equal(context.benches.currentPr, 1416);
	assert.equal(context.benches.isCurrentCheckoutPrBench, true);
	assert.equal(context.benches.currentCheckoutPath, "/var/lib/maglev-maintainer/checkouts/pr-1416");
	assert.equal(context.benches.targetPr, 1416);
	assert.equal(context.benches.targetCheckoutPath, "/var/lib/maglev-maintainer/checkouts/pr-1416");
	assert.equal(context.benches.targetBenchStateDir, "/var/lib/maglev-maintainer/benches/pr-1416");
	assert.equal(context.artifacts.targetReportsDir, "/var/lib/maglev-maintainer/benches/pr-1416/reports");
	assert.equal(context.companionRepos.companionReposDir, "/var/lib/maglev-maintainer/companion-repos");
	assert.equal(context.runtimes.runtimeDir, "/var/lib/maglev-maintainer/runtimes");
	assert.equal(context.capabilities.apiStartTool, "maglev_api_runtime_start");
	assert.equal(context.capabilities.apiStopTool, "maglev_api_runtime_stop");
	assert.equal(context.capabilities.apiStatusTool, "maglev_api_runtime_status");
});

test("buildWorkspaceContext allows explicit target PR outside a PR Bench", () => {
	const context = buildWorkspaceContext({ pr: 2000, cwd: "/workspace/maglev" }, paths);

	assert.equal(context.benches.currentPr, undefined);
	assert.equal(context.benches.isCurrentCheckoutPrBench, false);
	assert.equal(context.benches.targetPr, 2000);
	assert.equal(context.benches.targetBranchName, "pr-2000");
	assert.equal(context.artifacts.targetReportsDir, "/var/lib/maglev-maintainer/benches/pr-2000/reports");
});

test("buildWorkspaceContext honors OBA_WORKSPACE for Maglev source", () => {
	const context = buildWorkspaceContext({}, { ...paths, obaWorkspace: "/custom/oba" });
	assert.equal(context.maglevCheckout.path, "/custom/oba/maglev");
});

test("generated scripts use the configured shared root, independently of Bench", () => {
	const context = buildWorkspaceContext({ pr: 7 }, { ...paths, maintainerRoot: "/custom/maintainer" });
	assert.equal(context.artifacts.generatedScriptsDir, "/custom/maintainer/scripts");
	assert.match(context.conventions.generatedScripts, /0755/);
	assert.match(context.conventions.generatedScripts, /Human execution performs listed writes immediately/);
	assert.match(context.conventions.generatedScripts, /generation never authorizes execution/);
	assert.match(context.conventions.generatedReports, /Without a target Bench, use <maintainerRoot>\/plans/);
	assert.equal(buildWorkspaceContext({}, paths).artifacts.generatedScriptsDir, "/var/lib/maglev-maintainer/scripts");
});

test("formatWorkspaceContext summarizes key paths", () => {
	const text = formatWorkspaceContext(buildWorkspaceContext({ pr: 7, cwd: "/workspace/maglev" }, paths));

	assert.match(text, /Maglev Maintainer workspace context/);
	assert.match(text, /Target PR: #7/);
	assert.match(text, /Target reports: \/var\/lib\/maglev-maintainer\/benches\/pr-7\/reports/);
	assert.match(text, /Snapshot: \/var\/lib\/maglev-maintainer\/state\/github-snapshot.json/);
	assert.match(text, /Generated scripts dir: \/var\/lib\/maglev-maintainer\/scripts/);
	assert.match(text, /Companion repos dir: \/var\/lib\/maglev-maintainer\/companion-repos/);
});
