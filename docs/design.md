# Design: Maglev Maintainer

This document describes implemented architecture unless a section is explicitly
marked planned. See `../README.md` for the current resource inventory and known
limitations; deployment/cutover status depends on the local Pi settings.

## Naming

- Top-level workflow/package: **Maglev Maintainer**
- General branch-based working environment: **Bench**
- PR specialization of a Bench: **PR Bench**
- Existing PR Benches contain:
  - root-relative plain checkout path, currently `/var/lib/maglev-maintainer/checkouts/pr-N`
  - local branch `pr-N`
  - tmux session `pr-N`
  - tmux window `pi` running `pi` from the checkout root

UI says **Bench** generally and **PR Bench** for PR-specialized operations. The implementation uses independent plain checkouts rather than git worktrees.

Package identity is read from `package.json` by `extensions/identity.ts`, which
derives display name, package-wide command names, root environment/default, and
triage agent identity. Workspace context exposes these as `package` fields.
PR-specific tool/command names and durable Bench IDs are not branding identifiers.
The legacy explicit root environment variable is accepted only as a configuration
alias; no legacy state paths are auto-discovered. Keep existing roots configured
across renames to preserve active Bench paths and Docker runtime identity. See
README for rename/cutover guidance.

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
`maglev_bench_list`, `resolve_pr`, `inspect`, `start`, `reset`, `close`, and
`associate_pr` (each with the `maglev_bench_` prefix). Duplicate PR lifecycle
registrations are removed; internal PR views remain for queue/review consumers.

Start takes exactly one of branch or PR number and returns the planned/applied ID.
Resolution maps only existing PR associations to an ID (including legacy discovery)
and returns null when absent; it never creates a Bench or fabricates an identity.
Inspect, close, and reset take only stable IDs. Reset requires a PR association
and uses that PR's snapshot head. Conflicting local associations fail closed.

Branch start opens an existing origin branch, or explicitly creates a branch from
`createFrom` without tracking its base. Unassociated branches do not depend on
snapshots/triage. Start/recovery never pulls or resets existing work. Startup context
is background only, passed via `--append-system-prompt` when launching a new Pi
window; it never triggers a task/review or modifies an existing Pi session.

General commands `/maglev-benches`, `/maglev-bench-start`, `/maglev-bench-inspect`,
`/maglev-bench-close`, `/maglev-bench-reset`, `/maglev-bench-resolve-pr`, and
`/maglev-bench-associate-pr` default to plans for mutations;
`--apply` authorizes execution. Commands and tools share mutation serialization.
Workspace context, runtime identity, and PR review artifact paths retain the Bench
ID across association.

## State model

### GitHub snapshot file

`/var/lib/maglev-maintainer/state/github-snapshot.json`

Facts only, downloaded from GitHub. No inference, buckets, local bench state, or manual overrides.

### Decision file

`/var/lib/maglev-maintainer/state/decisions.json`

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

The existing `observations` array also carries durable PR analysis history through
self-contained `analysis:` records: absolute timestamp, type/scope, analyzed SHA
and provenance, status/outcome, findings/no-findings, evidence, and validation limits.
`maglev-pr-analysis-record` defines this skill-level convention; no new file/schema
is introduced. Preserve older records when updating a decision. The analyzed SHA
lives in each observation, independently of the writer's current snapshot basis.
Decision get/focused state query exposes history; compact list output omits it.
Parent orchestrators serialize get/merge/upsert for a PR; the filesystem lock covers
upsert, not a caller-side atomic append. Concurrent sessions require a single owner.
Review-selection skills and candidate analysts inspect exact history against fresh
head metadata before recommending or dispatching reviews. Completed same-SHA,
same-scope code reviews are reused regardless of findings; reruns need a concrete
scope/validation reason or explicit override. This pre-launch skill guardrail does
not add a post-review SHA gate or a raw-tool deterministic refusal.

## Tool surface

