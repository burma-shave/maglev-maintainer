import { SNAPSHOT_STALE_AFTER_HOURS } from "./constants.ts";
import type { SnapshotFile } from "./types.ts";

export type SnapshotStalenessStatus = "fresh" | "stale" | "missing" | "invalid";

export interface SnapshotStalenessInput {
	snapshot?: SnapshotFile;
	warning?: string;
	now?: string;
	snapshotFile?: string;
}

export interface SnapshotStalenessResult {
	status: SnapshotStalenessStatus;
	fresh: boolean;
	stale: boolean;
	shouldRefresh: boolean;
	maxAgeHours: number;
	now: string;
	snapshotFile?: string;
	fetchedAt?: string;
	ageHours?: number;
	warning?: string;
}

function snapshotAgeHours(fetchedAt: string, now: string): number | undefined {
	const fetchedMs = Date.parse(fetchedAt);
	const nowMs = Date.parse(now);
	if (!Number.isFinite(fetchedMs) || !Number.isFinite(nowMs)) return undefined;
	return (nowMs - fetchedMs) / (60 * 60 * 1000);
}

export function computeSnapshotStaleness(input: SnapshotStalenessInput): SnapshotStalenessResult {
	const now = input.now ?? new Date().toISOString();
	const base = {
		maxAgeHours: SNAPSHOT_STALE_AFTER_HOURS,
		now,
		snapshotFile: input.snapshotFile,
	};

	if (!input.snapshot) {
		return {
			...base,
			status: "missing",
			fresh: false,
			stale: true,
			shouldRefresh: true,
			warning: input.warning ?? "No Maglev PR GitHub snapshot is available.",
		};
	}

	const ageHours = snapshotAgeHours(input.snapshot.fetchedAt, now);
	if (ageHours === undefined) {
		return {
			...base,
			status: "invalid",
			fresh: false,
			stale: true,
			shouldRefresh: true,
			fetchedAt: input.snapshot.fetchedAt,
			warning: `Snapshot fetchedAt is not a valid timestamp: ${input.snapshot.fetchedAt}`,
		};
	}

	const stale = ageHours > SNAPSHOT_STALE_AFTER_HOURS;
	return {
		...base,
		status: stale ? "stale" : "fresh",
		fresh: !stale,
		stale,
		shouldRefresh: stale,
		fetchedAt: input.snapshot.fetchedAt,
		ageHours,
	};
}

export async function checkSnapshotStaleness(deps: {
	loadSnapshotOptional: () => Promise<{ snapshot?: SnapshotFile; warning?: string }>;
	now?: () => Date;
	snapshotFile?: string;
}): Promise<SnapshotStalenessResult> {
	const result = await deps.loadSnapshotOptional();
	return computeSnapshotStaleness({
		...result,
		now: (deps.now?.() ?? new Date()).toISOString(),
		snapshotFile: deps.snapshotFile,
	});
}

export function formatSnapshotStaleness(result: SnapshotStalenessResult): string {
	const threshold = `${result.maxAgeHours}h`;
	if (result.status === "missing") return `Snapshot: missing/stale • refresh required • threshold ${threshold}${result.warning ? ` • ${result.warning}` : ""}`;
	if (result.status === "invalid") return `Snapshot: invalid/stale • refresh required • threshold ${threshold}${result.warning ? ` • ${result.warning}` : ""}`;
	const age = result.ageHours === undefined ? "unknown age" : `${result.ageHours.toFixed(1)}h old`;
	return result.stale
		? `Snapshot: stale • fetched ${result.fetchedAt} • ${age} > ${threshold} • refresh required`
		: `Snapshot: fresh • fetched ${result.fetchedAt} • ${age} <= ${threshold}`;
}
