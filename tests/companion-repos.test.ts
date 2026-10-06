import assert from "node:assert/strict";
import test from "node:test";
import { formatCompanionReposReport, resolveCompanionRepos } from "../extensions/companion-repos.ts";

function fakeGit(responses: (args: string[]) => { ok?: boolean; stdout?: string; stderr?: string }) {
	const calls: string[][] = [];
	return {
		calls,
		runGit: async (args: string[]) => {
			calls.push(args);
			const response = responses(args);
			return { ok: response.ok ?? true, stdout: response.stdout ?? "", stderr: response.stderr ?? "" };
		},
	};
}

function standardRepoResponses(repoUrl: string, branch = "main", status = "") {
	return (args: string[]) => {
		const command = args.join(" ");
		if (command.includes("config --get remote.origin.url")) return { stdout: `${repoUrl}\n` };
		if (command.includes("rev-parse --show-toplevel")) return { stdout: "/checkout\n" };
		if (command.includes("symbolic-ref --short HEAD")) return { stdout: `${branch}\n` };
		if (command.includes("rev-parse HEAD")) return { stdout: "abcdef123456\n" };
		if (command.includes("status --porcelain")) return { stdout: status };
		if (command.includes("pull --ff-only")) return { stdout: "" };
		if (command.startsWith("clone ")) return { stdout: "" };
		return { stdout: "" };
	};
}

test("resolveCompanionRepos uses maintainer companion repo dir and updates clean reference repos", async () => {
	const git = fakeGit(standardRepoResponses("https://github.com/onebusaway/js-sdk.git"));
	const result = await resolveCompanionRepos({ repos: ["js-sdk"] }, {
		companionReposDir: "/var/lib/maglev-pr-maintainer/companion-repos",
	}, {
		exists: (path) => path === "/var/lib/maglev-pr-maintainer/companion-repos/js-sdk/.git",
		runGit: git.runGit,
	});

	assert.equal(result.ok, true);
	assert.equal(result.repos[0]?.path, "/var/lib/maglev-pr-maintainer/companion-repos/js-sdk");
	assert.equal(result.repos[0]?.source, "maintainer-root");
	assert.equal(result.repos[0]?.updated, true);
	assert.ok(git.calls.some((args) => args.join(" ").includes("pull --ff-only --quiet origin main")));
});

test("resolveCompanionRepos honors OBA_WORKSPACE and canonicalizes oba-java alias", async () => {
	const git = fakeGit(standardRepoResponses("git@github.com:onebusaway/onebusaway-application-modules.git"));
	const result = await resolveCompanionRepos({ repos: ["oba-java"] }, {
		companionReposDir: "/var/lib/maglev-pr-maintainer/companion-repos",
		obaWorkspace: "/custom/oba",
	}, {
		exists: (path) => path === "/custom/oba/onebusaway-application-modules/.git",
		runGit: git.runGit,
	});

	assert.equal(result.repos[0]?.inputName, "oba-java");
	assert.equal(result.repos[0]?.name, "onebusaway-application-modules");
	assert.equal(result.repos[0]?.path, "/custom/oba/onebusaway-application-modules");
	assert.equal(result.repos[0]?.source, "OBA_WORKSPACE");
});

test("resolveCompanionRepos clones missing repos into the maintainer companion repo dir", async () => {
	const git = fakeGit(standardRepoResponses("https://github.com/onebusaway/maglev.wiki.git"));
	const mkdirs: string[] = [];
	const result = await resolveCompanionRepos({ repos: ["maglev.wiki"] }, {
		companionReposDir: "/var/lib/maglev-pr-maintainer/companion-repos",
	}, {
		exists: () => false,
		mkdir: async (path) => { mkdirs.push(path); },
		runGit: git.runGit,
	});

	assert.equal(result.ok, true);
	assert.equal(result.repos[0]?.cloned, true);
	assert.deepEqual(mkdirs, ["/var/lib/maglev-pr-maintainer/companion-repos"]);
	assert.ok(git.calls.some((args) => args.join(" ") === "clone --depth 1 https://github.com/onebusaway/maglev.wiki.git /var/lib/maglev-pr-maintainer/companion-repos/maglev.wiki"));
});

test("resolveCompanionRepos reports dirty reference repos and does not pull them", async () => {
	const git = fakeGit(standardRepoResponses("https://github.com/onebusaway/wayfinder.git", "main", " M file.ts\n"));
	const result = await resolveCompanionRepos({ repos: ["wayfinder"] }, {
		companionReposDir: "/var/lib/maglev-pr-maintainer/companion-repos",
	}, {
		exists: (path) => path.endsWith("/.git"),
		runGit: git.runGit,
	});

	assert.equal(result.ok, true);
	assert.equal(result.repos[0]?.dirty, true);
	assert.match(result.repos[0]?.anomalies[0]?.message ?? "", /local changes/);
	assert.equal(git.calls.some((args) => args.join(" ").includes("pull --ff-only")), false);
	assert.match(formatCompanionReposReport(result), /warning: Reference repo wayfinder has local changes/);
});
