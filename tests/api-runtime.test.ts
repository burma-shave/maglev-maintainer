import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manageRuntime, runtimeIdentity, waitForRuntime, probeReady, type RuntimeDeps } from "../extensions/api-runtime.ts";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
	const root = await mkdtemp(join(tmpdir(), "mpr-runtime-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const cwd = join(root, "checkout");
	await mkdir(cwd);
	await writeFile(join(cwd, "Dockerfile"), "FROM scratch\n");
	await writeFile(join(cwd, "config.example.json"), JSON.stringify({ "gtfs-rt-feeds": [{ id: "example" }] }));
	const calls: string[][] = [];
	const deps: RuntimeDeps = { root, checkoutDir: join(root, "checkouts"), cwd, run: async (args) => { calls.push(args); return ""; }, probe: async () => true };
	return { root, cwd, calls, deps };
}

test("start planning is non-mutating and executes no commands", async (t) => {
	const { deps, root, calls } = await fixture(t);
	const result = await manageRuntime("start", { implementation: "maglev" }, deps);
	assert.equal(result.applied, false);
	assert.equal(result.baseUrl, "http://127.0.0.1:4000");
	assert.deepEqual(calls, []);
	assert.deepEqual(await readdir(root), ["checkout"]);
});

test("Maglev start generates isolated config and stop preserves data by default", async (t) => {
	const { deps, cwd, calls } = await fixture(t);
	const before = await readFile(join(cwd, "config.example.json"), "utf8");
	const params = { implementation: "maglev" as const, apply: true, port: 4100 };
	const result = await manageRuntime("start", params, deps);
	assert.equal(result.ready, true);
	assert.equal(result.applied, true);
	assert.match(result.project, /^mpr-[a-f0-9]{8}-maglev-/);
	const config = JSON.parse(await readFile(join(result.directory, "config.json"), "utf8"));
	assert.deepEqual(config["gtfs-rt-feeds"], []);
	assert.equal(config["data-path"], "/app/data/gtfs.db");
	assert.equal(await readFile(join(cwd, "config.example.json"), "utf8"), before);
	const compose = JSON.parse(await readFile(result.composePath, "utf8"));
	assert.deepEqual(compose.services.maglev.ports, ["127.0.0.1:4100:4000"]);
	assert.equal(compose.services.maglev.container_name, undefined);
	const planned = await manageRuntime("stop", { implementation: "maglev" }, deps);
	assert.deepEqual(planned.plan, ["down"]);
	assert.equal(calls.length, 1);
	await manageRuntime("stop", { implementation: "maglev", apply: true }, deps);
	assert.equal(calls.at(-1)?.at(-1), "down");
	await manageRuntime("stop", { implementation: "maglev", apply: true, removeVolumes: true, removeImages: true }, deps);
	assert.deepEqual(calls.at(-1)?.slice(-4), ["down", "--volumes", "--rmi", "local"]);
});

test("legacy pins source and uses internal MySQL and separate persistent volumes", async (t) => {
	const { deps, calls } = await fixture(t);
	const plan = await manageRuntime("start", { implementation: "legacy" }, deps);
	assert.equal(plan.version, "2.7.1");
	assert.match(plan.sourcePath, /oba-2\.7\.1$/);
	assert.equal(calls.length, 0);
	const result = await manageRuntime("start", { implementation: "legacy", apply: true }, deps);
	assert.equal(calls[0]?.[0], "git");
	assert.ok(calls[0]?.includes("v2.7.1"));
	const compose = JSON.parse(await readFile(result.composePath, "utf8"));
	assert.equal(compose.services.oba_database.ports, undefined);
	assert.equal(compose.services.oba_app.container_name, undefined);
	assert.deepEqual(compose.services.oba_app.ports, ["127.0.0.1:8080:8080"]);
	assert.ok(compose.volumes["oba-bundle"]);
});

test("identity rejects ambiguous targets and isolates checkout projects", async (t) => {
	const { deps } = await fixture(t);
	assert.throws(() => runtimeIdentity({ implementation: "legacy", pr: 1 }, deps), /Legacy/);
	assert.throws(() => runtimeIdentity({ implementation: "maglev", pr: 1, workingDirectory: "/x" }, deps), /not both/);
	assert.notEqual(runtimeIdentity({ implementation: "maglev", pr: 1 }, deps).project, runtimeIdentity({ implementation: "maglev", pr: 2 }, deps).project);
	assert.notEqual(runtimeIdentity({ implementation: "legacy" }, deps).project, runtimeIdentity({ implementation: "legacy" }, { ...deps, root: "/different-root" }).project);
	await assert.rejects(manageRuntime("start", { implementation: "maglev", port: 1.5 }, deps), /port/);
	await assert.rejects(manageRuntime("start", { implementation: "legacy", gtfsUrl: "file:///etc/passwd" }, deps), /HTTP/);
});

test("status/stop missing runtimes do not start or write; saved settings cannot drift", async (t) => {
	const { deps, calls } = await fixture(t);
	assert.equal((await manageRuntime("status", { implementation: "legacy" }, deps)).status, "not-created");
	assert.equal((await manageRuntime("stop", { implementation: "legacy", apply: true }, deps)).applied, false);
	assert.equal(calls.length, 0);
	await manageRuntime("start", { implementation: "maglev", apply: true }, deps);
	await assert.rejects(manageRuntime("start", { implementation: "maglev", port: 4999 }, deps), /configuration differs/);
	let probes = 0;
	deps.probe = async () => { probes++; return true; };
	const stopped = await manageRuntime("status", { implementation: "maglev" }, deps);
	assert.equal(stopped.ready, false);
	assert.equal(probes, 0);
	deps.run = async (args) => args.includes("--services") ? "maglev\n" : "[]";
	assert.equal((await manageRuntime("status", { implementation: "maglev" }, deps)).ready, true);
});

test("readiness waits for loaded agencies, times out and supports cancellation", async () => {
	let clock = 0;
	let probes = 0;
	const deps: RuntimeDeps = { root: "/unused", checkoutDir: "/unused", cwd: "/unused", now: () => clock, sleep: async (ms) => { clock += ms; }, probe: async () => ++probes > 1 };
	await waitForRuntime("http://example", 10, deps);
	assert.equal(probes, 2);
	deps.probe = async () => false;
	await assert.rejects(waitForRuntime("http://example", 1, deps), /did not load agencies/);
	await assert.rejects(waitForRuntime("http://example", 1, deps, AbortSignal.abort()), /abort/i);
	const original = globalThis.fetch;
	try {
		for (const body of [{ code: 200, data: { list: [] } }, { code: 500, data: { list: [{}] } }, { code: 200, data: { list: [{}] } }]) {
			globalThis.fetch = async () => new Response(JSON.stringify(body));
			assert.equal(await probeReady("http://example"), body.code === 200 && body.data.list.length > 0);
		}
	} finally { globalThis.fetch = original; }
});

test("failed startup is not reported ready and leaves a stoppable manifest", async (t) => {
	const { deps } = await fixture(t);
	deps.run = async () => { throw new Error("build failed"); };
	await assert.rejects(manageRuntime("start", { implementation: "maglev", apply: true }, deps), /build failed/);
	const stop = await manageRuntime("stop", { implementation: "maglev" }, deps);
	assert.deepEqual(stop.plan, ["down"]);
});
