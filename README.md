# Maglev PR Maintainer

Pi package for maintaining `OneBusAway/maglev` pull requests.

- **Maglev PR Maintainer**: the top-level package/workflow.
- **Bench**: a branch-based working environment (independent plain checkout + tmux session + `pi` window + artifacts).
- **PR Bench**: a Bench specialized by a PR association. Existing `pr-N` identities, paths, branches, and commands remain supported; a branch Bench can acquire a PR association without being moved or restarted.

The package manifest exposes `extensions/`, `skills/`, and the packaged triage agent.
Installation and discovery depend on each deployment's Pi settings. From this
repository root, load it explicitly for isolated development as shown below;
avoid simultaneously loading the old global Maglev extension or loose skills.

## Resources

- Extension: `extensions/index.ts`
  - `/maglev-benches` (all branch and PR Benches)
  - `/maglev-bench-start` (branch start/recovery)
  - `/maglev-bench-inspect`
  - `/maglev-bench-close`
  - `/maglev-bench-associate-pr`
  - `maglev_bench_list`, `maglev_bench_inspect`, `maglev_bench_start`, `maglev_bench_close`, `maglev_bench_associate_pr`
  - `/maglev-prs`
  - `/maglev-pr-benches`
  - `/maglev-pr-bench-start`
  - `/maglev-pr-bench-reset`
  - `/maglev-pr-bench-close`
  - `/maglev-pr-review-json`
  - `/maglev-pr-maintainer-status`
  - `/maglev-pr-maintainer-info`
  - `maglev_pr_workspace_context`
  - `maglev_pr_companion_repos`
  - `maglev_pr_checkout` (resolve/clone Maglev source outside a PR Bench; dry-run by default)
  - `maglev_pr_api_start` (plan/start Maglev or pinned legacy OBA; dry-run by default)
  - `maglev_pr_api_stop` (plan/stop runtime; preserves volumes/images by default)
  - `maglev_pr_api_status` (container state and data readiness)
  - `maglev_pr_snapshot_staleness`
  - `maglev_pr_refresh_metadata`
  - `maglev_pr_load_metadata`
  - `maglev_pr_state_query`
  - `maglev_pr_needs_inference`
  - `maglev_pr_decisions`
  - `maglev_pr_review_json` (writes/overwrites the current validated prospective PR review JSON draft; never submits)
  - `maglev_pr_review_json_clear` (deletes the current prospective PR review JSON draft)
  - `maglev_pr_review_json_list` (lists current prospective PR review JSON drafts)
  - `maglev_pr_review_json_load` (loads a current draft into model context for discussion)
  - `maglev_pr_bench_list`
  - `maglev_pr_bench_inspect`
  - `maglev_pr_code_review` (headless Claude Code /code-review by PR number, no Bench or checkout required; optional explicit checkout; captures a full log)
  - `maglev_pr_bench_kickoff` (on-demand review instructions and PR context; never run automatically)
  - `maglev_pr_bench_start` (dry-run by default; uses plain checkouts and `gh pr checkout`; can complete safe partial PR Benches)
  - `maglev_pr_bench_reset` (dry-run by default; forced PR checkout to the snapshot head after explicit acknowledgement)
  - `maglev_pr_bench_close` (dry-run by default; can execute with explicit `apply`)
- Skills:
  - `librarian` (placement and maintenance of local plans, reports, and handoffs)
  - `privileged-handoff-script` (executable scripts for operations performed outside sandboxed Pi)
  - `maglev-bug-triage` (issue numbers/URLs or free-text reports; conversation-only verdict, severity, and fix effort)
  - `maglev-pr-triage`
  - `maglev-pr-bench`
  - `maglev-pr-code-review` (Claude Code review plus focused validation and automatic draft handoff for settled findings)
  - `maglev-pr-review-draft` (packages settled findings as prospective review JSON; never submits)
  - `maglev-bench` (branch-based working environments and PR association)
  - `maglev-checkout`
  - `oba-workspace`
  - `maglev-api`
  - `legacy-oba-api`
  - `oba-api-change-review`
  - `oba-api-client-impact`
  - `oba-api-goal-check`
  - `oba-api-spec-check`
  - `oba-api-spec-finder`
  - `oba-api-pr-spec-review`
  - `oba-wiki-spec-update`
