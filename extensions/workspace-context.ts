import { isAbsolute, join, relative, sep } from "node:path";
import { REPO } from "./constants.ts";
import { DISPLAY_NAME, PACKAGE_NAME, ROOT_ENV_VAR, INFO_COMMAND, STATUS_COMMAND, TRIAGE_AGENT } from "./identity.ts";
import { maglevCheckoutPath } from "./maglev-checkout.ts";
import { validBenchId, type BenchDefinition } from "./bench-registry.ts";

export interface WorkspaceContextInput {
	pr?: number;
	benchId?: string;
	benchDefinitions?: BenchDefinition[];
	cwd?: string;
}

export interface WorkspaceContextPaths {
	maintainerRoot: string;
	stateDir: string;
	snapshotFile: string;
	decisionsFile: string;
	benchStateDir: string;
	checkoutDir: string;
	reviewJsonDir: string;
	companionReposDir: string;
	obaWorkspace?: string;
}

function firstRelativeSegment(base: string, path: string): string | undefined {
	const rel = relative(base, path);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined;
	return rel.split(sep)[0];
}

function prFromBenchSegment(segment?: string): number | undefined {
	const match = segment?.match(/^pr-(\d+)$/);
	if (!match) return undefined;
	return Number(match[1]);
}

export function buildWorkspaceContext(input: WorkspaceContextInput, paths: WorkspaceContextPaths) {
	const cwd = input.cwd;
	const currentSegment = cwd ? firstRelativeSegment(paths.checkoutDir, cwd) : undefined;
	const definitions = input.benchDefinitions ?? [];
	const currentBenchId = currentSegment && validBenchId(currentSegment) ? currentSegment : undefined;
	const currentDefinition = definitions.find((bench) => bench.id === currentBenchId);
	const currentPr = currentDefinition?.pr ?? prFromBenchSegment(currentSegment);
	if (input.benchId && !validBenchId(input.benchId)) throw new Error("Invalid Bench ID.");
	if (input.benchId && input.pr) throw new Error("Specify benchId or pr, not both.");
	const targetDefinition = input.pr ? definitions.find((bench) => bench.pr === input.pr) : definitions.find((bench) => bench.id === (input.benchId ?? currentBenchId));
	const targetPr = input.pr ?? targetDefinition?.pr ?? (input.benchId ? prFromBenchSegment(input.benchId) : currentPr);
	const targetBenchId = targetDefinition?.id ?? input.benchId ?? (input.pr ? `pr-${input.pr}` : currentBenchId);
	const currentCheckoutPath = currentBenchId ? join(paths.checkoutDir, currentBenchId) : undefined;
	const targetCheckoutPath = targetBenchId ? join(paths.checkoutDir, targetBenchId) : undefined;
	const targetBenchStateDir = targetBenchId ? join(paths.benchStateDir, targetBenchId) : undefined;

	return {
		schemaVersion: 1,
		package: {
			name: PACKAGE_NAME,
			displayName: DISPLAY_NAME,
			rootEnvVar: ROOT_ENV_VAR,
			infoCommand: INFO_COMMAND,
			statusCommand: STATUS_COMMAND,
			triageAgent: TRIAGE_AGENT,
		},
		repo: REPO,
		cwd,
		maintainerRoot: paths.maintainerRoot,
		state: {
			stateDir: paths.stateDir,
			snapshotFile: paths.snapshotFile,
			decisionsFile: paths.decisionsFile,
		},
		benches: {
			checkoutDir: paths.checkoutDir,
			benchStateDir: paths.benchStateDir,
			currentPr,
			currentBenchId,
			currentBranchName: currentDefinition?.branchName ?? (currentPr ? `pr-${currentPr}` : undefined),
			isCurrentCheckoutBench: Boolean(currentBenchId),
			currentCheckoutPath,
			isCurrentCheckoutPrBench: Boolean(currentPr),
			targetPr,
			targetBenchId,
			targetCheckoutPath,
			targetBenchStateDir,
			targetBranchName: targetDefinition?.branchName ?? (targetPr ? `pr-${targetPr}` : undefined),
			targetTmuxSessionName: targetBenchId,
		},
		artifacts: {
			generatedScriptsDir: join(paths.maintainerRoot, "scripts"),
			reviewJsonDir: paths.reviewJsonDir,
			targetReportsDir: targetBenchStateDir ? join(targetBenchStateDir, "reports") : undefined,
		},
		maglevCheckout: {
			path: maglevCheckoutPath({ checkoutDir: paths.checkoutDir, obaWorkspace: paths.obaWorkspace }),
			resolverTool: "maglev_pr_checkout",
		},
		companionRepos: {
			companionReposDir: paths.companionReposDir,
			resolverTool: "maglev_pr_companion_repos",
		},
		runtimes: {
			runtimeDir: join(paths.maintainerRoot, "runtimes"),
			defaultMaglevPort: 4000,
			defaultLegacyPort: 8080,
		},
		capabilities: {
			apiStartTool: "maglev_pr_api_start",
			apiStopTool: "maglev_pr_api_stop",
			apiStatusTool: "maglev_pr_api_status",
			workspaceContextTool: "maglev_pr_workspace_context",
			checkoutTool: "maglev_pr_checkout",
			companionReposTool: "maglev_pr_companion_repos",
			snapshotStalenessTool: "maglev_pr_snapshot_staleness",
			refreshMetadataTool: "maglev_pr_refresh_metadata",
			loadMetadataTool: "maglev_pr_load_metadata",
			stateQueryTool: "maglev_pr_state_query",
			generalBenchListTool: "maglev_bench_list",
			generalBenchInspectTool: "maglev_bench_inspect",
			generalBenchStartTool: "maglev_bench_start",
			generalBenchCloseTool: "maglev_bench_close",
			benchAssociatePrTool: "maglev_bench_associate_pr",
			benchListTool: "maglev_pr_bench_list",
			benchInspectTool: "maglev_pr_bench_inspect",
			benchKickoffTool: "maglev_pr_bench_kickoff",
			reviewJsonTool: "maglev_pr_review_json",
			reviewJsonLoadTool: "maglev_pr_review_json_load",
			decisionsTool: "maglev_pr_decisions",
		},
		conventions: {
			prBenchNamePattern: "pr-<PR>",
			branchBenchNamePattern: "branch-<slug>-<hash>",
			generatedReports: "Use artifacts.targetReportsDir for PR or branch Bench reports and handoffs; association never changes paths. Without a target Bench, use <maintainerRoot>/plans, not checkout-local tmp. Respect explicit output destinations.",
			generatedScripts: "Store privileged handoff scripts in artifacts.generatedScriptsDir with mode 0755. Human execution performs listed writes immediately unless preview/apply gates were explicitly requested; generation never authorizes execution.",
		},
	};
}

