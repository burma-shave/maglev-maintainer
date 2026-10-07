# AGENTS.md

## Project and development scope

**Maglev PR Maintainer** is the Pi package in this repository for maintaining
`OneBusAway/maglev`. It unifies metadata triage, Bench lifecycle, review tools,
API/spec skills, and durable maintainer state. Read existing code and workflow
context before changing it. See `README.md` for the current resource/module
inventory and `docs/design.md` for architecture and explicitly planned UI work.

Develop in the active repository checkout, not a hard-coded workspace path.
On this host that checkout is `/home/pi/maglev-pr-maintainer`; other installations
may differ. Maintainer state and target Maglev source are separate from package
source. Use `maglev_pr_workspace_context` for configured paths, and
`maglev_pr_checkout` when target source is needed outside a Bench.

Do not edit old global extensions, skills, or helper scripts without an explicit
request. Historical migration references included:

```text
/home/ubuntu/.pi/agent/extensions/maglev-pr-triage-tui.ts
/workspace/agentic/skills/maglev-pr-triage/SKILL.md
/workspace/agentic/skills/maglev-pr-worktree/SKILL.md
/workspace/bin/prrs-start
/workspace/bin/pr-worktree
/workspace/bin/prrs-teardown
```

Those paths are historical, not prerequisites, and are absent on this host.
The package implements lifecycle operations directly; it does not wrap those
helpers or require a separate `/workspace/maglev` checkout. GitHub commands
must name the repository explicitly.

## Naming and Bench lifecycle

- **Bench**: a branch-based environment with stable identity, independent plain
  checkout, tmux/Pi session, background startup context, and artifacts.
- **PR Bench**: a Bench optionally associated with a PR, using the same lifecycle.
- Legacy PR Bench identities are `pr-<PR>`; branch Bench IDs are
  `branch-<slug>-<hash>`, independent of Git branch names. Definitions live at
  `benches/<id>/bench.json` under the maintainer root.
- Association preserves identity, branch, paths, session, and artifacts.
- New Pi windows run from the checkout root without an initial task or automatic
  kickoff. Optional `context` is background via `--append-system-prompt`, only
  when launching a new Pi window; existing sessions are not modified.

Use Bench terminology, not “worktree,” as the primary workflow name. General
`maglev_bench_*` tools and PR-specialized tools share the lifecycle implementation.

Start, reset, association, and close tools default to plans. Apply only on an
explicit request. Inspect first, show warnings, and preserve identity/path
refusals. Draft/conflicted/failing/pinned PRs, stale/missing triage inference,
and absent stack-parent Benches are informational, not start blockers. Stale or
incomplete snapshots and existing HEAD mismatches still require acknowledgement.

Close protects dirty/ignored files and local-only commits on live refs (including
HEAD, other branches, and stash), not just checkout cleanliness. Remote-ref
checks are cached; fetch/prune and inspect again before deletion unless network
calls are prohibited. A missing upstream alone is not unsafe if remote refs
preserve all live local commits. File/head overrides do not acknowledge committed
work loss. `removeCheckout: false` stops tmux while preserving checkout/artifacts.

Reset currently checks dirty files but does **not** protect unpushed committed
work (open finding F1). Preserve displaced work before reset; do not describe
reset as having close's commit safeguards.

## Architecture and canonical state

Keep deterministic domain functions separate from Pi registration/adapters.
Tools, commands, TUI, and skills are clients of the same domain functions.
Skills provide policy/inference, not alternate JSON mutation implementations.

Canonical state is durable files under `/var/lib/maglev-pr-maintainer` by default,
overridden by `MAGLEV_PR_MAINTAINER_ROOT`. Pi custom entries may hold display-only
reports, never canonical workflow state.

### GitHub snapshot: `state/github-snapshot.json`

- Written only by metadata refresh; facts derived from GitHub only.
- No inferred buckets, manual overrides, session entries, or local Bench state.
- Includes PR refs/head, activity, discussions/reviews, checks, files, and
  GitHub-derived meaningful activity/stack metadata.
- Check snapshot staleness before metadata-dependent work; refresh when needed
  unless live GitHub calls are prohibited.

### Decisions: `state/decisions.json`

- Written through `maglev_pr_decisions`, never ad-hoc scripts.
- Buckets: `review | chase | pinned | watch`; `triage` and `bench` are display-only.
- Preserve unrelated decisions; validate timestamps and durable reason text.
- Use absolute dates in reasons/observations, not “today” or “recently.”
- Upsert/delete hold a filesystem lock across the complete read-modify-write,
  then write atomically. See `docs/decision-mutation-locking.md` for contention,
  cancellation, failure, and manual orphan recovery. Never steal a lock by age.

