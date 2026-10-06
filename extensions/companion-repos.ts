import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CompanionRepoInputName = "wayfinder" | "js-sdk" | "onebusaway-ios" | "onebusaway-android" | "onebusaway-application-modules" | "oba-java" | "maglev.wiki";
export type CompanionRepoCanonicalName = "wayfinder" | "js-sdk" | "onebusaway-ios" | "onebusaway-android" | "onebusaway-application-modules" | "maglev.wiki";
export type CompanionRepoSource = "OBA_WORKSPACE" | "maintainer-root";
export type CompanionRepoSeverity = "note" | "warning" | "error";

export interface CompanionRepoDefinition {
	inputName: CompanionRepoInputName;
	name: CompanionRepoCanonicalName;
	url: string;
	referenceOnly: boolean;
}

export interface CompanionRepoAnomaly {
	severity: CompanionRepoSeverity;
	message: string;
}

export interface CompanionRepoResult {
	inputName: CompanionRepoInputName;
	name: CompanionRepoCanonicalName;
	url: string;
	path: string;
	source: CompanionRepoSource;
	referenceOnly: boolean;
	ok: boolean;
	cloned: boolean;
	updated: boolean;
	branch?: string;
	head?: string;
	dirty?: boolean;
	anomalies: CompanionRepoAnomaly[];
}

export interface ResolveCompanionReposInput {
	repos?: CompanionRepoInputName[];
}

export interface ResolveCompanionReposOptions {
	companionReposDir: string;
	obaWorkspace?: string;
}

export interface GitResult {
	ok: boolean;
	stdout: string;
	stderr: string;
}

export interface ResolveCompanionReposDeps {
	exists?: (path: string) => boolean;
	mkdir?: (path: string) => Promise<void>;
	runGit?: (args: string[]) => Promise<GitResult>;
}

const DEFINITIONS: Record<CompanionRepoInputName, CompanionRepoDefinition> = {
	wayfinder: { inputName: "wayfinder", name: "wayfinder", url: "https://github.com/onebusaway/wayfinder.git", referenceOnly: true },
	"js-sdk": { inputName: "js-sdk", name: "js-sdk", url: "https://github.com/onebusaway/js-sdk.git", referenceOnly: true },
	"onebusaway-ios": { inputName: "onebusaway-ios", name: "onebusaway-ios", url: "https://github.com/onebusaway/onebusaway-ios.git", referenceOnly: true },
	"onebusaway-android": { inputName: "onebusaway-android", name: "onebusaway-android", url: "https://github.com/onebusaway/onebusaway-android.git", referenceOnly: true },
	"onebusaway-application-modules": { inputName: "onebusaway-application-modules", name: "onebusaway-application-modules", url: "https://github.com/onebusaway/onebusaway-application-modules.git", referenceOnly: true },
	"oba-java": { inputName: "oba-java", name: "onebusaway-application-modules", url: "https://github.com/onebusaway/onebusaway-application-modules.git", referenceOnly: true },
	"maglev.wiki": { inputName: "maglev.wiki", name: "maglev.wiki", url: "https://github.com/onebusaway/maglev.wiki.git", referenceOnly: false },
};

export const ALL_COMPANION_REPOS: CompanionRepoInputName[] = ["wayfinder", "js-sdk", "onebusaway-ios", "onebusaway-android", "onebusaway-application-modules", "maglev.wiki"];

function normalizeGitUrl(value: string): string {
	let normalized = value.trim().replace(/\.git$/, "").replace(/\/$/, "").toLowerCase();
	if (normalized.startsWith("git@github.com:")) normalized = `github.com/${normalized.slice("git@github.com:".length)}`;
	else if (normalized.startsWith("ssh://git@github.com/")) normalized = `github.com/${normalized.slice("ssh://git@github.com/".length)}`;
	else if (normalized.startsWith("https://github.com/")) normalized = `github.com/${normalized.slice("https://github.com/".length)}`;
	else if (normalized.startsWith("http://github.com/")) normalized = `github.com/${normalized.slice("http://github.com/".length)}`;
	else if (normalized.startsWith("git://github.com/")) normalized = `github.com/${normalized.slice("git://github.com/".length)}`;
	return normalized;
}

