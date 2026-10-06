import { DECISIONS_FILE, SNAPSHOT_FILE } from "./paths.ts";
import { loadDecisionsFromFile, loadSnapshotFromFile, loadSnapshotOptionalFromFile, writeDecisionsToFile } from "./state-core.ts";
import type { DecisionsFile, SnapshotFile } from "./types.ts";

export async function loadSnapshot(): Promise<SnapshotFile> {
	return loadSnapshotFromFile(SNAPSHOT_FILE);
}

export async function loadSnapshotOptional(): Promise<{ snapshot?: SnapshotFile; warning?: string }> {
	return loadSnapshotOptionalFromFile(SNAPSHOT_FILE);
}

export async function loadDecisions() {
	return loadDecisionsFromFile(DECISIONS_FILE);
}

export async function writeDecisions(file: DecisionsFile): Promise<void> {
	await writeDecisionsToFile(DECISIONS_FILE, file);
}
