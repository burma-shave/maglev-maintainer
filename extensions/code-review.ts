import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { BENCH_CHECKOUTS_DIR, BENCH_STATE_DIR } from "./paths.ts";
import { isNotFoundError } from "./utils.ts";
import { validBenchId } from "./bench-registry.ts";

const execFileAsync = promisify(execFile);

export interface CodeReviewParams {
	pr: number;
	/** Internal resolved association supplied by the tool wrapper. */
	benchId?: string;
	workingDirectory?: string;
	timeoutSeconds?: number;
}

export interface CodeReviewResult {
	pr: number;
	command: string[];
	workingDirectory: string;
	repositoryRoot?: string;
	success: boolean;
	exitCode: number | null;
	timedOut?: boolean;
	stdout: string;
	stderr: string;
	output: string;
	logPath: string;
	error?: string;
}

interface RunResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	timedOut?: boolean;
}

export interface CodeReviewDeps {
	runCommand: (cmd: string, args: string[], options: { cwd?: string; timeoutMs: number; signal?: AbortSignal }) => Promise<RunResult>;
	runText: (cmd: string, args: string[], cwd?: string, signal?: AbortSignal) => Promise<string>;
	writeFile: (path: string, content: string) => Promise<void>;
	now: () => Date;
	processCwd: () => string;
}

const DEFAULT_TIMEOUT_SECONDS = 20 * 60;
const MAX_TIMEOUT_SECONDS = 60 * 60;
const TOOL_OUTPUT_LIMIT = 24000;

function normalizeTimeoutSeconds(value?: number): number {
	if (!Number.isFinite(value) || !value) return DEFAULT_TIMEOUT_SECONDS;
	return Math.max(1, Math.min(MAX_TIMEOUT_SECONDS, Math.floor(value)));
}

function isoForPath(date: Date): string {
	return date.toISOString().replace(/[:.]/g, "-");
}

function truncateMiddle(value: string, max = TOOL_OUTPUT_LIMIT): string {
	if (value.length <= max) return value;
	const head = Math.floor(max * 0.55);
	const tail = Math.floor(max * 0.35);
	return `${value.slice(0, head)}\n\n[…truncated ${value.length - head - tail} bytes; full output is in the log path…]\n\n${value.slice(-tail)}`;
}

async function defaultRunCommand(cmd: string, args: string[], options: { cwd?: string; timeoutMs: number; signal?: AbortSignal }): Promise<RunResult> {
	try {
		const { stdout, stderr } = await execFileAsync(cmd, args, {
			cwd: options.cwd,
			timeout: options.timeoutMs,
			signal: options.signal,
			maxBuffer: 50 * 1024 * 1024,
		});
		return { stdout, stderr, exitCode: 0 };
	} catch (err) {
		const error = err as NodeJS.ErrnoException & { stdout?: string | Buffer; stderr?: string | Buffer; code?: number | string | null; killed?: boolean };
		if (isNotFoundError(error)) throw err;
		return {
			stdout: Buffer.isBuffer(error.stdout) ? error.stdout.toString("utf8") : error.stdout ? String(error.stdout) : "",
			stderr: Buffer.isBuffer(error.stderr) ? error.stderr.toString("utf8") : error.stderr ? String(error.stderr) : error.message,
			exitCode: typeof error.code === "number" ? error.code : null,
			timedOut: error.killed,
		};
	}
}

async function defaultRunText(cmd: string, args: string[], cwd?: string, signal?: AbortSignal): Promise<string> {
	const { stdout } = await execFileAsync(cmd, args, { cwd, signal, maxBuffer: 10 * 1024 * 1024 });
	return stdout;
}

async function defaultWriteFile(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, "utf8");
}

async function resolveRepositoryRoot(workingDirectory: string, deps: CodeReviewDeps, signal?: AbortSignal): Promise<string | undefined> {
	try {
		const root = (await deps.runText("git", ["rev-parse", "--show-toplevel"], workingDirectory, signal)).trim();
		return root || undefined;
	} catch {
		return undefined;
	}
}