- Agents (requires `pi-subagents`):
  - `maglev-pr-maintainer.pr-triage-analyst` — read-only per-PR snapshot analysis, returning a compact triage recommendation in a fresh context
Bench lifecycle is implemented directly in the package, not through legacy
`prrs-*` scripts. Generated privileged handoff scripts live outside package source
under the configured maintainer root.

`maglev_pr_workspace_context` exposes the package's maintainer-root paths, current/target PR Bench conventions, artifact directories, companion repo root, and deterministic tool capability names as JSON so package skills can avoid hard-coded `/workspace` assumptions.

`maglev_pr_checkout` resolves Maglev itself at `<maintainer-root>/checkouts/maglev`, or `$OBA_WORKSPACE/maglev`. Pass `path` to select another checkout root. Missing checkouts are planned by default; `apply: true` clones the remote default branch, or checks out an explicit branch/tag/SHA (`ref`) at detached HEAD in a new clone. Existing checkouts are validated and inspected without fetching, updating, switching, or resetting; a supplied ref must already resolve locally to HEAD. Dirty work is preserved. Results include `ready`, revision, branch, dirty state, and warnings. `ok: true` with `ready: false` is a plan only. Failed clones clean up only their temporary staging directory. This tool does not create a PR Bench or start services. The workspace context exposes its path and capability name; use the `maglev-checkout` skill for the safe workflow.

`maglev_pr_companion_repos` resolves OBA companion repos under `/var/lib/maglev-pr-maintainer/companion-repos` by default, or under `$OBA_WORKSPACE` when explicitly set. Reference-only repos (`wayfinder`, `js-sdk`, mobile clients, and legacy Java) are cloned on first use and fast-forwarded when clean on `main`/`master`; editable `maglev.wiki` is cloned on first use but not pulled automatically after that. Tool warnings/notes should be carried into OBA API review reports as caveats.

Current PR queue support is read-only: `/maglev-prs` joins the GitHub snapshot, durable decisions, stale/missing decision detection, and local PR Bench status into a session report. Optional PR-number arguments filter the queue. Reports are stored as TUI-only custom entries and do not enter model context. Use `maglev_pr_state_query` when the assistant needs exact joined state in model context; it returns selected snapshot, decision, needs-inference, and PR Bench fields as JSON text so callers should not craft ad-hoc Python/JQ scripts to read state files.

Prospective PR review JSON supports local creation, replacement, deletion, listing, and read-only viewing: `maglev_pr_review_json` writes or overwrites the current validated JSON draft at `/var/lib/maglev-pr-maintainer/review-json/pr-<N>.json`, `maglev_pr_review_json_clear` deletes that draft when there should be no prospective review, `maglev_pr_review_json_list` finds current drafts, and `maglev_pr_review_json_load` loads one into model context as readable Markdown plus structured JSON details. `/maglev-pr-review-json [PR number | path]` opens a scrollable TUI viewer for the current draft for a PR or an exact artifact path; press `d` in the viewer to ask the agent to load that draft for discussion.

PR Bench start policy separates review readiness from checkout safety: draft status, failing checks, pinned decisions, stale/missing triage inference, merge conflicts, and missing stack-parent Benches are informational and never require extra acknowledgement to open a review Bench. Stale/incomplete snapshot data and existing Bench HEAD mismatches still require explicit acknowledgement; path/identity refusals and destructive reset/close safeguards remain unchanged. Legacy readiness-related `allow*` start options are accepted as no-ops.

