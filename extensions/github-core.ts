import { BOT_LOGINS, MAINTAINER_LOGINS } from "./constants.ts";
import type { Activity, GhCheck, GhComment, GhCommit, GhPR, GhReview, SnapshotPR } from "./types.ts";
import { latestByDate, latestTimestamp, truncateBody } from "./utils.ts";

function isBot(login?: string): boolean {
	return !!login && BOT_LOGINS.has(login);
}

export function parseBadChecks(checks: GhCheck[] = []): string[] {
	return checks.flatMap((check) => {
		if (check.__typename === "CheckRun") {
			const bad = ["FAILURE", "CANCELLED", "ERROR", "TIMED_OUT", "ACTION_REQUIRED"].includes(check.conclusion ?? "");
			return bad ? [check.name ?? "check"] : [];
		}
		if (check.__typename === "StatusContext") {
			const bad = ["FAILURE", "ERROR", "PENDING"].includes(check.state ?? "");
			return bad ? [check.context ?? "status"] : [];
		}
		return [];
	});
}

function activityFromReview(review?: GhReview): Activity | undefined {
	if (!review?.submittedAt) return undefined;
	return { author: review.author?.login, at: review.submittedAt, body: truncateBody(review.body, 1200), state: review.state };
}

function activityFromComment(comment?: GhComment): Activity | undefined {
	if (!comment?.createdAt) return undefined;
	return { author: comment.author?.login, at: comment.createdAt, body: truncateBody(comment.body, 1200) };
}

function activityFromCommit(commit?: GhCommit): Activity | undefined {
	if (!commit?.committedDate) return undefined;
	return { oid: commit.oid, at: commit.committedDate, body: commit.messageHeadline };
}

function normalizeReview(review: GhReview): SnapshotPR["reviews"][number] {
	return {
		author: review.author?.login ?? "unknown",
		state: review.state,
		submittedAt: review.submittedAt,
		body: truncateBody(review.body),
	};
}

function normalizeComment(comment: GhComment): SnapshotPR["comments"][number] {
	return {
		author: comment.author?.login ?? "unknown",
		createdAt: comment.createdAt,
		body: truncateBody(comment.body),
	};
}

export function snapshotFromGh(gh: GhPR): SnapshotPR {
	const reviews = gh.reviews ?? [];
	const comments = gh.comments ?? [];
	const commits = gh.commits ?? [];
	const latestCommit = latestByDate(commits, (commit) => commit.committedDate);
	const headCommit = (gh.headRefOid ? commits.find((commit) => commit.oid === gh.headRefOid) : undefined) ?? commits.at(-1) ?? latestCommit;
	const lastCommit = activityFromCommit(headCommit);
	const lastHumanReview = activityFromReview(latestByDate(reviews, (review) => review.submittedAt, (review) => !isBot(review.author?.login)));
	const lastChangeRequest = activityFromReview(latestByDate(reviews, (review) => review.submittedAt, (review) => !isBot(review.author?.login) && review.state === "CHANGES_REQUESTED"));
	const lastCodeRabbitReview = activityFromReview(latestByDate(reviews, (review) => review.submittedAt, (review) => review.author?.login === "coderabbitai"));
	const lastHumanComment = activityFromComment(latestByDate(comments, (comment) => comment.createdAt, (comment) => !isBot(comment.author?.login)));
	const lastChase = activityFromComment(latestByDate(
		comments,
		(comment) => comment.createdAt,
		(comment) => !!comment.author?.login && MAINTAINER_LOGINS.has(comment.author.login) && (/checking in/i.test(comment.body ?? "") || /could you please/i.test(comment.body ?? "")),
	));
	const meaningfulUpdatedAt = latestTimestamp(latestCommit?.committedDate, lastHumanReview?.at, lastHumanComment?.at) ?? gh.createdAt;
	const commitSummary = {
		count: commits.length,
		lastOid: lastCommit?.oid,
		lastCommittedDate: lastCommit?.at,
		lastMessageHeadline: lastCommit?.body,
	};
	return {
		number: gh.number,
		title: gh.title,
		author: gh.author?.login ?? "unknown",
		url: gh.url,
		isDraft: gh.isDraft ?? false,
		baseRefName: gh.baseRefName,
		headRefName: gh.headRefName,
		headRepositoryOwner: gh.headRepositoryOwner?.login,
		headRepositoryName: gh.headRepository?.name,
		headRepositoryNameWithOwner: gh.headRepository?.nameWithOwner,
		headRepositoryUrl: gh.headRepository?.url,
		state: gh.state ?? "OPEN",
		closedAt: gh.closedAt,
		mergedAt: gh.mergedAt,
		createdAt: gh.createdAt,
		updatedAt: gh.updatedAt,
		meaningfulUpdatedAt,
		reviewDecision: gh.reviewDecision ?? "",
		mergeStateStatus: gh.mergeStateStatus ?? "UNKNOWN",
		badChecks: parseBadChecks(gh.statusCheckRollup),
		headOid: gh.headRefOid ?? lastCommit?.oid,
		commitSummary,
		commits,
		reviews: reviews.map(normalizeReview),
		comments: comments.map(normalizeComment),
		files: (gh.files ?? []).map((file) => file.path),
		lastCommit,
		lastHumanReview,
		lastChangeRequest,
		lastCodeRabbitReview,
		lastHumanComment,
		lastChase,
	};
}

export function addStackMetadata(prs: SnapshotPR[]): SnapshotPR[] {
	const byHeadRef = new Map(prs.map((pr) => [pr.headRefName, pr.number] as const).filter(([headRef]) => !!headRef));
	const children = new Map<number, number[]>();
	for (const pr of prs) {
		const stackBasePR = pr.baseRefName && pr.baseRefName !== "main" ? byHeadRef.get(pr.baseRefName) : undefined;
		pr.stackBasePR = stackBasePR;
		if (stackBasePR) children.set(stackBasePR, [...(children.get(stackBasePR) ?? []), pr.number]);
	}
	for (const pr of prs) {
		const stackChildren = children.get(pr.number)?.sort((a, b) => a - b);
		if (stackChildren?.length) pr.stackChildren = stackChildren;
	}
	return prs;
}
