import type { DecisionsFile, SnapshotFile } from "./types.ts";

export interface MaintainerStatusDeps {
	loadSnapshotOptional: () => Promise<{ snapshot?: SnapshotFile; warning?: string }>;
	loadDecisions: () => Promise<{ file: DecisionsFile; importedFromOld: false }>;
	listBenches: () => Promise<{ benches: unknown[]; snapshotWarning?: string }>;
	checkRoot: () => Promise<boolean>;
	checkGh: () => Promise<boolean>;
	checkTmux: () => Promise<boolean>;
	rootDir: string;
	snapshotFile: string;
	decisionsFile: string;
	checkoutDir: string;
}

export interface MaintainerStatus {
	root: {
		path: string;
		ok: boolean;
	};
	snapshot: {
		path: string;
		ok: boolean;
		fetchedAt?: string;
		prCount?: number;
		warning?: string;
	};
	decisions: {
		path: string;
		ok: boolean;
		count?: number;
		warning?: string;
	};
	benches: {
		checkoutDir: string;
		ok: boolean;
		count?: number;
		warning?: string;
	};
	gh: {
		ok: boolean;
	};
	tmux: {
		ok: boolean;
	};
}

export async function getMaintainerStatus(deps: MaintainerStatusDeps): Promise<MaintainerStatus> {
	const [snapshotResult, decisionsResult, benchesResult, rootOk, ghOk, tmuxOk] = await Promise.all([
		deps.loadSnapshotOptional(),
		deps.loadDecisions().then(
			(result) => ({ result }),
			(err: unknown) => ({ warning: err instanceof Error ? err.message : String(err) }),
		),
		deps.listBenches().then(
			(result) => ({ result }),
			(err: unknown) => ({ warning: err instanceof Error ? err.message : String(err) }),
		),
		deps.checkRoot(),
		deps.checkGh(),
		deps.checkTmux(),
	]);

	return {
		root: {
			path: deps.rootDir,
			ok: rootOk,
		},
		snapshot: snapshotResult.snapshot ? {
			path: deps.snapshotFile,
			ok: true,
			fetchedAt: snapshotResult.snapshot.fetchedAt,
			prCount: snapshotResult.snapshot.pullRequests.length,
		} : {
			path: deps.snapshotFile,
			ok: false,
			warning: snapshotResult.warning,
		},
		decisions: decisionsResult.result ? {
			path: deps.decisionsFile,
			ok: true,
			count: decisionsResult.result.file.decisions.length,
		} : {
			path: deps.decisionsFile,
			ok: false,
			warning: decisionsResult.warning,
		},
		benches: benchesResult.result ? {
			checkoutDir: deps.checkoutDir,
			ok: true,
			count: benchesResult.result.benches.length,
			warning: benchesResult.result.snapshotWarning,
		} : {
			checkoutDir: deps.checkoutDir,
			ok: false,
			warning: benchesResult.warning,
		},
		gh: {
			ok: ghOk,
		},
		tmux: {
			ok: tmuxOk,
		},
	};
}
