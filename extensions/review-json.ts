import { join } from "node:path";
import { REPO } from "./constants.ts";

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
export type ReviewCommentSide = "RIGHT" | "LEFT";

export interface ReviewJsonCommentInput {
	path: string;
	line: number;
	side?: ReviewCommentSide;
	body: string;
}

export interface ReviewJsonParams {
	pr: number;
	repo?: string;
	event: ReviewEvent;
	body: string;
	comments?: ReviewJsonCommentInput[];
}

export interface ReviewJsonComment {
	path: string;
	line: number;
	side: ReviewCommentSide;
	body: string;
}

export interface ReviewJsonFile {
	owner: string;
	repo: string;
	pr: number;
	commit: string;
	event: ReviewEvent;
	body: string;
	comments?: ReviewJsonComment[];
}

export interface ReviewJsonResult {
	owner: string;
	repo: string;
	repoFullName: string;
	pr: number;
	commit: string;
	title?: string;
	outputPath: string;
	review: ReviewJsonFile;
	commentCount: number;
}

export interface ReviewJsonDeps {
	runJson: <T>(cmd: string, args: string[]) => Promise<T>;
	runText: (cmd: string, args: string[]) => Promise<string>;
	writeReviewJson: (path: string, value: ReviewJsonFile) => Promise<void>;
	reviewJsonDir: string;
}

interface GhPrView {
	number: number;
	headRefOid?: string;
	title?: string;
}

interface DiffLine {
	oldLine?: number;
	newLine?: number;
	type: "context" | "add" | "del";
}

interface DiffFile {
	oldPath: string;
	newPath: string;
	lines: DiffLine[];
}

const VALID_EVENTS = new Set<ReviewEvent>(["APPROVE", "REQUEST_CHANGES", "COMMENT"]);
const VALID_SIDES = new Set<ReviewCommentSide>(["RIGHT", "LEFT"]);

function normalizeRepo(repo?: string): { owner: string; repoName: string; fullName: string } {
	const fullName = (repo?.trim() || REPO).replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
	const parts = fullName.split("/").filter(Boolean);
	if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error(`repo must be in owner/name form, got ${repo ?? ""}`);
	return { owner: parts[0], repoName: parts[1], fullName: `${parts[0]}/${parts[1]}` };
}

export function resolveReviewJsonOutputPath(pr: number, reviewJsonDir: string): string {
	return join(reviewJsonDir, `pr-${pr}.json`);
}

function normalizeComments(comments?: ReviewJsonCommentInput[]): ReviewJsonComment[] {
	return (comments ?? []).map((comment, index) => {
		if (!comment || typeof comment !== "object") throw new Error(`comments[${index}] must be an object`);
		const path = comment.path?.trim();
		if (!path) throw new Error(`comments[${index}].path is required`);
		if (!Number.isInteger(comment.line) || comment.line <= 0) throw new Error(`comments[${index}].line must be a positive integer`);
		const side = comment.side ?? "RIGHT";
		if (!VALID_SIDES.has(side)) throw new Error(`comments[${index}].side must be RIGHT or LEFT`);
		const body = comment.body?.trim();
		if (!body) throw new Error(`comments[${index}].body is required`);
		return { path, line: comment.line, side, body };
	});
}

function unquoteDiffPath(path: string): string {
	return path.replace(/^"|"$/g, "").replace(/^a\//, "").replace(/^b\//, "");
}

function parseDiffHeader(line: string): { oldPath: string; newPath: string } | undefined {
	const match = line.match(/^diff --git (.+) (.+)$/);
	if (!match) return undefined;
	return { oldPath: unquoteDiffPath(match[1]!), newPath: unquoteDiffPath(match[2]!) };
}

export function parseUnifiedDiff(diff: string): DiffFile[] {
	const files: DiffFile[] = [];
	let current: DiffFile | undefined;
	let oldLine = 0;
	let newLine = 0;
	let inHunk = false;

	for (const line of diff.split(/\r?\n/)) {
		const header = parseDiffHeader(line);
		if (header) {
			current = { ...header, lines: [] };
			files.push(current);
			inHunk = false;
			continue;
		}
		if (!current) continue;
		const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
		if (hunk) {
			oldLine = Number(hunk[1]);
			newLine = Number(hunk[3]);
			inHunk = true;
			continue;
		}
		if (!inHunk || line === "") continue;
		const prefix = line[0];
		if (prefix === "\\") continue;
		if (prefix === " ") {
			current.lines.push({ type: "context", oldLine, newLine });
			oldLine += 1;
			newLine += 1;
		} else if (prefix === "+") {
			current.lines.push({ type: "add", newLine });
			newLine += 1;
		} else if (prefix === "-") {
			current.lines.push({ type: "del", oldLine });
			oldLine += 1;
		}
	}

	return files;
}

export function validateCommentsAgainstDiff(comments: ReviewJsonComment[], diff: string): void {
	if (!comments.length) return;
	const files = parseUnifiedDiff(diff);
	for (const [index, comment] of comments.entries()) {
		const file = files.find((candidate) => comment.side === "RIGHT"
			? candidate.newPath === comment.path || candidate.oldPath === comment.path
			: candidate.oldPath === comment.path || candidate.newPath === comment.path);
		if (!file) throw new Error(`comments[${index}] path ${comment.path} does not appear in the PR diff`);
		const valid = file.lines.some((line) => comment.side === "RIGHT"
			? line.newLine === comment.line && line.type !== "del"
			: line.oldLine === comment.line && line.type !== "add");
		if (!valid) throw new Error(`comments[${index}] ${comment.path}:${comment.line} ${comment.side} is not a commentable line in the PR diff`);
	}
}

export async function writeReviewJson(params: ReviewJsonParams, deps: ReviewJsonDeps): Promise<ReviewJsonResult> {
	if (!Number.isInteger(params.pr) || params.pr <= 0) throw new Error("pr must be a positive integer");
	if (!VALID_EVENTS.has(params.event)) throw new Error("event must be APPROVE, REQUEST_CHANGES, or COMMENT");
	const body = params.body?.trim();
	if (!body) throw new Error("body is required");
	const repo = normalizeRepo(params.repo);
	const comments = normalizeComments(params.comments);

	const prView = await deps.runJson<GhPrView>("gh", ["pr", "view", String(params.pr), "--repo", repo.fullName, "--json", "number,headRefOid,title"]);
	if (prView.number !== params.pr) throw new Error(`gh returned PR #${prView.number}; expected #${params.pr}`);
	if (!prView.headRefOid) throw new Error(`PR #${params.pr} did not include a headRefOid`);

	if (comments.length) {
		const diff = await deps.runText("gh", ["pr", "diff", String(params.pr), "--repo", repo.fullName]);
		validateCommentsAgainstDiff(comments, diff);
	}

	const review: ReviewJsonFile = {
		owner: repo.owner,
		repo: repo.repoName,
		pr: params.pr,
		commit: prView.headRefOid,
		event: params.event,
		body,
		...(comments.length ? { comments } : {}),
	};
	const outputPath = resolveReviewJsonOutputPath(params.pr, deps.reviewJsonDir);
	await deps.writeReviewJson(outputPath, review);

	return {
		owner: repo.owner,
		repo: repo.repoName,
		repoFullName: repo.fullName,
		pr: params.pr,
		commit: prView.headRefOid,
		title: prView.title,
		outputPath,
		review,
		commentCount: comments.length,
	};
}
