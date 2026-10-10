---
name: oba-api-spec-check
description: Sub-skill that checks a Maglev OBA API change against the relevant maglev.wiki endpoint spec and deviation records. Usually invoked by oba-api-change-review; it reports needed wiki updates but does not edit the wiki.
---

# OBA API Spec Check

Assess whether a change is consistent with the relevant `maglev.wiki` spec, and verify that any deviation from legacy behaviour is recorded in the spec's Implementation Decisions section.

Typically invoked by `oba-api-change-review`. Call directly when you want to isolate spec alignment from goal-closure, client impact, or PR decision workflow. This skill reports needed wiki updates but does not edit the wiki; use `oba-wiki-spec-update` for approved wiki changes. This packaged version can run from a normal `maglev` checkout or PR Bench checkout; call `maglev_workspace_context` first and resolve wiki/Java repos through Maglev Maintainer tools.

**This skill identifies where a spec is inconsistent, incomplete, or needs a new Implementation Decisions entry — it does not edit `maglev.wiki` itself.** A spec change affects every client and every future review, so route actual wiki edits through the agreed spec-maintenance process (typically `oba-api-pr-spec-review` → `oba-wiki-spec-update`) rather than editing the wiki unilaterally.

## Durable PR analysis

For an identified PR, follow `../maglev-pr-analysis-record/SKILL.md` to save a
`spec-review` record with source SHA/provenance, scope, consistency/findings outcome,
wiki/Java evidence, and limitations, including blocked/failed analysis. When
called by a parent review, return these record facts to that parent for serialized
persistence rather than independently replacing its decision. A spec-only clean
result is not general code review or approval.

## Arguments

1. The endpoint name.
2. The diff source — PR number, branch name, working tree (empty), or a plain-English description of the proposed change.

## Workspace layout

- **Spec index**: `OBA-API-Specs.md` in the `maglev.wiki` repo — read this first as the endpoint-to-page map.
- **Endpoint spec**: `<endpoint>.md` in the `maglev.wiki` repo — resolve the repo's local path via `maglev_companion_repos_resolve` or the packaged `maglev-companion-repos` skill (argument: `maglev.wiki`). Some endpoints map to multiple pages in the index; read every relevant page rather than assuming a single file.
- **Legacy Java**: `onebusaway-application-modules` (alias: `oba-java`) — resolve through `maglev_companion_repos_resolve` / packaged `maglev-companion-repos` only when the wiki/spec is ambiguous, when a change appears to contradict Java behavior, or when Java behavior needs confirmation for a suspected deviation.
- **Maglev handler**: `internal/restapi/<endpoint>_handler.go` (relative to the `maglev` repo root) — handler filenames use underscores throughout, e.g. `stops-for-route` → `stops_for_route_handler.go`, so convert every hyphen in the endpoint name to an underscore before looking for the file.

## Steps

### 0. Load Maglev Maintainer context

Call `maglev_workspace_context`, then resolve `maglev.wiki` with `maglev_companion_repos_resolve` before reading spec files. If Java behavior is needed later, resolve `oba-java` with the same tool. If any resolved repo has an error anomaly, stop and report it; otherwise include warning/note anomalies as caveats.

### 1. Read the spec in full

Get the wiki repo's local path from `maglev_companion_repos_resolve` / packaged `maglev-companion-repos` (see Workspace layout above); include any caveats it reports in the final report, since the spec being read may be out of date. Then read `<path>/OBA-API-Specs.md` first to confirm the endpoint's page mapping. Read `<path>/<endpoint>.md` entirely, plus any additional pages the index lists for that endpoint. Note:
- The specified behaviour for each request parameter, response field, and error case.
- The **Suspected Defects** section — known divergences from ideal behaviour in the legacy implementation.
- The **Implementation Decisions** section — deliberate deviations Maglev has chosen to make, with rationale.
- Related shared-behavior pages linked from the endpoint or index, such as stop direction, federation/multi-agency, defect workshop, or GTFS-Flex pages.

### 2. Get the diff

Use the same diff-source policy as `oba-api-change-review`:

- **PR**: read `baseRefName` and `headRefOid` with `gh pr view`; fetch `origin/<baseRefName>`; if local `HEAD` matches `headRefOid`, use `git diff origin/<baseRefName>...HEAD`; otherwise use `gh pr diff <PR> --repo OneBusAway/maglev` and report the local mismatch caveat.
- **Branch**: `git fetch origin main`, then `git diff origin/main...<branch>`.
- **Working tree**: `git fetch origin main`, then inspect both `git diff origin/main...HEAD` for committed branch changes and `git diff` / `git status --short` for uncommitted changes.

For description mode, work from the stated intent rather than an actual diff.

### 3. Check spec consistency

For each production change (or proposed change):
- Does the spec permit or require this change?
- Does the change contradict the spec?
- Does the change address a **Suspected Defect** — intentionally or as a side effect?
- Does the change affect behaviour the spec does not yet cover? If so, the spec may need to be updated.
- If the answer depends on what legacy Java actually does and the wiki is ambiguous or internally inconsistent, resolve `oba-java` with `maglev_companion_repos_resolve` / packaged `maglev-companion-repos`, inspect the Java source, and cite any caveats from that checkout.

### 4. Check deviation recording

For any change that deviates from legacy behaviour (i.e. touches a Suspected Defect or introduces a deliberate difference):
- Does an **Implementation Decisions** entry already exist for this deviation?
- If not, flag it: the spec needs a new entry to maintain the audit trail. Don't add it yourself in this skill — route it through the agreed spec-maintenance process so the entry gets broader review before it's added.

For description mode this is prospective: "if this change were implemented, would a new Implementation Decisions entry be required?"

### 5. Report

**Spec check: `<endpoint>`**

For each changed behaviour:
- **Consistent** — change matches what the spec requires or permits.
- **Inconsistent** — change contradicts the spec; describe the conflict.
- **Spec gap** — spec does not cover this behaviour; spec should be updated.
- **Deviation** — change deviates from legacy; Implementation Decisions entry exists ✓ / missing ✗.

Overall: **spec-consistent** / **conflicts noted** / **spec update required**
