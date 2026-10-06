# AGENTS.md

This project contains the new **Maglev PR Maintainer** Pi package. It is being developed as a replacement/unification of the existing Maglev PR triage TUI, triage skill, PRRS/worktree skill, and helper scripts.

Err on the side of reading more context while this package is under active design. Prefer understanding the existing implementation and workflow before making changes.

## Core naming

- **Maglev PR Maintainer**: the top-level package/workflow/project.
- **Bench**: one branch-based working environment with a stable identity, checkout, tmux/Pi session, startup context, and artifacts.
- **PR Bench**: a Bench specialized by an optional PR association. Lifecycle is shared, not duplicated.
- Existing PR Benches consist of:
  - a maintainer-root checkout path, normally `/var/lib/maglev-pr-maintainer/checkouts/pr-<PR>`
  - a local branch `pr-<PR>`
  - a tmux session `pr-<PR>`
  - a tmux window named `pi` running Pi from the checkout root without an initial user prompt or automatic kickoff; agents may optionally supply background context via Bench start

Use **Bench** generally and **PR Bench** for PR-specialized workflows. Avoid using “worktree” as the primary term. Branch Bench IDs are `branch-<slug>-<hash>`, independent of Git branch names; definitions live at `benches/<id>/bench.json`. Associating a PR preserves identity and all paths. General `maglev_bench_*` tools and existing PR tools share the same lifecycle implementation. Cleanup must protect local-only committed work as well as dirty/ignored files; a clean checkout is not necessarily safe to delete.

## Development scope

Implement the new package under:

```text
/workspace/agentic/maglev-pr-maintainer
```

Do not edit the old global extension, old skills, or old helper scripts unless the user explicitly asks. Treat them as read-only references during development.

## Read-only reference files

Use these files for context and migration reference:

```text
/home/ubuntu/.pi/agent/extensions/maglev-pr-triage-tui.ts
/workspace/agentic/skills/maglev-pr-triage/SKILL.md
/workspace/agentic/skills/maglev-pr-worktree/SKILL.md
/workspace/bin/prrs-start
/workspace/bin/pr-worktree
/workspace/bin/prrs-teardown
```

The target repository being maintained is `OneBusAway/maglev`; PR Maintainer commands should use explicit GitHub repo arguments and must not require a separate `/workspace/maglev` checkout.

The old global Pi settings currently load skills from:

```text
/workspace/agentic/skills
```

and may auto-discover global extensions from:

```text
~/.pi/agent/extensions
```

When testing the new package in isolation, avoid loading the old global resources.

## Suggested isolated development session

From the new package directory:

```bash
cd /workspace/agentic/maglev-pr-maintainer
pi --no-extensions --no-skills \
  -e ./extensions/index.ts \
  --skill ./skills \
  --name "Develop Maglev PR Maintainer"
```

This keeps old `/maglev-prs` and old Maglev PR skills from conflicting while still allowing the reference files above to be read from disk.

## Package structure

```text
maglev-pr-maintainer/
├── AGENTS.md
├── README.md
├── package.json
├── docs/
│   └── design.md
├── extensions/
│   └── index.ts
├── scripts/
├── skills/
│   ├── maglev-pr-bench/
│   │   └── SKILL.md
│   └── maglev-pr-triage/
│       └── SKILL.md
└── testdata/
```

## Desired architecture

Create one coherent Pi package with:

- deterministic extension tools
- deterministic TUI commands/components
- LLM-facing skills that use those tools
- durable JSON files for workflow state
- no canonical state stored in Pi session custom entries

The TUI and skills should be clients of the same deterministic functions/tools, not separate implementations of stale-row logic or JSON mutation.

## State files

Use durable state files under the shared maintainer root, `/var/lib/maglev-pr-maintainer` by default. Developers may override this with `MAGLEV_PR_MAINTAINER_ROOT`.

### GitHub snapshot

```text
/var/lib/maglev-pr-maintainer/state/github-snapshot.json
```

Purpose: facts-only metadata downloaded from GitHub.

