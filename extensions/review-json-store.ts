import { readdir, readFile, stat, unlink } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import type { ReviewJsonFile } from "./review-json.ts";

export interface ReviewJsonArtifact {
	path: string;
	fileName: string;
	mtimeMs: number;
	owner: string;
	repo: string;
	pr: number;
	commit: string;
	event: string;
	body: string;
	commentCount: number;
}

export interface ReviewJsonListParams {
	pr?: number;
	limit?: number;
}

export interface ReviewJsonLoadParams {
	path?: string;
	pr?: number;
}

export interface ReviewJsonClearParams {
	pr: number;
}

export interface ReviewJsonClearResult {
	path: string;
	deleted: boolean;
}

export interface LoadedReviewJsonArtifact extends ReviewJsonArtifact {
	review: ReviewJsonFile;
	markdown: string;
}

export interface ReviewJsonStoreDeps {
	reviewJsonDir: string;
	readDir?: typeof readdir;
	readFile?: typeof readFile;
	stat?: typeof stat;
	unlink?: typeof unlink;
}

function readDirDep(deps: ReviewJsonStoreDeps) {
	return deps.readDir ?? readdir;
}

function readFileDep(deps: ReviewJsonStoreDeps) {
	return deps.readFile ?? readFile;
}

function statDep(deps: ReviewJsonStoreDeps) {
	return deps.stat ?? stat;
}

function unlinkDep(deps: ReviewJsonStoreDeps) {
	return deps.unlink ?? unlink;
}

function isReviewJsonFile(value: unknown): value is ReviewJsonFile {
	if (!value || typeof value !== "object") return false;
	const review = value as Partial<ReviewJsonFile>;
	return typeof review.owner === "string"
		&& typeof review.repo === "string"
		&& Number.isInteger(review.pr)
		&& typeof review.commit === "string"
		&& typeof review.event === "string"
		&& typeof review.body === "string"
		&& (review.comments === undefined || Array.isArray(review.comments));
}

function artifactFromReview(path: string, mtimeMs: number, review: ReviewJsonFile): ReviewJsonArtifact {
	return {
		path,
		fileName: basename(path),
		mtimeMs,
		owner: review.owner,
		repo: review.repo,
		pr: review.pr,
		commit: review.commit,
		event: review.event,
		body: review.body,
		commentCount: review.comments?.length ?? 0,
	};
}

export function resolveReviewJsonArtifactPath(path: string, reviewJsonDir: string): string {
	const trimmed = path.trim();
	if (!trimmed) throw new Error("path must not be empty");
	return isAbsolute(trimmed) ? trimmed : join(reviewJsonDir, trimmed);
}

export function resolveReviewJsonDraftPathForPr(pr: number, reviewJsonDir: string): string {
	if (!Number.isInteger(pr) || pr <= 0) throw new Error("pr must be a positive integer");
	return join(reviewJsonDir, `pr-${pr}.json`);
}

export function formatReviewJsonArtifactLine(artifact: ReviewJsonArtifact): string {
	return `${artifact.fileName} — #${artifact.pr} ${artifact.event} • ${artifact.commentCount} inline comment${artifact.commentCount === 1 ? "" : "s"}`;
}

export async function listReviewJsonArtifacts(params: ReviewJsonListParams, deps: ReviewJsonStoreDeps): Promise<ReviewJsonArtifact[]> {
	let entries: string[];
	try {
		entries = await readDirDep(deps)(deps.reviewJsonDir);
	} catch (err) {
		if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "ENOENT") return [];
		throw err;
	}
	const artifacts: ReviewJsonArtifact[] = [];
	for (const entry of entries) {
		if (!/^pr-\d+\.json$/.test(entry)) continue;
		const path = join(deps.reviewJsonDir, entry);
		try {
			const [raw, info] = await Promise.all([readFileDep(deps)(path, "utf8"), statDep(deps)(path)]);
			const parsed = JSON.parse(raw);
			if (!isReviewJsonFile(parsed)) continue;
			if (params.pr !== undefined && parsed.pr !== params.pr) continue;
			artifacts.push(artifactFromReview(path, info.mtimeMs, parsed));
		} catch {
			// Ignore malformed/stale files in the draft directory; explicit loads report errors.
		}
	}
	artifacts.sort((a, b) => b.mtimeMs - a.mtimeMs || b.fileName.localeCompare(a.fileName));
	return artifacts.slice(0, params.limit ?? 50);
}

export function formatReviewJsonMarkdown(artifact: ReviewJsonArtifact, review: ReviewJsonFile): string {
	const comments = review.comments ?? [];
	const lines = [
		`# PR review draft for ${review.owner}/${review.repo}#${review.pr}`,
		``,
		`Path: ${artifact.path}`,
		`Commit: ${review.commit}`,
		`Event: ${review.event}`,
		`Inline comments: ${comments.length}`,
		``,
		`## Review body`,
		``,
		review.body,
		``,
		`## Inline comments`,
		``,
	];
	if (!comments.length) {
		lines.push(`No inline comments.`);
	} else {
		for (const [index, comment] of comments.entries()) {
			lines.push(`${index + 1}. ${comment.path}:${comment.line} ${comment.side}`, ``, comment.body, ``);
		}
	}
	return lines.join("\n").trimEnd();
}

export async function loadReviewJsonArtifact(params: ReviewJsonLoadParams, deps: ReviewJsonStoreDeps): Promise<LoadedReviewJsonArtifact> {
	let path: string;
	if (params.path?.trim()) {
		path = resolveReviewJsonArtifactPath(params.path, deps.reviewJsonDir);
	} else if (Number.isInteger(params.pr) && params.pr! > 0) {
		path = resolveReviewJsonDraftPathForPr(params.pr!, deps.reviewJsonDir);
	} else {
		throw new Error("Provide either path or pr");
	}

	const [raw, info] = await Promise.all([readFileDep(deps)(path, "utf8"), statDep(deps)(path)]);
	const parsed = JSON.parse(raw);
	if (!isReviewJsonFile(parsed)) throw new Error(`${path} is not a valid PR review JSON draft`);
	const artifact = artifactFromReview(path, info.mtimeMs, parsed);
	return { ...artifact, review: parsed, markdown: formatReviewJsonMarkdown(artifact, parsed) };
}

export async function clearReviewJsonArtifact(params: ReviewJsonClearParams, deps: ReviewJsonStoreDeps): Promise<ReviewJsonClearResult> {
	const path = resolveReviewJsonDraftPathForPr(params.pr, deps.reviewJsonDir);
	try {
		await unlinkDep(deps)(path);
		return { path, deleted: true };
	} catch (err) {
		if (typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "ENOENT") return { path, deleted: false };
		throw err;
	}
}
