import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

// Resource contract tests; actual agent execution requires a configured Pi host/model.
test("package exposes the fresh-context read-only triage analyst", async () => {
	const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
	assert.deepEqual(manifest.pi.subagents.agents, ["./agents"]);
	const file = new URL("agents/pr-triage-analyst.md", root);
	const agent = await readFile(file, "utf8");
	assert.match(agent, /^name: pr-triage-analyst$/m);
	assert.match(agent, /^package: maglev-maintainer$/m);
	assert.match(agent, /^defaultContext: fresh$/m);
	assert.match(agent, /^acceptanceRole: read-only$/m);
	assert.match(agent, /^inheritSkills: true$/m);
	const tools = agent.match(/^tools: (.+)$/m)![1].split(",").map((tool) => tool.trim());
	assert.deepEqual(tools, ["read", "maglev_pr_workspace_context", "maglev_pr_snapshot_staleness", "maglev_pr_load_metadata", "maglev_pr_state_query"]);
	const provider = agent.match(/^subagentOnlyExtensions: (.+)$/m)![1];
	await access(new URL(provider, file));
	assert.ok(!/^skills:|^skillPath:/m.test(agent));
	assert.ok(agent.includes("using its advertised absolute location"));
	assert.ok(!agent.includes("relative to this agent file"));
	for (const field of ["basis", "recommendation", "action", "readiness", "evidence", "confidence", "caveats", "needsParentConfirmation"]) {
		assert.ok(agent.includes(`"${field}"`), `missing compact result field: ${field}`);
	}
});

test("triage delegates without bulk metadata and keeps persistence in the parent", async () => {
	const skill = await readFile(new URL("skills/maglev-pr-triage/SKILL.md", root), "utf8");
	assert.ok(skill.includes("maglev-maintainer.pr-triage-analyst"));
	assert.ok(skill.includes('context: "fresh"'));
	assert.ok(skill.includes("at most three active analysts"));
	assert.ok(skill.includes("Do not load all selected PRs' metadata into the parent"));
	assert.ok(skill.includes("Persist accepted results sequentially"));
	assert.ok(skill.includes("discard affected recommendations and reanalyze"));
	assert.ok(skill.includes("leave affected decisions unchanged"));
});