Rules:

- Written only by the metadata refresh tool.
- Contains only GitHub-derived information.
- No inference decisions.
- No manual bucket overrides.
- No PR Bench/local machine state.
- No session custom-entry data.

Expected content includes:

- repo
- schema version
- fetchedAt
- PR list
- title, author, URL
- base/head refs
- created/updated/closed/merged state
- reviewDecision
- mergeStateStatus
- statusCheckRollup-derived bad checks
- commits or compact commit summary
- reviews/comments needed for meaningful activity and chase detection
- files changed
- stack metadata derivable from branch refs or shared commits
- normalized `meaningfulUpdatedAt` may be included if it is derived only from GitHub facts

### Decisions

```text
/var/lib/maglev-pr-maintainer/state/decisions.json
```

Purpose: inference/user decisions about PR triage state.

Rules:

- Written through the decision tool, not by ad-hoc shell/Python/JQ scripts in skill instructions.
- Read by both the TUI and skills/tools.
- Preserve decisions for PRs not being updated.
- Validate bucket names and timestamps.
- Atomic writes preferred.

Suggested decision shape:

```json
{
  "pr": 1362,
  "bucket": "watch",
  "priority": 3,
  "reason": "chased today; wait for contributor update",
  "observations": [
    "requested changes still open",
    "latest human comment is maintainer chase"
  ],
  "decidedAt": "2026-09-05T01:24:43.957Z",
  "source": "skill",
  "basis": {
    "snapshotFetchedAt": "2026-09-05T01:21:51.636Z",
    "meaningfulUpdatedAt": "2026-09-05T01:05:38Z",
    "headOid": "3bc474b..."
  }
}
```

Buckets:

```text
review | chase | pinned | watch
```

Potential display-only buckets may include:

```text
triage | bench
```

but those should be computed by tools/TUI from facts + decisions + local PR Bench state, not stored as normal decision buckets.

## Tool surface plan

Implement custom tools in the extension for deterministic state management and PR Bench operations.

### GitHub / triage tools

- `maglev_pr_refresh_metadata`
  - Fetch all open `OneBusAway/maglev` PR metadata from GitHub.
  - Write the facts-only snapshot file.
  - Return a compact summary.

- `maglev_pr_load_metadata`
  - Read selected PR metadata from the snapshot file.
  - Support loading PRs by explicit number list or by `needs-inference`.
  - Return enough structured data for inference to triage without live GitHub calls.

- `maglev_pr_needs_inference`
  - Read GitHub snapshot + decisions file.
  - No live GitHub calls.
  - Return PRs with no decision or stale decisions.
  - Staleness should be based on GitHub-derived meaningful activity from the snapshot, not live API state.
  - Meaningful activity is the latest of: last commit, last non-bot review, and last non-bot comment. Bot/status churn alone should not stale a decision.

- `maglev_pr_decisions`
  - Read/write decisions file.
  - Operations: `list`, `get`, `upsert`, `delete`.
  - Validate buckets: `review`, `chase`, `pinned`, `watch`.
  - Add/update `decidedAt` and `basis` consistently.
  - Preserve unrelated decisions.

### PR Bench tools

- `maglev_pr_bench_kickoff`
  - Load the read-only review kickoff instructions and PR context for the calling agent on explicit request.
  - Never called automatically by Bench start/recovery; does not write prompt files or send input to tmux.

- `maglev_pr_bench_list`
  - List active/local PR Benches.
  - Include branch, tmux session, path, local head, dirty state, freshness if snapshot has the PR head.

- `maglev_pr_bench_inspect`
  - Inspect one PR Bench.
  - Do not mutate state.

