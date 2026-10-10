---
name: maglev-bench
compatibility: Requires the Maglev Maintainer extension tools.
description: Manage Maglev Benches by branch or PR, including opening, creating a branch from a base, listing, inspecting, recovering, associating with a PR, resetting to a PR head, and closing. PR association enriches the same environment without changing its identity or paths.
---

# Maglev Bench

A Bench is an independent Maglev checkout tied to a branch, with a stable ID,
tmux session, Pi window, startup context, and external artifacts. A PR Bench is
that same environment enriched with a PR association, not a separate environment
or lifecycle. Use this skill for both branch development and PR review environments.

## Resolve and inspect

1. Call `maglev_workspace_context` first. Pass `pr` or `benchId` when known
   (mutually exclusive), and use returned paths/capabilities.
2. Use `maglev_bench_list` for local Benches (optional `ids` or `prs` filters).
   When only a PR number is known, call `maglev_bench_resolve_pr` with `pr` once.
   It returns an existing stable `id`, or `id: null` when no Bench exists; it
   never creates a Bench or guesses an ID. Use `maglev_bench_inspect` with that
   ID. IDs are distinct from branch names; never derive paths from a branch slug.
3. Before work depending on remote PR metadata, call
   `maglev_pr_snapshot_staleness`; if `shouldRefresh` is true, call
   `maglev_pr_refresh_metadata` unless live GitHub calls are prohibited.
   Unassociated branch Benches need no snapshot or triage decision.

## Open, create, or recover

- For a branch, use `maglev_bench_start` with `branch`. Omit `createFrom` to open
  an existing origin branch; supply it only when the user explicitly wants a new
  branch (e.g. from `origin/main`). Initial scope is OneBusAway/maglev.
- For a PR number, use `maglev_bench_start` with `pr`, not `branch` or
  `createFrom`. Exactly one of `branch` or `pr` is required. Start returns `id`
  even for a plan; that is a planned identity, not proof a Bench exists. It uses a plain checkout plus
  `gh pr checkout` and resolves an already-associated branch Bench without
  changing its identity. It also completes safe partial PR Benches, such as a
  missing PR branch, tmux session, or `pi` window.
- Start defaults to a plan. Set `apply: true` only on explicit user request.
  Inspect existing state first; report refusals and warnings before applying
  acknowledgements. Start/recovery never pulls or resets existing branches.
  A branch/path/identity mismatch is a refusal, not permission to switch work.
- Opening a review Bench is not a merge-readiness decision. Draft status, failing
  checks, pinned decisions, stale/missing triage inference, merge conflicts, and
  missing stack-parent Benches are informational, not additional start blockers.
  Stale/incomplete snapshot data or an existing HEAD mismatch still require
  explicit start-safety acknowledgement. Preserve path/identity refusals.
- Do not claim a Bench was started or completed unless the result says
  `applied: true`; check returned verification before claiming completeness.
- Optional startup `context` carries goals, findings, constraints, and references
  as background appended only to a new Pi session's system prompt. It submits
  no task, review, or model turn. Dry runs write no files; blank context is
  ignored. An existing Pi window cannot receive new context through start.

## Associate with a PR

Check snapshot freshness first, then use `maglev_bench_associate_pr` with the
existing stable ID and PR number. Association defaults to a plan; apply only on
explicit request. Head repository/branch must match, and the PR cannot already
have another Bench. Association preserves branch, ID, checkout, tmux/Pi session,
and artifact paths. Continue using the same Bench ID after association.

## Update after a PR force-push

Use `maglev_bench_reset` with `id` for an existing Bench whose HEAD is displaced
by a contributor force-push, not Bench start. Reset requires a PR association
and refuses unassociated Benches; it targets that association's snapshot head. Refresh stale metadata first and inspect
local state. Reset defaults to a plan; apply only on explicit request after
showing warnings and obtaining explicit acknowledgement for discarded files.

Reset does **not** have close's committed-work protection. Preserve displaced
local-only or unpushed committed work before resetting; a clean checkout is not
proof that reset is safe. Do not describe reset as protecting commits.

## Close or stop the session

Use `maglev_bench_close` with `id`. Resolve a PR to its existing ID first if
needed. Close defaults to a plan; apply only on explicit request after inspection
and required warning acknowledgements.

- Show all cleanup warnings. `allowDirty` covers files (`any` includes ignored
  files); `allowStale` only covers PR-head mismatch. `allowLocalCommits` separately
  acknowledges committed-work loss or unknown preservation.
- Before cleanup, run `git fetch origin --prune` from the returned checkout path
  and inspect again, unless live network calls are prohibited. Report fetch
  failures; do not silently treat stale refs as live proof of preservation.
- Checks cover all live local refs, including HEAD, other branches, and stash,
  but not reflog-only history. A missing upstream alone is not unsafe if all
  commits are reachable from remote refs. A clean working directory is not proof
  that deletion is safe. Push or otherwise preserve remaining local-only work.
- To stop tmux while preserving checkout/artifacts, set `removeCheckout: false`.
- API runtimes accept `benchId` (mutually exclusive with `pr`/`workingDirectory`).
  Stop services explicitly before removing their source checkout; Bench closure
  does not stop Docker runtimes.

## Commands and related workflows

Use `/maglev-benches` and `/maglev-bench-*`. Start accepts a branch or
`--pr <number>`; `/maglev-bench-resolve-pr <number>` resolves an existing ID.
Inspect, close, and reset accept only the stable ID. Mutating commands print plans
by default; `--apply` explicitly authorizes execution, and warning overrides
require their dedicated flags. Duplicate PR lifecycle tools/commands are removed.

```text
/maglev-bench-start --pr 123
/maglev-bench-resolve-pr 123
/maglev-bench-inspect <returned-id>
/maglev-bench-reset <returned-id>
/maglev-bench-close <returned-id> --keep-checkout --apply
```

Review and draft creation are separate from lifecycle. Do not invoke
`maglev_pr_review_instructions_load` automatically after starting or recovering a Bench.
Only load kickoff on explicit request and follow its instructions from the
specified checkout. Use `../maglev-pr-code-review/SKILL.md` for standalone Claude
Code review and `../maglev-pr-review-draft/SKILL.md` for settled findings. Starting
or recovering a Bench runs neither automatically.

Use `../maglev-artifacts/SKILL.md` for artifact placement and the returned
per-Bench report directory. Do not edit Bench manifests directly or call legacy
low-level helper scripts. Do not make triage/chase decisions here; hand off to
`maglev-pr-triage` when needed. Use Bench terminology generally and PR Bench when
its PR association matters.
