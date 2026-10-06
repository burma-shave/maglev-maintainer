export type DecisionBucket = "review" | "chase" | "pinned" | "watch";

export interface GhPRListItem {
	number: number;
	headRefName?: string;
}

export interface GhPR {
	number: number;
	title: string;
	author?: { login?: string };
	url: string;
	isDraft?: boolean;
	baseRefName?: string;
	headRefName?: string;
	headRefOid?: string;
	headRepositoryOwner?: { login?: string };
	headRepository?: { name?: string; nameWithOwner?: string; url?: string };
	createdAt: string;
	updatedAt: string;
	state?: string;
	closedAt?: string;
	mergedAt?: string;
	reviewDecision?: string;
	mergeStateStatus?: string;
	reviews?: GhReview[];
	comments?: GhComment[];
	commits?: GhCommit[];
	statusCheckRollup?: GhCheck[];
	files?: Array<{ path: string }>;
}

export interface GhReview {
	author?: { login?: string };
	state: string;
	submittedAt: string;
	body?: string;
}

export interface GhComment {
	author?: { login?: string };
	createdAt: string;
	body?: string;
}

export interface GhCommit {
	oid: string;
	committedDate: string;
	messageHeadline: string;
}

export interface GhCheck {
	__typename: string;
	name?: string;
	context?: string;
	conclusion?: string;
	state?: string;
	status?: string;
}

export interface Activity {
	author?: string;
	at: string;
	body?: string;
	oid?: string;
	state?: string;
}

export interface SnapshotPR {
	number: number;
	title: string;
	author: string;
	url: string;
	isDraft: boolean;
	baseRefName?: string;
	headRefName?: string;
	headRepositoryOwner?: string;
	headRepositoryName?: string;
	headRepositoryNameWithOwner?: string;
	headRepositoryUrl?: string;
	stackBasePR?: number;
	stackChildren?: number[];
	state: string;
	closedAt?: string;
	mergedAt?: string;
	createdAt: string;
	updatedAt: string;
	meaningfulUpdatedAt: string;
	reviewDecision: string;
	mergeStateStatus: string;
	badChecks: string[];
	headOid?: string;
	commitSummary: {
		count: number;
		lastOid?: string;
		lastCommittedDate?: string;
		lastMessageHeadline?: string;
	};
	commits: GhCommit[];
	reviews: Array<{ author: string; state: string; submittedAt: string; body?: string }>;
	comments: Array<{ author: string; createdAt: string; body?: string }>;
	files: string[];
	lastCommit?: Activity;
	lastHumanReview?: Activity;
	lastChangeRequest?: Activity;
	lastCodeRabbitReview?: Activity;
	lastHumanComment?: Activity;
	lastChase?: Activity;
}

export interface SnapshotFile {
	schemaVersion: number;
	repo: string;
	fetchedAt: string;
	pullRequests: SnapshotPR[];
}

export interface DecisionBasis {
	snapshotFetchedAt?: string;
	meaningfulUpdatedAt?: string;
	headOid?: string;
}

export interface TriageDecision {
	pr: number;
	bucket: DecisionBucket;
	priority?: number;
	reason: string;
	observations?: string[];
	decidedAt: string;
	source: "skill" | "user" | "tool" | "migration" | string;
	basis?: DecisionBasis;
}

export interface DecisionsFile {
	schemaVersion: number;
	repo: string;
	updatedAt: string;
	decisions: TriageDecision[];
}

export interface NeedsInferenceRow {
	number: number;
	title: string;
	author: string;
	reason: string;
	meaningfulUpdatedAt: string;
	updatedAt: string;
	headOid?: string;
	decision?: TriageDecision;
}

export interface WorktreeInfo {
	path: string;
	head?: string;
	branch?: string;
}

export interface TmuxSessionInfo {
	name: string;
	path?: string;
	paneCommand?: string;
	panePath?: string;
}

export interface TmuxWindowInfo {
	sessionName: string;
	windowName: string;
	paneCommand?: string;
	panePath?: string;
}

export type BenchDirtyStatus = "clean" | "untracked-only" | "modified" | "staged" | "conflicted" | "unknown";

export interface BenchDirtyFile {
	path: string;
	code: string;
}

export interface GeneralBenchState {
	/** Legacy PR benches infer their ID from pr-N. */
	id?: string;
	repo?: string;
	pr?: number;
	currentBranch?: string;
	upstream?: string;
	localOnlyCommits?: number;
	commitSafety?: "safe" | "local-only" | "no-upstream" | "unknown";
	ignoredFiles?: number;
	branchName: string;
	sessionName: string;
	benchPath?: string;
	branchExists: boolean;
	checkoutExists: boolean;
	checkoutKind?: "plain" | "worktree" | "unknown";
	/** @deprecated Use checkoutExists. Present for compatibility with older tool consumers. */
	worktreeRegistered: boolean;
	tmuxExists: boolean;
	tmuxPath?: string;
	tmuxPaneCommand?: string;
	tmuxPanePath?: string;
	piWindowExists?: boolean;
	piWindowPaneCommand?: string;
	piWindowPanePath?: string;
	localHead?: string;
	localHeadShort?: string;
	dirty?: boolean;
	dirtyStatus?: BenchDirtyStatus;
	dirtyFiles?: BenchDirtyFile[];
	freshness: "fresh" | "stale" | "unknown";
	fresh?: boolean;
	snapshotHeadOid?: string;
	title?: string;
	author?: string;
	url?: string;
	warnings: string[];
}

/** A PR Bench specializes a branch-based Bench. */
export interface BenchState extends GeneralBenchState {
	pr: number;
}