- `maglev_pr_bench_start`
  - Start or reuse a PR Bench for a PR.
  - Optional caller `context` is appended to a newly launched Pi session's system prompt via a unique external context file, without submitting a task or invoking kickoff. Dry runs do not write context files. Context is refused when no new Pi window will be launched; existing sessions are not modified.
  - Initially may wrap existing `/workspace/bin/prrs-start`.
  - Eventually prefer package-local script/code using PR Bench terminology.
  - Draft/conflicted/failing/pinned PRs, stale/missing triage inference, and missing stack-parent Benches are informational, not start blockers. An explicit start request is sufficient authorization; do not request a separate merge-readiness acknowledgement.
  - Preserve start safeguards for stale/incomplete snapshot data, existing Bench HEAD mismatches, and path/identity refusals, plus destructive reset/close safeguards.

- `maglev_pr_bench_close`
  - Close/tear down a PR Bench.
  - Initially may wrap existing `/workspace/bin/prrs-teardown`.
  - Dry-run by default unless explicit apply/confirm option is provided.
  - Refuse to discard uncommitted changes unless explicitly requested.
  - Refuse if local HEAD differs from PR head unless explicitly overridden.

## TUI plan

The TUI should be deterministic and should not own inference.

Commands likely to keep/add:

- `/maglev-prs`: main queue TUI.
- `/maglev-pr-benches`: list active PR Benches.
- `/maglev-pr-bench-close`: close one PR Bench.

The TUI should:

- call metadata refresh on refresh key
- display snapshot + decisions + PR Bench status
- compute `TRIAGE` from the same stale/missing-decision function as the tool
- mark manual decisions through the decision API
- use PR Bench APIs for open/close/inspect
- use consistent PR Bench terminology
- avoid session custom entries

Suggested UI copy:

- `b open bench`
- `i insert review prompt`
- `x close bench`
- `X close bench and discard changes`
- `TRIAGE means run skill inference`
- `Bench: active tmux pr-1416 • path /var/lib/maglev-pr-maintainer/checkouts/pr-1416 • fresh`

Avoid primary UI text like:

- `w worktree`
- `Local: ... wt`
- `PRRS`

## Skill plan

### `maglev-pr-triage`

Policy/inference wrapper only.

Expected flow:

1. Use `maglev_pr_needs_inference` to find PRs requiring inference.
2. Use `maglev_pr_load_metadata` to load those PR facts from the snapshot.
3. Infer bucket, priority, observations, and reason.
4. Use `maglev_pr_decisions` to write decisions.
5. Summarize review queue, chase batch, watch items, pinned items.

The skill should not:

- call `gh` directly for normal triage
- edit JSON files directly
- depend on TUI-exported `needs-refresh` files
- generate scripts just to mutate decision JSON
- start/close PR Benches unless the user explicitly asks and the PR Bench skill/tools are appropriate

### `maglev-pr-bench`

LLM-facing wrapper around PR Bench tools.

Expected flow:

- inspect/list benches through tools
- start a bench only when explicitly requested
- close a bench only when explicitly requested
- avoid reviewing/chasing policy unless handed off from triage

## Existing scripts migration notes

Current helper scripts:

```text
/workspace/bin/prrs-start
/workspace/bin/pr-worktree
/workspace/bin/prrs-teardown
```

They currently use PRRS/worktree terminology. Treat them as low-level compatibility helpers during early implementation. Do not expose their names in primary UI/skill language except as migration notes.

Future package-local scripts may be named:

```text
scripts/pr-bench-start
scripts/pr-bench-close
```

These can wrap or replace the existing scripts.

## Testing and validation

Useful commands while developing:

```bash
node --check extensions/index.ts
```

When testing in isolation:

```bash
cd /workspace/agentic/maglev-pr-maintainer
pi --no-extensions --no-skills \
  -e ./extensions/index.ts \
  --skill ./skills \
  --name "Develop Maglev PR Maintainer"
```

Before cutover, verify:

- extension loads without old global extension
- no tool/command name conflicts
- metadata refresh writes only GitHub facts
- decisions tool updates only decision file
- needs-inference uses snapshot + decisions only
- TUI uses PR Bench terminology consistently
- TUI no longer writes session custom entries
- PR Bench list/start/close works safely

## Compatibility / migration

No runtime compatibility reads from old PR Maintainer paths are supported. If state must be preserved, copy it into the maintainer root before running the package.
