import { Type, type Static } from "typebox";

export const PrNumberSchema = Type.Number({ minimum: 1, description: "GitHub PR number" });
export const BucketSchema = Type.Union([
	Type.Literal("review"),
	Type.Literal("chase"),
	Type.Literal("pinned"),
	Type.Literal("watch"),
]);

export const RefreshMetadataParamsSchema = Type.Object({
	repo: Type.Optional(Type.String({ description: "GitHub repo in owner/name form. Defaults to OneBusAway/maglev." })),
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500, description: "Maximum open PRs to fetch. Defaults to 200." })),
});

export const WorkspaceContextParamsSchema = Type.Object({
	pr: Type.Optional(PrNumberSchema),
	benchId: Type.Optional(Type.String({ minLength: 1, description: "Stable branch or PR Bench ID. Mutually exclusive with pr." })),
});

export const MaglevCheckoutParamsSchema = Type.Object({
	apply: Type.Optional(Type.Boolean({ description: "Clone a missing checkout. Defaults to false/dry-run. Existing checkouts are never updated or switched." })),
	path: Type.Optional(Type.String({ minLength: 1, description: "Checkout root. Defaults to OBA_WORKSPACE/maglev or maintainer-root/checkouts/maglev." })),
	ref: Type.Optional(Type.String({ minLength: 1, description: "Branch, tag, full ref, or commit SHA. New clones use detached HEAD for explicit refs; existing HEAD must already match. Omit to clone the remote default branch or preserve an existing checkout." })),
});

export const CompanionRepoNameSchema = Type.Union([
	Type.Literal("wayfinder"),
	Type.Literal("js-sdk"),
	Type.Literal("onebusaway-ios"),
	Type.Literal("onebusaway-android"),
	Type.Literal("onebusaway-application-modules"),
	Type.Literal("oba-java"),
	Type.Literal("maglev.wiki"),
]);

export const CompanionReposParamsSchema = Type.Object({
	repos: Type.Optional(Type.Array(CompanionRepoNameSchema, { description: "OBA companion repos to resolve. Defaults to all known companion repos." })),
});

export const SnapshotStalenessParamsSchema = Type.Object({});

export const LoadMetadataParamsSchema = Type.Object({
	selection: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("numbers"), Type.Literal("needs-inference")], { description: "Which snapshot PRs to load. Defaults to numbers when prs is provided, otherwise all." })),
	prs: Type.Optional(Type.Array(PrNumberSchema, { description: "Explicit PR numbers to load from the snapshot." })),
});

export const NeedsInferenceParamsSchema = Type.Object({
	prs: Type.Optional(Type.Array(PrNumberSchema, { description: "Optional PR number filter." })),
});

export const StateQueryParamsSchema = Type.Object({
	selection: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("numbers"), Type.Literal("needs-inference")], { description: "Which snapshot PRs to dump. Defaults to numbers when prs is provided, otherwise all." })),
	prs: Type.Optional(Type.Array(PrNumberSchema, { description: "Explicit PR numbers to dump from joined state." })),
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, description: "Maximum rows to return. Defaults to all selected rows." })),
});

export const BenchListParamsSchema = Type.Object({
	prs: Type.Optional(Type.Array(PrNumberSchema, { description: "Optional PR number filter." })),
});

export const BenchInspectParamsSchema = Type.Object({
	pr: PrNumberSchema,
});

export const CodeReviewParamsSchema = Type.Object({
	pr: PrNumberSchema,
	workingDirectory: Type.Optional(Type.String({ description: "Optional repository checkout for local review. Omit for remote PR-number-only review from the current directory; no Bench or checkout required." })),
	timeoutSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 3600, description: "Claude Code review timeout in seconds. Defaults to 1200 (20 minutes)." })),
});

export const BenchKickoffParamsSchema = Type.Object({
	pr: PrNumberSchema,
	context: Type.Optional(Type.String({ description: "Optional additional context for the on-demand review kickoff." })),
});