function buildLog(pr: number, command: string[], cwd: string, result: RunResult, error?: string): string {
	return [
		`PR: #${pr}`,
		`Command: ${command.join(" ")}`,
		`Working directory: ${cwd}`,
		`Exit code: ${result.exitCode ?? "unknown"}`,
		result.timedOut ? "Timed out: yes" : "Timed out: no",
		error ? `Error: ${error}` : undefined,
		"",
		"--- stdout ---",
		result.stdout,
		"",
		"--- stderr ---",
		result.stderr,
	].filter((line): line is string => line !== undefined).join("\n");
}

function missingResult(pr: number, command: string[], workingDirectory: string, repositoryRoot: string | undefined, logPath: string, error: string): CodeReviewResult {
	return { pr, command, workingDirectory, repositoryRoot, success: false, exitCode: null, stdout: "", stderr: error, output: error, logPath, error };
}

export async function runClaudeCodeReview(params: CodeReviewParams, partialDeps: Partial<CodeReviewDeps> = {}, signal?: AbortSignal): Promise<CodeReviewResult> {
	const deps: CodeReviewDeps = {
		runCommand: partialDeps.runCommand ?? defaultRunCommand,
		runText: partialDeps.runText ?? defaultRunText,
		writeFile: partialDeps.writeFile ?? defaultWriteFile,
		now: partialDeps.now ?? (() => new Date()),
		processCwd: partialDeps.processCwd ?? (() => process.cwd()),
	};
	const pr = params.pr;
	const timeoutSeconds = normalizeTimeoutSeconds(params.timeoutSeconds);
	const benchId = params.benchId ?? `pr-${pr}`;
	if (!validBenchId(benchId)) throw new Error("Invalid Bench ID.");
	const requestedWorkingDirectory = params.workingDirectory || `${BENCH_CHECKOUTS_DIR}/${benchId}`;
	const repositoryRoot = await resolveRepositoryRoot(requestedWorkingDirectory, deps, signal);
	const workingDirectory = repositoryRoot ?? requestedWorkingDirectory;
	const command = ["claude", "--dangerously-skip-permissions", "-p", `/code-review ${pr}`];
	const logPath = `${BENCH_STATE_DIR}/${benchId}/claude-code-review-${isoForPath(deps.now())}.log`;

	try {
		await deps.runCommand("claude", ["--version"], { cwd: workingDirectory, timeoutMs: 30_000, signal });
	} catch (err) {
		const error = `claude CLI was not found or could not be executed: ${err instanceof Error ? err.message : String(err)}`;
		const result = { stdout: "", stderr: error, exitCode: null };
		await deps.writeFile(logPath, buildLog(pr, command, workingDirectory, result, error));
		return missingResult(pr, command, workingDirectory, repositoryRoot, logPath, error);
	}

	if (!repositoryRoot) {
		const error = `Working directory is not inside a git repository: ${requestedWorkingDirectory}. Start or reset the PR Bench first, or pass workingDirectory explicitly.`;
		const result = { stdout: "", stderr: error, exitCode: null };
		await deps.writeFile(logPath, buildLog(pr, command, workingDirectory, result, error));
		return missingResult(pr, command, workingDirectory, undefined, logPath, error);
	}

	const result = await deps.runCommand(command[0]!, command.slice(1), { cwd: workingDirectory, timeoutMs: timeoutSeconds * 1000, signal });
	const output = [result.stdout.trim(), result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : ""].filter(Boolean).join("\n\n");
	await deps.writeFile(logPath, buildLog(pr, command, workingDirectory, result));
	return {
		pr,
		command,
		workingDirectory,
		repositoryRoot,
		success: result.exitCode === 0 && !result.timedOut,
		exitCode: result.exitCode,
		timedOut: result.timedOut,
		stdout: result.stdout,
		stderr: result.stderr,
		output: truncateMiddle(output || "Claude Code produced no output."),
		logPath,
	};
}

export function formatCodeReviewResult(result: CodeReviewResult): string {
	return [
		`Claude Code /code-review for PR #${result.pr}: ${result.success ? "completed" : "failed"}${result.exitCode !== null ? ` (exit ${result.exitCode})` : ""}${result.timedOut ? " (timed out)" : ""}`,
		`Working directory: ${result.workingDirectory}`,
		`Command: ${result.command.join(" ")}`,
		`Full log: ${result.logPath}`,
		"",
		result.output,
	].join("\n");
}
