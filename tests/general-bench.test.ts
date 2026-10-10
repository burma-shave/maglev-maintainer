import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { branchBenchDefinition, loadBenchDefinitions, prBenchDefinition, saveBenchDefinition, validateBenchDefinition, validBranchName } from "../extensions/bench-registry.ts";
import { executeBenchStart, planBenchClose, planBenchReset, planBenchStart, verifyBenchStart } from "../extensions/bench-core.ts";
import { inspectCommitSafety } from "../extensions/bench.ts";
import { buildWorkspaceContext } from "../extensions/workspace-context.ts";
import { runtimeIdentity } from "../extensions/api-runtime.ts";
import type { GeneralBenchState } from "../extensions/types.ts";
import { makeSnapshotFile, makeSnapshotPr } from "../testdata/fixtures.ts";

const exec = promisify(execFile);
const target = branchBenchDefinition("feature/branch-benches");
function bench(overrides: Partial<GeneralBenchState> = {}): GeneralBenchState {
	return { ...target, sessionName: target.id, benchPath: `/var/lib/maglev-maintainer/checkouts/${target.id}`, currentBranch: target.branchName,
		branchExists: true, checkoutExists: true, checkoutKind: "plain", worktreeRegistered: false, tmuxExists: false, piWindowExists: false,
		dirty: false, dirtyStatus: "clean", commitSafety: "safe", freshness: "unknown", warnings: [], ...overrides };
}
function recordingDeps(localBranch = false) {
	const calls: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
	return { calls, deps: {
		commandSucceeds: async (cmd: string, args: string[]) => localBranch && cmd === "git" && args[0] === "show-ref",
		runText: async (cmd: string, args: string[], cwd?: string) => {
			calls.push({ cmd, args, cwd });
			return cmd === "git" && args[0] === "rev-parse" ? "abc123\n" : "";
		},
	} };
}

test("stable Bench IDs are safe, deterministic, and distinguish slug collisions", () => {
	assert.equal(branchBenchDefinition("feature/branch-benches").id, target.id);
	assert.notEqual(branchBenchDefinition("feature/branch-benches").id, branchBenchDefinition("feature-branch-benches").id);
	assert.notEqual(branchBenchDefinition("Feature/branch-benches").id, target.id);
	assert.equal(branchBenchDefinition("pr-123").pr, undefined);
	assert.deepEqual(prBenchDefinition(123), { id: "pr-123", repo: "OneBusAway/maglev", branchName: "pr-123", pr: 123 });
	for (const name of ["", "-bad", "../escape", "a..b", "a.lock", "a/.hidden", "HEAD", "has space", "x@{y", "a\\b", "x\nfoo"]) {
		assert.equal(validBranchName(name), false, name);
		assert.throws(() => branchBenchDefinition(name));
	}
	assert.throws(() => branchBenchDefinition("valid", "--orphan"));
	assert.throws(() => validateBenchDefinition({ ...target, id: "../../escape" }));
	assert.throws(() => validateBenchDefinition({ ...target, branchName: "different" }));
});

test("branch start uses the shared planner without snapshot or triage", () => {
	const plan = planBenchStart({ target });
	assert.equal(plan.status, "ready");
	assert.equal(plan.pr, undefined);
	assert.equal(plan.sessionName, target.id);
	assert.equal(plan.options.apply, false);
	assert.ok(!plan.findings.some((finding) => finding.code.includes("snapshot")));
	assert.ok(plan.actions.some((action) => action.includes("existing remote branch")));
});

test("branch execution opens a tracking branch and shares tmux/context startup", async () => {
	const plan = planBenchStart({ target }, { apply: true, context: "Background only" });
	const { calls, deps } = recordingDeps();
	const executed = await executeBenchStart({ plan }, { ...deps, writeContext: async (context) => {
		assert.equal(context, "Background only"); return "/tmp/background.md";
	} });
	assert.ok(executed.length > 0);
	assert.ok(calls.some((call) => call.cmd === "git" && call.args.join(" ") === `switch --track -c ${target.branchName} origin/${target.branchName}`));
	const command = calls.find((call) => call.cmd === "tmux")!.args.at(-1)!;
	assert.match(command, /--append-system-prompt '\/tmp\/background.md'/);
	assert.match(command, /Bench feature\/branch-benches/);
	assert.ok(!calls.some((call) => call.cmd === "gh" && call.args[0] === "pr"));
});