PR Bench lifecycle support is implemented directly: read-only list/inspect can find `/var/lib/maglev-pr-maintainer/checkouts/pr-N` checkouts, tmux `pr-N` sessions, the tmux `pi` window, classified dirty state, and snapshot freshness. `maglev_pr_bench_start` defaults to a dry-run start/reuse safety plan; `apply` creates a plain checkout with `gh repo clone`, checks out the PR with `gh pr checkout --branch pr-N`, verifies the checkout HEAD against the snapshot, and starts tmux with a `pi` window running `pi --name "Review PR #N"` from the PR Bench checkout. Starting or recovering a Bench does not generate a kickoff file, submit an initial user prompt, or automatically run a review. An agent may pass optional free-form `context` to `maglev_pr_bench_start` to hand off goals, findings, constraints, and references. When a new Pi window is launched, the caller's context is saved to a unique `benches/pr-N/context-<id>.md` file and loaded via `--append-system-prompt`; this supplies background context without triggering an agent turn. Blank context is ignored. Dry runs write no files. Context is refused when reusing an existing Pi window, rather than silently dropped or sent as terminal input. On explicit request, `maglev_pr_bench_kickoff` returns the read-only review instructions and PR snapshot/triage context to the calling agent, with optional additional `context`. It does not send input to another Pi session or execute the review itself; the calling agent follows the instructions using `maglev_pr_code_review` from the specified checkout. Bench start no longer accepts `kickoff` or `kickoffContext` options. It can also complete safe partial PR Benches, such as an existing checkout missing the PR branch, tmux session, or `pi` window. `gh pr checkout` handles same-repo and fork PR checkout/push configuration inside the independent PR Bench checkout. `maglev_pr_bench_close` defaults to a dry-run close plan with warnings/refusals and executes only with explicit `apply` after required warning acknowledgements. Use `/maglev-pr-benches`, optionally with PR numbers, to print the same data as a session report that does not enter model context.

Use `/maglev-pr-maintainer-status` to check root writability, snapshot availability/count, decision file status, active PR Bench count, `gh auth status`, and `tmux` availability.

## Review and draft skills

Use `maglev-pr-code-review` to run Claude Code by PR number (optional explicit
checkout) and validate its findings. Whenever settled actionable PR findings emerge
in any context, use `maglev-pr-review-draft` automatically to save prospective
review JSON, whether they came from Claude Code, API/spec review, manual
investigation, or the maintainer. No separate draft request or review-only mode
exists. Report the draft path/event or a concrete save blocker. Neither skill
starts a Bench or submits a GitHub review. No findings alone is not approval.

The existing explicitly requested `maglev_pr_bench_kickoff` is the composition
point: its instructions load the code-review skill first, then the draft skill.
Starting/recovering a Bench still runs neither automatically; startup context is
background only. Run `/reload` to discover the new skills.

## Privileged handoff scripts

Use `privileged-handoff-script` when Pi lacks GitHub write access and the
maintainer asks for a script to run in an authenticated environment. Generated
handoffs live in `artifacts.generatedScriptsDir` from workspace context:
`<maintainerRoot>/scripts/` (normally `/var/lib/maglev-pr-maintainer/scripts/`).
They are not package source helpers or per-Bench artifacts.

Scripts use mode `0755`, so all users can read and execute them by absolute path
provided parent directories are traversable. No PATH changes or OS privilege
escalation are implied. By default, the generated script performs its listed
writes immediately when the human runs it; preview modes or apply/create gates
are added only when explicitly requested. Script generation and syntax validation
never execute the external write. Review generated contents before running them
under a more privileged account; rerunning a creation script may create a
duplicate unless it implements a duplicate check.

Run `/reload` to discover the skill and updated workspace context after changes.

## Branch-based Benches

All Benches use the same lifecycle implementation. `maglev_bench_start` opens an
existing `origin` branch, or explicitly creates one when `createFrom` is supplied.
Initial scope is `OneBusAway/maglev`, not arbitrary repositories. IDs are stable
`branch-<slug>-<hash>` names, separate from Git branch names; the hash includes the
repository and exact branch name, avoiding slash/case/slug collisions.

Examples (commands default to plans; add `--apply` to execute):

```text
/maglev-bench-start feature/routing
/maglev-bench-start feature/new-work --from origin/main --apply
/maglev-benches
/maglev-bench-inspect <bench-id>
/maglev-bench-close <bench-id> --keep-checkout --apply
/maglev-bench-associate-pr <bench-id> 123 --apply
```

Equivalent tool inputs:

```json
{"branch":"feature/routing"}
{"branch":"feature/new-work","createFrom":"origin/main","apply":true,"context":"Background goals and constraints; not an automatic task."}
```

An unassociated branch Bench needs no PR snapshot or triage decision. Start/recovery
never pulls or resets existing work. Startup context has the same semantics as PR
Bench context: only a new Pi window receives it, and it triggers no task or review.
A new branch does not track its base branch automatically.

