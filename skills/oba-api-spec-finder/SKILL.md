---
name: oba-api-spec-finder
description: Finds and reads Maglev wiki OBA API endpoint specs. Use when a user asks where endpoint specs live, asks for the spec for an endpoint, or needs a quick spec/page map without a full PR/change review.
---

# OBA API Spec Finder

Use this lightweight skill to locate `maglev.wiki` OBA API specs and, when requested, read the relevant endpoint page. This is intentionally read-only and does not perform PR review, client-impact analysis, Java behavior confirmation, or wiki edits.

This packaged version can run from a normal `maglev` checkout or PR Bench checkout. Call `maglev_pr_workspace_context` first and resolve `maglev.wiki` through the packaged `oba-workspace` skill / `maglev_pr_companion_repos` tool.

## Arguments

Optional:
- No argument: show where specs live and list the endpoint index.
- Endpoint name, endpoint path, or handler-like name: locate/read the matching wiki spec page(s). Examples: `stops-for-route`, `/api/where/stops-for-route/{id}.json`, `stops_for_route_handler.go`.

## Spec locations

Resolve the wiki checkout through the packaged `oba-workspace` skill or directly with `maglev_pr_companion_repos`:

```text
/skill:oba-workspace maglev.wiki
```

Then use:

- **Endpoint index**: `<wiki-path>/OBA-API-Specs.md`
- **Endpoint pages**: `<wiki-path>/<endpoint>.md`
- **Legacy defects**: `<wiki-path>/OBA-API-Defect-Workshop.md`
- **Federation / multi-agency deviations**: `<wiki-path>/Multi-Agency-Static-Feeds-Stop-Consolidation.md`
- **Shared stop direction behavior**: `<wiki-path>/Stop-Direction-Calculation.md`
- **GTFS-Flex / on-demand behavior**: `<wiki-path>/GTFS-Flex-Support.md`

Endpoint names normally use hyphens, not underscores: `stops-for-route.md`, not `stops_for_route.md`.

## Steps

### 1. Resolve the wiki repo

Call `maglev_pr_workspace_context`, then invoke `maglev_pr_companion_repos` or packaged `oba-workspace` for `maglev.wiki`. Include any workspace caveats in the final response; a stale or locally modified wiki checkout may affect what spec text was read.

### 2. Read the endpoint index

Read `<wiki-path>/OBA-API-Specs.md` first. Use it as the page map rather than assuming every endpoint maps to exactly one page. Some endpoints intentionally reference more than one page, such as ID-only variants that share behavior with the full list endpoint.

### 3. Normalize the requested endpoint, if any

If the user provided an endpoint-ish value:

- Strip `/api/where/` prefix.
- Strip `.json` suffix.
- Remove path parameters such as `/{id}`.
- Convert underscores to hyphens.
- Convert handler filenames like `stops_for_route_handler.go` to `stops-for-route`.

Then look up the normalized endpoint in `OBA-API-Specs.md`. If the index lists multiple pages, read/report all relevant pages. If no match is found but `<wiki-path>/<endpoint>.md` exists, report that direct page match and note that it was not found in the index.

### 4. Read and summarize requested pages

For each matched endpoint page, read it in full. Call out these sections when present:

- Request parameters
- Response fields / references
- Error behavior
- Suspected Defects
- Implementation Decisions
- Related shared-behavior pages

Do not edit the wiki. If the user is asking whether a code change conforms to the spec, hand off to `oba-api-spec-check` or `oba-api-change-review` instead of expanding this finder into a review.

## Report

Use this concise format:

```markdown
Spec location:
- Wiki repo: `<wiki-path>`
- Index: `<wiki-path>/OBA-API-Specs.md`

Endpoint: `<endpoint or none>`
Pages:
- `<wiki-path>/<page>.md` — <why it applies>

Notes:
- <key sections, related pages, or caveats>
```
