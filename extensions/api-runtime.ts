import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, appendFile, realpath, access } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { atomicWriteJson, isNotFoundError } from "./utils.ts";
import { validBenchId } from "./bench-registry.ts";

const exec = promisify(execFile);
export const LEGACY_ASSETS = fileURLToPath(new URL("../assets/legacy-oba/", import.meta.url));
export const DEFAULT_GTFS_URL = "https://www.soundtransit.org/GTFS-KCM/google_transit.zip";
export interface RuntimeParams {
	implementation: "maglev" | "legacy";
	pr?: number;
	benchId?: string;
	workingDirectory?: string;
	apply?: boolean;
	port?: number;
	gtfsUrl?: string;
	timeoutSeconds?: number;
	removeVolumes?: boolean;
	removeImages?: boolean;
}
export interface RuntimeManifest {
	schemaVersion: 1;
	implementation: "maglev" | "legacy";
	project: string;
	sourcePath: string;
	version: string;
	port: number;
	gtfsUrl: string;
}
export interface RuntimeDeps {
	root: string;
	checkoutDir: string;
	cwd: string;
	/** Resolved PR association; identity/path remains the original Bench ID. */
	prBenchId?: string;
	run?: (args: string[], logPath: string, signal?: AbortSignal) => Promise<string>;
	probe?: (url: string, signal?: AbortSignal) => Promise<boolean>;
	now?: () => number;
	sleep?: (ms: number, signal?: AbortSignal) => Promise<unknown>;
}

export function runtimeIdentity(params: RuntimeParams, deps: RuntimeDeps) {
	if (!["maglev", "legacy"].includes(params.implementation)) throw new Error("Unknown implementation");
	if (params.pr !== undefined && (!Number.isInteger(params.pr) || params.pr < 1)) throw new Error("Invalid PR number");
	if (params.benchId && !validBenchId(params.benchId)) throw new Error("Invalid Bench ID");
	if ([params.pr, params.benchId, params.workingDirectory].filter((value) => value !== undefined).length > 1) throw new Error("Specify pr, benchId, or workingDirectory, not both/multiple targets");
	if (params.implementation === "legacy" && (params.pr || params.benchId || params.workingDirectory)) throw new Error("Legacy uses the pinned packaged version, not a PR checkout");
	const benchId = params.benchId ?? (params.pr ? deps.prBenchId ?? `pr-${params.pr}` : undefined);
	if (benchId && !validBenchId(benchId)) throw new Error("Invalid resolved Bench ID");
	const sourcePath = params.implementation === "legacy" ? "" : resolve(benchId ? join(deps.checkoutDir, benchId) : params.workingDirectory ?? deps.cwd);
	const id = params.implementation === "legacy" ? "legacy" : `maglev-${createHash("sha256").update(sourcePath).digest("hex").slice(0, 12)}`;
	const directory = join(deps.root, "runtimes", id);
	const rootId = createHash("sha256").update(resolve(deps.root)).digest("hex").slice(0, 8);
	return { sourcePath, directory, manifestPath: join(directory, "runtime.json"), composePath: join(directory, "compose.json"), logPath: join(directory, "runtime.log"), project: `mpr-${rootId}-${id}` };
}

export function buildRuntimeCompose(manifest: RuntimeManifest, directory: string) {
	if (manifest.implementation === "maglev") return {
		services: { maglev: {
			build: { context: manifest.sourcePath, dockerfile: "Dockerfile" },
			ports: [`127.0.0.1:${manifest.port}:4000`],
			volumes: [`${join(directory, "config.json")}:/app/config.json:ro`, "maglev-data:/app/data"],
			environment: { TZ: "UTC" },
		} }, volumes: { "maglev-data": {} },
	};
	return {
		services: {
			oba_database: { image: "mysql:8.4", environment: { MYSQL_ROOT_PASSWORD: "local-only-root", MYSQL_DATABASE: "oba_database", MYSQL_USER: "oba_user", MYSQL_PASSWORD: "oba_password" }, volumes: ["mysql-data:/var/lib/mysql"] },
			oba_app: {
				depends_on: ["oba_database"], build: { context: join(LEGACY_ASSETS, "oba"), args: { OBA_VERSION: manifest.version } },
				environment: { JDBC_URL: "jdbc:mysql://oba_database:3306/oba_database", JDBC_DRIVER: "com.mysql.cj.jdbc.Driver", JDBC_USER: "oba_user", JDBC_PASSWORD: "oba_password", TEST_API_KEY: "test", TZ: "America/Los_Angeles", GTFS_URL: manifest.gtfsUrl },
				volumes: ["oba-bundle:/bundle"], ports: [`127.0.0.1:${manifest.port}:8080`],
			},
		}, volumes: { "mysql-data": {}, "oba-bundle": {} },
	};
}

