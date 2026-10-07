import { VALID_BUCKETS, VALID_BUCKET_SET } from "./constants.ts";
import { withDecisionFileLock } from "./decision-lock.ts";
import type { DecisionBasis, DecisionsFile, SnapshotFile, SnapshotPR, TriageDecision } from "./types.ts";
import { validIsoTimestamp } from "./utils.ts";

export interface DecisionInput {
	bucket: TriageDecision["bucket"];
	priority?: number;
	reason: string;
	observations?: string[];
	source?: "skill" | "user" | "tool" | "migration";
	basis?: DecisionBasis;
}

export interface DecisionStoreDeps {
	decisionsFile: string;
	signal?: AbortSignal;
	loadDecisions: () => Promise<{ file: DecisionsFile; importedFromOld: boolean }>;
	writeDecisions: (file: DecisionsFile) => Promise<void>;
	loadSnapshot?: () => Promise<SnapshotFile>;
	now?: () => Date;
}

export interface DecisionListResult {
	decisions: TriageDecision[];
	importedFromOld: boolean;
}

export interface DecisionResult {
	decision: TriageDecision | null;
	importedFromOld: boolean;
}

export interface DeleteDecisionResult {
	pr: number;
	deleted: boolean;
}

export function normalizeDecision(raw: any, sourceOverride?: string): TriageDecision | undefined {
	if (!raw || !Number.isInteger(raw.pr) || raw.pr <= 0 || !VALID_BUCKET_SET.has(raw.bucket) || typeof raw.reason !== "string" || !validIsoTimestamp(raw.decidedAt)) return undefined;
	return {
		pr: raw.pr,
		bucket: raw.bucket,
		priority: typeof raw.priority === "number" ? raw.priority : undefined,
		reason: raw.reason,
		observations: Array.isArray(raw.observations) ? raw.observations.filter((item: unknown) => typeof item === "string") : undefined,
		decidedAt: raw.decidedAt,
		source: sourceOverride ?? (typeof raw.source === "string" ? raw.source : "skill"),
		basis: raw.basis && typeof raw.basis === "object" ? {
			snapshotFetchedAt: typeof raw.basis.snapshotFetchedAt === "string" ? raw.basis.snapshotFetchedAt : undefined,
			meaningfulUpdatedAt: typeof raw.basis.meaningfulUpdatedAt === "string" ? raw.basis.meaningfulUpdatedAt : undefined,
			headOid: typeof raw.basis.headOid === "string" ? raw.basis.headOid : undefined,
		} : undefined,
	};
}

export function decisionMap(decisions: TriageDecision[]): Map<number, TriageDecision> {
	return new Map(decisions.map((decision) => [decision.pr, decision]));
}

const RELATIVE_TIME_PATTERNS: RegExp[] = [
	/\bearlier today\b/i,
	/\bthis (morning|afternoon|evening|week|month)\b/i,
	/\blast night\b/i,
	/\btoday\b/i,
	/\byesterday\b/i,
	/\btomorrow\b/i,
	/\brecently\b/i,
	/\btonight\b/i,
];

function assertPositivePr(pr: number): void {
	if (!Number.isInteger(pr) || pr <= 0) throw new Error("PR number must be a positive integer");
}

export function relativeTimePhraseInDecisionText(text: string): string | undefined {
	for (const pattern of RELATIVE_TIME_PATTERNS) {
		const match = text.match(pattern);
		if (match?.[0]) return match[0].toLowerCase();
	}
	return undefined;
}

function assertDurableDecisionText(field: string, text: string): void {
	const phrase = relativeTimePhraseInDecisionText(text);
	if (phrase) throw new Error(`Decision ${field} contains relative time phrase "${phrase}". Durable decisions must use absolute dates such as "maintainer chased on 2026-09-05"; compute relative wording at display time.`);
}

export async function listDecisions(deps: Pick<DecisionStoreDeps, "loadDecisions">): Promise<DecisionListResult> {
	const loaded = await deps.loadDecisions();
	return {
		decisions: [...decisionMap(loaded.file.decisions).values()].sort((a, b) => a.pr - b.pr),
		importedFromOld: loaded.importedFromOld,
	};
}

export async function getDecision(pr: number, deps: Pick<DecisionStoreDeps, "loadDecisions">): Promise<DecisionResult> {
	assertPositivePr(pr);
	const loaded = await deps.loadDecisions();
	return {
		decision: decisionMap(loaded.file.decisions).get(pr) ?? null,
		importedFromOld: loaded.importedFromOld,
	};
}

export async function deleteDecision(pr: number, deps: Pick<DecisionStoreDeps, "decisionsFile" | "signal" | "loadDecisions" | "writeDecisions">): Promise<DeleteDecisionResult> {
	assertPositivePr(pr);
	return withDecisionFileLock(deps.decisionsFile, async () => {
		const loaded = await deps.loadDecisions();
		const byPr = decisionMap(loaded.file.decisions);
		const deleted = byPr.delete(pr);
		deps.signal?.throwIfAborted();
		await deps.writeDecisions({ ...loaded.file, decisions: [...byPr.values()] });
		return { pr, deleted };
	}, { signal: deps.signal });
}

export async function saveDecision(pr: number, input: DecisionInput, deps: DecisionStoreDeps): Promise<TriageDecision> {
	assertPositivePr(pr);
	if (!VALID_BUCKET_SET.has(input.bucket)) throw new Error(`Invalid bucket ${input.bucket}. Valid buckets: ${VALID_BUCKETS.join(", ")}`);
	const reason = input.reason.trim();
	if (!reason) throw new Error("Decision reason is required");
	assertDurableDecisionText("reason", reason);
	const observations = input.observations?.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
	for (const [index, observation] of observations?.entries() ?? []) assertDurableDecisionText(`observation ${index + 1}`, observation);

	return withDecisionFileLock(deps.decisionsFile, async () => {
		const loaded = await deps.loadDecisions();
		const byPr = decisionMap(loaded.file.decisions);
		let snapshot: SnapshotFile | undefined;
		let snapshotPr: SnapshotPR | undefined;
		if (deps.loadSnapshot) {
			try {
				snapshot = await deps.loadSnapshot();
				snapshotPr = snapshot.pullRequests.find((item) => item.number === pr);
			} catch {
				// Decisions are still useful during migration/bootstrap; basis falls back to caller-provided values.
			}
		}

		const decision: TriageDecision = {
			pr,
			bucket: input.bucket,
			priority: typeof input.priority === "number" ? input.priority : undefined,
			reason,
			observations,
			decidedAt: (deps.now?.() ?? new Date()).toISOString(),
			source: input.source ?? "skill",
			basis: {
				...input.basis,
				snapshotFetchedAt: snapshot?.fetchedAt ?? input.basis?.snapshotFetchedAt,
				meaningfulUpdatedAt: snapshotPr?.meaningfulUpdatedAt ?? input.basis?.meaningfulUpdatedAt,
				headOid: snapshotPr?.headOid ?? input.basis?.headOid,
			},
		};
		byPr.set(pr, decision);
		deps.signal?.throwIfAborted();
		await deps.writeDecisions({ ...loaded.file, decisions: [...byPr.values()] });
		return decision;
	}, { signal: deps.signal });
}
