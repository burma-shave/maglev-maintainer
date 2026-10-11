# Tasks

## 1. Remove bundled execution and kickoff surfaces

- [ ] 1.1 Remove runner/loader registrations, imports, startup advertisements, parameter schemas and exported runner type from `extensions/index.ts` and `extensions/schemas.ts`; delete `extensions/code-review.ts` and `extensions/bench-kickoff.ts`. Remove their exclusive test files and add focused registration/schema absence assertions; verify removed entry points and exports are absent and focused tests pass.
- [ ] 1.2 Delete `prompts/bench-kickoff.md` and the kickoff renderer plus exclusive activity/discussion/template helpers in `extensions/bench-core.ts`; remove the renderer test/imports from `tests/bench-core.test.ts`, retaining shared lifecycle code. Verify call-site search finds no active consumers and Bench core/context tests pass with startup-context semantics unchanged.
- [ ] 1.3 Remove `reviewInstructionsLoadTool` from workspace capabilities and update `tests/workspace-context.test.ts` to assert its absence while retaining draft, decisions, and lifecycle capabilities; verify focused workspace tests pass.
- [ ] 1.4 Update README and design inventories, startup/kickoff descriptions, legacy tool mapping, and bundled-runner publication caveats to reflect these breaking removals; update corresponding documentation tests. Verify inventories match the actual registration set and neither document directs callers to removed entry points.

## 2. Remove launch resources and retain independent policy

- [ ] 2.1 Delete `skills/maglev-pr-code-review/SKILL.md` and `.pi/agents/maglev-batch-code-reviewer.md` without replacing them; update resource-discovery tests to assert absence and continued availability of analysis/draft skills. Verify no active resource requires the removed files and no external dependency, compatibility alias, fallback, or dispatch layer was introduced.
- [ ] 2.2 Update `AGENTS.md` and retained Bench, analysis-record, and draft skills to remove launcher/kickoff references and provider-specific assumptions while preserving same-SHA reuse, SHA/provenance recording, record-only failure handling, parent-owned persistence, automatic draft handoff, no approval, and no publication. Adapt `tests/review-skills.test.ts` and `tests/documentation.test.ts`; verify all retained policy assertions and API/spec entry-point history assertions pass.
- [ ] 2.3 Document the independent-review-provider boundary and breaking upgrade/reload behavior in README and `docs/design.md` without prescribing a provider-specific orchestration recipe. Verify documentation states that discovery requires separately loaded resources and does not guarantee follow-up composition, and that stored history/drafts/logs are not migrated or deleted.

## 3. Integration acceptance

- [ ] 3.1 Run `npm test`, explicit per-file `node --check` for `extensions/*.ts`, `testdata/*.ts`, and `tests/*.test.ts`, and `git diff --check`; verify success or document pre-existing failures separately. Audit active source/docs/instructions/resources for stale calls and broken links, allowing only explicit removal notes and historical planning references.
- [ ] 3.2 Verify isolated Pi extension/skill loading with Maglev Maintainer alone and with the independently loaded review package using resource inspection only: confirm both removed tools/launch resources are absent, retained maintainer capabilities load without Claude, and the external tool/skill remain discoverable without duplicates. Do not execute Claude, install dependencies, change Pi settings, or make GitHub writes; record the observed resource sets and distinguish discovery evidence from untested live follow-through.
- [ ] 3.3 Map each `review-provider-independence` scenario to deterministic tests, guidance/resource inspection, or explicit validation limits; verify existing freshness, draft, history, and Bench tests remain intact, no real maintainer state was mutated. Run `openspec validate remove-bundled-code-review --strict` and verify it passes.

## Workflow follow-up

- A live automatic-discovery/history/draft composition check requires a separately authorized review; resource-loading checks do not establish that behavior.
