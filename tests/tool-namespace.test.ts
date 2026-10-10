import assert from "node:assert/strict";
import test from "node:test";
import { MAGLEV_TOOL_NAMESPACE } from "../extensions/tool-namespace.ts";

test("tool namespace is stable and independent of package branding", () => {
	assert.equal(MAGLEV_TOOL_NAMESPACE.name, "maglev");
	assert.ok(MAGLEV_TOOL_NAMESPACE.description);
	assert.match(MAGLEV_TOOL_NAMESPACE.instructions, /maglev_workspace_context/);
	assert.match(MAGLEV_TOOL_NAMESPACE.instructions, /explicit authorization/);
});
