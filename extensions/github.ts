import { REPO, SNAPSHOT_SCHEMA_VERSION } from "./constants.ts";
import { addStackMetadata, snapshotFromGh } from "./github-core.ts";
import type { GhPR, GhPRListItem, SnapshotFile, SnapshotPR } from "./types.ts";

export interface RefreshMetadataInput {
	repo?: string;
	limit?: number;
}

export interface RefreshMetadataDeps {
	runJson: <T>(cmd: string, args: string[]) => Promise<T>;
	writeSnapshot: (snapshot: SnapshotFile) => Promise<void>;
	now?: () => Date;
}

export async function refreshMetadata(params: RefreshMetadataInput, deps: RefreshMetadataDeps): Promise<SnapshotFile> {
	const repo = params.repo?.trim() || REPO;
	const limit = params.limit ?? 200;
	const list = await deps.runJson<GhPRListItem[]>("gh", ["pr", "list", "--repo", repo, "--state", "open", "--limit", String(limit), "--json", "number,headRefName"]);
	const pullRequests: SnapshotPR[] = [];
	for (const item of list) {
		const gh = await deps.runJson<GhPR>("gh", [
			"pr",
			"view",
			String(item.number),
			"--repo",
			repo,
			"--json",
			"number,title,author,url,isDraft,baseRefName,headRefName,headRefOid,headRepositoryOwner,headRepository,createdAt,updatedAt,state,closedAt,mergedAt,reviewDecision,mergeStateStatus,reviews,comments,commits,statusCheckRollup,files",
		]);
		pullRequests.push(snapshotFromGh(gh));
	}
	const snapshot: SnapshotFile = {
		schemaVersion: SNAPSHOT_SCHEMA_VERSION,
		repo,
		fetchedAt: (deps.now?.() ?? new Date()).toISOString(),
		pullRequests: addStackMetadata(pullRequests).sort((a, b) => a.number - b.number),
	};
	await deps.writeSnapshot(snapshot);
	return snapshot;
}

export { addStackMetadata, snapshotFromGh } from "./github-core.ts";
