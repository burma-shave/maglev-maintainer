import assert from "node:assert/strict";
import { fork } from "node:child_process";
import fs, { access, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { withDecisionFileLock } from "../extensions/decision-lock.ts";
import { deleteDecision, saveDecision } from "../extensions/decisions.ts";
import { loadDecisionsFromFile, writeDecisionsToFile } from "../extensions/state-core.ts";
import { makeDecision, makeDecisionsFile } from "../testdata/fixtures.ts";

async function fixture(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "maglev-decision-lock-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const file = join(root, "state", "decisions.json");
	return { root, file, lock: `${file}.lock`, deps: {
		decisionsFile: file,
		loadDecisions: () => loadDecisionsFromFile(file),
		writeDecisions: (next: ReturnType<typeof makeDecisionsFile>) => writeDecisionsToFile(file, next),
	} };
}

function child(t: TestContext, root: string, file: string, operation: string, pr: number) {
	const process = fork(new URL("../testdata/decision-process.ts", import.meta.url), [file, operation, String(pr), "pause"], {
		env: { ...globalThis.process.env, FIXTURE_ROOT: root, MAGLEV_PR_MAINTAINER_ROOT: root },
		stdio: ["ignore", "pipe", "pipe", "ipc"],
	});
	let stderr = "";
	process.stderr?.on("data", (data) => { stderr += data; });
	const events: Array<{ event: string; message?: string }> = [];
	const waiters: Array<() => void> = [];
	let exited = false;
	process.on("message", (message) => { events.push(message as typeof events[number]); for (const notify of waiters.splice(0)) notify(); });
	process.on("exit", () => { exited = true; for (const notify of waiters.splice(0)) notify(); });
	t.after(() => { if (!exited) process.kill("SIGKILL"); });
	async function wait(names: string[]) {
		for (;;) {
			const error = events.find((item) => item.event === "error");
			assert.equal(error, undefined, error?.message);
			const found = events.find((item) => names.includes(item.event));
			if (found) return found.event;
			assert.equal(exited, false, `child exited unexpectedly: ${stderr}`);
			await new Promise<void>((resolve) => waiters.push(resolve));
		}
	}
	return { process, wait };
}

for (const [firstOperation, secondOperation] of [["upsert", "upsert"], ["delete", "upsert"], ["upsert", "delete"]]) {
	test(`separate-process ${firstOperation}/${secondOperation} transactions preserve unrelated decisions`, { timeout: 10_000 }, async (t) => {
		const { root, file, deps, lock } = await fixture(t);
		await deps.writeDecisions(makeDecisionsFile([makeDecision(7), makeDecision(99)]));
		const first = child(t, root, file, firstOperation, firstOperation === "delete" ? 7 : 5);
		await first.wait(["loaded"]); // first read is held until the other process attempts its transaction
		const second = child(t, root, file, secondOperation, secondOperation === "delete" ? 7 : 6);
		await second.wait(["contended", "loaded"]); // a missing lock would allow both reads before first write
		first.process.send("release");
		await first.wait(["done"]);
		await second.wait(["loaded"]);
		second.process.send("release");
		await second.wait(["done"]);
		const numbers = (await deps.loadDecisions()).file.decisions.map((row) => row.pr);
		assert.deepEqual(numbers, firstOperation === "delete" ? [6, 99] : secondOperation === "delete" ? [5, 99] : [5, 6, 7, 99]);
		await assert.rejects(access(lock), { code: "ENOENT" });
	});
}

test("live/old, orphan, and malformed locks fail closed with bounded contention", async (t) => {
	const { file, lock } = await fixture(t);
	for (const owner of [JSON.stringify({ pid: process.pid, acquiredAt: "1970-01-01T00:00:00Z" }), JSON.stringify({ pid: 99999999 }), "not json", undefined]) {
		await mkdir(lock, { recursive: true });
		if (owner !== undefined) await writeFile(join(lock, "owner.json"), owner);
		const identity = await lstat(lock);
		let called = false;
		await assert.rejects(withDecisionFileLock(file, async () => { called = true; }, { timeoutMs: 10, pollMs: 2 }), /Timed out.*manual recovery/);
		assert.equal(called, false);
		assert.equal((await lstat(lock)).ino, identity.ino);
		if (owner !== undefined) assert.equal(await readFile(join(lock, "owner.json"), "utf8"), owner);
		await rm(lock, { recursive: true }); // fixture-only manual recovery, with no active writer
		await withDecisionFileLock(file, async () => {});
	}
});

test("cancellation while waiting leaves the other owner's lock untouched", async (t) => {
	const { file, lock } = await fixture(t);
	await mkdir(lock, { recursive: true });
	await writeFile(join(lock, "owner.json"), "other owner");
	const controller = new AbortController();
	const original = fs.mkdir;
	let notify!: () => void;
	const contended = new Promise<void>((resolve) => { notify = resolve; });
	fs.mkdir = (async (...args: Parameters<typeof fs.mkdir>) => {
		try {
			return await original(...args);
		} catch (error) {
			if (args[0] === lock && (error as NodeJS.ErrnoException).code === "EEXIST") notify();
			throw error;
		}
	}) as typeof fs.mkdir;
	syncBuiltinESMExports();
	try {
		const pending = withDecisionFileLock(file, async () => assert.fail("must not enter"), { signal: controller.signal });
		await contended;
		controller.abort();
		await assert.rejects(pending, { name: "AbortError" });
	} finally {
		fs.mkdir = original;
		syncBuiltinESMExports();
	}
	assert.equal(await readFile(join(lock, "owner.json"), "utf8"), "other owner");
});

test("read/write failures and cancellation before writing release owned locks", async (t) => {
	const { file, lock, deps } = await fixture(t);
	await deps.writeDecisions(makeDecisionsFile([makeDecision(7)]));
	for (const operation of ["save", "delete"]) {
		for (const failingStage of ["read", "write", "cancel"]) {
			const controller = new AbortController();
			const failingDeps = {
				...deps, signal: controller.signal,
				loadDecisions: async () => {
					if (failingStage === "read") throw new Error("fixture read failure");
					const result = await deps.loadDecisions();
					if (failingStage === "cancel") controller.abort();
					return result;
				},
				writeDecisions: async () => { throw new Error("fixture write failure"); },
			};
			await assert.rejects(operation === "save"
				? saveDecision(5, { bucket: "review", reason: "ready" }, failingDeps)
				: deleteDecision(7, failingDeps), failingStage === "cancel" ? { name: "AbortError" } : /fixture .* failure/);
			await assert.rejects(access(lock), { code: "ENOENT" });
			assert.deepEqual((await deps.loadDecisions()).file.decisions.map((row) => row.pr), [7]);
		}
	}
	await saveDecision(6, { bucket: "watch", reason: "waiting" }, deps);
	assert.deepEqual((await deps.loadDecisions()).file.decisions.map((row) => row.pr), [6, 7]);
});

test("partial metadata setup failure cleans up the acquired directory", async (t) => {
	const { file, lock } = await fixture(t);
	const original = fs.open;
	fs.open = (async (...args: Parameters<typeof fs.open>) => {
		const handle = await original(...args);
		const write = handle.writeFile.bind(handle);
		handle.writeFile = async (...writeArgs: Parameters<typeof handle.writeFile>) => {
			await write(...writeArgs);
			throw new Error("fixture metadata failure");
		};
		return handle;
	}) as typeof fs.open;
	syncBuiltinESMExports();
	try {
		await assert.rejects(withDecisionFileLock(file, async () => assert.fail("must not enter")), /fixture metadata failure/);
	} finally {
		fs.open = original;
		syncBuiltinESMExports();
	}
	await assert.rejects(access(lock), { code: "ENOENT" });
	await withDecisionFileLock(file, async () => {});
});

test("release refuses to remove a lock with replaced ownership", async (t) => {
	const { file, lock } = await fixture(t);
	await assert.rejects(withDecisionFileLock(file, async () => {
		await writeFile(join(lock, "owner.json"), JSON.stringify({ token: "replacement" }));
	}), /owner changed.*refusing release/);
	assert.deepEqual(JSON.parse(await readFile(join(lock, "owner.json"), "utf8")), { token: "replacement" });
});

test("abrupt process termination leaves an orphan; manual fixture recovery permits writes", { timeout: 10_000 }, async (t) => {
	const { root, file, lock, deps } = await fixture(t);
	const writer = child(t, root, file, "upsert", 5);
	await writer.wait(["loaded"]);
	const exited = new Promise<void>((resolve) => writer.process.once("exit", () => resolve()));
	writer.process.kill("SIGKILL");
	await exited;
	await assert.rejects(withDecisionFileLock(file, async () => assert.fail("must not enter"), { timeoutMs: 10, pollMs: 2 }), /Timed out/);
	await rm(lock, { recursive: true }); // dead fixture writer confirmed, no other writers
	await saveDecision(6, { bucket: "review", reason: "ready" }, deps);
	assert.deepEqual((await deps.loadDecisions()).file.decisions.map((row) => row.pr), [6]);
});
