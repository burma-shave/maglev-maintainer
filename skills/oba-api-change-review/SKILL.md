---
name: oba-api-change-review
description: Focused review of a Maglev OBA API behavior change, branch, PR, working tree, or proposal. Use for goal closure, client impact, and wiki-spec consistency. For full PR spec-maintenance with SD decisions, use oba-api-pr-spec-review instead.
---

# OBA API Change Review

Focused entry point for reviewing a Maglev OBA API behavior change. Determines which analyses are relevant and runs them.

Use this for a focused behavior review of a PR, branch, working tree, or proposed change. For the full PR/spec-maintenance workflow that gathers PR comments, assigns `SD-*` IDs, asks for decisions, and writes wiki/comment handoffs, use `oba-api-pr-spec-review` instead.

This Maglev Maintainer packaged skill is meant to run from a normal `maglev` checkout or from a PR Bench checkout. At the start, call `maglev_workspace_context`; if the source is a PR number, pass that PR number. Use the returned current/target PR Bench paths, artifact directories, and companion repo resolver capability instead of assuming `/workspace` or repo-local output paths.

`oba-api-client-impact` needs source from `wayfinder`, `js-sdk`, `onebusaway-ios`, and `onebusaway-android`; Java-behavior checks may need `onebusaway-application-modules` / `oba-java`; `oba-api-spec-check` and `oba-api-goal-check` need `maglev.wiki`. Resolve those through the packaged `oba-workspace` skill / `maglev_companion_repos_resolve` tool and include any caveats in the final report.

## Wiki specs quick reference

- Endpoint index: `maglev.wiki/OBA-API-Specs.md`
- Endpoint pages: `maglev.wiki/<endpoint>.md` using hyphenated endpoint names, e.g. `stops-for-route.md`
- Always read the index before assuming a page mapping; some endpoint variants reference multiple pages.
- Deviation and defect context lives in each page's **Suspected Defects** and **Implementation Decisions** sections, with related shared pages linked from the index or endpoint page.
- For quick lookup without full review, use `oba-api-spec-finder`.

## Argument

The source is one of four forms, optionally followed by a `--output [path]` flag:

| Form | Detection | Example |
|------|-----------|---------|
| PR number | Numeric / `#NNN` | `123` |
| Branch name | Single token, no spaces, not numeric | `fix/route-ids-paging` |
| Description | Contains spaces | `remove the situationIds field from stops-for-route` |
| *(empty)* | No argument | *(none)* → current working tree |

Strip a trailing `--output` or `--output <path>` token from the argument before applying the detection rules above — it's a modifier, not part of the source. Its presence means: also save the final report to a file (step 8). Its absence means the report is only printed inline, as before. If `--output` is given without a path, use the default path described in step 8.

## Steps

### 0. Load Maglev Maintainer context

Call `maglev_workspace_context` before inspecting paths or choosing output locations. If the parsed source is a PR number, pass it as `pr`; otherwise call with no arguments. Carry the returned context through the review, especially `benches.*`, `artifacts.targetReportsDir`, and `companionRepos.resolverTool`.

### 1. Resolve the diff source

**PR (`123` or `#NNN`):**
```bash
gh pr view <PR> --repo OneBusAway/maglev --json number,title,body,baseRefName,headRefOid,headRefName,url
```
Note the PR title, body, base ref, head SHA, and any linked issues. Fetch linked spec-gap issue if present:
```bash
gh issue view <issue> --repo OneBusAway/maglev
```
Then fetch the PR base ref. If local `HEAD` matches the PR `headRefOid`, inspect the local triple-dot diff against that base; otherwise use `gh pr diff` and report the local mismatch as a caveat:
```bash
git fetch origin <baseRefName>
git rev-parse HEAD
git diff origin/<baseRefName>...HEAD --name-only
# or, if local HEAD differs from headRefOid:
gh pr diff <PR> --repo OneBusAway/maglev
```

**Branch (single token, not numeric):**
```bash
git fetch origin main
git diff origin/main...<branch> --name-only
```
Check whether the branch is linked to a GitHub issue. If so, fetch it.

**Description (contains spaces):** No diff to fetch. The argument is the stated intent. Continue with endpoint-scope identification from the description.

**Working tree (empty argument):**
```bash
git fetch origin main
git diff origin/main...HEAD --name-only
git diff
git status --short
```
`git diff origin/main...HEAD` captures the branch's full committed divergence from the remote base, not just uncommitted edits — a branch can be entirely committed (and pushed as a PR) with nothing left in the working tree. `git diff` and `git status --short` additionally surface any uncommitted changes on top of that. Check whether the current branch is linked to a GitHub issue, or has an open PR (`gh pr list --head <branch>`). If so, fetch it.

### 2. Identify affected endpoint scope

For PR, branch, and working-tree modes, inspect the changed files and diff to determine the API scope before partitioning production/test changes. Classify the scope as one of:

- **Single endpoint** — one endpoint handler/model/route clearly owns the behavior.
- **Multiple endpoints** — several endpoint handlers or endpoint-specific models are affected.
- **Cross-cutting API behavior** — shared models, references, response wrappers, middleware, SQL, time/date utilities, route registration, or other shared code affects more than one endpoint.
- **Unknown / ask user** — the affected endpoint(s) cannot be inferred confidently from the diff or description.

Endpoint discovery hints:

- Handler files usually map directly: `internal/restapi/stops_for_route_handler.go` → `stops-for-route`.
- Test files usually map the same way: `*_handler_test.go`.
- Route registration changes in `internal/restapi/routes.go` may add/remove/change endpoint paths directly.
- Shared model or SQL changes require tracing call sites to identify affected handlers.
- A description-mode argument may name an endpoint explicitly; if not, infer cautiously or ask.