export const BenchStartParamsSchema = Type.Object({
	pr: PrNumberSchema,
	context: Type.Optional(Type.String({ description: "Optional caller-supplied handoff/background context appended to the new Pi session's system prompt. Does not submit a task or run a kickoff. Only supported when starting a new Pi window, not reusing an existing one; blank context is ignored." })),
	apply: Type.Optional(Type.Boolean({ description: "Execute the start/completion plan when it is ready. Defaults to false/dry-run." })),
	allowDraft: Type.Optional(Type.Boolean({ description: "Legacy no-op; draft status does not block PR Bench start." })),
	allowBadChecks: Type.Optional(Type.Boolean({ description: "Legacy no-op; failing/problem checks do not block PR Bench start." })),
	allowConflicts: Type.Optional(Type.Boolean({ description: "Legacy no-op; non-clean GitHub merge state does not block PR Bench start." })),
	allowPinned: Type.Optional(Type.Boolean({ description: "Legacy no-op; pinned triage decisions do not block PR Bench start." })),
	allowNeedsInference: Type.Optional(Type.Boolean({ description: "Legacy no-op; missing or stale triage inference does not block PR Bench start." })),
	allowStaleSnapshot: Type.Optional(Type.Boolean({ description: "Acknowledge stale or incomplete snapshot/head information." })),
	allowHeadMismatch: Type.Optional(Type.Boolean({ description: "Acknowledge that an existing PR Bench HEAD differs from the snapshot PR head." })),
	allowStackParentMissing: Type.Optional(Type.Boolean({ description: "Legacy no-op; a missing stack-parent Bench does not block PR Bench start." })),
	reuseExisting: Type.Optional(Type.Boolean({ description: "Reuse a complete existing PR Bench instead of refusing. Defaults to true." })),
	snapshotMaxAgeHours: Type.Optional(Type.Number({ minimum: 0, description: "Snapshot age warning threshold. Defaults to the package snapshot staleness threshold." })),
});

export const BenchResetParamsSchema = Type.Object({
	pr: PrNumberSchema,
	apply: Type.Optional(Type.Boolean({ description: "Execute the reset plan when it is ready. Defaults to false/dry-run." })),
	allowDirty: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("untracked"), Type.Literal("any")], { description: "Which dirty local file states are acknowledged and discarded by reset planning. Defaults to none." })),
	allowStaleSnapshot: Type.Optional(Type.Boolean({ description: "Acknowledge stale or incomplete snapshot/head information." })),
	snapshotMaxAgeHours: Type.Optional(Type.Number({ minimum: 0, description: "Snapshot age warning threshold. Defaults to the package snapshot staleness threshold." })),
});

export const BenchCloseParamsSchema = Type.Object({
	pr: PrNumberSchema,
	apply: Type.Optional(Type.Boolean({ description: "Execute the close plan when it is ready. Defaults to false/dry-run." })),
	allowDirty: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("untracked"), Type.Literal("any")], { description: "Which dirty local file states are acknowledged for close planning. Defaults to none." })),
	allowStale: Type.Optional(Type.Boolean({ description: "Acknowledge that local HEAD differs from the snapshot PR head." })),
	allowLocalCommits: Type.Optional(Type.Boolean({ description: "Acknowledge losing committed work or unknown preservation state when deleting the checkout." })),

	closeTmux: Type.Optional(Type.Boolean({ description: "Plan to kill the PR Bench tmux session. Defaults to true." })),
	removeCheckout: Type.Optional(Type.Boolean({ description: "Plan to remove the PR Bench checkout path. Defaults to true. Set false to stop tmux without deleting local work or artifacts." })),
	deleteBranch: Type.Optional(Type.Boolean({ description: "Plan to delete the local pr-N branch for legacy worktree-based Benches. Plain checkout branches are removed with the checkout directory. Defaults to true." })),
});

export const ReviewJsonCommentSchema = Type.Object({
	path: Type.String({ minLength: 1, description: "Path to the file in the PR diff." }),
	line: Type.Number({ minimum: 1, description: "Line number on the selected diff side." }),
	side: Type.Optional(Type.Union([Type.Literal("RIGHT"), Type.Literal("LEFT")], { description: "RIGHT for new-file lines, LEFT for deleted/pre-change lines. Defaults to RIGHT." })),
	body: Type.String({ minLength: 1, description: "Inline review comment body." }),
});

