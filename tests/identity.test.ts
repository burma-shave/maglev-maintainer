import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_MAINTAINER_ROOT, DISPLAY_NAME, INFO_COMMAND, PACKAGE_NAME, ROOT_ENV_VAR, STATUS_COMMAND, TRIAGE_AGENT, resolveMaintainerRoot } from "../extensions/identity.ts";
import { MAINTAINER_ROOT, STATE_DIR } from "../extensions/paths.ts";

const root = new URL("../", import.meta.url);

test("manifest identity drives commands, configuration, and packaged triage agent", () => {
	const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
	assert.equal(PACKAGE_NAME, manifest.name);
	assert.equal(PACKAGE_NAME, "maglev-maintainer");
	assert.equal(DISPLAY_NAME, "Maglev Maintainer");
	assert.equal(INFO_COMMAND, `${PACKAGE_NAME}-info`);
	assert.equal(STATUS_COMMAND, `${PACKAGE_NAME}-status`);
	assert.equal(ROOT_ENV_VAR, "MAGLEV_MAINTAINER_ROOT");
	assert.equal(DEFAULT_MAINTAINER_ROOT, `/var/lib/${PACKAGE_NAME}`);
	const agent = readFileSync(new URL("agents/pr-triage-analyst.md", root), "utf8");
	assert.ok(agent.includes(`package: ${PACKAGE_NAME}\n`));
	const skill = readFileSync(new URL("skills/maglev-pr-triage/SKILL.md", root), "utf8");
	assert.ok(skill.includes(TRIAGE_AGENT));
	assert.ok(skill.includes("package.triageAgent"));
});

test("root configuration supports explicit legacy settings without path discovery", () => {
	assert.equal(resolveMaintainerRoot({}), DEFAULT_MAINTAINER_ROOT);
	assert.equal(resolveMaintainerRoot({ MAGLEV_MAINTAINER_ROOT: "./new-root" }), resolve("./new-root"));
	assert.equal(resolveMaintainerRoot({ MAGLEV_PR_MAINTAINER_ROOT: "/existing-root" }), "/existing-root");
	assert.equal(resolveMaintainerRoot({ MAGLEV_MAINTAINER_ROOT: "/new", MAGLEV_PR_MAINTAINER_ROOT: "/old" }), "/new");
	assert.equal(resolveMaintainerRoot({ MAGLEV_MAINTAINER_ROOT: "", MAGLEV_PR_MAINTAINER_ROOT: "/old" }), "/old");
	assert.equal(STATE_DIR, `${MAINTAINER_ROOT}/state`);
});

test("packaged skills use current branding and keep their workflow names", () => {
	for (const dir of readdirSync(new URL("skills/", root))) {
		const skill = readFileSync(new URL(`skills/${dir}/SKILL.md`, root), "utf8");
		assert.ok(!skill.includes("Maglev PR Maintainer"), dir);
		assert.ok(!skill.includes("maglev-pr-maintainer.pr-triage-analyst"), dir);
		assert.ok(skill.includes(`name: ${dir}\n`), dir);
	}
});
