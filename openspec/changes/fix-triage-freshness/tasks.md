# Tasks

## 1. Evaluation evidence and compatibility

- [ ] 1.1 Add optional discussion attribution and applicability types to `extensions/types.ts`, decision input schemas, normalization, and fixtures; verify `tests/decisions.test.ts` and `tests/state-core.test.ts` round-trip new fields and retain legacy records without inventing attribution.
- [ ] 1.2 Derive a human-discussion watermark in `extensions/github-core.ts`, including fallback derivation for older snapshot payloads; verify `tests/github-core.test.ts` covers empty discussion, newer human comments/reviews, bot-only churn, and independence from commit dates.
- [ ] 1.3 Document evaluated evidence versus storage time and legacy unknown applicability in `docs/design.md` and `README.md`; verify documentation/reference tests and explicitly retain the discussion-edit/thread coverage limitations.

## 2. Shared applicability assessment

- [ ] 2.1 Introduce a pure assessment in the triage domain returning current/superseded/unknown with dimension-specific reasons, and route `computeNeedsInference` through it; verify `tests/triage.test.ts` covers older-dated head changes, matching evidence after refetch, delayed saves, backward discussion-watermark changes, partial/invalid basis, and mismatch precedence over unknown evidence.
- [ ] 2.2 Preserve existing selection/filter and no-decision/invalid-decision behavior while removing `decidedAt` as the activity cutoff; verify triage selection tests and add a CI-only change scenario proving readiness is outside this assessment.
- [ ] 2.3 Update freshness documentation to describe applicability rather than approval or completed code-review coverage; verify the documented state/reason semantics agree with the assessment fixtures.

## 3. Truthful decision mutation

- [ ] 3.1 Stop snapshot overwrite/fill of explicit basis in `saveDecision`; preserve prior basis when omitted and leave new attribution unknown; verify isolated decision tests for S1/A analysis saved after S2/B refresh, partial input, no snapshot, and omitted-basis updates.
- [ ] 3.2 Add additive recommendation/record-only mutation mode to schemas and the decision domain under the existing lock; verify record-only preserves all recommendation fields while retaining/deduplicating observations, and creates an unknown blocked-analysis placeholder when no decision exists.
- [ ] 3.3 Add executable failed/incomplete/blocked attempt regressions showing stale/unknown applicability remains unchanged after record-only writes; verify decision and triage assertions together using temporary state only, including protection from outdated caller recommendation fields.
- [ ] 3.4 Update decision tool descriptions and mutation documentation to explain explicit attribution and record-only intent; verify schema/reference tests and preserve the stated limitation that ordinary same-PR recommendation replacement is not an atomic-history solution.

## 4. Client and analysis-workflow integration

- [ ] 4.1 Expose shared applicability and concrete reasons in `extensions/queue-core.ts`, `state-query.ts`, and `triage-tool-results.ts`, preserving historical recommendation details on reassessment rows; verify their respective tests cover current, superseded, and unknown states without changing bucket/filter semantics or adding a new UI.
- [ ] 4.2 Update `agents/pr-triage-analyst.md` and packaged triage/analysis-record/code-review guidance to carry the evaluated discussion basis, retain superseded analysis, and use record-only for non-accepted attempts; verify skill/agent reference tests and inspect every packaged decision-save entry point for consistent mutation intent.
- [ ] 4.3 Update `README.md`, `docs/design.md`, and affected workflow examples for the new result fields and conservative legacy reassessment; verify documentation tests and confirm no claims of CI readiness, atomic structured history, or post-review Claude SHA gates were introduced.

## 5. Integration validation

- [ ] 5.1 Add an isolated end-to-end deterministic scenario covering evaluation at A/D1, refresh to B/D2, superseded save, failed record-only attempt, and successful explicit reevaluation; verify queue, discovery, focused query, retained observations, and original provenance agree at each step.
- [ ] 5.2 Run `npm test`, explicit `node --check` for every extension/fixture/test file, and `git diff --check`; verify all pass and report the actual commands/results rather than treating skill-text assertions as execution evidence.
- [ ] 5.3 Verify isolated Pi extension loading for the additive schemas/tools without live GitHub calls or real maintainer-state writes; confirm registration succeeds and document the isolated environment and validation limits.
