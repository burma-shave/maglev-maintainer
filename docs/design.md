# Design: Maglev PR Maintainer

## Naming

- Top-level workflow/package: **Maglev PR Maintainer**
- General branch-based working environment: **Bench**
- PR specialization of a Bench: **PR Bench**
- Existing PR Benches contain:
  - root-relative plain checkout path, currently `/var/lib/maglev-pr-maintainer/checkouts/pr-N`
  - local branch `pr-N`
  - tmux session `pr-N`
  - tmux window `pi` running `pi` from the checkout root

UI says **Bench** generally and **PR Bench** for PR-specialized operations. The implementation uses independent plain checkouts rather than git worktrees.

## Shared Bench model

A Bench has a stable ID, repository (`OneBusAway/maglev` initially), branch, checkout,
tmux/Pi session, startup context, and artifacts. PR association enriches that Bench;
it is not a second environment or independent lifecycle implementation.

`bench-registry.ts` stores validated definitions atomically at `benches/<id>/bench.json`.
Branch IDs combine a safe branch slug and a hash of repository + exact branch name.
Legacy `pr-N` Benches remain discoverable without manifests. Association requires a
matching snapshot head repository/branch and rejects duplicate PR environments.
Checkout, session, and artifacts remain unchanged; PR resolution follows the manifest.

`bench-core.ts` plans/executes the common lifecycle. PR checkout/fork handling, head
comparison, and reset are PR-specific additions. `bench.ts` provides shared discovery
and lifecycle operations plus PR compatibility views. `bench-tools.ts` registers
`maglev_bench_list`, `inspect`, `start`, `close`, and `associate_pr` (each with the
`maglev_bench_` prefix). Existing PR tools are adapters over those domain operations.

Branch start opens an existing origin branch, or explicitly creates a branch from
`createFrom` without tracking its base. Unassociated branches do not depend on
snapshots/triage. Start/recovery never pulls or resets existing work. Startup context
is background only, passed via `--append-system-prompt` when launching a new Pi
window; it never triggers a task/review or modifies an existing Pi session.

General commands `/maglev-benches`, `/maglev-bench-start`, `/maglev-bench-inspect`,
`/maglev-bench-close`, and `/maglev-bench-associate-pr` default to plans for mutations;
`--apply` authorizes execution. Commands and tools share mutation serialization.
Workspace context, runtime identity, and PR review artifact paths retain the Bench
ID across association.

## State model

### GitHub snapshot file

`/var/lib/maglev-pr-maintainer/state/github-snapshot.json`

Facts only, downloaded from GitHub. No inference, buckets, local bench state, or manual overrides.

### Decision file

`/var/lib/maglev-pr-maintainer/state/decisions.json`

Inference/user decisions only. Written through a tool, not by ad-hoc shell scripts. Durable decision text should use absolute dates, not relative phrases that become stale in later sessions; the decision tool rejects new `reason` or `observations` containing phrases such as `today`, `yesterday`, `recently`, or `this morning`.

Suggested decision fields:

- `pr`
- `bucket`: `review | chase | pinned | watch`
- `priority`
- `reason`
- `observations`
- `decidedAt`
- `source`: `skill | user | tool | migration`
- `basis.snapshotFetchedAt`
- `basis.meaningfulUpdatedAt`
- `basis.headOid`

## Tool surface

GitHub/state/context tools:

