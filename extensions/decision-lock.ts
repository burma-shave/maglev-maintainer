import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rmdir, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export interface DecisionLockOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
	pollMs?: number;
}

// No age-based or PID-based stealing: orphan/unknown locks require offline manual recovery.
export async function withDecisionFileLock<T>(decisionsFile: string, fn: () => Promise<T>, options: DecisionLockOptions = {}): Promise<T> {
	const lockPath = `${resolve(decisionsFile)}.lock`;
	const ownerPath = `${lockPath}/owner.json`;
	const token = randomUUID();
	const timeoutMs = options.timeoutMs ?? 10_000;
	const pollMs = options.pollMs ?? 50;
	if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(pollMs) || pollMs <= 0) throw new Error("Invalid decision lock wait options");
	const deadline = performance.now() + timeoutMs;
	options.signal?.throwIfAborted();
	await mkdir(dirname(lockPath), { recursive: true });
	for (;;) {
		options.signal?.throwIfAborted();
		try {
			await mkdir(lockPath, { mode: 0o700 });
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			const remaining = deadline - performance.now();
			if (remaining <= 0) throw new Error(`Timed out waiting for decision mutation lock ${lockPath}. Never remove an active lock; orphan/unknown locks require manual recovery after verifying no writer remains on any host.`);
			await delay(Math.min(pollMs, remaining), undefined, { signal: options.signal });
		}
	}

	let identity: Awaited<ReturnType<typeof lstat>> | undefined;
	let ownerCreated = false;
	let ownerWritten = false;
	try {
		identity = await lstat(lockPath);
		const ownerFile = await open(ownerPath, "wx", 0o600);
		ownerCreated = true;
		try {
			await ownerFile.writeFile(JSON.stringify({ token, pid: process.pid, hostname: hostname(), acquiredAt: new Date().toISOString() }) + "\n");
			ownerWritten = true;
		} finally {
			await ownerFile.close();
		}
		options.signal?.throwIfAborted();
		return await fn();
	} finally {
		// Never recursively remove a lock or release a replacement acquisition.
		// Operators must not change the lock directory while a writer is active.
		if (identity) {
			const current = await lstat(lockPath);
			if (current.dev !== identity.dev || current.ino !== identity.ino) throw new Error(`Decision lock ownership changed at ${lockPath}; refusing release`);
			if (ownerWritten) {
				const owner = JSON.parse(await readFile(ownerPath, "utf8"));
				if (owner.token !== token) throw new Error(`Decision lock owner changed at ${lockPath}; refusing release`);
			}
			if (ownerCreated) await unlink(ownerPath);
			await rmdir(lockPath);
		}
	}
}
