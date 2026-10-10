# Tasks

## 1. Evaluation evidence and compatibility

- [x] 1.1 Add optional discussion attribution and applicability types to `extensions/types.ts`, decision input schemas, normalization, and fixtures; verify `tests/decisions.test.ts` and `tests/state-core.test.ts` round-trip new fields and retain legacy records without inventing attribution.
- [x] 1.2 Derive a human-discussion watermark in `extensions/github-core.ts`, including fallback derivation for older snapshot payloads; verify `tests/github-core.test.ts` covers empty discussion, newer human comments/reviews, bot-only churn, and independence from commit dates.
- [x] 1.3 Document evaluated evidence versus storage time and legacy unknown applicability in `docs/design.md` and `README.md`; verify documentation/reference tests and explicitly retain the discussion-edit/thread coverage limitations.

## 2. Shared applicability assessment

- [x] 2.1 Introduce a pure assessment in the triage domain returning current/superseded/unknown with dimension-specific reasons, and route `computeNeedsInference` through it; verify `tests/triage.test.ts` covers older-dated head changes, matching evidence after refetch, delayed saves, backward discussion-watermark changes, partial/invalid basis, and mismatch precedence over unknown evidence.
- [x] 2.2 Preserve existing selection/filter and no-decision/invalid-decision behavior while removing `decidedAt` as the activity cutoff; verify triage selection tests and add a CI-only change scenario proving readiness is outside this assessment.
- [x] 2.3 Update freshness documentation to describe applicability rather than approval or completed code-review coverage; verify the documented state/reason semantics agree with the assessment fixtures.

## 3. Truthful decision mutation

- [x] 3.1 Stop snapshot overwrite/fill of explicit basis in `saveDecision`; preserve prior basis when omitted and leave new attribution unknown; verify isolated decision tests for S1/A analysis saved after S2/B refresh, partial input, no snapshot, and omitted-basis updates.
- [x] 3.2 Add additive recommendation/record-only mutation mode to schemas and the decision domain under the existing lock; verify record-only preserves all recommendation fields while retaining/deduplicating observations, and creates an unknown blocked-analysis placeholder when no decision exists.
- [x] 3.3 Add executable failed/incomplete/blocked attempt regressions showing stale/unknown applicability remains unchanged after record-only writes; verify decision and triage assertions together using temporary state only, including protection from outdated caller recommendation fields.
- [x] 3.4 Update decision tool descriptions and mutation documentation to explain explicit attribution and record-only intent; verify schema/reference tests and preserve the stated limitation that ordinary same-PR recommendation replacement is not an atomic-history solution.

## 4. Client and analysis-workflow integration

- [x] 4.1 Expose shared applicability and concrete reasons in `extensions/queue-core.ts`, `state-query.ts`, and `triage-tool-results.ts`, preserving historical recommendation details on reassessment rows; verify their respective tests cover current, superseded, and unknown states without changing bucket/filter semantics or adding a new UI.
- [x] 4.2 Update `agents/pr-triage-analyst.md` and packaged triage/analysis-record/code-review guidance to carry the evaluated discussion basis, retain superseded analysis, and use record-only for non-accepted attempts; verify skill/agent reference tests and inspect every packaged decision-save entry point for consistent mutation intent.
- [x] 4.3 Update `README.md`, `docs/design.md`, and affected workflow examples for the new result fields and conservative legacy reassessment; verify documentation tests and confirm no claims of CI readiness, atomic structured history, or post-review Claude SHA gates were introduced.

## 5. Integration validation

- [x] 5.1 Add an isolated end-to-end deterministic scenario covering evaluation at A/D1, refresh to B/D2, superseded save, failed record-only attempt, and successful explicit reevaluation; verify queue, discovery, focused query, retained observations, and original provenance agree at each step.
- [x] 5.2 Run `npm test`, explicit `node --check` for every extension/fixture/test file, and `git diff --check`; verify all pass and report the actual commands/results rather than treating skill-text assertions as execution evidence.
- [x] 5.3 Verify isolated Pi extension loading for the additive schemas/tools without live GitHub calls or real maintainer-state writes; confirm registration succeeds and document the isolated environment and validation limits.

## Validation evidence

- `npm test`: 187 tests passed, zero failures. Includes temporary-file decision/triage lifecycle tests, not only skill-text assertions.
- Explicit `node --check` loop over `extensions/*.ts`, `testdata/*.ts`, and `tests/*.test.ts`: passed. This is syntax checking, not TypeScript typechecking.
- `git diff --check`: passed.
- Isolated registration check on Node v24.21.0 / Pi SDK 1.1.0: `DefaultResourceLoader` loaded only the explicit `extensions/index.ts` path with in-memory settings, temporary cwd/agent directory, and temporary `MAGLEV_MAINTAINER_ROOT`. Automatic extensions, skills, prompts, themes, and context files were disabled. Registered 25 tools and 11 commands with zero extension-load errors; the decision schema contained record-only mode and discussion attribution.
- Invoked the registered decision tool directly against an isolated synthetic snapshot: a save against earlier facts returned superseded, and a subsequent record-only attempt retained basis, bucket, and evaluation time while remaining superseded. Temporary storage was removed. No model turn, GitHub call, or real maintainer-state write occurred; fetch was disabled in the checking process.
- Registration validation exercised the actual Pi loader and registered tool adapter, not interactive UI, a live model's adherence to skills, or all dispatcher argument-validation paths. Live GitHub collection, Claude publication behavior, Docker, general same-PR recommendation races, same-timestamp discussion edits, and uncollected inline threads were not validated by this change.
