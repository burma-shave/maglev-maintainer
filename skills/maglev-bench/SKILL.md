---
name: maglev-bench
compatibility: Requires the Maglev Maintainer extension tools.
description: Manage branch-based Maglev Benches for development, including opening existing branches, creating a branch from a base, inspecting/recovering/closing environments, and associating an existing Bench with a PR.
---

# Maglev Bench

A Bench is an independent Maglev checkout tied to a branch, with a stable ID,
tmux session, Pi window, startup context, and external artifacts. A PR Bench is
that same environment enriched with a PR association, not another implementation.

1. Call `maglev_pr_workspace_context` first. Use returned paths/capabilities.
2. Use `maglev_bench_list` and `maglev_bench_inspect` for local state. IDs are
   distinct from branch names; never guess paths from a sanitized branch name.
3. On explicit request, use `maglev_bench_start` with `branch`. Omit `createFrom`
   to open an existing origin branch; supply it only when the user explicitly
   wants a new branch (e.g. `origin/main`). Initial scope is OneBusAway/maglev.
4. Start/close/association default to plans. Set `apply: true` only for an explicit
   user request, and report refusals/warnings before applying acknowledgements.
5. Startup `context` is background appended only to a new Pi session's system
   prompt. It submits no task/review. An existing Pi window cannot receive new
   context through start. Do not invoke PR review kickoff automatically.
6. Start/recovery never pulls or resets existing branches. A branch mismatch is a
   refusal, not permission to switch/reset work. Check returned verification
   before claiming a complete environment.
7. Unassociated branch Benches need no snapshot or triage decision. Before PR
   association, check snapshot staleness and refresh if needed unless live GitHub
   calls are prohibited. Use `maglev_bench_associate_pr` with the existing ID and
   PR number. Head repository/branch must match; a PR cannot have another Bench.
   Association preserves all paths and active sessions. Use PR tools/skill after
   association for PR-specific review/head-reset workflows.
8. Cleanup must protect dirty/ignored files and committed work. Show all warnings:
   `allowDirty` covers files (`any` includes ignored files), `allowStale` only
   covers PR-head mismatch, and `allowLocalCommits` separately acknowledges
   committed-work loss or unknown preservation. Before cleanup, run
   `git fetch origin --prune` from the returned checkout path and inspect again
   (unless live network calls are prohibited). Report fetch failures; do not
   silently treat stale refs as live proof. Checks cover all live local refs,
   including HEAD, other branches/stash, but not reflog-only history. Missing
   upstream alone is not unsafe if all commits are reachable from remote refs.
   Push or otherwise preserve remaining local-only work first. To stop tmux while
   preserving checkout/artifacts, set `removeCheckout: false`.
9. API runtimes accept `benchId` (mutually exclusive with `pr`/`workingDirectory`).
   Stop services explicitly before removing their source checkout; Bench closure
   does not stop Docker runtimes. Prefer returned per-Bench report directories.

Do not edit Bench manifests directly or call legacy low-level helper scripts.
