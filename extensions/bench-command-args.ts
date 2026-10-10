import { validateBenchStartTarget, type BenchStartTarget } from "./bench.ts";
import { validBenchId } from "./bench-registry.ts";

export function parseIdFlags(args: string, allowed: string[]) {
	const [id, ...flags] = args.trim().split(/\s+/);
	if (!id || !validBenchId(id) || flags.some((flag) => !allowed.includes(flag))) throw new Error("Expected a stable Bench ID followed by supported flags.");
	return { id, flags: new Set(flags) };
}

export interface BenchStartCommandArgs extends BenchStartTarget {
	apply: boolean;
	allowStaleSnapshot?: boolean;
	allowHeadMismatch?: boolean;
	error?: string;
}

export function parseBenchStartArgs(args: string): BenchStartCommandArgs {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	const result: BenchStartCommandArgs = { apply: false };
	try {
		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			if (token === "--apply") result.apply = true;
			else if (token === "--allow-stale-snapshot") result.allowStaleSnapshot = true;
			else if (token === "--allow-head-mismatch") result.allowHeadMismatch = true;
			else if (token === "--pr" && result.pr === undefined && /^#?[1-9]\d*$/.test(tokens[i + 1] ?? "")) result.pr = Number(tokens[++i].replace(/^#/, ""));
			else if (token === "--from" && !result.createFrom && tokens[i + 1] && !tokens[i + 1].startsWith("--")) result.createFrom = tokens[++i];
			else if (!token.startsWith("--") && result.branch === undefined) result.branch = token;
			else throw new Error("Unsupported or duplicate argument.");
		}
		validateBenchStartTarget(result);
		return result;
	} catch (err) {
		return { ...result, error: `${String(err)} Usage: /maglev-bench-start <branch> [--from <base>] or --pr <PR> [--apply]` };
	}
}
