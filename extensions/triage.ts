import { VALID_BUCKET_SET } from "./constants.ts";
import { decisionMap } from "./decisions.ts";
import type { DecisionsFile, EvidenceComparison, NeedsInferenceRow, RecommendationApplicability, SnapshotFile, SnapshotPR, TriageDecision } from "./types.ts";
import { discussionUpdatedAtFor } from "./github-core.ts";
import { validIsoTimestamp } from "./utils.ts";

function compareEvidence(evaluated: string | undefined, current: string | undefined, timestamp = false): EvidenceComparison {
	const usable = (value?: string) => timestamp ? validIsoTimestamp(value) : typeof value === "string" && !!value.trim() && value.trim().toLowerCase() !== "unknown";
	const known = usable(evaluated) && usable(current);
	const matching = timestamp ? Date.parse(evaluated ?? "") === Date.parse(current ?? "") : evaluated === current;
	return { status: !known ? "unknown" : matching ? "matching" : "changed", evaluated, current };
}

/** Compare evaluated facts, never write time. Current is not review/merge coverage. */
export function assessRecommendation(pr: SnapshotPR | undefined, decision?: TriageDecision): RecommendationApplicability {
	const head = compareEvidence(decision?.basis?.headOid, pr?.headOid);
	const discussion = compareEvidence(decision?.basis?.discussionUpdatedAt, pr ? discussionUpdatedAtFor(pr) : undefined, true);
	const reasons: string[] = [];
	if (!decision) reasons.push("no saved bucket decision");
	else if (!VALID_BUCKET_SET.has(decision.bucket)) reasons.push(`invalid saved bucket: ${decision.bucket}`);
	else if (!validIsoTimestamp(decision.decidedAt)) reasons.push("saved decision has invalid decidedAt");
	if (head.status === "changed") reasons.push("evaluated PR head differs from current snapshot head");
	if (discussion.status === "changed") reasons.push("captured human discussion differs from evaluated discussion");
	if (head.status === "unknown") reasons.push("evaluated or current PR head is unknown");
	if (discussion.status === "unknown") reasons.push("evaluated or current human discussion basis is unknown");
	const changed = head.status === "changed" || discussion.status === "changed";
	return { status: changed ? "superseded" : reasons.length ? "unknown" : "current", reasons, head, discussion };
}

export function computeNeedsInference(snapshot: SnapshotFile, decisions: TriageDecision[], filter?: number[]): NeedsInferenceRow[] {
	const decisionByPr = decisionMap(decisions);
	const filterSet = filter?.length ? new Set(filter) : undefined;
	return snapshot.pullRequests
		.filter((pr) => !filterSet || filterSet.has(pr.number))
		.flatMap((pr) => {
			const decision = decisionByPr.get(pr.number);
			const applicability = assessRecommendation(pr, decision);
			if (applicability.status === "current") return [];
			const reason = applicability.reasons[0];
			return [{
				number: pr.number,
				title: pr.title,
				author: pr.author,
				reason,
				meaningfulUpdatedAt: pr.meaningfulUpdatedAt,
				updatedAt: pr.updatedAt,
				headOid: pr.headOid,
				discussionUpdatedAt: discussionUpdatedAtFor(pr),
				applicability,
				decision,
			}];
		})
		.sort((a, b) => Date.parse(b.meaningfulUpdatedAt) - Date.parse(a.meaningfulUpdatedAt));
}

export interface LoadPrMetadataInput {
	selection?: "all" | "numbers" | "needs-inference";
	prs?: number[];
}

export interface ListPrsNeedingInferenceInput {
	prs?: number[];
}

export function selectSnapshotPrs(snapshot: SnapshotFile, params: LoadPrMetadataInput, decisions: TriageDecision[]): SnapshotPR[] {
	const selection = params.selection ?? (params.prs?.length ? "numbers" : "all");
	if (selection === "needs-inference") {
		const needed = new Set(computeNeedsInference(snapshot, decisions, params.prs).map((row) => row.number));
		return snapshot.pullRequests.filter((pr) => needed.has(pr.number));
	}
	if (selection === "numbers") {
		const wanted = new Set(params.prs ?? []);
		return snapshot.pullRequests.filter((pr) => wanted.has(pr.number));
	}
	return snapshot.pullRequests;
}

export function compactPrLine(pr: SnapshotPR): string {
	const flags = [
		pr.isDraft ? "draft" : undefined,
		pr.reviewDecision || undefined,
		pr.mergeStateStatus || undefined,
		pr.badChecks.length ? `${pr.badChecks.length} bad checks` : undefined,
		pr.stackBasePR ? `stack base #${pr.stackBasePR}` : undefined,
		pr.stackChildren?.length ? `stack children ${pr.stackChildren.map((n) => `#${n}`).join(",")}` : undefined,
	].filter(Boolean).join("; ");
	return `#${pr.number} ${pr.title} — ${pr.author}${flags ? ` (${flags})` : ""}`;
}

export interface TriageStateDeps {
	loadSnapshot: () => Promise<SnapshotFile>;
	loadDecisions: () => Promise<{ file: DecisionsFile; importedFromOld: boolean }>;
}

export interface LoadPrMetadataResult {
	snapshotFetchedAt: string;
	repo: string;
	pullRequests: SnapshotPR[];
	missing: number[];
}

export async function loadPrMetadata(params: LoadPrMetadataInput, deps: TriageStateDeps): Promise<LoadPrMetadataResult> {
	const snapshot = await deps.loadSnapshot();
	const { file: decisions } = await deps.loadDecisions();
	return {
		snapshotFetchedAt: snapshot.fetchedAt,
		repo: snapshot.repo,
		pullRequests: selectSnapshotPrs(snapshot, params, decisions.decisions).map((pr) => ({ ...pr, discussionUpdatedAt: discussionUpdatedAtFor(pr) })),
		missing: params.prs?.filter((number) => !snapshot.pullRequests.some((pr) => pr.number === number)) ?? [],
	};
}

export interface ListPrsNeedingInferenceResult {
	snapshotFetchedAt: string;
	prs: NeedsInferenceRow[];
	importedFromOld: boolean;
}

export async function listPrsNeedingInference(params: ListPrsNeedingInferenceInput, deps: TriageStateDeps): Promise<ListPrsNeedingInferenceResult> {
	const snapshot = await deps.loadSnapshot();
	const { file: decisions, importedFromOld } = await deps.loadDecisions();
	return {
		snapshotFetchedAt: snapshot.fetchedAt,
		prs: computeNeedsInference(snapshot, decisions.decisions, params.prs),
		importedFromOld,
	};
}