async function defaultRunGit(args: string[]): Promise<GitResult> {
	try {
		const { stdout, stderr } = await execFileAsync("git", args, { maxBuffer: 20 * 1024 * 1024 });
		return { ok: true, stdout, stderr };
	} catch (err) {
		const error = err as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
		return {
			ok: false,
			stdout: String(error.stdout ?? ""),
			stderr: String(error.stderr ?? error.message ?? ""),
		};
	}
}

function repoTarget(definition: CompanionRepoDefinition, options: ResolveCompanionReposOptions): { path: string; source: CompanionRepoSource } {
	if (options.obaWorkspace) return { path: join(options.obaWorkspace, definition.name), source: "OBA_WORKSPACE" };
	return { path: join(options.companionReposDir, definition.name), source: "maintainer-root" };
}

async function gitField(runGit: (args: string[]) => Promise<GitResult>, path: string, args: string[]): Promise<string | undefined> {
	const result = await runGit(["-C", path, ...args]);
	return result.ok ? result.stdout.trim() || undefined : undefined;
}

async function inspectRepoState(runGit: (args: string[]) => Promise<GitResult>, target: string, result: CompanionRepoResult): Promise<void> {
	result.branch = await gitField(runGit, target, ["symbolic-ref", "--short", "HEAD"]);
	result.head = await gitField(runGit, target, ["rev-parse", "HEAD"]);
	const status = await gitField(runGit, target, ["status", "--porcelain"]);
	result.dirty = Boolean(status);
}

async function validateCheckout(definition: CompanionRepoDefinition, target: string, runGit: (args: string[]) => Promise<GitResult>, anomalies: CompanionRepoAnomaly[]): Promise<boolean> {
	const topLevel = await runGit(["-C", target, "rev-parse", "--show-toplevel"]);
	if (!topLevel.ok) {
		anomalies.push({ severity: "error", message: `${target} exists but is not a git checkout.` });
		return false;
	}
	const origin = await runGit(["-C", target, "config", "--get", "remote.origin.url"]);
	const actual = normalizeGitUrl(origin.stdout);
	const expected = normalizeGitUrl(definition.url);
	if (actual !== expected) {
		anomalies.push({ severity: "error", message: `${target} origin is ${origin.stdout.trim() || "unset"}, expected ${definition.url}.` });
		return false;
	}
	return true;
}

async function updateReferenceCheckout(definition: CompanionRepoDefinition, target: string, runGit: (args: string[]) => Promise<GitResult>, result: CompanionRepoResult): Promise<void> {
	if (!result.branch) {
		result.anomalies.push({ severity: "warning", message: `Reference repo ${definition.name} is in a detached HEAD state; not pulling automatically.` });
		return;
	}
	if (result.branch !== "main" && result.branch !== "master") {
		result.anomalies.push({ severity: "warning", message: `Reference repo ${definition.name} is on branch ${result.branch}, not main/master; not pulling automatically.` });
		return;
	}
	if (result.dirty) {
		result.anomalies.push({ severity: "warning", message: `Reference repo ${definition.name} has local changes; not pulling automatically.` });
		return;
	}
	const pull = await runGit(["-C", target, "pull", "--ff-only", "--quiet", "origin", result.branch]);
	if (pull.ok) {
		result.updated = true;
		await inspectRepoState(runGit, target, result);
	} else {
		result.anomalies.push({ severity: "warning", message: `Failed to fast-forward reference repo ${definition.name}: ${pull.stderr.trim() || "git pull failed"}` });
	}
}

