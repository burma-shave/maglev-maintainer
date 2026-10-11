# Implementation validation

## Deterministic checks

- `npm test`: 179 tests passed, no failures or skips.
- Explicit per-file `node --check` over `extensions/*.ts`, `testdata/*.ts`, and `tests/*.test.ts`: passed (syntax only, not TypeScript typechecking).
- `git diff --check`: passed.
- Active source/resource/documentation audit: removed identifiers remain only in the README's breaking-removal note and negative test assertions, not live launch instructions or imports. Relative skill-link and tool-capability resolution tests passed.
- The initial new test's direct schema import could not resolve the host-provided `typebox` peer under standalone Node. With maintainer approval, it now checks source-level schema absence; actual registrations were checked through Pi's loader below. No dependency installation or manifest change was made.

## Isolated Pi resource loading

Used the installed Pi 1.1.0 SDK `DefaultResourceLoader`, in-memory settings, an empty temporary cwd/agent directory, all ambient resource categories disabled, and explicit extension/skill paths. `MAGLEV_MAINTAINER_ROOT` pointed to temporary scratch space; `PATH` pointed to a nonexistent directory so no Claude CLI was available. No session/model prompt, extension tool execution, lifecycle event, subprocess review, network call, or GitHub operation was performed. Temporary loader state was removed afterward.

Maintainer alone: 23 tools and 18 skills, zero extension errors/warnings or skill diagnostics. With the independently loaded external package: the same resources plus exactly `claude_code_review` and `claude-code-review`, with zero duplicates or diagnostics.

Observed maintainer tools:

```text
maglev_api_runtime_start
maglev_api_runtime_status
maglev_api_runtime_stop
maglev_bench_associate_pr
maglev_bench_close
maglev_bench_inspect
maglev_bench_list
maglev_bench_reset
maglev_bench_resolve_pr
maglev_bench_start
maglev_checkout
maglev_companion_repos_resolve
maglev_pr_decisions
maglev_pr_load_metadata
maglev_pr_needs_inference
maglev_pr_refresh_metadata
maglev_pr_review_draft_clear
maglev_pr_review_draft_list
maglev_pr_review_draft_load
maglev_pr_review_draft_save
maglev_pr_snapshot_staleness
maglev_pr_state_query
maglev_workspace_context
```

Observed maintainer skills:

```text
maglev-api-runtime
maglev-artifacts
maglev-bench
maglev-bug-triage
maglev-checkout
maglev-companion-repos
maglev-handoff-script
maglev-legacy-api-runtime
maglev-pr-analysis-record
maglev-pr-review-draft
maglev-pr-triage
oba-api-change-review
oba-api-client-impact
oba-api-goal-check
oba-api-pr-spec-review
oba-api-spec-check
oba-api-spec-finder
oba-wiki-spec-update
```

Both removed tools and the removed launch skill were absent. Resource-file absence checks also cover the old prompt and local batch agent. This proves resource registration/discovery only, not that a live model will automatically choose the external skill or carry out every history/draft obligation.

## Scenario coverage

| Spec scenario | Evidence / limitation |
| --- | --- |
| Maintainer loads without a review provider | Isolated loader with no CLI on PATH; registration/schema/resource absence tests. |
| Workspace capabilities are queried | `tests/workspace-context.test.ts` verifies removed key absence and retained history/draft/lifecycle values. |
| External review resources are loaded | Isolated combined loader discovers one external tool and skill without duplicates. |
| No external review resource is available | Maintainer-only loader plus unchanged provider-free manifest and negative launch-source checks; no fallback added. |
| External analysis is completed | Retained generic instruction checks in `tests/review-skills.test.ts` cover SHA/provenance, unknown evidence, record-only attempts, and parent-owned persistence; live external review not run. |
| Equivalent review already exists | Retained pre-launch history/reuse tests cover same-SHA/scope, fresh head, findings/no-findings, and explicit rerun reasons. |
| Actionable external findings are settled | Draft skill tests cover automatic handoff, validation, tools, and no publication; existing `tests/review-json.test.ts` covers diff anchors with injected GitHub operations. |
| External review fails | Draft/history guidance tests retain no clean inference, no failed-review draft clearing, and record-only evidence policy. |
| Removal is deployed over existing state | No state migration/deletion code added; state/history/draft implementation is unchanged. Existing state and draft-store tests use isolated fixtures, not real maintainer state. |
| Bench starts with background context | Existing Bench core/context/execution tests passed; shared lifecycle implementation is unchanged apart from exclusive kickoff-renderer removal. |

## Limits

No live Claude review, publication behavior, automatic model-level skill selection, or end-to-end history/draft composition was exercised. Actual deployment settings and reload remain maintainer responsibilities. No real maintainer state, existing logs/drafts, Bench checkouts, or external extension source were modified.
