import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { REPO } from "./constants.ts";
import { BENCH_STATE_DIR } from "./paths.ts";
import { atomicWriteJson, isNotFoundError } from "./utils.ts";

/** Identity is independent of the checked-out branch and optional PR association. */
export interface BenchDefinition {
	id: string;
	repo: string;
	branchName: string;
	pr?: number;
	createFrom?: string;
}

export function validBenchId(id: string): boolean {
	return /^(?:pr-[1-9]\d*|branch-[a-z0-9][a-z0-9-]*-[a-f0-9]{12})$/.test(id);
}

export function validBranchName(branch: string): boolean {
	return !!branch && branch !== "HEAD" && !branch.startsWith("-") && !branch.startsWith("/") && !branch.endsWith("/")
		&& !branch.endsWith(".") && !/[\s~^:?*\[\\\x00-\x1f\x7f]/.test(branch) && !branch.includes("..")
		&& !branch.includes("@{") && !branch.includes("//") && branch !== "@"
		&& branch.split("/").every((part) => !part.startsWith(".") && !part.endsWith(".lock"));
}

export function branchBenchDefinition(branchName: string, createFrom?: string): BenchDefinition {
	if (!validBranchName(branchName)) throw new Error(`Invalid branch name: ${branchName}`);
	if (createFrom !== undefined && (!createFrom.trim() || createFrom.startsWith("-") || /[\s\x00-\x1f]/.test(createFrom))) throw new Error("Invalid base ref.");
	const slug = branchName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "branch";
	const hash = createHash("sha256").update(`${REPO}\0${branchName}`).digest("hex").slice(0, 12);
	return { id: `branch-${slug}-${hash}`, repo: REPO, branchName, ...(createFrom ? { createFrom } : {}) };
}

export function prBenchDefinition(pr: number): BenchDefinition {
	if (!Number.isSafeInteger(pr) || pr < 1) throw new Error("Invalid PR number.");
	return { id: `pr-${pr}`, repo: REPO, branchName: `pr-${pr}`, pr };
}

export function validateBenchDefinition(value: unknown): BenchDefinition {
	const bench = value as BenchDefinition;
	if (!bench || !validBenchId(bench.id) || bench.repo !== REPO || !validBranchName(bench.branchName)
		|| (bench.pr !== undefined && (!Number.isSafeInteger(bench.pr) || bench.pr < 1))) throw new Error("Invalid bench manifest.");
	if (bench.id.startsWith("pr-") && (bench.id !== `pr-${bench.pr}` || bench.branchName !== bench.id)) throw new Error("PR bench identity mismatch.");
	if (bench.id.startsWith("branch-") && branchBenchDefinition(bench.branchName, bench.createFrom).id !== bench.id) throw new Error("Branch bench identity mismatch.");
	return bench;
}

export async function loadBenchDefinitions(stateDir = BENCH_STATE_DIR): Promise<BenchDefinition[]> {
	let entries;
	try { entries = await readdir(stateDir, { withFileTypes: true }); }
	catch (err) { if (isNotFoundError(err)) return []; throw err; }
	const benches: BenchDefinition[] = [];
	for (const entry of entries) {
		if (!validBenchId(entry.name)) continue;
		if (entry.isSymbolicLink()) throw new Error(`Bench state directory is a symlink: ${entry.name}`);
		if (!entry.isDirectory()) continue;
		try {
			const bench = validateBenchDefinition(JSON.parse(await readFile(join(stateDir, entry.name, "bench.json"), "utf8")));
			if (bench.id !== entry.name) throw new Error(`Bench manifest/path mismatch: ${entry.name}`);
			benches.push(bench);
		} catch (err) {
			if (isNotFoundError(err)) continue;
			throw new Error(`Cannot load Bench ${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	const prs = benches.flatMap((bench) => bench.pr === undefined ? [] : [bench.pr]);
	if (new Set(prs).size !== prs.length) throw new Error("Multiple benches are associated with the same PR.");
	return benches;
}

export async function saveBenchDefinition(bench: BenchDefinition, stateDir = BENCH_STATE_DIR): Promise<void> {
	validateBenchDefinition(bench);
	try {
		if ((await lstat(join(stateDir, bench.id))).isSymbolicLink()) throw new Error("Bench state directory is a symlink.");
	} catch (err) { if (!isNotFoundError(err)) throw err; }
	await atomicWriteJson(join(stateDir, bench.id, "bench.json"), bench);
}
