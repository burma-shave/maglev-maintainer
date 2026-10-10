import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

async function skillDocs() {
	const entries = await readdir(new URL("skills/", root), { withFileTypes: true });
	return Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => ({
		name: entry.name,
		text: await read(`skills/${entry.name}/SKILL.md`),
	})));
}

test("README inventories all packaged skills, extension modules, tools, and commands", async () => {
	const doc = await read("README.md");
	for (const { name } of await skillDocs()) assert.ok(doc.includes(`\`${name}\``), `missing skill ${name}`);
	for (const name of await readdir(new URL("extensions/", root))) {
		if (name.endsWith(".ts")) assert.ok(doc.includes(`\`extensions/${name}\``), `missing module ${name}`);
	}
	for (const path of ["extensions/index.ts", "extensions/bench-tools.ts"]) {
		const source = await read(path);
		for (const match of source.matchAll(/registerCommand\("([^"]+)"/g)) {
			assert.ok(doc.includes(`\`/${match[1]}\``), `missing command ${match[1]}`);
		}
		for (const match of source.matchAll(/name: "(maglev_[^"]+)"/g)) {
			assert.ok(doc.includes(`\`${match[1]}\``), `missing tool ${match[1]}`);
		}
	}
	for (const action of ["start", "stop", "status"]) assert.ok(doc.includes(`\`maglev_api_runtime_${action}\``));
});

async function registeredToolNames() {
	const names = new Set<string>();
	for (const path of ["extensions/index.ts", "extensions/bench-tools.ts", "extensions/api-runtime-tools.ts"]) {
		const source = await read(path);
		for (const block of source.split("pi.registerTool({").slice(1)) {
			assert.match(block, /namespace: MAGLEV_TOOL_NAMESPACE/, `missing namespace in ${path}`);
		}
		for (const match of source.matchAll(/name: "(maglev_[^"]+)"/g)) {
			assert.ok(!names.has(match[1]), `duplicate tool ${match[1]}`);
			names.add(match[1]);
		}
		if (path.endsWith("api-runtime-tools.ts")) {
			assert.ok(source.includes("name: `maglev_api_runtime_${action}`"));
			for (const action of ["start", "stop", "status"]) names.add(`maglev_api_runtime_${action}`);
		}
	}
	return names;
}

test("skill, agent, prompt, and capability references resolve to namespaced tools", async () => {
	const tools = await registeredToolNames();
	const docs = (await skillDocs()).map(({ name, text }) => ({ name, text }));
	for (const dir of ["agents", "prompts"]) {
		for (const name of await readdir(new URL(`${dir}/`, root))) {
			if (name.endsWith(".md")) docs.push({ name: `${dir}/${name}`, text: await read(`${dir}/${name}`) });
		}
	}
	for (const { name, text } of docs) {
		for (const match of text.matchAll(/\bmaglev_[a-z_]+\b/g)) {
			assert.ok(tools.has(match[0]), `${name} references unregistered tool ${match[0]}`);
		}
	}
	const context = await read("extensions/workspace-context.ts");
	for (const match of context.matchAll(/(?:\w+Tool|resolverTool): "([^"]+)"/g)) {
		assert.ok(tools.has(match[1]), `unregistered capability ${match[1]}`);
	}
	for (const legacy of ["maglev_pr_workspace_context", "maglev_pr_checkout", "maglev_pr_companion_repos", "maglev_pr_api_start", "maglev_pr_api_stop", "maglev_pr_api_status", "maglev_pr_review_json", "maglev_pr_review_json_clear", "maglev_pr_review_json_list", "maglev_pr_review_json_load", "maglev_pr_bench_kickoff"]) {
		assert.ok(!tools.has(legacy), `unexpected legacy alias ${legacy}`);
	}
});

test("packaged slash-skill handoffs resolve to packaged skills", async () => {
	const docs = await skillDocs();
	const names = new Set(docs.map(({ name }) => name));
	for (const { name, text } of docs) {
		for (const match of text.matchAll(/\/skill:([a-z0-9-]+)/g)) {
			assert.ok(names.has(match[1]), `${name} invokes missing skill ${match[1]}`);
		}
	}
});

test("packaged skill names and relative skill handoffs remain consistent", async () => {
	for (const { name, text } of await skillDocs()) {
		assert.match(text, new RegExp(`^name: ${name}$`, "m"));
		for (const match of text.matchAll(/`(\.\.\/[^`]+\/SKILL\.md)`/g)) {
			await readFile(new URL(match[1], new URL(`skills/${name}/`, root)), "utf8");
		}
	}
});

test("one Bench skill covers branches and PR adapters without weakening safeguards", async () => {
	const names = new Set((await skillDocs()).map(({ name }) => name));
	assert.ok(names.has("maglev-bench"));
	assert.ok(names.has("maglev-artifacts"));
	assert.ok(!names.has("maglev-pr-bench"));
	assert.ok(!names.has("librarian"));
	const bench = await read("skills/maglev-bench/SKILL.md");
	for (const tool of ["maglev_bench_start", "maglev_bench_list", "maglev_bench_inspect", "maglev_bench_close", "maglev_bench_associate_pr", "maglev_pr_bench_start", "maglev_pr_bench_reset", "maglev_pr_review_instructions_load"]) {
		assert.ok(bench.includes(`\`${tool}\``), `missing lifecycle guidance for ${tool}`);
	}
	assert.match(bench, /Reset does \*\*not\*\* have close's committed-work protection/);
	assert.match(bench, /Do not invoke\s+`maglev_pr_review_instructions_load` automatically/);
	assert.match(bench, /allowLocalCommits/);
	assert.match(bench, /removeCheckout: false/);
	const artifacts = await read("skills/maglev-artifacts/SKILL.md");
	assert.match(artifacts, /artifacts\.generatedScriptsDir/);
	assert.match(artifacts, /Never relocate or overwrite tool-owned/);
});

test("artifact placement and script execution guidance match current policy", async () => {
	for (const path of ["skills/oba-api-change-review/SKILL.md", "skills/oba-api-pr-spec-review/SKILL.md", "skills/oba-api-change-review/README.md", "skills/maglev-artifacts/SKILL.md"]) {
		const text = await read(path);
		assert.ok(text.includes("<maintainerRoot>/plans/"), `missing no-Bench destination in ${path}`);
		assert.doesNotMatch(text, /(?:fall back to|use) `tmp\/oba-/);
	}
	const doc = await read("README.md");
	assert.match(doc, /writes immediately when the human runs it/);
	assert.doesNotMatch(doc, /Preview is local-only and the default/);
	assert.match(await read("docs/design.md"), /\*\*Planned, not implemented:\*\*/);
});