Definitions are stored atomically at `benches/<id>/bench.json`. Existing `pr-N`
checkouts/sessions are discovered without requiring a manifest. PR-facing tools
list only associated Benches; the general tools list all Benches. Association
requires a matching PR head repository and branch from the snapshot and refuses
another existing Bench for that PR. It never changes identity, checkout, session,
or artifact paths. PR start/reset/review, workspace context, and API runtime
resolution follow that association. `maglev_pr_workspace_context` also accepts
`benchId`, mutually exclusive with `pr`.

Cleanup protects dirty and ignored files, commits on all live local refs (including
HEAD, other branches and stash), and unknown preservation state. Reflog-only
history is excluded. A missing/deleted upstream is safe when all local commits
are reachable from cached remote refs (for example, after merging into main).
Checks use **locally cached remote refs**, without fetching; refresh them with
`git fetch origin --prune` before cleanup, then inspect again. Push or otherwise
preserve any remaining local-only work before removing a checkout.
`allowDirty: "any"` acknowledges ignored-file loss; `allowLocalCommits: true`
separately acknowledges committed-work loss or unknown preservation. `allowStale` is only a PR-head acknowledgement and does
not bypass commit protection. `removeCheckout: false` stops tmux without deleting
work/artifacts. CLI equivalents are `--allow-dirty`, `--allow-local-commits`,
`--allow-stale`, and `--keep-checkout`. Identity/path errors remain refusals.

## Delegated PR triage

The `maglev-pr-triage` skill delegates each selected PR's detailed discussion,
review, commit, and blocker analysis to `maglev-pr-maintainer.pr-triage-analyst`.
The parent passes only the PR number, snapshot identity, as-of timestamp, cwd,
and maintainer constraints—not the full PR metadata or parent transcript. The
analyst retrieves only its assigned PR through the deterministic tools and
returns a compact recommendation with action, evidence, readiness, confidence,
and decision basis. The parent orders the queue and saves accepted decisions
sequentially; children cannot write decisions, refresh snapshots, or mutate PR
Benches/GitHub. Analysis is metadata triage, not a substitute for code review.

Install/load `pi-subagents` alongside this package. Agent discovery uses
`pi.subagents.agents` in `package.json`; run `/reload` after resource changes.
The agent explicitly loads this package's extension for its read-only tool
allowlist. It inherits the deployment's model choice; configure
`subagents.agentOverrides.maglev-pr-maintainer.pr-triage-analyst.model` in Pi
settings to choose a different analysis model. Multiple PRs use bounded fresh
context fanout (at most three active analysts). If delegation is unavailable,
triage reports the blocker rather than silently loading every PR into the parent.

## Live API runtimes

Use the `maglev-api` and `legacy-oba-api` skills to start, inspect, or stop local
services. These skills manage service lifecycle only and do not prescribe any
subsequent use of the running service. All three `maglev_pr_api_*` tools take
`implementation: "maglev" | "legacy"`.
For Maglev, select one of `pr`, `benchId`, or `workingDirectory` (defaults to current checkout).
A PR associated with a branch Bench resolves to its original checkout, preserving
runtime identity. Use the stable `benchId` to stop that runtime even after removing
the Bench's registry entry.
Legacy uses packaged Docker assets and the pinned Java release in
`assets/legacy-oba/VERSION` (currently 2.7.1), with matching source cached under
the maintainer root. It runs published Maven artifacts, not local Java edits.

Example tool inputs:

```json
{"implementation":"maglev","pr":1470,"apply":true}
{"implementation":"legacy","apply":true}
```

Start and stop default to planning only. Status never starts services.
Docker Engine, Compose v2, Git (legacy source cache), and network access are required.
Start builds images and waits for a successful OBA response with non-empty agencies;
initial Java bundle/build startup can take many minutes. `timeoutSeconds` defaults
to 1800 for each build command and readiness wait. Both use Sound Transit's KCM
static GTFS feed by default and no realtime, API key `test`, and loopback ports
4000 (Maglev) / 8080 (legacy). Choose `port` and `gtfsUrl` on first start if needed.