For multiple endpoints, run endpoint-specific sub-skills per endpoint when behavior differs by endpoint. For cross-cutting behavior, report it as cross-cutting and list affected endpoints when discoverable. If scope is unknown and the review cannot proceed safely, ask the user for the endpoint(s) or behavior area.

### 3. Partition the changes

For PR, branch, and working-tree modes, categorise every changed file:

- **Production changes** — handler code, models, DB queries, middleware, or any non-test file that affects what Maglev returns at runtime.
- **Test changes** — `*_test.go` files, test helpers, fixtures, test-only DB helpers.

Record whether the diff contains production changes, test changes, or both.

### 4. Write the overview

Before running any sub-skills, write an **Overview** section for the report. This orients the reader — someone who may not have read the PR, the issue, or the spec — so they can follow the analysis that comes after.

The overview has two parts:

**What this change does** — a plain-English explanation of the problem and the fix (or feature). Walk through the before/after behaviour concretely: what the endpoint returned before, what it returns after, and under what conditions the difference matters. Use a specific scenario if one helps (e.g. "Route X ends in December but the feed runs until June — querying January used to return Y, now returns Z"). Reference the linked issue and spec section where relevant.

**Domain background** — explain any GTFS, transit-operations, or OBA API concepts that a reader needs to follow the change. Examples: how `calendar` vs `calendar_dates` determine active service; what a "feed end date" is vs a route's service window; what 510/ServiceDateOutOfRange means in the OBA API. Only cover concepts that are actually relevant to *this* change — don't recite the full GTFS spec. Aim for a reader who knows Go and SQL but not transit data.

Sources to draw on:
- The PR description and linked issue
- The `maglev.wiki` spec for the affected endpoint (see `oba-api-spec-check` for how it's resolved)
- GTFS specification concepts (calendar, calendar_dates, routes, trips, service_id)
- The diff itself (for understanding the mechanics of the fix)

### 5. Determine which sub-skills to run

| Condition | Run |
|-----------|-----|
| A gap description is available and a diff source exists — linked spec-gap issue on a PR / branch / working tree | `oba-api-goal-check` |
| Description mode with no diff | Treat the description as prospective intent; do not claim implementation is addressed. Run `oba-api-goal-check` only as a prospective goal/spec interpretation if useful. |
| Production changes exist (PR / branch / working tree) | `oba-api-client-impact`, `oba-api-spec-check` for each affected endpoint, or a cross-cutting analysis if endpoint-specific checks are not sufficient |
| Description mode | `oba-api-client-impact`, `oba-api-spec-check` (prospective) |
| Test changes only, no gap description | None — report this and stop |

### 6. Run the relevant sub-skills

Invoke each applicable sub-skill in order, passing the relevant context (gap description, endpoint name or endpoint scope, diff source):

1. `oba-api-goal-check` — if a gap description is available
2. `oba-api-client-impact` — if production changes exist or description mode
3. `oba-api-spec-check` — if production changes exist or description mode

### 7. Synthesise the report

Combine the sub-skill outputs into a single report:

---

## OBA API Change Review: `<source>` — `<scope>`

**Input**: [PR #NNN / branch `<name>` / working tree / proposed change]
**Stated goal**: [from linked issue, description argument, or "none"]
**Scope**: [single endpoint / multiple endpoints / cross-cutting / unknown]
**Affected endpoint(s)**: [endpoint list, cross-cutting area, or "unknown"]
**Changes**: [production / test-only / both / description only]

### Overview
[Plain-English explanation of the change and relevant domain concepts, from step 4.]

### Goal check
[Output of `oba-api-goal-check`, or "No stated goal — not assessed."]

### Client impact
[Output of `oba-api-client-impact`, or "Test-only changes — not applicable."]

### Spec check
[Output of `oba-api-spec-check`, or "Test-only changes — not applicable."]

### Summary

A short plain-English summary of what the analysis found. Note anything that is incomplete, incorrect, or that the change touches beyond its stated scope. Do not prescribe what should happen — that is the reader's decision.

---

### Prospective PR review draft

Whenever this analysis settles actionable findings for an identified PR, automatically follow `../maglev-pr-review-draft/SKILL.md` and save a prospective draft. No separate draft request or `--output` flag is needed. Include the draft path/event or a concrete save blocker in the final response. For branch/working-tree/proposal analysis without an identified PR, report that limitation rather than inventing a PR number.

### 8. Save the report to a file (only if `--output` was given)

Skip this report-file step if `--output` was not given; the prospective PR draft handoff above still applies.

If `--output <path>` was given, write the exact report content from step 7 to `<path>` verbatim (no truncation or reformatting), creating parent directories if needed.

If `--output` was given with no path, follow `../maglev-artifacts/SKILL.md` and use the `maglev_workspace_context` result. Use `<artifacts.targetReportsDir>/oba-api-change-review-<slug>-<timestamp>.md` for the applicable PR or branch Bench; an associated branch Bench keeps its original reports path. With no applicable Bench, use `<maintainerRoot>/plans/oba-api-change-review-<slug>-<timestamp>.md`. Do not default to checkout-local `tmp/` or start a Bench merely to store a report. Preserve an explicitly requested output destination, subject to repository instructions.

Create the chosen parent directory before writing.

- `<timestamp>` is `date +%Y%m%d-%H%M%S`
- `<slug>` depends on the resolved source:

| Source | Slug |
|--------|------|
| PR | `pr-<NNN>` |
| Branch | the branch name with `/` replaced by `-` |
| Working tree | `working-tree-<current-branch-name-with-/-replaced-by-->` |
| Description | a short kebab-case slug derived from the description (e.g. `remove-situationids-from-stops-for-route`) |

After writing, tell the user the file path so they can open, share, or diff it against a previous run.
