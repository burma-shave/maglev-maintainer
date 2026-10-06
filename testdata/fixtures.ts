import type { BenchState, DecisionsFile, GhPR, SnapshotFile, SnapshotPR, TriageDecision } from "../extensions/types.ts";

export function makeGhPr(overrides: Partial<GhPR> = {}): GhPR {
	return {
		number: overrides.number ?? 100,
		title: overrides.title ?? "Improve routing",
		author: overrides.author ?? { login: "alice" },
		url: overrides.url ?? `https://github.com/OneBusAway/maglev/pull/${overrides.number ?? 100}`,
		isDraft: overrides.isDraft ?? false,
		baseRefName: overrides.baseRefName ?? "main",
		headRefName: overrides.headRefName ?? "feature-routing",
		headRepositoryOwner: overrides.headRepositoryOwner ?? { login: "OneBusAway" },
		headRepository: overrides.headRepository ?? { name: "maglev", nameWithOwner: "OneBusAway/maglev", url: "https://github.com/OneBusAway/maglev" },
		createdAt: overrides.createdAt ?? "2026-01-01T00:00:00Z",
		updatedAt: overrides.updatedAt ?? "2026-01-08T00:00:00Z",
		state: overrides.state ?? "OPEN",
		closedAt: overrides.closedAt,
		mergedAt: overrides.mergedAt,
		reviewDecision: overrides.reviewDecision,
		mergeStateStatus: overrides.mergeStateStatus,
		reviews: overrides.reviews ?? [],
		comments: overrides.comments ?? [],
		commits: overrides.commits ?? [],
		statusCheckRollup: overrides.statusCheckRollup ?? [],
		files: overrides.files ?? [],
	};
}

export function makeSnapshotPr(overrides: Partial<SnapshotPR> & Pick<SnapshotPR, "number">): SnapshotPR {
	return {
		number: overrides.number,
		title: overrides.title ?? `PR ${overrides.number}`,
		author: overrides.author ?? "contributor",
		url: overrides.url ?? `https://github.com/OneBusAway/maglev/pull/${overrides.number}`,
		isDraft: overrides.isDraft ?? false,
		baseRefName: overrides.baseRefName ?? "main",
		headRefName: overrides.headRefName ?? `feature-${overrides.number}`,
		headRepositoryOwner: overrides.headRepositoryOwner ?? "OneBusAway",
		headRepositoryName: overrides.headRepositoryName ?? "maglev",
		headRepositoryNameWithOwner: overrides.headRepositoryNameWithOwner ?? "OneBusAway/maglev",
		headRepositoryUrl: overrides.headRepositoryUrl ?? "https://github.com/OneBusAway/maglev",
		stackBasePR: overrides.stackBasePR,
		stackChildren: overrides.stackChildren,
		state: overrides.state ?? "OPEN",
		closedAt: overrides.closedAt,
		mergedAt: overrides.mergedAt,
		createdAt: overrides.createdAt ?? "2026-01-01T00:00:00Z",
		updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00Z",
		meaningfulUpdatedAt: overrides.meaningfulUpdatedAt ?? "2026-01-01T00:00:00Z",
		reviewDecision: overrides.reviewDecision ?? "",
		mergeStateStatus: overrides.mergeStateStatus ?? "CLEAN",
		badChecks: overrides.badChecks ?? [],
		headOid: overrides.headOid,
		commitSummary: overrides.commitSummary ?? { count: 0 },
		commits: overrides.commits ?? [],
		reviews: overrides.reviews ?? [],
		comments: overrides.comments ?? [],
		files: overrides.files ?? [],
		lastCommit: overrides.lastCommit,
		lastHumanReview: overrides.lastHumanReview,
		lastChangeRequest: overrides.lastChangeRequest,
		lastCodeRabbitReview: overrides.lastCodeRabbitReview,
		lastHumanComment: overrides.lastHumanComment,
		lastChase: overrides.lastChase,
	};
}

export function makeSnapshotFile(pullRequests: SnapshotPR[], overrides: Partial<SnapshotFile> = {}): SnapshotFile {
	return {
		schemaVersion: overrides.schemaVersion ?? 1,
		repo: overrides.repo ?? "OneBusAway/maglev",
		fetchedAt: overrides.fetchedAt ?? "2026-01-10T00:00:00Z",
		pullRequests,
	};
}

export function makeDecision(pr: number, overrides: Partial<TriageDecision> = {}): TriageDecision {
	return {
		pr,
		bucket: overrides.bucket ?? "watch",
		priority: overrides.priority,
		reason: overrides.reason ?? "wait",
		observations: overrides.observations,
		decidedAt: overrides.decidedAt ?? "2026-01-02T00:00:00Z",
		source: overrides.source ?? "skill",
		basis: overrides.basis,
	};
}

export function makeDecisionsFile(decisions: TriageDecision[], overrides: Partial<DecisionsFile> = {}): DecisionsFile {
	return {
		schemaVersion: overrides.schemaVersion ?? 1,
		repo: overrides.repo ?? "OneBusAway/maglev",
		updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00Z",
		decisions,
	};
}

export function makeBenchState(overrides: Partial<BenchState> = {}): BenchState {
	const pr = overrides.pr ?? 1416;
	return {
		pr,
		branchName: overrides.branchName ?? `pr-${pr}`,
		sessionName: overrides.sessionName ?? `pr-${pr}`,
		benchPath: overrides.benchPath,
		branchExists: overrides.branchExists ?? true,
		checkoutExists: overrides.checkoutExists ?? overrides.worktreeRegistered ?? true,
		checkoutKind: overrides.checkoutKind ?? "plain",
		worktreeRegistered: overrides.worktreeRegistered ?? false,
		tmuxExists: overrides.tmuxExists ?? true,
		tmuxPath: overrides.tmuxPath,
		tmuxPaneCommand: overrides.tmuxPaneCommand,
		tmuxPanePath: overrides.tmuxPanePath,
		piWindowExists: overrides.piWindowExists,
		piWindowPaneCommand: overrides.piWindowPaneCommand,
		piWindowPanePath: overrides.piWindowPanePath,
		localHead: overrides.localHead,
		localHeadShort: overrides.localHeadShort,
		dirty: overrides.dirty,
		dirtyStatus: overrides.dirtyStatus,
		dirtyFiles: overrides.dirtyFiles,
		freshness: overrides.freshness ?? "unknown",
		fresh: overrides.fresh,
		snapshotHeadOid: overrides.snapshotHeadOid,
		title: overrides.title,
		author: overrides.author,
		url: overrides.url,
		warnings: overrides.warnings ?? [],
	};
}