Generated config, Compose JSON, runtime manifest, and build/command logs live in
`<maintainer-root>/runtimes/<runtime-id>/`, never in the source checkout. Docker
project names include the maintainer root and target identity; fixed global
container names and host MySQL ports are not used. Simultaneous runtimes still
need distinct host ports. Saved feed/port configuration is reused; for different
settings use a separate maintainer root to avoid reusing an incompatible bundle.

Stop preserves GTFS/database volumes and images. `removeVolumes: true` explicitly
destroys project data; `removeImages: true` removes project-local built images,
not all shared images. Failure leaves containers available for inspection and
returns log guidance. Services persist after Pi exits: stop them explicitly,
and stop Maglev before removing its PR Bench checkout. Bench teardown is separate.
The legacy asset provenance and transitive dependency caveats are documented in
`assets/legacy-oba/README.md`.

## Development

From this repository root, load only this package for isolated development:

```bash
pi --no-extensions --no-skills -e ./extensions/index.ts --skill ./skills
```

Delegated triage additionally requires loading `pi-subagents`. Run deterministic
unit tests and individual syntax checks with:

```bash
for file in extensions/*.ts testdata/*.ts tests/*.test.ts; do
  node --check "$file" || exit
done
npm test
git diff --check
```

The current `npm run check` expands multiple filenames but Node checks only the
first (open F6). The loop above checks all files; it is not a TypeScript typecheck.

Tests live in `tests/`; shared test fixtures and factories live in `testdata/`.

## Module layout

The extension keeps Pi-specific adapter code separate from ordinary TypeScript functions:

- `extensions/index.ts` — Pi registration only: commands, tools, schemas, UI calls, and tool-result formatting.
- `extensions/constants.ts` — repo names, schema versions, bucket constants, snapshot staleness threshold, and login sets.
- `extensions/paths.ts` — the shared maintainer root path plus all root-relative state, checkout, bench, and review JSON paths.
- `extensions/types.ts` — shared GitHub snapshot, decision, and PR Bench types.
- `extensions/schemas.ts` — TypeBox schemas for Pi tool parameters.
- `extensions/utils.ts` — generic helpers for timestamps, subprocesses, atomic JSON writes, and Pi tool result formatting.
- `extensions/github-core.ts` — pure GitHub metadata normalization helpers.
- `extensions/github.ts` — GitHub metadata refresh operation with injected `gh` runner and snapshot writer.
- `extensions/triage.ts` — metadata selection and needs-inference operations over loaded snapshot/decision state.
- `extensions/triage-tool-results.ts` — model-visible selected metadata and compact decision/discovery outputs.
- `extensions/queue-core.ts` — read-only queue grouping/formatting for `/maglev-prs` from snapshot, decisions, and PR Bench state.
- `extensions/state-query.ts` — joined JSON state query for selected PRs so exact fields can enter model context without ad-hoc scripts.
- `extensions/review-json.ts` — prospective PR review JSON assembly and diff-line validation with injectable GitHub/file operations.
- `extensions/review-json-store.ts` — centralized current review JSON draft listing, loading, clearing, and Markdown formatting.
- `extensions/decisions.ts` — decision normalization and ordinary decision store operations.
- `extensions/decision-lock.ts` — cross-process locking for complete decision mutations; bounded wait and manual orphan recovery.
- `extensions/status.ts` — maintainer-root/state availability and command readiness checks.
- `extensions/state-core.ts` — file-based snapshot/decision load/write helpers with injectable paths.
- `extensions/state.ts` — production state helpers wired to the maintainer root paths.
- `extensions/workspace-context.ts` — config/path/context payload for skills that need to run inside the same PR Maintainer framework.
- `extensions/companion-repos.ts` — deterministic OBA companion repo resolver/updater for API/spec review skills.
- `extensions/maglev-checkout.ts` — safe standalone Maglev checkout resolution and staged cloning.
- `extensions/api-runtime.ts` — isolated Docker runtime planning, generated config, startup/readiness, inspection, and teardown.
- `extensions/api-runtime-tools.ts` — Pi schemas/registration and per-runtime mutation serialization.
- `extensions/snapshot-staleness.ts` — simple local snapshot age/staleness check shared by tools and skills.
- `extensions/bench-core.ts` — shared branch-based lifecycle planning/execution, with PR-specific resolution/reset safeguards.
- `extensions/bench.ts` — shared discovery/inspection, lifecycle operations, PR association, and PR compatibility views.
- `extensions/bench-registry.ts` — stable identity, definition validation, and atomic manifest storage.
- `extensions/bench-tools.ts` — general Bench tools and commands; PR adapters remain in `index.ts`.
- `extensions/bench-context.ts` — caller-supplied startup context persistence outside the source checkout.
- `extensions/bench-kickoff.ts` — on-demand read-only review kickoff context loader, independent of Bench startup.
- `extensions/code-review.ts` — headless Claude Code invocation, timeout handling, and captured review logs.
- `prompts/bench-kickoff.md` — external template used only by the on-demand kickoff tool.

