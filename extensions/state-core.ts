import { readFile } from "node:fs/promises";
import { DECISIONS_SCHEMA_VERSION, REPO, SNAPSHOT_SCHEMA_VERSION } from "./constants.ts";
import { normalizeDecision } from "./decisions.ts";
import type { DecisionsFile, SnapshotFile, TriageDecision } from "./types.ts";
import { atomicWriteJson, isNotFoundError, validIsoTimestamp } from "./utils.ts";

export async function loadSnapshotFromFile(snapshotFile: string): Promise<SnapshotFile> {
	let text: string;
	try {
		text = await readFile(snapshotFile, "utf8");
	} catch (err) {
		if (isNotFoundError(err)) throw new Error(`No Maglev PR GitHub snapshot found at ${snapshotFile}. Run maglev_pr_refresh_metadata first.`);
		throw err;
	}
	const parsed = JSON.parse(text) as SnapshotFile;
	if (parsed.schemaVersion !== SNAPSHOT_SCHEMA_VERSION || !Array.isArray(parsed.pullRequests)) {
		throw new Error(`Unsupported Maglev PR snapshot schema in ${snapshotFile}`);
	}
	return parsed;
}

export async function loadSnapshotOptionalFromFile(snapshotFile: string): Promise<{ snapshot?: SnapshotFile; warning?: string }> {
	try {
		return { snapshot: await loadSnapshotFromFile(snapshotFile) };
	} catch (err) {
		return { warning: err instanceof Error ? err.message : String(err) };
	}
}

export async function loadDecisionsFromFile(decisionsFile: string): Promise<{ file: DecisionsFile; importedFromOld: false }> {
	let fileText: string;
	try {
		fileText = await readFile(decisionsFile, "utf8");
	} catch (err) {
		if (!isNotFoundError(err)) throw err;
		return {
			file: { schemaVersion: DECISIONS_SCHEMA_VERSION, repo: REPO, updatedAt: new Date(0).toISOString(), decisions: [] },
			importedFromOld: false,
		};
	}
	const parsed = JSON.parse(fileText) as DecisionsFile;
	return {
		file: {
			schemaVersion: DECISIONS_SCHEMA_VERSION,
			repo: parsed.repo ?? REPO,
			updatedAt: validIsoTimestamp(parsed.updatedAt) ? parsed.updatedAt : new Date(0).toISOString(),
			decisions: (parsed.decisions ?? []).map((decision) => normalizeDecision(decision)).filter((decision): decision is TriageDecision => !!decision),
		},
		importedFromOld: false,
	};
}

export async function writeDecisionsToFile(decisionsFile: string, file: DecisionsFile): Promise<void> {
	const updated: DecisionsFile = {
		schemaVersion: DECISIONS_SCHEMA_VERSION,
		repo: file.repo || REPO,
		updatedAt: new Date().toISOString(),
		decisions: [...file.decisions].sort((a, b) => a.pr - b.pr),
	};
	await atomicWriteJson(decisionsFile, updated);
}