test("opening the remote default branch does not try to create an existing local branch", async () => {
	const { calls, deps } = recordingDeps(true);
	const main = branchBenchDefinition("main");
	await executeBenchStart({ plan: planBenchStart({ target: main }, { apply: true }) }, deps);
	assert.deepEqual(calls.find((call) => call.cmd === "git" && call.args[0] === "switch")?.args, ["switch", "main"]);
});

test("branch creation is explicit and does not track the base branch", async () => {
	const created = branchBenchDefinition("new-feature", "origin/main");
	const { calls, deps } = recordingDeps();
	await executeBenchStart({ plan: planBenchStart({ target: created }, { apply: true }) }, deps);
	assert.ok(calls.some((call) => call.args.join(" ") === "switch --no-track -c new-feature origin/main"));
	await assert.rejects(() => executeBenchStart({ plan: planBenchStart({ target: created }, { apply: true }) }, recordingDeps(true).deps), /already exists/);
});

test("recovering a branch Bench never pulls, resets, or changes its branch", async () => {
	const existingBench = bench();
	const plan = planBenchStart({ target, existingBench }, { apply: true });
	const { calls, deps } = recordingDeps();
	await executeBenchStart({ plan, existingBench }, deps);
	assert.deepEqual(calls.map((call) => call.cmd), ["git", "tmux"]);
	assert.ok(!calls.some((call) => call.args.includes("pull") || call.args.includes("reset") || call.args.includes("switch")));
	assert.equal(planBenchStart({ target, existingBench: bench({ currentBranch: "other" }) }).status, "refused");
	assert.equal(planBenchStart({ target, existingBench: bench({ branchExists: false, localOnlyCommits: 1 }) }).status, "refused");
	assert.equal(planBenchStart({ target, existingBench: bench({ tmuxExists: true, piWindowExists: true }) }, { context: "New context" }).status, "refused");
});

test("branch verification does not compare against a PR head", async () => {
	const plan = planBenchStart({ target }, { apply: true });
	const result = await verifyBenchStart({ plan }, {
		commandSucceeds: async () => true,
		runText: async (cmd, args) => cmd === "tmux" ? "pi\n" : args.includes("--abbrev-ref") ? target.branchName : "arbitrary-head",
	});
	assert.equal(result.ok, true);
});

test("cleanup protects committed work independently of dirty and PR-head overrides", () => {
	for (const commitSafety of ["local-only", "no-upstream", "unknown"] as const) {
		const local = bench({ commitSafety, localOnlyCommits: commitSafety === "local-only" ? 2 : undefined });
		assert.equal(planBenchClose(local, { allowDirty: "any", allowStale: true }).status, "needs-override");
		assert.equal(planBenchClose(local, { allowLocalCommits: true }).status, "ready");
	}
	assert.equal(planBenchClose(bench({ ignoredFiles: 3 }), { allowDirty: "untracked" }).status, "needs-override");
	assert.equal(planBenchClose(bench({ ignoredFiles: 3 }), { allowDirty: "any" }).status, "ready");
	assert.equal(planBenchClose(bench({ checkoutKind: "unknown" }), { allowLocalCommits: true, allowDirty: "any" }).status, "refused");
	assert.equal(planBenchClose(bench({ commitSafety: undefined })).status, "needs-override");
});

test("stopping tmux without deleting a checkout does not require work-loss overrides", () => {
	const local = bench({ tmuxExists: true, commitSafety: "local-only", dirtyStatus: "modified", ignoredFiles: 4, freshness: "stale" });
	const plan = planBenchClose(local, { removeCheckout: false, currentWorkingDirectory: local.benchPath });
	assert.equal(plan.status, "ready");
	assert.deepEqual(plan.actions, [`kill tmux session ${target.id}`]);
});

