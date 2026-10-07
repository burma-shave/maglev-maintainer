---
name: maglev-pr-bench
compatibility: Requires the Maglev PR Maintainer extension tools.
description: Manage local PR Benches for OneBusAway/maglev PR review. Use when the maintainer asks to open, inspect, continue, list, or close a PR Bench.
---

# Maglev PR Bench

A **PR Bench** is a specialization of a branch-based Bench with a PR association. Existing PR Benches use a plain checkout path such as `/var/lib/maglev-pr-maintainer/checkouts/pr-N`, `pr-N` branch, tmux session, and a tmux window named `pi` running Pi from the checkout root. New Pi windows start without an initial user prompt or automatic review. An agent can supply optional free-form `context` to Bench start as background for the new Pi session. Review kickoff is a separate, explicitly requested operation. A branch Bench can acquire a PR association through `maglev_bench_associate_pr` without changing its branch, ID, checkout/session, or artifact paths; PR tools then resolve that same Bench. Use the `maglev-bench` skill for branch development and association.

Use PR Bench tools:

- `maglev_pr_snapshot_staleness` — read-only check for whether remote PR metadata is missing or older than the package threshold, currently 4 hours
- `maglev_pr_refresh_metadata` — refresh remote PR metadata when the staleness check says `shouldRefresh: true`
- `maglev_pr_bench_list` — read-only list of local PR Benches
- `maglev_pr_bench_inspect` — read-only inspection of one PR Bench
- `maglev_pr_bench_kickoff` — load review kickoff instructions and PR context for the calling agent on demand; does not start a bench, write prompt files, or send input to another Pi session
- `maglev_pr_bench_start` — dry-run by default; uses a plain checkout plus `gh pr checkout`, and can complete safe partial PR Benches
- `maglev_pr_bench_reset` — dry-run by default; resets an existing Bench checkout to the snapshot PR head after a force-push
- `maglev_pr_bench_close` — dry-run by default; executes only with explicit `apply` after required acknowledgements

Rules:

- Before PR Bench work that depends on remote PR metadata, call `maglev_pr_snapshot_staleness`; if `shouldRefresh` is true, call `maglev_pr_refresh_metadata` unless the maintainer explicitly asked not to make live GitHub calls.
- Only start or close a PR Bench when the user explicitly asks.
- For an agent handoff, pass `context` to `maglev_pr_bench_start` with relevant goals, findings, constraints, and references. It is appended to the new Pi session's system prompt, not submitted as a task, and does not trigger a model turn. Dry runs write no files; blank context is ignored. Start refuses context when reusing an existing Pi window rather than silently dropping it or modifying that session.
- Do not invoke `maglev_pr_bench_kickoff` automatically after starting or recovering a Bench. Only use it when the maintainer explicitly asks for a review kickoff; follow its instructions from the specified checkout.
- Opening a review Bench is not a merge-readiness decision. Draft status, failing checks, pinned decisions, stale/missing triage inference, merge conflicts, and a missing stack-parent Bench are informational: report them, but do not ask for additional acknowledgement. The explicit request to start is sufficient authorization.
- Start-safety acknowledgement remains required for stale/incomplete snapshot data or an existing Bench HEAD mismatch. Keep path/identity refusals and destructive reset/close safeguards intact.
- `maglev_pr_bench_start` is also the recovery/completion path for safe partial Benches, such as a missing `pr-N` branch, missing tmux session, or missing `pi` tmux window. Do not claim a PR Bench was started or completed unless the tool result says `applied: true`.
- When a contributor force-push leaves an already-opened Bench at an old head, use `maglev_pr_bench_reset`; it updates the existing checkout to the snapshot PR head and requires explicit dirty-state acknowledgement before discarding local changes. Do not use Bench start for this normal already-open Bench update flow.
- Show cleanup warnings explicitly. `allowDirty` acknowledges files (`any` also covers ignored files); `allowStale` acknowledges PR-head mismatch. `allowLocalCommits` separately acknowledges losing local-only commits or unknown preservation. A clean working directory is not proof that a checkout can be deleted. Before cleanup, run `git fetch origin --prune` from the returned checkout path and inspect again, unless live network calls are prohibited. Report fetch failures. Checks use cached remote refs, not a fetch; missing upstream alone is safe if all live local commits are reachable from remote refs. Reflog-only history is excluded. Preserve remaining local-only committed work first. `removeCheckout: false` stops tmux without deleting work or artifacts.
- Review and draft creation are separate from Bench lifecycle. Use `../maglev-pr-code-review/SKILL.md` for a standalone Claude Code review and `../maglev-pr-review-draft/SKILL.md` for packaging already-settled findings. An explicitly requested kickoff composes both in sequence; starting/recovering a Bench runs neither automatically.
- Prefer PR Bench terminology in user-facing output.
- Do not call low-level compatibility scripts directly.
- Do not make triage/chase policy decisions here; hand off to `maglev-pr-triage` when needed.
