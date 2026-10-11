# Proposal

## Why

Claude Code execution now belongs to a separate Pi extension whose tool and skill are already discoverable. Keeping a second runner and Maglev-specific launch workflow duplicates ownership and makes Maglev Maintainer unnecessarily responsible for a particular review provider.

## What Changes

- **BREAKING**: Remove `maglev_pr_code_review`, its schema, bundled Claude runner, runner tests, and `maglev-pr-code-review` skill without a compatibility alias or replacement wrapper.
- **BREAKING**: Remove `maglev_pr_review_instructions_load`, the Bench kickoff loader/template and exclusive rendering helpers, and its workspace-context capability advertisement.
- Remove the repository-local `.pi/agents/maglev-batch-code-reviewer.md`, which depends on the removed workflow.
- Rely on Pi discovery of independently loaded review extensions and skills; do not add automatic installation, dependency enforcement, dispatch, or shell fallback.
- Preserve reviewer-independent PR history, same-SHA/same-scope reuse guidance, prospective draft handling, API/spec analysis, and Bench lifecycle/startup context.
- Clean live documentation, project instructions, and retained skills of removed entry points and provider-specific assumptions. Document the breaking removal and limits of discovery without recreating an orchestration recipe.

## Capabilities

### New Capabilities

- `review-provider-independence`: Maintainer review support owns durable evidence and prospective drafts, not review-provider execution, discovery enforcement, or launch orchestration.

### Modified Capabilities

None. The existing `triage-freshness` requirements remain unchanged.

## Impact

Affected implementation includes `extensions/index.ts`, `extensions/schemas.ts`, `extensions/code-review.ts`, `extensions/bench-kickoff.ts`, exclusive helpers in `extensions/bench-core.ts`, and `extensions/workspace-context.ts`. Affected resources include the removed skill, kickoff prompt, local batch reviewer, `AGENTS.md`, `README.md`, `docs/design.md`, and retained Bench/history/draft guidance. Tests must remove runner/kickoff expectations while preserving independent history, draft, freshness, and lifecycle coverage and adding absence checks.

No durable state migration or deletion is required; existing logs, observations, drafts, and Bench artifacts remain untouched. No edits to the external extension or Pi installation settings are in scope.