async function checkEditableFreshness(definition: CompanionRepoDefinition, target: string, runGit: (args: string[]) => Promise<GitResult>, result: CompanionRepoResult): Promise<void> {
	if (!result.branch) {
		result.anomalies.push({ severity: "note", message: `${definition.name} is in a detached HEAD state; skipping freshness check.` });
		return;
	}
	const fetch = await runGit(["-C", target, "fetch", "--quiet", "origin", result.branch]);
	if (!fetch.ok) {
		result.anomalies.push({ severity: "note", message: `Could not fetch to check freshness of ${definition.name}; offline, or no matching upstream branch.` });
		return;
	}
	const upstream = `refs/remotes/origin/${result.branch}`;
	const verify = await runGit(["-C", target, "rev-parse", "--verify", "--quiet", upstream]);
	if (!verify.ok) {
		result.anomalies.push({ severity: "note", message: `No origin/${result.branch} ref found for ${definition.name}; freshness could not be confirmed.` });
		return;
	}
	const counts = await runGit(["-C", target, "rev-list", "--left-right", "--count", `HEAD...${upstream}`]);
	const [ahead, behind] = counts.stdout.trim().split(/\s+/);
	if (counts.ok && (ahead !== "0" || behind !== "0")) {
		result.anomalies.push({ severity: "warning", message: `${definition.name} differs from origin/${result.branch} (ahead: ${ahead ?? "?"}, behind: ${behind ?? "?"}). Editable checkout was not updated automatically.` });
	}
}

export async function resolveCompanionRepo(name: CompanionRepoInputName, options: ResolveCompanionReposOptions, deps: ResolveCompanionReposDeps = {}): Promise<CompanionRepoResult> {
	const definition = DEFINITIONS[name];
	if (!definition) throw new Error(`Unknown OBA companion repo: ${name}`);
	const exists = deps.exists ?? existsSync;
	const runGit = deps.runGit ?? defaultRunGit;
	const mkdirp = deps.mkdir ?? ((path: string) => mkdir(path, { recursive: true }));
	const target = repoTarget(definition, options);
	const result: CompanionRepoResult = {
		inputName: name,
		name: definition.name,
		url: definition.url,
		path: target.path,
		source: target.source,
		referenceOnly: definition.referenceOnly,
		ok: true,
		cloned: false,
		updated: false,
		anomalies: [],
	};

	if (!exists(join(target.path, ".git"))) {
		if (exists(target.path)) {
			result.ok = false;
			result.anomalies.push({ severity: "error", message: `${target.path} exists but does not look like a git checkout.` });
			return result;
		}
		await mkdirp(dirname(target.path));
		const clone = await runGit(["clone", "--depth", "1", definition.url, target.path]);
		if (!clone.ok) {
			result.ok = false;
			result.anomalies.push({ severity: "error", message: `Failed to clone ${definition.name}: ${clone.stderr.trim() || "git clone failed"}` });
			return result;
		}
		result.cloned = true;
	}

	if (!(await validateCheckout(definition, target.path, runGit, result.anomalies))) {
		result.ok = false;
		return result;
	}
	await inspectRepoState(runGit, target.path, result);
	if (definition.referenceOnly) await updateReferenceCheckout(definition, target.path, runGit, result);
	else await checkEditableFreshness(definition, target.path, runGit, result);
	if (result.anomalies.some((anomaly) => anomaly.severity === "error")) result.ok = false;
	return result;
}

export async function resolveCompanionRepos(input: ResolveCompanionReposInput, options: ResolveCompanionReposOptions, deps: ResolveCompanionReposDeps = {}) {
	const requested = input.repos?.length ? input.repos : ALL_COMPANION_REPOS;
	const repos: CompanionRepoResult[] = [];
	for (const repo of requested) repos.push(await resolveCompanionRepo(repo, options, deps));
	return {
		companionReposDir: options.companionReposDir,
		obaWorkspace: options.obaWorkspace,
		repos,
		ok: repos.every((repo) => repo.ok),
	};
}

export function formatCompanionReposReport(result: Awaited<ReturnType<typeof resolveCompanionRepos>>): string {
	const lines = [`Resolved ${result.repos.length} OBA companion repo${result.repos.length === 1 ? "" : "s"}.`];
	for (const repo of result.repos) {
		const flags = [repo.referenceOnly ? "reference-only" : "editable", repo.cloned ? "cloned" : undefined, repo.updated ? "updated" : undefined, repo.dirty ? "dirty" : undefined, repo.ok ? undefined : "error"].filter(Boolean).join(", ");
		lines.push(`- ${repo.inputName} → ${repo.path} (${repo.source}${flags ? `; ${flags}` : ""})`);
		for (const anomaly of repo.anomalies) lines.push(`  ${anomaly.severity}: ${anomaly.message}`);
	}
	return lines.join("\n");
}