export const ReviewJsonParamsSchema = Type.Object({
	pr: PrNumberSchema,
	repo: Type.Optional(Type.String({ description: "GitHub repo in owner/name form. Defaults to OneBusAway/maglev." })),
	event: Type.Union([Type.Literal("APPROVE"), Type.Literal("REQUEST_CHANGES"), Type.Literal("COMMENT")], { description: "GitHub review event." }),
	body: Type.String({ minLength: 1, description: "Top-level review summary body." }),
	comments: Type.Optional(Type.Array(ReviewJsonCommentSchema, { description: "Optional inline review comments to validate against the PR diff." })),
});

export const ReviewJsonClearParamsSchema = Type.Object({
	pr: PrNumberSchema,
});

export const ReviewJsonListParamsSchema = Type.Object({
	pr: Type.Optional(PrNumberSchema),
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, description: "Maximum drafts to return. Defaults to 50." })),
});

export const ReviewJsonLoadParamsSchema = Type.Object({
	path: Type.Optional(Type.String({ description: "Review JSON artifact path. Relative paths resolve under the centralized review JSON directory." })),
	pr: Type.Optional(PrNumberSchema),
});

export const DecisionInputSchema = Type.Object({
	bucket: BucketSchema,
	priority: Type.Optional(Type.Number({ minimum: 0, maximum: 9 })),
	reason: Type.String({ minLength: 1, description: "Durable reason text. Use absolute dates; relative temporal phrases like today/yesterday/recently are rejected." }),
	observations: Type.Optional(Type.Array(Type.String({ description: "Durable observation text. Use absolute dates; relative temporal phrases like today/yesterday/recently are rejected." }))),
	source: Type.Optional(Type.Union([Type.Literal("skill"), Type.Literal("user"), Type.Literal("tool"), Type.Literal("migration")], { description: "Who/what made the decision. Defaults to skill." })),
	basis: Type.Optional(Type.Object({
		snapshotFetchedAt: Type.Optional(Type.String()),
		meaningfulUpdatedAt: Type.Optional(Type.String()),
		headOid: Type.Optional(Type.String()),
	})),
});

export const DecisionsParamsSchema = Type.Object({
	operation: Type.Union([Type.Literal("list"), Type.Literal("get"), Type.Literal("upsert"), Type.Literal("delete")]),
	pr: Type.Optional(PrNumberSchema),
	decision: Type.Optional(DecisionInputSchema),
});

export type RefreshMetadataParams = Static<typeof RefreshMetadataParamsSchema>;
export type WorkspaceContextParams = Static<typeof WorkspaceContextParamsSchema>;
export type CompanionReposParams = Static<typeof CompanionReposParamsSchema>;
export type SnapshotStalenessParams = Static<typeof SnapshotStalenessParamsSchema>;
export type LoadMetadataParams = Static<typeof LoadMetadataParamsSchema>;
export type NeedsInferenceParams = Static<typeof NeedsInferenceParamsSchema>;
export type StateQueryParams = Static<typeof StateQueryParamsSchema>;
export type BenchListParams = Static<typeof BenchListParamsSchema>;
export type BenchInspectParams = Static<typeof BenchInspectParamsSchema>;
export type CodeReviewParams = Static<typeof CodeReviewParamsSchema>;
export type BenchStartParams = Static<typeof BenchStartParamsSchema>;
export type BenchResetParams = Static<typeof BenchResetParamsSchema>;
export type BenchCloseParams = Static<typeof BenchCloseParamsSchema>;
export type ReviewJsonParams = Static<typeof ReviewJsonParamsSchema>;
export type ReviewJsonClearParams = Static<typeof ReviewJsonClearParamsSchema>;
export type ReviewJsonListParams = Static<typeof ReviewJsonListParamsSchema>;
export type ReviewJsonLoadParams = Static<typeof ReviewJsonLoadParamsSchema>;
export type DecisionsParams = Static<typeof DecisionsParamsSchema>;