- `maglev_pr_workspace_context`: return maintainer-root paths, current/target PR Bench context, artifact directories, companion repo root, naming conventions, and tool capability names. Config-aware skills should call this rather than hard-coding `/workspace` paths or repo-local output directories.
- `maglev_pr_companion_repos`: resolve OBA companion repos for API/spec review skills. By default repos live under `/var/lib/maglev-pr-maintainer/companion-repos`; `$OBA_WORKSPACE` is an explicit override. Reference-only repos are cloned/fast-forwarded when safe; editable `maglev.wiki` is cloned on first use but not pulled automatically after that. Warnings/notes are returned as structured anomalies for the calling skill to report as caveats.
- `maglev_pr_snapshot_staleness`: check the local snapshot `fetchedAt` against `SNAPSHOT_STALE_AFTER_HOURS` from `extensions/constants.ts` (currently 4 hours). No live GitHub calls.
- `maglev_pr_refresh_metadata`: fetch all open PR metadata and write the facts snapshot.
  - Current implementation is sequential: `gh pr list`, then one `gh pr view` per PR.
  - The `limit` parameter defaults to 200 and is capped at 500.
  - Future batching/parallelism should stay conservative to avoid rate-limit bursts and must continue writing only GitHub-derived facts.
- `maglev_pr_load_metadata`: read selected PR metadata from the snapshot and return it to inference.
- `maglev_pr_state_query`: read snapshot + decisions + local PR Bench state and return selected joined rows as JSON text. Use when exact fields need to enter model context; assistants should not craft ad-hoc Python/JQ scripts to inspect state files.
- `maglev_pr_needs_inference`: read snapshot + decisions and return PRs with missing/stale decisions. No live GitHub calls.
- `maglev_pr_decisions`: list/get/upsert/delete decisions with validation and atomic writes.

PR Bench tools:

- `maglev_pr_bench_list` (implemented read-only)
- `maglev_pr_bench_inspect` (implemented read-only)
- `maglev_pr_bench_start` (dry-run by default; uses plain checkouts and `gh pr checkout`; can complete safe partial PR Benches)
- `maglev_pr_bench_close` (implemented; dry-run by default, executes only with explicit `apply` when the plan is ready)

### PR Bench start safety model

Start is implemented directly in this package, not as a wrapper around the old PRRS helper scripts. Like close, it is deterministic and non-interactive at the tool layer: plan first, apply only when there are no refusals and all warnings are explicitly acknowledged. Apply creates independent plain checkouts and can complete safe partial PR Benches, such as an existing checkout missing the PR branch, tmux session, or `pi` tmux window. Starting or recovering a Bench launches `pi --name "Review PR #N"` without an initial user prompt, generated kickoff file, or automatic review. Agents can optionally provide free-form `context` to Bench start. Only when a new Pi window is launched, context is saved verbatim in a unique `benches/pr-N/context-<id>.md` file and loaded with `--append-system-prompt`. This adds background context without triggering a model turn. Dry runs write no context files, and passing context when reusing an existing Pi window is refused to avoid losing the handoff or interfering with a live session. The separate `maglev_pr_bench_kickoff` tool loads the existing read-only review instructions and snapshot/triage context on explicit request. It returns instructions to the calling agent rather than sending input to the Bench's Pi session; its optional `context` augments only that on-demand review workflow, independently of the startup context accepted by Bench start.

The core start planner currently treats these as refusals:

- PR is missing from the GitHub snapshot.
- Existing local Bench branch/session/path does not match its validated identity, or an existing checkout is on a different branch. PR-associated branch Benches retain their branch-based identity.
- A complete local PR Bench already exists but the caller asked not to reuse it.

The core start planner currently treats these as warnings requiring explicit acknowledgement:

- Snapshot is missing the PR head OID.
- Snapshot is older than the configured maximum age, defaulting to the package snapshot staleness threshold.
- Existing local PR Bench HEAD differs from the snapshot PR head.

Draft status, merge state, failing checks, missing/stale triage decisions, pinning,
and stack-parent gaps are informational only, not start blockers.

Start plans use `gh repo clone` to create `/var/lib/maglev-pr-maintainer/checkouts/pr-N` when needed, then `gh pr checkout N --repo OneBusAway/maglev --branch pr-N` inside that checkout. GitHub CLI handles same-repo and fork PR checkout/push configuration inside the independent PR Bench checkout, avoiding repository-config coupling between PR Benches.

After applying start/completion, the package verifies checkout availability, branch existence, current branch, checkout HEAD, tmux session, and the tmux `pi` window. Verification failures are reported as partial or unexpected local state instead of silently claiming a clean start.