Example:

```json
{
  "pr": 1362,
  "bucket": "watch",
  "priority": 3,
  "reason": "maintainer chased on 2026-09-05; wait for contributor update",
  "observations": ["requested changes still open"],
  "decidedAt": "2026-09-05T01:24:43.957Z",
  "source": "skill",
  "basis": {
    "snapshotFetchedAt": "2026-09-05T01:21:51.636Z",
    "meaningfulUpdatedAt": "2026-09-05T01:05:38Z",
    "headOid": "3bc474b..."
  }
}
```

## Workflow responsibilities

### Triage

Use compact needs-inference/decision outputs in the parent. Delegate one PR per
fresh-context `maglev-pr-maintainer.pr-triage-analyst`; that child loads only its
assigned PR using `maglev_pr_load_metadata` and returns a recommendation/basis.
The parent owns ordering, decisions, persistence, and final acceptance. Intentional
focused parent inspection of one selected PR remains supported. Do not use live
`gh` calls for normal snapshot triage or bulk-load discussions into the parent.

Meaningful activity excludes bot/status churn. Current head-change timestamp and
basis-stamping limitations remain open findings F3/F4; do not claim they are fixed.

### Reviews and drafts

`maglev-pr-code-review` runs the existing Claude Code tool and validates findings.
`maglev-pr-review-draft` packages already-settled findings from any review source;
it must not invent findings or submit reviews. OBA API review is a distinct
behavior/client/spec review, not a replacement for general code review.

The current explicitly requested `maglev_pr_bench_kickoff` template composes code
review and draft creation. It is never invoked by start/recovery. Whenever settled
actionable PR review findings emerge in any context (Claude Code, API/spec,
manual investigation, or maintainer discussion), invoke `maglev-pr-review-draft`
and save them automatically. No separate draft request or review-only mode exists.
A review handoff must include the saved draft path/event or a concrete save blocker.
No findings alone is not approval; failed/incomplete reviews must not clear drafts.

Prospective review JSON must be written through `maglev_pr_review_json`, and
cleared through its dedicated tool. Keep summary/comments PR-facing; report local
housekeeping separately. Claude command/plugin publication behavior is an open
deployment verification issue (F7), not guaranteed by a local review wrapper.

### Documents and privileged handoffs

Follow `librarian` for working documents: returned `artifacts.targetReportsDir`
for PR or branch Bench reports; `<maintainerRoot>/plans/` when no Bench applies.
Respect explicitly requested destinations. Repository documentation intended for
commit belongs in the repository. Do not default reports to checkout-local `tmp/`.

Generated privileged scripts belong in `artifacts.generatedScriptsDir`, mode
`0755`. Follow `privileged-handoff-script`: human execution performs writes
immediately unless preview/apply gates were explicitly requested. Generation and
syntax validation never authorize executing the script or publishing to GitHub.

## Current UI versus planned UI

`/maglev-prs` and `/maglev-pr-benches` are read-only transcript reports with optional
PR filters, not interactive refresh/marking/tab queues. The review JSON viewer and
PR lifecycle confirmation flows are implemented. A queue refresh key, TRIAGE tab,
and manual marking UI remain planned; use tools/skills for those operations now.

## Testing and isolated development

From this repository root:

```bash
pi --no-extensions --no-skills \
  -e ./extensions/index.ts \
  --skill ./skills \
  --name "Develop Maglev PR Maintainer"
```

Avoid loading old global resources alongside the package. Delegated triage also
requires `pi-subagents`; load it explicitly when testing that workflow in isolation.

Run `npm test` for deterministic tests. The existing `npm run check` glob command
checks only the first file (open F6). Until corrected, check each file explicitly:

```bash
for file in extensions/*.ts testdata/*.ts tests/*.test.ts; do
  node --check "$file" || exit
done
git diff --check
```

This is syntax validation, not TypeScript typechecking. Test cross-process state
mutations with isolated temporary files, never real maintainer state. Verify Pi
extension loading separately from unit tests when registrations change. Never
commit, push, publish, or run destructive lifecycle tests without authorization.

## Compatibility / migration

No runtime compatibility reads from old maintainer paths are supported. Copy
state into the configured root before use if preservation is required. Installation
and cutover status is deployment-specific; do not assume global package settings
from historical instructions.