All registered tools share the stable `maglev` namespace from
`tool-namespace.ts`, independent of manifest branding. Registered names remain
fully prefixed. General context/repository/runtime tools omit the PR scope;
review tools describe draft operations rather than their JSON storage format.
The naming migration has no duplicate aliases and does not move durable state.
See README for the public name and workspace capability-key migration.

GitHub/state/context tools:

- `maglev_workspace_context`: return maintainer-root paths, current/target PR Bench context, artifact directories, companion repo root, naming conventions, and tool capability names. Config-aware skills should call this rather than hard-coding `/workspace` paths or repo-local output directories.
- `maglev_companion_repos_resolve`: resolve OBA companion repos for API/spec review skills. By default repos live under `/var/lib/maglev-maintainer/companion-repos`; `$OBA_WORKSPACE` is an explicit override. Reference-only repos are cloned/fast-forwarded when safe; editable `maglev.wiki` is cloned on first use but not pulled automatically after that. Warnings/notes are returned as structured anomalies for the calling skill to report as caveats.
- `maglev_pr_snapshot_staleness`: check the local snapshot `fetchedAt` against `SNAPSHOT_STALE_AFTER_HOURS` from `extensions/constants.ts` (currently 4 hours). No live GitHub calls.
- `maglev_pr_refresh_metadata`: fetch all open PR metadata and write the facts snapshot.
  - Current implementation is sequential: `gh pr list`, then one `gh pr view` per PR.
  - The `limit` parameter defaults to 200 and is capped at 500.
  - Future batching/parallelism should stay conservative to avoid rate-limit bursts and must continue writing only GitHub-derived facts.
- `maglev_pr_load_metadata`: read selected PR metadata from the snapshot and return it to inference.
- `maglev_pr_state_query`: read snapshot + decisions + local PR Bench state and return selected joined rows as JSON text. Use when exact fields need to enter model context; assistants should not craft ad-hoc Python/JQ scripts to inspect state files.
- `maglev_pr_needs_inference`: read snapshot + decisions and return PRs with missing/stale decisions. No live GitHub calls.
- `maglev_pr_decisions`: list/get/upsert/delete decisions with validation and atomic writes. Upsert/delete hold an adjacent filesystem lock over the complete read-modify-write, shared across processes. Acquisition is bounded; orphaned locks require manual recovery, never age-based stealing. See [decision mutation locking](decision-mutation-locking.md).
- `maglev_checkout`: resolve or explicitly clone target Maglev source independently of a Bench; existing work is preserved.
- `maglev_pr_review_draft_save`, `maglev_pr_review_draft_clear`, `maglev_pr_review_draft_list`, `maglev_pr_review_draft_load`: create/replace, clear, locate, and read centralized prospective drafts. The writer validates inline locations against the live PR diff, not finding correctness; no submission is performed.
- `maglev_api_runtime_start`, `maglev_api_runtime_stop`, `maglev_api_runtime_status`: isolated Maglev/legacy Docker runtime lifecycle; start/stop default to plans, status is read-only.

Unified Bench tools:

- `maglev_bench_list` (read-only; optional ID or PR filters)
- `maglev_bench_resolve_pr` (read-only existing PR-to-ID mapping)
- `maglev_bench_inspect` (read-only stable-ID inspection)
- `maglev_bench_start` (branch or PR entry point; dry-run by default, returns ID)
- `maglev_bench_reset` (stable ID; associated PR snapshot target, dry-run by default)
- `maglev_bench_close` (stable ID; dry-run by default, explicit apply/acknowledgements)
- `maglev_bench_associate_pr` (stable ID plus matching PR; identity-preserving)

PR-facing review tools remain separate:
- `maglev_pr_review_instructions_load` (explicit on-demand instructions/context for the calling agent, never automatic)
- `maglev_pr_code_review` (headless Claude Code `/code-review` plus captured logs; PR-number-only remote review by default, optional explicit checkout; no Bench lookup)

### PR Bench start safety model

