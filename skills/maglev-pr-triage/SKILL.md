---
name: maglev-pr-triage
compatibility: Requires the Maglev Maintainer extension tools; delegated analysis also requires pi-subagents.
description: Overview and triage of open OneBusAway/maglev PRs using Maglev Maintainer metadata and decision tools. Use when the maintainer asks for an open-PR overview, backlog summary, or what needs review, chase, watch, or pinning.
---

# Maglev PR Triage

Use this skill to infer PR buckets from the durable Maglev Maintainer GitHub snapshot and persist those decisions through the deterministic decision tool. Delegate detailed per-PR analysis to `maglev-maintainer.pr-triage-analyst` in fresh contexts; keep only compact recommendations in the parent. This workflow authorizes that bounded read-only delegation for triage, not child mutation or further fanout.

## Operating rules

- Do not call `gh` directly for normal triage.
- Tool text is model-visible: `maglev_pr_load_metadata` returns full selected PR facts and snapshot identity; `maglev_pr_needs_inference` returns every selected discovery row, and `maglev_pr_decisions` operation `list` returns compact saved queues with reasons and basis. Use decision `get` for exact saved observations. Keep full metadata in the delegated per-PR context unless focused parent inspection is intentionally requested.
- Do not edit JSON files directly.
- Do not craft ad-hoc shell/Python/JQ scripts to inspect Maglev state JSON; use `maglev_pr_state_query` when exact joined snapshot/decision/PR Bench fields need to enter model context.
- Parent-context guardrail: never call `maglev_pr_state_query` with `selection: "all"`, an omitted PR filter, or a multi-PR backlog filter to obtain an overview. Its output includes full commits, reviews, and comments, not a compact summary. Likewise, never bulk-load backlog metadata with `maglev_pr_load_metadata`. Pagination or multiple small batches do not bypass this rule. Parent-side exact-state queries are limited to one disputed PR or explicitly identified Bench reconciliation facts.
- Do not depend on old TUI-exported `needs-refresh` files.
- Do not start or close PR Benches unless the user explicitly asks; hand off to `maglev-bench` for that.
- If the maintainer indicates that a PR has been merged, landed, or closed, do not automatically close anything. If a PR number is known, check for a local PR Bench with `maglev_bench_resolve_pr` for that PR and prompt the maintainer to clean it up if one exists. If no PR number is known, ask which PR was merged before checking.
- Do not write relative temporal phrases such as `today`, `yesterday`, `recently`, or `this morning` into durable decision `reason` or `observations`; use absolute dates from the snapshot instead, such as `maintainer chased on 2026-09-05`.
- Do not parallelize `maglev_pr_decisions` mutations; upsert/delete calls should run sequentially so durable decision updates are easy to audit.

## Flow

1. Call `maglev_pr_snapshot_staleness` before relying on PR metadata.
2. If `shouldRefresh` is true because the snapshot is missing or older than the package threshold (currently 4 hours), call `maglev_pr_refresh_metadata` unless the maintainer explicitly asked not to make live GitHub calls.
3. After any successful snapshot refresh, call `maglev_bench_list`, select rows with a `pr` association, and check whether each active local PR Bench still corresponds to a PR in the refreshed open-PR snapshot. Use `maglev_pr_state_query` with the active Bench PR numbers when exact joined state is needed. If a Bench no longer has an open snapshot PR, tell the maintainer it appears to be for a closed or merged PR and ask whether they want to clean up that PR Bench. Do not close it unless they explicitly ask.
4. Call `maglev_pr_needs_inference` to find PRs with missing or stale decisions.
5. Do not load all selected PRs' metadata into the parent. Use `package.triageAgent` from workspace context (currently `maglev-maintainer.pr-triage-analyst`) for agent discovery and delegation rather than constructing the package-qualified name. Enable subagents with `subagents_enable` when needed, then confirm that agent is available using `subagent({action: "list", capabilities: true})`. Assign each selected PR to one fresh-context analyst, supplying only PR number, snapshotFetchedAt from `maglev_pr_needs_inference`, an absolute as-of timestamp, cwd, and explicit maintainer constraints. The analyst loads that PR's metadata itself and returns the compact result contract from its agent definition.
6. Use direct async calls for one PR, or a bounded workflow/rolling fanout for multiple PRs (at most three active analysts). Use `context: "fresh"`, never fork the parent transcript. Do not pass full PR facts or read child logs/transcripts back into the parent. In an interactive session, yield when only async work remains and resume on native completion notifications. The analyst is read-only: no refreshes, decisions, PR Bench mutations, GitHub calls, or nested delegation.
7. Check each compact result's PR, basis, evidence, confidence, and caveats. The parent owns cross-PR urgency ordering and the settled bucket/priority. Respect explicit maintainer/user pins; resolve `needsParentConfirmation` before changing them. For low-confidence or contradictory results, ask a narrow follow-up or load only the disputed PR's exact state; do not bulk-load metadata as a fallback.
8. Before saving results, call `maglev_pr_snapshot_staleness` again and compare its `fetchedAt` to the analyzed `basis.snapshotFetchedAt`. If it changed, discard affected recommendations and reanalyze against the new snapshot; do not stamp old analysis with new facts. Do not refresh while an analysis batch is active. Persist accepted results sequentially with `maglev_pr_decisions` operation `upsert`, using the returned reason/observations and basis. Do not persist blocked, failed, missing, or unresolved recommendations.
9. Summarize review, chase, watch, and pinned queues from the compact results. Include warnings/notes and any PRs whose analysis is incomplete.

