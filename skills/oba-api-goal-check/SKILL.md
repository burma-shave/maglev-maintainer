---
name: oba-api-goal-check
description: Sub-skill that checks whether a Maglev OBA API diff closes a stated goal/spec-gap and has adequate tests. Usually invoked by oba-api-change-review; call directly only for isolated goal-closure analysis.
---

# OBA API Goal Check

Assess whether a change fully accomplishes its stated goal, including adequate test coverage for every sub-gap.

Typically invoked by `oba-api-change-review`. Call directly only when you have a specific gap description and want isolated goal-closure analysis without client-impact or spec-maintenance workflow. This packaged version can run from a normal `maglev` checkout or PR Bench checkout; call `maglev_pr_workspace_context` first and resolve `maglev.wiki` through Maglev PR Maintainer tools.

## Arguments

1. The stated goal or gap description — from a spec-gap issue, a PR body, or a user-supplied description of intent.
2. The diff source — PR number, branch name, working tree (empty), or `prospective` when there is no diff and only a proposed goal/description exists.

## Workspace layout

- **Spec index**: `OBA-API-Specs.md` in the `maglev.wiki` repo — read this first as the endpoint-to-page map.
- **Endpoint spec**: `<endpoint>.md` in the `maglev.wiki` repo — resolve the repo's local path via `maglev_pr_companion_repos` or the packaged `oba-workspace` skill (argument: `maglev.wiki`). Some endpoints map to multiple pages in the index; read every relevant page for the stated goal.
- **Maglev handler**: `internal/restapi/<endpoint>_handler.go` (relative to the `maglev` repo root) — handler filenames use underscores throughout, e.g. `stops-for-route` → `stops_for_route_handler.go`, so convert every hyphen in the endpoint name to an underscore before looking for the file.
- **Maglev tests**: `internal/restapi/<endpoint>_handler_test.go` (relative to the `maglev` repo root, same hyphen-to-underscore conversion).

## Steps

### 0. Load Maglev PR Maintainer context

Call `maglev_pr_workspace_context`, then resolve `maglev.wiki` with `maglev_pr_companion_repos` before reading spec files. If the wiki repo has an error anomaly, stop and report it; otherwise include warning/note anomalies as caveats.

### 1. Parse the stated goal

Extract the endpoint name and the specific behaviours, fields, parameters, or error cases the change is meant to address. If the goal lists sub-gaps (e.g. a numbered list in a spec-gap issue), enumerate them — each will need individual coverage.

### 2. Read the relevant spec section

Get the wiki repo's local path from `maglev_pr_companion_repos` / packaged `oba-workspace` (see Workspace layout above); include any caveats it reports in the final report, since the spec being read may be out of date. Read `<path>/OBA-API-Specs.md` first to confirm the endpoint's page mapping. Then read the section(s) of `<path>/<endpoint>.md`, plus any additional pages the index maps to the endpoint, that correspond to the stated goal. Confirm what correct behaviour looks like according to the spec.

### 3. Get the diff

Use the same diff-source policy as `oba-api-change-review`:

- **PR**: read `baseRefName` and `headRefOid` with `gh pr view`; fetch `origin/<baseRefName>`; if local `HEAD` matches `headRefOid`, use `git diff origin/<baseRefName>...HEAD`; otherwise use `gh pr diff <PR> --repo OneBusAway/maglev` and report the local mismatch caveat.
- **Branch**: `git fetch origin main`, then `git diff origin/main...<branch>`.
- **Working tree**: `git fetch origin main`, then inspect both `git diff origin/main...HEAD` for committed branch changes and `git diff` / `git status --short` for uncommitted changes.
- **Prospective**: no diff exists; assess whether the goal is clear and what implementation/test evidence would be required, but do not report sub-gaps as addressed.

Read the handler file and test file in context if the diff alone is insufficient.

### 4. Assess production changes against the goal

For each sub-gap or behaviour named in the stated goal:
- Is it addressed by a production change in the diff?
- Does the production change correctly implement what the spec requires?
- Are any adjacent behaviours accidentally affected?

In prospective mode, replace these questions with: what production behavior would need to change, what existing code appears relevant, and what evidence would be needed to confirm completion later.

Flag anything the diff claims to address but does not, and anything the diff changes that was not part of the stated goal.

### 5. Assess test coverage

For each sub-gap or behaviour named in the stated goal:
- Is there at least one test or assertion that would catch a regression?
- Are assertions specific enough — not just `assert.NotNil` or a shape check with the wrong expected value?
- Is the test scenario correctly structured: right endpoint called, test data valid for the scenario, proper isolation and cleanup?
- Does any existing assertion get weakened or removed by the diff?

### 6. Report

**Goal check: `<endpoint>`**

Stated goal: [summary]

For each sub-gap: ✓ addressed / ✗ missing / ⚠ partial — with a brief note.

Test coverage: [adequate / gaps noted — list any uncovered sub-gaps or weak assertions]

Overall: **fully closed** / **partially closed** / **not closed** / **prospective only — no implementation diff assessed**
