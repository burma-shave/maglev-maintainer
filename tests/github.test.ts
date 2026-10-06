import assert from "node:assert/strict";
import test from "node:test";
import { refreshMetadata } from "../extensions/github.ts";
import { makeGhPr } from "../testdata/fixtures.ts";
import type { GhPR, GhPRListItem, SnapshotFile } from "../extensions/types.ts";

test("refreshMetadata lists PRs, fetches each PR, writes a sorted snapshot, and adds stack metadata", async () => {
	const calls: Array<{ cmd: string; args: string[] }> = [];
	let written: SnapshotFile | undefined;
	const prs = new Map<number, GhPR>([
		[2, makeGhPr({ number: 2, title: "Child", headRefName: "feature-child", baseRefName: "feature-base" })],
		[1, makeGhPr({ number: 1, title: "Base", headRefName: "feature-base", baseRefName: "main" })],
	]);

	const snapshot = await refreshMetadata({ repo: "Example/repo", limit: 50 }, {
		now: () => new Date("2026-02-03T04:05:06Z"),
		writeSnapshot: async (value) => { written = value; },
		runJson: async <T>(cmd: string, args: string[]): Promise<T> => {
			calls.push({ cmd, args });
			if (args[0] === "pr" && args[1] === "list") {
				return [{ number: 2, headRefName: "feature-child" }, { number: 1, headRefName: "feature-base" }] as GhPRListItem[] as T;
			}
			if (args[0] === "pr" && args[1] === "view") {
				const pr = prs.get(Number(args[2]));
				if (!pr) throw new Error(`unexpected PR ${args[2]}`);
				return pr as T;
			}
			throw new Error(`unexpected gh call: ${cmd} ${args.join(" ")}`);
		},
	});

	assert.equal(written, snapshot);
	assert.equal(snapshot.repo, "Example/repo");
	assert.equal(snapshot.fetchedAt, "2026-02-03T04:05:06.000Z");
	assert.deepEqual(snapshot.pullRequests.map((pr) => pr.number), [1, 2]);
	assert.deepEqual(snapshot.pullRequests[0].stackChildren, [2]);
	assert.equal(snapshot.pullRequests[1].stackBasePR, 1);
	assert.deepEqual(calls.map((call) => call.args.slice(0, 3)), [
		["pr", "list", "--repo"],
		["pr", "view", "2"],
		["pr", "view", "1"],
	]);
	assert.deepEqual(calls[0].args, ["pr", "list", "--repo", "Example/repo", "--state", "open", "--limit", "50", "--json", "number,headRefName"]);
	assert.ok(calls[1].args.includes("number,title,author,url,isDraft,baseRefName,headRefName,headRefOid,headRepositoryOwner,headRepository,createdAt,updatedAt,state,closedAt,mergedAt,reviewDecision,mergeStateStatus,reviews,comments,commits,statusCheckRollup,files"));
});

test("refreshMetadata uses default repo and limit when input is empty", async () => {
	let listArgs: string[] | undefined;
	await refreshMetadata({}, {
		writeSnapshot: async () => {},
		runJson: async <T>(_cmd: string, args: string[]): Promise<T> => {
			listArgs = args;
			return [] as GhPRListItem[] as T;
		},
	});

	assert.deepEqual(listArgs, ["pr", "list", "--repo", "OneBusAway/maglev", "--state", "open", "--limit", "200", "--json", "number,headRefName"]);
});