test("PR specialization preserves the branch Bench identity and supports PR reset", () => {
	const pr = makeSnapshotPr({ number: 45, headRefName: target.branchName, headOid: "new-head" });
	const associated = { ...bench({ localHead: "old-head", freshness: "stale", fresh: false }), pr: 45 };
	const plan = planBenchStart({ target: { ...target, pr: 45 }, pr, existingBench: associated }, { allowHeadMismatch: true });
	assert.equal(plan.status, "ready");
	assert.equal(plan.sessionName, target.id);
	assert.equal(plan.branchName, target.branchName);
	const reset = planBenchReset(associated, pr);
	assert.equal(reset.status, "ready");
	assert.equal(reset.branchName, target.branchName);
	assert.equal(planBenchClose(associated, { allowStale: true }).status, "ready");
});

test("registry round-trips definitions and rejects identity conflicts/corruption", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "bench-registry-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await saveBenchDefinition(target, root);
	assert.deepEqual(await loadBenchDefinitions(root), [target]);
	await saveBenchDefinition({ ...target, pr: 5 }, root);
	await saveBenchDefinition(prBenchDefinition(5), root);
	await assert.rejects(() => loadBenchDefinitions(root), /Multiple benches/);
	await rm(join(root, "pr-5"), { recursive: true });
	await writeFile(join(root, target.id, "bench.json"), "not-json");
	await assert.rejects(() => loadBenchDefinitions(root), /Cannot load Bench/);
});

test("workspace context and API runtime retain stable paths after PR association", () => {
	const paths = { maintainerRoot: "/sandbox", stateDir: "/sandbox/state", snapshotFile: "/sandbox/state/snapshot.json", decisionsFile: "/sandbox/state/decisions.json",
		benchStateDir: "/sandbox/benches", checkoutDir: "/sandbox/checkouts", reviewJsonDir: "/sandbox/review-json", companionReposDir: "/sandbox/companion-repos" };
	const definition = { ...target, pr: 45 };
	const context = buildWorkspaceContext({ cwd: `/sandbox/checkouts/${target.id}/src`, benchDefinitions: [definition] }, paths);
	assert.equal(context.benches.currentPr, 45);
	assert.equal(context.benches.targetBranchName, target.branchName);
	assert.equal(context.artifacts.targetReportsDir, `/sandbox/benches/${target.id}/reports`);
	assert.equal(buildWorkspaceContext({ pr: 45, benchDefinitions: [definition] }, paths).benches.targetCheckoutPath, `/sandbox/checkouts/${target.id}`);
	const deps = { root: "/sandbox", checkoutDir: paths.checkoutDir, cwd: "/elsewhere" };
	const before = runtimeIdentity({ implementation: "maglev", benchId: target.id }, deps);
	const after = runtimeIdentity({ implementation: "maglev", pr: 45 }, { ...deps, prBenchId: target.id });
	assert.deepEqual(before, after);
	assert.throws(() => runtimeIdentity({ implementation: "maglev", benchId: "../../escape" }, deps));
	assert.throws(() => runtimeIdentity({ implementation: "maglev", benchId: target.id, pr: 45 }, deps));
});

