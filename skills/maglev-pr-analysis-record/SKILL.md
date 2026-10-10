---
name: maglev-pr-analysis-record
description: Persist or retrieve durable Maglev PR analysis history, including analysis type, SHA, findings/no-findings, evidence, and limitations, through PR decisions. Use after any PR analysis or when asked whether a PR has been reviewed or analyzed.
---

# Maglev PR analysis record

Every analysis of an identified PR must leave a durable record, including clean,
failed, incomplete, and blocked analyses. Reports, Claude logs, subagent results,
mission summaries, and prospective drafts are evidence, not substitutes for this
record. Clearing a draft must not erase the analysis history.

Use the existing `maglev_pr_decisions` store: append one self-contained `analysis:`
observation per analysis. No new bucket or approval event is required. History is
retrieved with decision `get` or a focused `maglev_pr_state_query`; the compact
`list` output intentionally omits observations.

## Pre-review history guardrail

Before selecting a PR for review **and before launching** `maglev_pr_code_review`
or a review subagent, inspect its durable analysis history. This applies in clean
sessions and to requests such as “review some more PRs”; that request alone is
not an override to repeat completed reviews.

1. Establish the current PR head from fresh metadata: check snapshot staleness
   and refresh when required unless live calls are prohibited. Use the selected
   PR's snapshot head, not a checkout's unrelated HEAD. With explicitly authorized
   stale/offline metadata, disclose that current-head coverage is unverified.
2. Get its exact decision observations via `maglev_pr_decisions` operation `get`.
   A delegated read-only triage analyst instead uses
   `maglev_pr_state_query({prs: [N]})` for that one PR. Compact decision `list`,
   `needs-inference`, a bucket, and presence/absence of a draft are **not** enough:
   they do not establish completed review coverage. Keep backlog facts in the
   analysts; return only compact history evidence to the parent.
3. Compare full recorded SHA, analysis type, status, and scope/validation with the
   intended review. A completed same-SHA, same-scope `code-review` normally means
   **skip redundant code review**, whether it found issues or found none:
   - No actionable findings: reuse the result; next action is maintainer approval
     and remaining merge checks/holds, not another identical review.
   - Actionable findings on an unchanged head: reuse the findings; next action is
     contributor fixes or the outstanding decision, not another identical review.
   - Changed SHA, failed/incomplete prior review, a materially different scope, or
     a concrete validation gap can justify review. Missing/unknown SHA, unclear
     scope, missing records, or bot-only/metadata/API/spec analysis cannot establish
     completed general code-review coverage. These are reasons to investigate or
     select a review, not proof the PR was never reviewed.
4. For a same-SHA rerun, state the concrete reason **before dispatch**: e.g. an
   untested risk the prior review did not cover, new evidence contradicting its
   conclusion, or an explicit user request to re-review despite the saved result.
   The word “review” or “more” alone is not that request. If records conflict or
   cannot be read, resolve the narrow uncertainty/report the blocker; do not
   silently launch an automatic batch with the guardrail bypassed.
5. The parent owns the final selection. Include prior analysis date/SHA/outcome,
   scope/limitations, and `skip` or `review` with a reason in each candidate's
   compact assessment. Recheck the candidate's current head/history at dispatch
   if selection evidence changed or another review finished in the meantime.
   For delegated execution, give the child this evidence; it also applies this
   guardrail before invoking the review tool.

A history-only lookup/reuse is not a new code review: do not append a misleading
`code-review` completion, rerun merely to create a draft, clear existing drafts,
or erase history. If new readiness analysis was performed, record it as
`metadata-triage` with the skip/reuse reason. Skipping review never implies approval.
This is a **pre-launch selection check**, not a new post-review SHA gate for
Claude Code completion or draft creation.

## Record an analysis

1. Call `maglev_workspace_context` with the PR. Establish the analysis type and
   actual scope: `code-review`, `api-review`, `spec-review`, `client-impact`,
   `goal-check`, `metadata-triage`, `manual-investigation`, or another explicit
   label. Do not call metadata triage a code review.