Domain modules should expose ordinary reusable functions with domain names, such as `listPrsNeedingInference`, `loadPrMetadata`, `buildStateQuery`, `listBenches`, `inspectBench`, and `saveDecision`. Any Pi tool/command infrastructure details should be adapted in `extensions/index.ts`.

`maglev_pr_snapshot_staleness` performs the simple local freshness check used by skills before PR metadata-dependent work. The default staleness threshold is `SNAPSHOT_STALE_AFTER_HOURS` in `extensions/constants.ts`, currently 4 hours.

Metadata refresh currently uses `gh pr list` followed by per-PR `gh pr view` calls. It is intentionally sequential and bounded by the tool `limit` parameter, which defaults to 200 and is capped at 500. If refresh is parallelized later, keep concurrency conservative to avoid GitHub rate-limit bursts and keep the snapshot facts-only.

## Maintainer root

All maintainer-owned state is rooted at `/var/lib/maglev-pr-maintainer` by default. Set `MAGLEV_PR_MAINTAINER_ROOT` to override it for development or non-system installs. For shared system use, make the root writable by a `maglev-pr-maintainer` group and add maintainer users to that group. Root-relative paths are:

```text
/var/lib/maglev-pr-maintainer/
  plans/ (general/cross-PR working documents and reports without a Bench)
  state/
    github-snapshot.json
    decisions.json
    decisions.json.lock/ (temporary exclusive mutation lock)
  benches/
    pr-N/ (manifest, caller context files, review logs and reports)
    branch-<slug>-<hash>/ (same artifacts; optional PR association)
  checkouts/
    maglev/
    pr-N/
    branch-<slug>-<hash>/
  scripts/
    <operation>-<subject>.sh (generated privileged handoffs, mode 0755)
  review-json/
    pr-N.json
  runtimes/
    <runtime-id>/runtime.json, compose.json, config.json, runtime.log
    source/oba-<version>/
  companion-repos/
    maglev.wiki/
    js-sdk/
    ...
```

Decision reasons/observations are durable text: use absolute dates like `maintainer chased on 2026-09-05`, not relative phrases like `chased today`.

Decision upsert/delete holds a cross-process filesystem lock for the entire
read-modify-write. Contention is bounded; locks are never automatically reclaimed
by age or PID. See [decision mutation locking](docs/decision-mutation-locking.md)
for cancellation, failure, and safe manual orphan recovery.

Working reports and handoffs use `artifacts.targetReportsDir` for the selected PR
or branch Bench (association preserves its original directory). With no applicable
Bench, use `<maintainerRoot>/plans/`, not checkout-local `tmp/`. Explicit user
output paths take precedence, subject to repository instructions. Canonical state,
review JSON, and runtime artifacts remain tool-owned.

No Pi session custom entries should be used for canonical workflow state.

## Known limitations

- Reset does not yet protect displaced unpushed commits as close does (F1).
  Preserve committed work before resetting a Bench.
- Decision basis stamping and older-date head changes still have open freshness
  findings (F3/F4); cross-process locking fixes F2, not those semantics.
- Claude `/code-review` publication depends on the installed command/plugin
  version (F7). Some variants post PR comments automatically; verify active
  resolution and use a non-publishing-by-default variant for local-only review.
  The wrapper invokes `/code-review N` without `--comment` but does not enforce a
  GitHub write capability boundary. Unit tests do not establish live resolution.
- Queue refresh keys, interactive TRIAGE tabs, and manual marking are planned,
  not features of the current read-only `/maglev-prs` report.
