---
name: maglev-pr-code-review
compatibility: Requires the Maglev Maintainer extension tools and an authenticated Claude Code CLI with /code-review available.
description: Run Claude Code /code-review for a Maglev PR by number without requiring a Bench or checkout. An explicit checkout is optional. Automatically hands settled findings to maglev-pr-review-draft; never submits GitHub reviews.
---

# Maglev PR code review

## Workflow

1. Resolve the PR number and call `maglev_workspace_context` with `pr` for configured artifact paths. Do not inspect or start Benches or require an existing checkout. **Before invoking the review tool or dispatching a review subagent**, read and apply the pre-review history guardrail in `../maglev-pr-analysis-record/SKILL.md`: check fresh current-head metadata and exact saved analysis observations. Skip completed same-SHA, same-scope reviews with or without findings unless a concrete validation/scope reason or explicit fresh-review override justifies rerunning. Report reused evidence and the next action instead; do not label reuse as a new code review. Missing/unknown-SHA or incomplete records do not prove coverage. A generic request to review more PRs is not an override. For a justified rerun, state the reason before dispatch. This pre-launch check does not add a post-review SHA-confirmation gate.
2. Call `maglev_pr_code_review` with `pr` alone by default. For a supplied checkout, call `maglev_pr_code_review` with explicit `workingDirectory`. The default timeout is 1200 seconds; `timeoutSeconds` may be set up to 3600.
3. Let the underlying Claude `/code-review` command manage its own review and validation workflow. Do not add instructions limiting checkouts, dependency installation, builds or tests. Use the tool rather than invoking Claude CLI directly.
4. Inspect the returned status, output and `logPath`; read the full log when needed. A failed, timed-out, or incomplete run is not a clean review. Report actual failures or eligibility skips, findings, validation results and limitations. Do not classify checkout/test activity as a violation or reject it merely because no checkout existed when review began.
5. Validate actionable findings before packaging them. Assume Claude Code's findings apply to the PR it reviewed; do not require a reviewed SHA or perform SHA checks as a completion or draft-creation gate. Missing SHA output is not a review failure or limitation.
6. Follow `../maglev-pr-analysis-record/SKILL.md` for **every outcome**, including no actionable findings, skips, failures, and incomplete validation. Save a durable `code-review` observation through `maglev_pr_decisions` with the analysis date, full source SHA and provenance (or explicit unknown), outcome, scope, findings/no-findings, prior-feedback closure, validation limits, and log/draft references. Preserve all older observations and their SHAs. For delegated reviews, return these facts to the parent; the parent owns serialized decision saves and must confirm persistence before final handoff.
7. A completed review with no actionable findings should normally move the PR to `review` as a **potential merge candidate**, subject to maintainer approval, checks, and other holds. Preserve explicit pins/unresolved holds; record the clean result without implying approval. Failed/incomplete reviews are not clean results.
8. Report settled findings, rejected/unconfirmed candidates, prior-feedback closure, validation results, full log path, and durable decision save outcome. The wrapper retains a publication guard; this workflow does not submit GitHub reviews.

## Handoff

Whenever settled actionable PR findings emerge, read `../maglev-pr-review-draft/SKILL.md` and save them through the dedicated draft tools before reporting completion. No separate draft request is needed, and there is no review-only mode. The prospective draft is the useful review output; include its path and event in the final response. Do not rerun a review solely to package findings, and do not add SHA gates for Claude Code findings.

If a complete review settles no prospective comments, follow the draft skill's no-findings flow **and save the clean analysis result as a durable decision observation**. Clearing/no draft is not a record that a review was done. No findings alone is not approval. Failed or incomplete reviews must not clear saved drafts, but their attempted analysis and limitations must still be recorded.
