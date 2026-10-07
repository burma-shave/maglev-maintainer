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
	for (const action of ["start", "stop", "status"]) assert.ok(doc.includes(`\`maglev_pr_api_${action}\``));
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

test("artifact placement and script execution guidance match current policy", async () => {
	for (const path of ["skills/oba-api-change-review/SKILL.md", "skills/oba-api-pr-spec-review/SKILL.md", "skills/oba-api-change-review/README.md", "skills/librarian/SKILL.md"]) {
		const text = await read(path);
		assert.ok(text.includes("<maintainerRoot>/plans/"), `missing no-Bench destination in ${path}`);
		assert.doesNotMatch(text, /(?:fall back to|use) `tmp\/oba-/);
	}
	const doc = await read("README.md");
	assert.match(doc, /writes immediately when the human runs it/);
	assert.doesNotMatch(doc, /Preview is local-only and the default/);
	assert.match(await read("docs/design.md"), /\*\*Planned, not implemented:\*\*/);
});
