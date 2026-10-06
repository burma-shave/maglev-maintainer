import { VALID_BUCKET_SET } from "./constants.ts";
import { decisionMap } from "./decisions.ts";
import type { DecisionsFile, NeedsInferenceRow, SnapshotFile, SnapshotPR, TriageDecision } from "./types.ts";
import { newerThan, validIsoTimestamp } from "./utils.ts";

export function computeNeedsInference(snapshot: SnapshotFile, decisions: TriageDecision[], filter?: number[]): NeedsInferenceRow[] {
	const decisionByPr = decisionMap(decisions);
	const filterSet = filter?.length ? new Set(filter) : undefined;
	return snapshot.pullRequests
		.filter((pr) => !filterSet || filterSet.has(pr.number))
		.flatMap((pr) => {
			const decision = decisionByPr.get(pr.number);
			let reason: string | undefined;
			if (!decision) reason = "no saved bucket decision";
			else if (!VALID_BUCKET_SET.has(decision.bucket)) reason = `invalid saved bucket: ${decision.bucket}`;
			else if (!validIsoTimestamp(decision.decidedAt)) reason = "saved decision has invalid decidedAt";
			else if (newerThan(pr.meaningfulUpdatedAt, decision.decidedAt)) reason = "saved decision is stale after commit/human activity";
			else if (decision.basis?.headOid && pr.headOid && decision.basis.headOid !== pr.headOid && newerThan(pr.lastCommit?.at, decision.decidedAt)) reason = "saved decision is stale after newer PR head commit";
			if (!reason) return [];
			return [{
				number: pr.number,
				title: pr.title,
				author: pr.author,
				reason,
				meaningfulUpdatedAt: pr.meaningfulUpdatedAt,
				updatedAt: pr.updatedAt,
				headOid: pr.headOid,
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
		pullRequests: selectSnapshotPrs(snapshot, params, decisions.decisions),
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
