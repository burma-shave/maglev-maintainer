import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { manageRuntime, runtimeIdentity } from "./api-runtime.ts";
import { MAINTAINER_ROOT, BENCH_CHECKOUTS_DIR } from "./paths.ts";
import { toolResult } from "./utils.ts";
import { loadBenchDefinitions } from "./bench-registry.ts";

const target = {
	implementation: Type.Union([Type.Literal("maglev"), Type.Literal("legacy")]),
	pr: Type.Optional(Type.Integer({ minimum: 1, description: "Maglev PR number; resolves an associated branch Bench when present. Mutually exclusive with benchId and workingDirectory." })),
	benchId: Type.Optional(Type.String({ minLength: 1, description: "Stable Maglev Bench ID, including branch Benches. Mutually exclusive with pr and workingDirectory." })),
	workingDirectory: Type.Optional(Type.String({ description: "Maglev checkout root. Defaults to current directory. Legacy uses pinned packaged assets." })),
};
export function registerApiRuntimeTools(pi: ExtensionAPI) {
	for (const action of ["start", "stop", "status"] as const) {
		const parameters = Type.Object({
			...target,
			...(action === "status" ? {} : { apply: Type.Optional(Type.Boolean({ description: "Execute instead of planning. Defaults to false." })) }),
			...(action === "start" ? {
				port: Type.Optional(Type.Integer({ minimum: 1024, maximum: 65535, description: "Loopback host port; defaults to Maglev 4000 or legacy 8080." })),
				gtfsUrl: Type.Optional(Type.String({ description: "Static GTFS URL; defaults to Sound Transit KCM for both implementations." })),
				timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 3600, description: "Build command and readiness timeout; defaults to 1800 each." })),
			} : {}),
			...(action === "stop" ? {
				removeVolumes: Type.Optional(Type.Boolean({ description: "Destructively remove this runtime's GTFS bundle and database volumes. Defaults to false." })),
				removeImages: Type.Optional(Type.Boolean({ description: "Remove project-local built images (not all shared images). Defaults to false." })),
			} : {}),
		});
		pi.registerTool({
			name: `maglev_pr_api_${action}`,
			label: `Maglev PR API ${action}`,
			description: `${action === "status" ? "Inspect readiness and containers for" : `Plan or execute ${action} of`} a local Maglev or pinned legacy OBA Docker runtime. Isolated Compose projects, loopback ports, shared GTFS defaults.`,
			promptSnippet: `${action} a Maglev or legacy OBA API runtime.`,
			promptGuidelines: ["Use maglev_pr_workspace_context first. Start/stop are dry-run by default; apply only on explicit user request. Show warnings before destructive volume removal. Status never starts containers. Services persist beyond the Pi session; stop explicitly."],
			parameters,
			async execute(_id, params, signal, _onUpdate, ctx) {
				const prBenchId = params.pr ? (await loadBenchDefinitions()).find((bench) => bench.pr === params.pr)?.id : undefined;
				const deps = { root: MAINTAINER_ROOT, checkoutDir: BENCH_CHECKOUTS_DIR, cwd: ctx?.cwd ?? process.cwd(), prBenchId };
				const identity = runtimeIdentity(params, deps);
				const result = await withFileMutationQueue(identity.manifestPath, () => manageRuntime(action, params, deps, signal));
				return toolResult(JSON.stringify(result, null, 2), result);
			},
		});
	}
}