export function formatWorkspaceContext(context: ReturnType<typeof buildWorkspaceContext>): string {
	const lines = [
		`${DISPLAY_NAME} workspace context`,
		`Repo: ${context.repo}`,
		`Maintainer root: ${context.maintainerRoot}`,
		context.cwd ? `Current directory: ${context.cwd}` : undefined,
		context.benches.currentPr ? `Current PR Bench: #${context.benches.currentPr} at ${context.benches.currentCheckoutPath}` : context.benches.currentBenchId ? `Current Bench: ${context.benches.currentBenchId} at ${context.benches.currentCheckoutPath}` : "Current Bench: not detected from cwd",
		context.benches.targetPr ? `Target PR: #${context.benches.targetPr}` : "Target PR: not set",
		context.benches.targetCheckoutPath ? `Target checkout: ${context.benches.targetCheckoutPath}` : undefined,
		context.artifacts.targetReportsDir ? `Target reports: ${context.artifacts.targetReportsDir}` : undefined,
		`Snapshot: ${context.state.snapshotFile}`,
		`Decisions: ${context.state.decisionsFile}`,
		`Review JSON dir: ${context.artifacts.reviewJsonDir}`,
		`Generated scripts dir: ${context.artifacts.generatedScriptsDir}`,
		`Maglev source checkout: ${context.maglevCheckout.path}`,
		`Companion repos dir: ${context.companionRepos.companionReposDir}`,
	].filter(Boolean);
	return lines.join("\n");
}