The intended invariant is: a newly started PR Bench corresponds to the snapshot PR head unless the maintainer explicitly acknowledges stale or incomplete snapshot/head information.

### PR Bench close safety model

Close/start flows should notify the maintainer when something is off without making common scratch state painful. The deterministic close planner classifies findings as:

- `info`: normal context worth showing, such as an active tmux session or a snapshot freshness warning.
- `warning`: safe to proceed only after explicit acknowledgement/override, such as untracked files, modified/staged files, conflicts, or local HEAD differing from the snapshot PR head.
- `refusal`: unsafe to automate in normal flow, such as no matching PR Bench, a branch/session/path that does not match `pr-N` / `/var/lib/maglev-pr-maintainer/checkouts/pr-N`, or an unknown local state that prevents identifying what would be removed.

Dirty state should be more specific than a boolean:

- `clean`
- `untracked-only`
- `modified`
- `staged`
- `conflicted`
- `unknown`

The tool API remains deterministic and non-interactive. It defaults to dry-run and returns planned actions, findings, unacknowledged warnings, and refusals. Options such as `allowDirty: "untracked" | "any"` and `allowStale: true` acknowledge file/PR-head warnings. Cleanup also checks all live local refs (including HEAD, other branches/stash) against cached remote refs, and warns for local-only commits or unverifiable preservation. Reflog-only history is excluded, so old remote tips after force-pushes do not appear as local work. A deleted/missing upstream is safe when all live local commits remain reachable from remote refs. Callers should fetch/prune before cleanup and re-inspect; read-only inspection itself never fetches. `allowLocalCommits: true` is a separate explicit acknowledgement; file/PR-head overrides never bypass it. Ignored files require `allowDirty: "any"`. `removeCheckout: false` preserves work and artifacts and needs no work-loss overrides. Deletion rechecks local state after stopping Pi. Cached remote refs are not live proof of remote preservation; callers should push or otherwise preserve work before deletion. `apply: true` executes only when there are no refusals and all warnings are acknowledged.

The command/UI flow should be interactive on top of the same planner: show the plan and warnings, then offer same-flow choices such as cancel, dry-run report, close while discarding untracked files, or close anyway. Untracked-only files are a warning with an easy override; modified/staged/conflicted files get stronger copy but can still be explicitly overridden unless a separate refusal is present.

Commands:

- `/maglev-prs` (implemented read-only queue report, optional PR-number filters; TUI-only custom entry, not model context)
- `/maglev-pr-benches` (implemented read-only PR Bench report, optional PR-number filters; TUI-only custom entry, not model context)
- `/maglev-pr-maintainer-status` (implemented status summary for root writability, snapshot, decisions, PR Benches, `gh`, and `tmux` availability)
- `/maglev-pr-bench-start` (implemented interactive start flow over the same planner)
- `/maglev-pr-bench-close` (implemented interactive close flow over the same planner)

## TUI responsibilities

The TUI is a deterministic client of the same functions/tools:

- Freshness checks use the same snapshot staleness tool/constant as skills.
- Refresh key calls metadata refresh.
- Display joins snapshot + decisions + PR Bench local status as transcript reports or focused interactive UI, not persistent long-list widgets.
- TRIAGE tab comes from stale/missing decisions computed from snapshot + decisions.
- Manual marking writes through the decision API.
- PR Bench operations use PR Bench APIs.

## Skill responsibilities

Skills orchestrate policy and inference only:

- Triage skill asks deterministic tools what needs inference, loads those PR facts, infers buckets/priorities/observations, then records decisions through the decision tool.
- PR Bench skill uses PR Bench tools and does not call low-level scripts directly.
- OBA API/spec review skills should call `maglev_pr_workspace_context` first, prefer returned PR Bench artifact directories for generated reports/handoffs, resolve companion repos with `maglev_pr_companion_repos`, and avoid direct assumptions about `/workspace` sibling checkouts or shell resolver scripts.
