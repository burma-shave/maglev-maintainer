import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, realpath, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { GitResult } from "./companion-repos.ts";

const execFileAsync = promisify(execFile);
const URL = "https://github.com/OneBusAway/maglev.git";

export interface MaglevCheckoutInput {
	apply?: boolean;
	path?: string;
	ref?: string;
}

export interface MaglevCheckoutOptions {
	checkoutDir: string;
	obaWorkspace?: string;
	runGit?: (args: string[]) => Promise<GitResult>;
}

export function maglevCheckoutPath(options: Pick<MaglevCheckoutOptions, "checkoutDir" | "obaWorkspace">): string {
	return resolve(options.obaWorkspace ? join(options.obaWorkspace, "maglev") : join(options.checkoutDir, "maglev"));
}

async function runGit(args: string[]): Promise<GitResult> {
	try {
		const { stdout, stderr } = await execFileAsync("git", args, { timeout: 120_000, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" } });
		return { ok: true, stdout, stderr };
	} catch (err) {
		const error = err as { stdout?: string; stderr?: string; message?: string };
		return { ok: false, stdout: String(error.stdout ?? ""), stderr: String(error.stderr || error.message || "git failed") };
	}
}

export function isMaglevOrigin(url: string): boolean {
	return /^(?:https?:\/\/github\.com\/|git:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)onebusaway\/maglev(?:\.git)?\/?$/i.test(url.trim());
}

/** Existing checkouts are inspected only. New clones are staged and published only after verification. */
export async function resolveMaglevCheckout(input: MaglevCheckoutInput, options: MaglevCheckoutOptions) {
	const git = options.runGit ?? runGit;
	const path = input.path ? resolve(input.path) : maglevCheckoutPath(options);
	const result = {
		path, url: URL, requestedRef: input.ref, ok: false, ready: false, cloned: false,
		branch: undefined as string | undefined, head: undefined as string | undefined,
		dirty: undefined as boolean | undefined, warnings: [] as string[], errors: [] as string[],
	};
	if (input.ref !== undefined) {
		if (!input.ref || input.ref.startsWith("-") || !(await git(["check-ref-format", "--allow-onelevel", input.ref])).ok) {
			result.errors.push("Invalid ref: use a branch, tag, full ref name, or commit SHA, not a revision expression or option.");
			return result;
		}
	}
	async function inspect(target: string, fetched = false): Promise<boolean> {
		const top = await git(["-C", target, "rev-parse", "--show-toplevel"]);
		if (!top.ok || await realpath(top.stdout.trim()) !== await realpath(target)) {
			result.errors.push(`${path} is not a Git checkout root.`);
			return false;
		}
		const origin = await git(["-C", target, "config", "--get", "remote.origin.url"]);
		if (!origin.ok || !isMaglevOrigin(origin.stdout)) {
			result.errors.push(`${path} does not have the expected OneBusAway/maglev origin.`);
			return false;
		}
		const head = await git(["-C", target, "rev-parse", "--verify", "HEAD^{commit}"]);
		const status = await git(["-C", target, "status", "--porcelain", "--untracked-files=all"]);
		if (!head.ok || !status.ok) {
			result.errors.push("Could not inspect HEAD or local changes; refusing to treat checkout as usable.");
			return false;
		}
		result.head = head.stdout.trim();
		result.dirty = Boolean(status.stdout.trim());
		const branch = await git(["-C", target, "symbolic-ref", "--short", "HEAD"]);
		result.branch = branch.ok ? branch.stdout.trim() : undefined;
		if (input.ref) {
			let wanted: string | undefined;
			for (const ref of fetched ? ["FETCH_HEAD"] : [input.ref, `refs/remotes/origin/${input.ref}`]) {
				const resolved = await git(["-C", target, "rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`]);
				if (resolved.ok) { wanted = resolved.stdout.trim(); break; }
			}
			if (!wanted || wanted !== result.head) {
				result.errors.push(`Existing HEAD does not match locally resolved ref ${input.ref}; no fetch, branch switch, or reset was performed. Choose a new checkout path to clone that ref.`);
				return false;
			}
		}
		return true;
	}
	let exists = false;
	try { await lstat(path); exists = true; } catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
	if (exists) {
		result.ok = await inspect(path);
		result.ready = result.ok;
		result.warnings.push("Existing checkout preserved as-is; no fetch or update performed, so remote freshness is unknown.");
		if (result.dirty) result.warnings.push("Local changes are present and were preserved.");
		return result;
	}
	if (!input.apply) {
		result.ok = true;
		result.warnings.push(`Checkout is missing. Set apply: true to clone ${input.ref ?? "the remote default branch"}; no files or network requests were made.`);
		return result;
	}
	await mkdir(dirname(path), { recursive: true });
	const staging = await mkdtemp(join(dirname(path), ".maglev-clone-"));
	const checkout = join(staging, "checkout");
	try {
		const clone = await git(["clone", ...(input.ref ? ["--no-checkout"] : []), "--", URL, checkout]);
		if (!clone.ok) { result.errors.push(`Clone failed: ${clone.stderr.trim()}`); return result; }
		if (input.ref) {
			const fetch = await git(["-C", checkout, "fetch", "--no-tags", "origin", input.ref]);
			if (!fetch.ok) { result.errors.push(`Could not fetch requested ref: ${fetch.stderr.trim()}`); return result; }
			const select = await git(["-C", checkout, "checkout", "--detach", "FETCH_HEAD"]);
			if (!select.ok) { result.errors.push(`Could not check out requested ref: ${select.stderr.trim()}`); return result; }
		}
		if (!(await inspect(checkout, Boolean(input.ref)))) return result;
		// Reserve the destination atomically, including against other Pi processes.
		// rename(checkout, path) alone could replace a concurrently created empty directory.
		try { await mkdir(path); }
		catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
			result.errors.push("Target appeared during cloning; it was not replaced.");
			return result;
		}
		try {
			for (const entry of await readdir(checkout)) await rename(join(checkout, entry), join(path, entry));
		} catch (err) {
			result.errors.push(`Could not publish checkout: ${String(err)}. The partially published target was preserved for inspection.`);
			return result;
		}
		result.ok = result.ready = result.cloned = true;
		return result;
	} finally {
		// Only this invocation's temporary directory is removed, never the user's target.
		await rm(staging, { recursive: true, force: true });
	}
}

export function formatMaglevCheckout(result: Awaited<ReturnType<typeof resolveMaglevCheckout>>): string {
	return [
		`Maglev checkout: ${result.path}`,
		`State: ${result.ready ? result.cloned ? "cloned" : "existing" : result.ok ? "planned (not applied)" : "refused"}`,
		result.head ? `Revision: ${result.head} (${result.branch ?? "detached HEAD"})` : undefined,
		...result.warnings.map((message) => `Warning: ${message}`),
		...result.errors.map((message) => `Error: ${message}`),
	].filter(Boolean).join("\n");
}