Start is implemented directly in this package, not as a wrapper around the old PRRS helper scripts. Like close, it is deterministic and non-interactive at the tool layer: plan first, apply only when there are no refusals and all safety warnings are explicitly acknowledged. Review-readiness information is not a safety warning. Apply creates independent plain checkouts and can complete safe partial PR Benches, such as an existing checkout missing the PR branch, tmux session, or `pi` tmux window. Starting or recovering a Bench launches `pi --name "Review PR #N"` without an initial user prompt, generated kickoff file, or automatic review. Agents can optionally provide free-form `context` to Bench start. Only when a new Pi window is launched, context is saved verbatim in a unique `benches/pr-N/context-<id>.md` file and loaded with `--append-system-prompt`. This adds background context without triggering a model turn. Dry runs write no context files, and passing context when reusing an existing Pi window is refused to avoid losing the handoff or interfering with a live session. The separate `maglev_pr_review_instructions_load` tool loads the existing read-only review instructions and snapshot/triage context on explicit request. It returns instructions to the calling agent rather than sending input to the Bench's Pi session; its optional `context` augments only that on-demand review workflow, independently of the startup context accepted by Bench start.

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

Start plans use `gh repo clone` to create `/var/lib/maglev-maintainer/checkouts/pr-N` when needed, then `gh pr checkout N --repo OneBusAway/maglev --branch pr-N` inside that checkout. GitHub CLI handles same-repo and fork PR checkout/push configuration inside the independent PR Bench checkout, avoiding repository-config coupling between PR Benches.

After applying start/completion, the package verifies checkout availability, branch existence, current branch, checkout HEAD, tmux session, and the tmux `pi` window. Verification failures are reported as partial or unexpected local state instead of silently claiming a clean start.

The intended invariant is: a newly started PR Bench corresponds to the snapshot PR head unless the maintainer explicitly acknowledges stale or incomplete snapshot/head information.

### PR Bench close safety model

Close/start flows should notify the maintainer when something is off without making common scratch state painful. The deterministic close planner classifies findings as:

- `info`: normal context worth showing, such as an active tmux session or a snapshot freshness warning.
- `warning`: safe to proceed only after explicit acknowledgement/override, such as untracked files, modified/staged files, conflicts, or local HEAD differing from the snapshot PR head.
- `refusal`: unsafe to automate in normal flow, such as no matching Bench, a branch/session/path that does not match its validated identity (legacy `pr-N` or a registered branch Bench), or an unknown local state that prevents identifying what would be removed.

Dirty state should be more specific than a boolean:

- `clean`
- `untracked-only`
- `modified`
- `staged`
- `conflicted`
- `unknown`

The tool API remains deterministic and non-interactive. It defaults to dry-run and returns planned actions, findings, unacknowledged warnings, and refusals. Options such as `allowDirty: "untracked" | "any"` and `allowStale: true` acknowledge file/PR-head warnings. Cleanup also checks all live local refs (including HEAD, other branches/stash) against cached remote refs, and warns for local-only commits or unverifiable preservation. Reflog-only history is excluded, so old remote tips after force-pushes do not appear as local work. A deleted/missing upstream is safe when all live local commits remain reachable from remote refs. Callers should fetch/prune before cleanup and re-inspect; read-only inspection itself never fetches. `allowLocalCommits: true` is a separate explicit acknowledgement; file/PR-head overrides never bypass it. Ignored files require `allowDirty: "any"`. `removeCheckout: false` preserves work and artifacts and needs no work-loss overrides. Deletion rechecks local state after stopping Pi. Cached remote refs are not live proof of remote preservation; callers should push or otherwise preserve work before deletion. `apply: true` executes only when there are no refusals and all warnings are acknowledged.

Unified commands use explicit plan/apply flags over the same planner instead of
the retired PR-specific interactive confirmation menus. `--apply` authorizes a
mutation; separate file, HEAD/snapshot, and committed-work flags acknowledge
warnings. Refusals cannot be overridden. Reset remains subject to F1: preserve
displaced unpushed commits first.