export async function probeReady(url: string, signal?: AbortSignal): Promise<boolean> {
	try {
		const response = await fetch(url, { signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]) });
		if (!response.ok) return false;
		const body = await response.json() as { code?: number; data?: { list?: unknown[] } };
		return body.code === 200 && Array.isArray(body.data?.list) && body.data.list.length > 0;
	} catch (error) {
		if (signal?.aborted) throw error;
		return false;
	}
}

export async function waitForRuntime(url: string, seconds: number, deps: RuntimeDeps, signal?: AbortSignal) {
	const now = deps.now ?? Date.now;
	const deadline = now() + seconds * 1000;
	do {
		signal?.throwIfAborted();
		if (await (deps.probe ?? probeReady)(url, signal)) return;
		if (now() >= deadline) break;
		await (deps.sleep ?? ((ms, s) => sleep(ms, undefined, { signal: s })))(Math.min(5000, deadline - now()), signal);
	} while (now() < deadline);
	throw new Error(`API did not load agencies within ${seconds}s`);
}

export async function manageRuntime(action: "start" | "stop" | "status", params: RuntimeParams, deps: RuntimeDeps, signal?: AbortSignal) {
	const identity = runtimeIdentity(params, deps);
	let saved: RuntimeManifest | undefined;
	try { saved = JSON.parse(await readFile(identity.manifestPath, "utf8")); }
	catch (error) { if (!isNotFoundError(error)) throw error; }
	if (saved && (saved.schemaVersion !== 1 || saved.project !== identity.project || saved.implementation !== params.implementation)) throw new Error("Runtime manifest identity mismatch");
	const port = params.port ?? saved?.port ?? (params.implementation === "legacy" ? 8080 : 4000);
	if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("port must be an integer from 1024 to 65535");
	const timeout = params.timeoutSeconds ?? 1800;
	if (!Number.isInteger(timeout) || timeout < 1 || timeout > 3600) throw new Error("timeoutSeconds must be an integer from 1 to 3600");
	const gtfsUrl = params.gtfsUrl ?? saved?.gtfsUrl ?? DEFAULT_GTFS_URL;
	if (!["http:", "https:"].includes(new URL(gtfsUrl).protocol)) throw new Error("gtfsUrl must be HTTP(S)");
	if (saved && ((params.port !== undefined && port !== saved.port) || (params.gtfsUrl !== undefined && gtfsUrl !== saved.gtfsUrl))) throw new Error("Runtime configuration differs; stop it first and use a separate maintainer root for different feed/configuration");
	const baseUrl = `http://127.0.0.1:${port}`;
	const readyUrl = `${baseUrl}/api/where/agencies-with-coverage.json?key=test`;
	const run = deps.run ?? (async (args: string[], logPath: string, s?: AbortSignal) => {
		if (action !== "status") await mkdir(dirname(logPath), { recursive: true });
		try {
			const result = await exec(args[0]!, args.slice(1), { signal: s, timeout: timeout * 1000, maxBuffer: 20 * 1024 * 1024 });
			if (action !== "status") await appendFile(logPath, `\n$ ${args.join(" ")}\n${result.stdout}${result.stderr}`);
			return result.stdout;
		} catch (error) {
			const e = error as Error & { stdout?: string; stderr?: string };
			if (action !== "status") await appendFile(logPath, `\n$ ${args.join(" ")}\n${e.stdout ?? ""}${e.stderr ?? ""}\n${e.message}\n`);
			throw new Error(`${e.message}\nFull output: ${logPath}`, { cause: error });
		}
	});
	const compose = (...args: string[]) => run(["docker", "compose", "--project-name", identity.project, "-f", identity.composePath, ...args], identity.logPath, signal);
	const result = { action, applied: false, ...identity, baseUrl, apiKey: "test", version: saved?.version, sourcePath: saved?.sourcePath ?? identity.sourcePath, ready: false, warnings: ["Downloads feeds/images and builds local code on start. GTFS bundle/database volumes are preserved by default."] };
	if (action === "status") {
		if (!saved) return { ...result, status: "not-created" };
		const containers = await compose("ps", "--all", "--format", "json");
		const running = await compose("ps", "--status", "running", "--services");
		const service = params.implementation === "maglev" ? "maglev" : "oba_app";
		return { ...result, containers, ready: running.trim().split(/\s+/).includes(service) && await (deps.probe ?? probeReady)(readyUrl, signal) };
	}
	if (action === "stop") {
		if (!saved) return { ...result, status: "not-created", plan: [] };
		const args = ["down", ...(params.removeVolumes ? ["--volumes"] : []), ...(params.removeImages ? ["--rmi", "local"] : [])];
		if (params.removeVolumes) result.warnings.push("DESTRUCTIVE: removes this runtime's GTFS bundle and database volumes.");
		if (!params.apply) return { ...result, plan: args };
		await compose(...args);
		return { ...result, applied: true, status: "stopped" };
	}
	if (params.removeVolumes || params.removeImages) throw new Error("Removal options are only valid for stop");
	let sourcePath = identity.sourcePath;
	let version = "checkout";
	let config: Record<string, unknown> | undefined;
	if (params.implementation === "legacy") {
		version = (await readFile(join(LEGACY_ASSETS, "VERSION"), "utf8")).trim();
		sourcePath = join(deps.root, "runtimes", "source", `oba-${version}`);
	} else {
		sourcePath = await realpath(sourcePath);
		await access(join(sourcePath, "Dockerfile"));
		config = JSON.parse(await readFile(join(sourcePath, "config.example.json"), "utf8"));
		Object.assign(config!, { port: 4000, "api-keys": ["test"], "protected-api-keys": [], "gtfs-static-feed": { url: gtfsUrl, "enable-gtfs-tidy": false }, "gtfs-rt-feeds": [], "data-path": "/app/data/gtfs.db" });
	}
	const manifest: RuntimeManifest = { schemaVersion: 1, implementation: params.implementation, project: identity.project, sourcePath, version, port, gtfsUrl };
	const plan = [params.implementation === "legacy" ? `Cache Java source tag v${version}` : `Build Maglev from ${sourcePath}`, "docker compose up --build -d", `Wait for non-empty agencies: ${readyUrl}`];
	if (!params.apply) return { ...result, sourcePath, version, plan };
	await mkdir(identity.directory, { recursive: true });
	if (params.implementation === "legacy") {
		try { await access(join(sourcePath, ".git")); }
		catch (error) {
			if (!isNotFoundError(error)) throw error;
			await mkdir(dirname(sourcePath), { recursive: true });
			await run(["git", "clone", "--depth", "1", "--branch", `v${version}`, "https://github.com/OneBusAway/onebusaway-application-modules.git", sourcePath], identity.logPath, signal);
		}
	}
	if (config) await atomicWriteJson(join(identity.directory, "config.json"), config);
	await atomicWriteJson(identity.composePath, buildRuntimeCompose(manifest, identity.directory));
	await atomicWriteJson(identity.manifestPath, manifest);
	await compose("up", "--build", "-d");
	try { await waitForRuntime(readyUrl, timeout, deps, signal); }
	catch (error) { throw new Error(`${(error as Error).message}. Containers were left for inspection; use status or stop. Logs: docker compose --project-name ${identity.project} -f ${identity.composePath} logs --tail 100. Build log: ${identity.logPath}`, { cause: error }); }
	return { ...result, sourcePath, version, applied: true, ready: true, status: "ready" };
}
