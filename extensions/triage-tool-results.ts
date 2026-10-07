import type { DecisionListResult, DecisionResult } from "./decisions.ts";
import type { ListPrsNeedingInferenceResult, LoadPrMetadataResult } from "./triage.ts";
import type { TriageDecision } from "./types.ts";
import { toolResult } from "./utils.ts";

// Parent queue summaries omit observations; exact decision inspection uses get.
function compactDecision(decision: TriageDecision) {
	return {
		pr: decision.pr,
		bucket: decision.bucket,
		priority: decision.priority,
		reason: decision.reason,
		decidedAt: decision.decidedAt,
		source: decision.source,
		basis: decision.basis,
	};
}

export function loadMetadataToolResult(result: LoadPrMetadataResult, snapshotFile: string) {
	const payload = { snapshotFile, ...result };
	return toolResult(JSON.stringify(payload, null, 2), payload);
}

export function needsInferenceToolResult(result: ListPrsNeedingInferenceResult, snapshotFile: string, decisionsFile: string) {
	const payload = { snapshotFile, decisionsFile, snapshotFetchedAt: result.snapshotFetchedAt, prs: result.prs };
	const text = [
		`${result.prs.length} PRs need inference from snapshot ${result.snapshotFetchedAt}.`,
		JSON.stringify({ snapshotFile, decisionsFile, snapshotFetchedAt: result.snapshotFetchedAt }),
		// Emit every selected identity, not a capped display preview. No GitHub discussions.
		...result.prs.map((row) => JSON.stringify({
			number: row.number,
			title: row.title,
			author: row.author,
			reason: row.reason,
			meaningfulUpdatedAt: row.meaningfulUpdatedAt,
			updatedAt: row.updatedAt,
			headOid: row.headOid,
			decision: row.decision ? compactDecision(row.decision) : undefined,
		})),
	].join("\n");
	return toolResult(text, payload);
}

export function decisionListToolResult(result: DecisionListResult, decisionsFile: string) {
	const payload = { decisionsFile, importedFromOld: result.importedFromOld, decisions: result.decisions };
	const text = [
		`Loaded ${result.decisions.length} decisions from ${decisionsFile}.`,
		...result.decisions.map((decision) => JSON.stringify(compactDecision(decision))),
	].join("\n");
	return toolResult(text, payload);
}

export function decisionGetToolResult(result: DecisionResult, pr: number, decisionsFile: string) {
	const payload = { decision: result.decision, decisionsFile, importedFromOld: result.importedFromOld };
	return toolResult(result.decision ? JSON.stringify(payload, null, 2) : `No decision for #${pr}.`, payload);
}