2. Record the full SHA of the source analyzed and how it was established (checked
   source/ref, reviewer output, or snapshot attribution). Do not silently use the
   decision's current `basis.headOid` as proof of the analyzed revision: the
   decision writer stamps the current snapshot basis, which can differ. Include
   the SHA in the observation itself. If unavailable, record `sha=unknown` and
   the limitation; do not invent a SHA or omit the failed analysis. Uncommitted
   edits require a dirty/diff caveat; HEAD alone does not identify those edits.
   This records revision attribution, not an extra SHA-confirmation gate for
   Claude Code review completion or draft creation.
3. Compose a self-contained observation using absolute dates:

   `analysis: at=<ISO timestamp>; type=<kind>; sha=<full SHA or unknown>; shaSource=<provenance>; status=<completed|incomplete|failed|blocked>; outcome=<actionable-findings|no-actionable-findings|unconfirmed|not-applicable>; summary=<scope and result>; validation=<checks actually performed and limitations>; evidence=<log/report/draft paths or source references>; next=<next action>`

   Include settled finding count/severity, rejected/unconfirmed candidates,
   prior-feedback closure, and important limitations in the summary as relevant.
   A successful process exit alone is not a completed validated review. An
   incomplete review with zero confirmed findings is `unconfirmed`, not clean.
4. Get the existing decision immediately before saving. Preserve **all** existing
   observations, including older analysis records and their SHAs; append the new
   record (deduplicate only an identical record). Preserve historical results
   even when a later revision fixes a finding. Do not replace history with only
   the newest review. Record types separately when a workflow performed distinct
   analyses; an orchestrator can save their records in one upsert.
5. Set the current queue decision independently of the history:
   - A completed code review with no actionable findings is evidence that the PR
     **may be ready to merge**. Usually use `review` with reason
     `<absolute date> code review at <SHA> found no actionable findings; potential
     merge candidate pending maintainer approval and remaining checks/holds`.
   - Do not override explicit user pins or unresolved spec/dependency/check holds
     merely because a code review was clean. Preserve the bucket/priority and
     record clean-review evidence and the remaining hold in observations/reason.
   - Valid actionable findings generally mean contributor action (`watch`),
     unless a maintainer/spec decision is the actual next action (`pinned`).
   - Failed/incomplete analysis preserves the existing queue decision; if no
     decision exists, use `review` with a reason describing the blocked analysis,
     not merge readiness. Metadata triage uses its settled triage recommendation.
   - Narrow API/spec/client/goal analysis is not general code review or approval.
6. Upsert via `maglev_pr_decisions`, passing the preserved observations plus the
   new record, reason, bucket, priority, source, and analysis/snapshot basis.
   Serialize saves in the parent; read-only analysts return the record facts to
   the parent, which owns persistence. Do not let parallel children read/replace
   the same PR decision. The existing lock protects each upsert, not a separate
   caller-side get/merge/upsert transaction. If other sessions may write the same
   PR concurrently, coordinate a single owner rather than claiming atomic append.
7. Confirm the saved result and report the PR, type, SHA, outcome, and decisions
   file path. If saving fails, report the exact persistence blocker; do not claim
   the analysis handoff is complete. A draft save failure does not excuse saving
   the analysis result; include that failure as a limitation.

## Answer analysis-history questions

For questions such as “was a code review done on this PR?”, get that PR's decision
and inspect its `analysis:` observations. Report which analyses ran, when, at which
SHAs, findings/no-findings, and validation limits. Compare each recorded SHA with
the current snapshot head when available: a review of an older revision is history,
not coverage of the current revision. `sha=unknown` cannot establish current-head
coverage. Absence of a record means **no durable record found**, not proof that no
analysis ever occurred. Logs/reports can be used to backfill a record with explicit
provenance and limitations.

No findings alone is not approval or permission to merge. This skill neither
submits reviews nor changes GitHub.