Commands:

- `/maglev-prs` (implemented read-only queue report, optional PR-number filters; TUI-only custom entry, not model context)
- `/maglev-benches` (read-only list of all Benches)
- `/maglev-bench-resolve-pr` (read-only PR-to-ID resolution)
- `/maglev-bench-inspect` (stable-ID inspection)
- `/maglev-bench-associate-pr` (stable-ID association, explicit apply)
- `/maglev-maintainer-status` (implemented status summary for root writability, snapshot, decisions, PR Benches, `gh`, and `tmux` availability)
- `/maglev-bench-start` (branch or `--pr` entry point, plan by default)
- `/maglev-bench-reset` (stable-ID reset, plan by default)
- `/maglev-bench-close` (stable-ID closure, plan by default)
- `/maglev-pr-review-draft` (implemented read-only scrollable draft viewer with discussion handoff)
- `/maglev-maintainer-info` (implemented resource/path summary)

## Current TUI and planned queue UI

The current TUI is a deterministic client of the same functions/tools:

- `/maglev-prs` joins snapshot + decisions + PR Bench status as a read-only transcript report. Its TRIAGE group uses the shared stale/missing-decision calculation, not an interactive tab.
- `/maglev-benches` lists all local Benches; the queue report remains display-only, not canonical state or model-visible facts.
- Unified lifecycle commands use the same planners and explicit apply/override flags; draft viewing is read-only.
- Freshness checks use the shared snapshot staleness constant/tools.

**Planned, not implemented:** a queue refresh key invoking metadata refresh, an
interactive TRIAGE tab, and manual decision marking through the decision API.
Use metadata/decision tools and skills for those operations today.

## Skill responsibilities

Skills orchestrate policy and inference using deterministic tools:

- Triage keeps the parent on compact discovery/decision results, delegates one PR per fresh-context analyst, and lets that child load its assigned PR facts. The parent owns ordering, acceptance, and serialized decision persistence. Focused parent inspection of a deliberately selected PR remains supported.
- The single `maglev-bench` skill owns branch and PR lifecycle, not review policy; it does not call legacy helper scripts. PR numbers are entry points for start and read-only resolution; subsequent lifecycle operations use stable IDs.
- `maglev-pr-code-review` runs Claude Code and focused validation, automatically saves drafts for settled actionable findings, and records every outcome through `maglev-pr-analysis-record`. A completed clean review is potential merge-readiness evidence, not approval; preserve explicit holds. `maglev-pr-review-draft` accepts settled findings from any source, writes via dedicated tools, and never submits to GitHub. Draft clearing never erases durable analysis history. The current explicit kickoff composes these workflows; it is not triggered by Bench startup.
- OBA API/spec skills provide a distinct behavior/client/spec review and may hand settled findings to the shared draft skill when requested. They resolve companion repos through the package tools, not hard-coded sibling paths or shell resolver scripts.
- `maglev-artifacts` organizes working artifacts and delegates tool-owned state or generated-script mutations to their dedicated tools/skills. It places maintainer working reports/handoffs in the applicable `artifacts.targetReportsDir` for PR or branch Benches; without an applicable Bench, use `<maintainerRoot>/plans/`. Association preserves paths, and explicit destinations take precedence. Never default to checkout-local `tmp/`.
- `maglev-handoff-script` generates reviewable executable scripts under `artifacts.generatedScriptsDir`, mode `0755`. Human execution performs listed writes immediately unless preview/apply gates were explicitly requested. Generation does not authorize execution or publication.

## Known safety/freshness limitations

Close's commit-preservation safeguards do not currently apply to reset: preserve
unpushed work before forced checkout (F1). Decision basis stamping and timestamp-
dependent head-change detection remain open (F3/F4), independently of the fixed
cross-process mutation race (F2). Claude command/plugin resolution and non-
publication behavior need deployment verification (F7); the wrapper does not
prove that a plugin cannot post comments. See README for operational caveats.