### Availability and fallback

The package exposes the analyst through `pi.subagents.agents` in `package.json`; `pi-subagents` must be installed and the package loaded. After resource changes, use `/reload` before discovery. If delegation is unavailable or fails, report the exact blocker and leave affected decisions unchanged. Offer parent-side analysis one PR at a time only with maintainer approval; never silently load the entire backlog.

### Open-PR overviews and backlog summaries

Requests such as "give me an overview of open PRs" invoke this skill; they are not an exception to delegation or parent-context limits.

1. Check snapshot freshness using flow steps 1–3, then call `maglev_pr_needs_inference` and read saved buckets with `maglev_pr_decisions` operation `list`. These are compact discovery inputs, not substitutes for current analysis.
2. Delegate every PR with a missing or stale decision to the fresh-context analyst using flow steps 5–7 (at most three active analysts). Do not label an overview "facts-only" or "existing queues" to avoid this step. For PRs with current saved decisions, summarize those decisions without loading their detailed metadata.
3. If the requested overview needs facts absent from the compact inputs (titles, readiness, blockers, or current review evidence), delegate the relevant PRs, including ones with current decisions. Analysts load their own per-PR facts; the parent receives only compact results.
4. An overview request alone does not require writing decisions. If persisting accepted triage results, follow step 8. Never silently present stale saved buckets as current; mark pending or failed analysis explicitly.
5. If delegation is unavailable, follow the availability fallback above. Give a clearly labeled saved-queue summary if useful, explain its limits, and ask for approval before parent-side analysis one PR at a time. Never bulk-load the backlog as a fallback.

A saved-queue-only summary may skip delegation only when no missing/stale decisions are being represented as current and no new per-PR evidence or inference is needed. A close-to-merge shortlist requires delegated evidence checks for the selected PRs even if they are not in `needs-inference`.

## Buckets

- `review`: maintainer should review/re-review now.
- `chase`: contributor action is overdue enough to batch-chase.
- `pinned`: blocked on maintainer/spec/CI/conflict/strategic decision.
- `watch`: wait for contributor or external signal; no immediate action.

## Maintainer-attention prioritization

The maintainer is usually trying to address the most urgent PRs first, not just find clean review candidates.

- Treat any explicit call for maintainer attention as actionable and highlight it prominently. This includes contributor questions, requests for direction, requests for clarification, merge-conflict/blocker coordination, spec decisions, CI/blocker calls, and ready-for-re-review comments.
- Always state the concrete action needed, such as `respond`, `give direction`, `re-review`, `review`, `resolve blocker`, `decide spec/API direction`, or `merge/conflict coordination`.
- Do not present conflicted, blocked, or direction-seeking PRs as ordinary clean review candidates. They may still be urgent, but label the action accurately.
- Sort urgent maintainer-attention items primarily by actionability/urgency signals from the snapshot: explicit unanswered maintainer-directed questions and contributor updates after requested changes should normally rise above routine clean reviews.
- Use age as an important tie-breaker and stale-risk signal. Older actionable PRs should not be allowed to languish, but age usually breaks ties between similarly urgent items rather than overriding a newer explicit maintainer-attention request.
- `chase` is different: aggregate chase items and handle them at the end of a session/day. Age still matters for chase ordering and deciding what is overdue, but chase items should not displace non-chase maintainer-attention work unless the maintainer asks.
- Do not take a view on which PRs are more valuable. Describe scope, age, readiness, blockers, and review effort, but avoid ranking based on perceived product or technical value.
- Deviation from this ordering should be based only on explicit maintainer direction or deterministic readiness/blocker facts, not subjective value judgments.

## User-facing triage output

When the maintainer asks what to review or what needs attention:

- Lead with a short `Needs maintainer attention` list, sorted by urgency with age as a tie-breaker.
- For each item, include PR number/title, action needed, why it is urgent, and any blockers/conflicts/check failures that affect how to handle it.
- Then list `Clean review candidates` separately, for PRs that are not waiting on contributor action and do not primarily need direction/blocker handling.
- Put `Chase later` or `Chase batch` last, summarized rather than interleaved with review/response work.

When the maintainer asks for PRs that are close to merging, use this compact layout:

- Start with the snapshot freshness timestamp in one short sentence.
- Give a numbered list of the best close-to-merge candidates, ordered by merge-readiness.
- Each item should include:
  - `#PR — title`
  - PR URL on the next line
  - A short readiness label or sentence, such as `Closest.`, `Clean merge state`, or `Worth reviewing after the first few`.
  - Concrete evidence: merge state, bad checks, CodeRabbit/human review status, Java/spec parity, and whether a latest commit appears to address a remaining nit.
  - `Action:` with the next maintainer step, such as `quick maintainer review/merge`, `verify one scoped fix`, or `ask for PR-description note, then merge`.
  - If an active local PR Bench exists and is fresh, mention its path only when useful.
- End with a short `Not close right now:` sentence naming blocked/requested-changes/spec-held PRs and why they are excluded.