async function localRepository(t: { after: (fn: () => Promise<unknown>) => void }) {
	const root = await mkdtemp(join(tmpdir(), "bench-git-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const git = (...args: string[]) => exec("git", args, { cwd: root });
	await git("init", "-b", "main"); await git("config", "user.name", "Test"); await git("config", "user.email", "test@example.com");
	await writeFile(join(root, "file"), "base"); await git("add", "."); await git("commit", "-m", "base");
	return { root, git };
}

test("real Git preservation check covers remote reachability, other branches, stash and ignored files", async (t) => {
	const { root, git } = await localRepository(t);
	await git("remote", "add", "origin", "https://github.com/OneBusAway/maglev.git");
	await git("update-ref", "refs/remotes/origin/main", "HEAD");
	assert.equal((await inspectCommitSafety(root)).commitSafety, "safe");
	await git("branch", "--set-upstream-to", "origin/main");
	assert.equal((await inspectCommitSafety(root)).commitSafety, "safe");
	await git("switch", "-c", "local-work"); await writeFile(join(root, "file"), "local"); await git("commit", "-am", "local work"); await git("switch", "main");
	assert.equal((await inspectCommitSafety(root)).commitSafety, "local-only");
	await git("branch", "-D", "local-work");
	await writeFile(join(root, "file"), "stash me"); await git("stash", "push", "-m", "local stash");
	assert.equal((await inspectCommitSafety(root)).commitSafety, "local-only");
	await git("stash", "clear");
	await writeFile(join(root, ".gitignore"), "ignored\n"); await writeFile(join(root, "ignored"), "important local content");
	assert.equal((await inspectCommitSafety(root)).ignoredFiles, 1);
	assert.equal((await inspectCommitSafety("/path/that/does/not/exist")).commitSafety, "unknown");
});

test("merged branch remains safe after remote deletion and unrelated remote force-push", async (t) => {
	const { root, git } = await localRepository(t);
	await git("config", "core.logAllRefUpdates", "true");
	await git("remote", "add", "origin", "https://github.com/OneBusAway/maglev.git");
	await git("update-ref", "refs/remotes/origin/main", "HEAD");
	await git("switch", "-c", "topic");
	await writeFile(join(root, "file"), "pushed topic");
	await git("commit", "-am", "topic");
	await git("update-ref", "refs/remotes/origin/topic", "HEAD");
	await git("branch", "--set-upstream-to", "origin/topic");
	await git("update-ref", "refs/remotes/origin/main", "HEAD");
	await git("update-ref", "-d", "refs/remotes/origin/topic");
	// Simulate an unrelated remote branch being force-pushed. Its old tip
	// remains only in the remote reflog, not in any local branch or stash.
	const base = (await git("rev-parse", "main")).stdout.trim();
	const tree = (await git("rev-parse", "main^{tree}")).stdout.trim();
	const oldTip = (await git("commit-tree", tree, "-p", base, "-m", "old remote tip")).stdout.trim();
	await git("update-ref", "refs/remotes/origin/unrelated", oldTip);
	await git("update-ref", "refs/remotes/origin/unrelated", base);
	assert.equal((await git("rev-list", "--count", "--all", "--reflog", "--not", "--remotes")).stdout.trim(), "1");
	const safety = await inspectCommitSafety(root);
	assert.equal(safety.upstream, undefined);
	assert.equal(safety.localOnlyCommits, 0);
	assert.equal(safety.commitSafety, "safe");
	assert.equal(planBenchClose(bench(safety)).status, "ready");
});

test("unpushed commits are protected without an upstream and on detached HEAD", async (t) => {
	const { root, git } = await localRepository(t);
	assert.equal((await inspectCommitSafety(root)).commitSafety, "local-only");
	await git("remote", "add", "origin", "https://github.com/OneBusAway/maglev.git");
	await git("update-ref", "refs/remotes/origin/main", "HEAD");
	await git("switch", "--detach");
	await writeFile(join(root, "file"), "detached work");
	await git("commit", "-am", "unpushed detached work");
	const safety = await inspectCommitSafety(root);
	assert.equal(safety.localOnlyCommits, 1);
	assert.equal(safety.commitSafety, "local-only");
	assert.equal(planBenchClose(bench(safety)).status, "needs-override");
});

test("sandbox discovery/association uses the same Bench and PR compatibility view", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "bench-association-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const sandboxTarget = branchBenchDefinition(`test-${root.split("/").at(-1)}`);
	const path = join(root, "checkouts", sandboxTarget.id);
	await mkdir(path, { recursive: true });
	await exec("git", ["init", "-b", sandboxTarget.branchName], { cwd: path });
	await exec("git", ["remote", "add", "origin", "https://github.com/OneBusAway/maglev.git"], { cwd: path });
	await exec("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "base"], { cwd: path });
	const head = (await exec("git", ["rev-parse", "HEAD"], { cwd: path })).stdout.trim();
	await saveBenchDefinition(sandboxTarget, join(root, "benches"));
	const snapshot = makeSnapshotFile([
		makeSnapshotPr({ number: 45, headRefName: sandboxTarget.branchName, headOid: head }),
		makeSnapshotPr({ number: 46, headRefName: "different-branch", headOid: head }),
		makeSnapshotPr({ number: 47, headRefName: sandboxTarget.branchName, headOid: head, headRepositoryNameWithOwner: "someone/maglev" }),
	], { fetchedAt: new Date().toISOString() });
	await mkdir(join(root, "state"), { recursive: true });
	await writeFile(join(root, "state", "github-snapshot.json"), JSON.stringify(snapshot));
	const moduleUrl = new URL("../extensions/bench.ts", import.meta.url).href;
	const source = `import assert from 'node:assert/strict'; import * as b from ${JSON.stringify(moduleUrl)};
		const id=${JSON.stringify(sandboxTarget.id)};
		const fs=await import('node:fs/promises'); const snapshotPath=${JSON.stringify(join(root, "state", "github-snapshot.json"))};
		const snapshot=await fs.readFile(snapshotPath); await fs.unlink(snapshotPath);
		await assert.rejects(()=>b.startGeneralBench({}), /exactly one/);
		await assert.rejects(()=>b.startGeneralBench({branch:'main',pr:45}), /exactly one/);
		await assert.rejects(()=>b.startGeneralBench({pr:45,createFrom:'origin/main'}), /branch/);
		await assert.rejects(()=>b.resolveBenchPr(0), /Invalid PR/);
		assert.deepEqual(await b.resolveBenchPr(45), {pr:45,id:null,found:false});
		const refused=await b.resetGeneralBench(id,{apply:true}); assert.equal(refused.applied,false); assert.equal(refused.plan.refusals[0].code,'pr-association-required');
		const unassociated=await b.startGeneralBench({branch:${JSON.stringify(sandboxTarget.branchName)}}, {context:'Background'});
		assert.equal(unassociated.id,id);
		assert.equal(unassociated.plan.status,'ready'); assert.equal(unassociated.snapshotWarning,undefined); assert.equal(unassociated.applied,false);
		assert.deepEqual(await fs.readdir(${JSON.stringify(join(root, "benches", sandboxTarget.id))}), ['bench.json']);
		await fs.writeFile(snapshotPath,snapshot);
		assert.equal((await b.listBenches()).benches.length,0);
		const first=(await b.collectAllBenchStates()).benches[0]; assert.equal(first.id,id);
		await assert.rejects(()=>b.associateBenchPr(id,46), /does not match/);
		await assert.rejects(()=>b.associateBenchPr(id,47), /does not match/);
		const dry=await b.associateBenchPr(id,45); assert.equal(dry.applied,false);
		assert.equal((await b.listBenches()).benches.length,0);
		const result=await b.associateBenchPr(id,45,{apply:true}); assert.equal(result.applied,true);
		const associated=(await b.inspectBench(45)).bench; assert.equal(associated.id,id); assert.equal(associated.benchPath,first.benchPath);
		assert.deepEqual(await b.resolveBenchPr(45), {pr:45,id,found:true});
		const start=await b.startGeneralBench({pr:45}); assert.equal(start.id,id); assert.equal(start.plan.target.id,id); assert.equal(start.applied,false);
		const reset=await b.resetGeneralBench(id); assert.equal(reset.id,id); assert.equal(reset.plan.pr,45); assert.equal(reset.plan.benchPath,first.benchPath); assert.equal(reset.applied,false);
		await fs.unlink(snapshotPath); assert.equal((await b.resolveBenchPr(45)).id,id); await fs.writeFile(snapshotPath,snapshot);
		const stale=await b.resetGeneralBench(id,{now:'2100-01-01T00:00:00Z'}); assert.equal(stale.plan.status,'needs-override'); assert.equal(stale.applied,false);
		const staleAllowed=await b.resetGeneralBench(id,{now:'2100-01-01T00:00:00Z',allowStaleSnapshot:true}); assert.equal(staleAllowed.plan.status,'ready'); assert.equal(staleAllowed.applied,false);
		const localFile=${JSON.stringify(join(path, 'local-work'))}; await fs.writeFile(localFile,'preserve me');
		assert.equal((await b.resetGeneralBench(id)).plan.status,'needs-override');
		const acknowledged=await b.resetGeneralBench(id,{allowDirty:'untracked'}); assert.equal(acknowledged.plan.status,'ready'); assert.equal(acknowledged.applied,false);
		assert.equal(await fs.readFile(localFile,'utf8'),'preserve me'); await fs.unlink(localFile);
		const generic=await b.startBranchBench(${JSON.stringify(sandboxTarget.branchName)}); assert.equal(generic.plan.pr,45);
		const close=await b.closeGeneralBench(id,{closeTmux:false}); assert.equal(close.applied,false); assert.equal(close.plan.status,'needs-override');
		await fs.mkdir(${JSON.stringify(join(root, 'checkouts', 'pr-88'))}, {recursive:true});
		assert.deepEqual(await b.resolveBenchPr(88), {pr:88,id:'pr-88',found:true});
		assert.deepEqual(await b.resolveBenchPr(89), {pr:89,id:null,found:false});
		await fs.mkdir(${JSON.stringify(join(root, 'checkouts', 'pr-45'))}, {recursive:true});
		await assert.rejects(()=>b.resolveBenchPr(45), /Multiple local benches/);
		await assert.rejects(()=>b.inspectGeneralBench(id), /Multiple local benches/);
		console.log('ok');`;
	const result = await exec(process.execPath, ["--input-type=module", "-e", source], { env: { ...process.env, MAGLEV_MAINTAINER_ROOT: root } });
	assert.equal(result.stdout.trim(), "ok");
	assert.equal(JSON.parse(await readFile(join(root, "benches", sandboxTarget.id, "bench.json"), "utf8")).pr, 45);
});

test("shared executor uses real Git for default/topic branches and new-branch creation, with tmux mocked", async (t) => {
	const source = await localRepository(t);
	await source.git("branch", "topic");
	const root = await mkdtemp(join(tmpdir(), "bench-lifecycle-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const coreUrl = new URL("../extensions/bench-core.ts", import.meta.url).href;
	const registryUrl = new URL("../extensions/bench-registry.ts", import.meta.url).href;
	const script = `import assert from 'node:assert/strict'; import {execFile} from 'node:child_process'; import {promisify} from 'node:util';
		import {mkdir} from 'node:fs/promises';
		import {planBenchStart,executeBenchStart,verifyBenchStart} from ${JSON.stringify(coreUrl)};
		import {branchBenchDefinition} from ${JSON.stringify(registryUrl)};
		const exec=promisify(execFile); await mkdir(${JSON.stringify(join(root, "checkouts"))},{recursive:true});
		let launches=0;
		const deps={
			commandSucceeds:async(cmd,args,cwd)=>{if(cmd==='tmux')return true; try{await exec(cmd,args,{cwd});return true;}catch{return false;}},
			runText:async(cmd,args,cwd)=>{
				if(cmd==='gh'){await exec('git',['clone',${JSON.stringify(source.root)},args.at(-1)]);return '';}
				if(cmd==='tmux'){if(args[0]==='new-session')launches++;return args[0]==='list-windows'?'pi\\n':'';}
				return (await exec(cmd,args,{cwd})).stdout;
			}
		};
		for(const branch of ['main','topic','new-work']) {
			const target=branchBenchDefinition(branch,branch==='new-work'?'origin/main':undefined);
			const plan=planBenchStart({target},{apply:true});
			await executeBenchStart({plan},deps);
			assert.equal((await verifyBenchStart({plan},deps)).ok,true);
			const current=(await exec('git',['branch','--show-current'],{cwd:plan.benchPath})).stdout.trim(); assert.equal(current,branch);
			if(branch==='new-work') await assert.rejects(()=>exec('git',['rev-parse','@{upstream}'],{cwd:plan.benchPath}));
			else assert.equal((await exec('git',['rev-parse','--abbrev-ref','@{upstream}'],{cwd:plan.benchPath})).stdout.trim(),'origin/'+branch);
		}
		assert.equal(launches,3); console.log('ok');`;
	const result = await exec(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, MAGLEV_MAINTAINER_ROOT: root } });
	assert.equal(result.stdout.trim(), "ok");
});
