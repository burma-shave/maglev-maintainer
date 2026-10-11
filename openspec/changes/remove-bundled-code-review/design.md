# Design

## Context

See `proposal.md` for motivation and `specs/review-provider-independence/spec.md` for the observable contract. This is a cross-cutting removal across tool registration, workspace capabilities, package resources, tests, and instructions, so a design is warranted.

Observed integration points:
- `extensions/index.ts` imports and registers both the Claude runner and explicit review-instructions loader, and advertises them in its startup notification.
- `extensions/schemas.ts` defines their parameter schemas and the runner's exported parameter type.
- `extensions/workspace-context.ts` advertises `reviewInstructionsLoadTool`.
- `extensions/bench-kickoff.ts` reads `prompts/bench-kickoff.md` and calls `buildBenchKickoffPromptFromTemplate` in `extensions/bench-core.ts`. Nearby activity/discussion/template helpers support that renderer.
- `skills/maglev-pr-code-review` and `.pi/agents/maglev-batch-code-reviewer.md` launch the bundled tool. Retained history, draft, and Bench skills reference this launch path.
- The package manifest independently discovers `./extensions`, `./skills`, and packaged `./agents`; it declares no Claude dependency. The repository-local `.pi/agents` resource is an additional stale launch surface.
- The separate `claude-code-review` package owns execution, contextual guidance, permissions, cancellation, diagnostics, and temporary-directory logs. Its skill is visible in the current session; that establishes resource discovery, not reliable automatic follow-up orchestration.
- The durable `triage-freshness` spec remains applicable without modification.

## Goals / Non-Goals

**Goals:**
- Make provider ownership a clean resource boundary rather than replacing one runner with another adapter.
- Keep independent evidence/draft policy discoverable without dangling links or provider-specific requirements.
- Verify absence of removed resources and preservation of remaining behavior using isolated deterministic checks.

**Non-Goals:**
- No external extension changes, required peer dependency, Pi settings migration, automatic installation, or fallback invocation.
- No generic replacement kickoff, new review command, orchestration skill, or replacement batch agent.
- No canonical state changes, existing artifact relocation, real Claude review, or GitHub publication during implementation validation.

## Decisions

### 1. Remove execution and kickoff together

Delete `extensions/code-review.ts`, `extensions/bench-kickoff.ts`, `prompts/bench-kickoff.md`, the launch skill, and the local batch-review agent. Remove both registrations, schemas/types, related imports, startup advertisements, and the workspace capability key. Remove the kickoff renderer and its exclusive helpers after confirming their call sites; retain any shared lifecycle utility.

Alternative: preserve the Maglev launch skill or redirect the kickoff to `claude_code_review`. Rejected because it retains precisely the provider-specific orchestration the user wants to eliminate. Do not add compatibility aliases: callers must use independently loaded resources directly.

### 2. Preserve policy, not provider coupling

Update `AGENTS.md`, retained analysis/draft/Bench guidance, README, and design documentation to remove obsolete launch requirements. Keep same-SHA/same-scope checks, absolute-date/SHA/provenance recording, parent-owned serialized persistence, automatic prospective draft handling, failure limits, and no-approval/no-publication distinctions. Generalize any Claude-specific assumptions in retained policy so evidence and validation limits come from the actual review result rather than the provider's name.

A brief explanation that review execution comes from separately loaded resources is appropriate; a mandatory external tool name, provider-specific recipe, or new orchestration contract is not. Keep API/spec review skills and the triage analyst: they perform distinct analysis or review selection rather than invoking the removed runner.

Alternative: delete all code-review-related guidance. Rejected because general review history and draft obligations remain valuable independent of Claude and are explicitly retained in scope.

### 3. Preserve state and startup semantics

Do not touch maintainer-root data. Historic log paths and old observations remain valid historical evidence even when their former runner disappears. Future external logs can be referenced in the existing evidence fields without moving them into Bench state or introducing a log schema. External temporary-log retention is owned by that extension; copied evidence, if separately requested, follows the normal artifact policy.

Keep Bench creation, recovery, background context, and explicit user-task separation unchanged. Removal of an on-demand review loader does not remove Bench startup context.

Alternative: migrate logs or rewrite old observations. Rejected as unnecessary and unsafe housekeeping with no behavior requirement.

### 4. Test the boundary without launching reviews

Delete tests exclusive to the removed runner/loader and the kickoff rendering test in `tests/bench-core.test.ts`. Adapt `tests/review-skills.test.ts`, `tests/documentation.test.ts`, and `tests/workspace-context.test.ts` to assert retained policies and absence of removed entry points. Add focused resource/registration absence coverage for the tools, skill, prompt, local agent, schemas, and capability advertisement, using isolated temporary fixtures where needed.

Audit active source, docs, instructions, and resources for dangling references. Historical OpenSpec plans and a clearly labeled breaking-removal note may mention old names; do not enforce a repository-wide ban that would erase history. Distinguish these permitted references from instructions to call removed tools or read deleted files.

Verify Pi loading twice: Maglev Maintainer alone with no provider requirements, and alongside the separate review package to confirm its tool/skill are independently discoverable and no duplicate launcher exists. Resource inspection must not execute Claude, install dependencies, or publish anything. A live model end-to-end check of automatic history/draft follow-through is outside deterministic acceptance and requires a separate authorized review; do not claim it from resource discovery alone.

## Risks / Trade-offs

- [External review discovery does not guarantee follow-up policy composition] -> Keep generic obligations prominent in project instructions and retained skills; report discovery checks separately from live behavioral evidence.
- [Existing callers reference removed entry points] -> Document breaking removal, remove capability advertisements, and reload Pi. No alias masks the break.
- [Over-broad cleanup erases review policy or shared helpers] -> Scope deletions to launch resources and exclusive helpers; retain independent policy and lifecycle tests.
- [External logs may later be manually deleted] -> Preserve returned evidence paths and validation limits without promising durable external-log storage; do not move files implicitly.

## Migration Plan

1. Remove launch resources and registrations together with active-reference cleanup and updated tests.
2. Run deterministic tests, explicit per-file syntax checks, whitespace checks, and isolated resource-loading verification.
3. Reload Pi to remove stale registered tools and skills. Maintainers who want Claude reviews load the external package independently; this change does not alter their settings.
4. No data migration is necessary. Rollback restores package source/resources and reloads Pi without rewriting canonical state or external extension settings.
