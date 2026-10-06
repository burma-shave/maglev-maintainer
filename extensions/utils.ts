import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function validIsoTimestamp(value?: string): boolean {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function newerThan(a?: string, b?: string): boolean {
	if (!a || !b) return false;
	const aTime = Date.parse(a);
	const bTime = Date.parse(b);
	return Number.isFinite(aTime) && Number.isFinite(bTime) && aTime > bTime;
}

export function latestTimestamp(...values: Array<string | undefined>): string | undefined {
	return values.filter(validIsoTimestamp).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}

export function latestByDate<T>(items: T[], getDate: (item: T) => string | undefined, pred: (item: T) => boolean = () => true): T | undefined {
	return items
		.filter(pred)
		.filter((item) => validIsoTimestamp(getDate(item)))
		.sort((a, b) => Date.parse(getDate(b)!) - Date.parse(getDate(a)!))[0];
}

export function truncateBody(body?: string, max = 4000): string | undefined {
	if (!body) return undefined;
	return body.length > max ? `${body.slice(0, max)}…` : body;
}

export async function runJson<T>(cmd: string, args: string[], signal?: AbortSignal): Promise<T> {
	const { stdout } = await execFileAsync(cmd, args, { maxBuffer: 50 * 1024 * 1024, signal });
	return JSON.parse(stdout) as T;
}

export async function runText(cmd: string, args: string[], cwd?: string, signal?: AbortSignal): Promise<string> {
	const { stdout } = await execFileAsync(cmd, args, { cwd, maxBuffer: 20 * 1024 * 1024, signal });
	return stdout;
}

export async function commandSucceeds(cmd: string, args: string[], cwd?: string): Promise<boolean> {
	try {
		await execFileAsync(cmd, args, { cwd });
		return true;
	} catch {
		return false;
	}
}

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
	await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	await rename(tmp, path);
}

export function isNotFoundError(err: unknown): boolean {
	return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "ENOENT";
}

export function shortOid(oid?: string): string | undefined {
	return oid?.slice(0, 7);
}

export function toolResult(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text }], details };
}
