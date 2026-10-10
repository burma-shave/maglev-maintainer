---
name: maglev-companion-repos
compatibility: Requires the Maglev Maintainer extension tools.
description: Resolves local checkout paths for OBA companion repos such as maglev.wiki, wayfinder, js-sdk, onebusaway-ios, onebusaway-android, and legacy Java through the Maglev Maintainer framework.
---

# Maglev Companion Repositories

Resolve OBA companion repos through Maglev Maintainer tools instead of shell resolver scripts or hard-coded `/workspace` assumptions.

Use this skill when OBA API/spec review skills need local source for:

- `maglev.wiki`
- `wayfinder`
- `js-sdk`
- `onebusaway-ios`
- `onebusaway-android`
- `onebusaway-application-modules` / `oba-java`

For **Maglev itself**, use the `maglev-checkout` skill and `maglev_checkout` tool; it is not a companion repo. For a branch or PR environment, use `maglev-bench`.

## Rules

- First call `maglev_workspace_context` to get the maintainer root and companion repo policy.
- Then call `maglev_companion_repos_resolve` with the requested repos.
- Do not call `/workspace/agentic/skills/lib/resolve-oba-repo.sh`.
- Do not assume repos live under `/workspace`.
- Include any returned `warning` or `note` anomalies in the calling review's caveats.
- Treat `maglev.wiki` as editable: the resolver clones it on first use but does not pull it automatically after that.
- Treat client repos and legacy Java as reference-only: the resolver may clone or fast-forward them when safe.

## Arguments

One or more repo names, for example:

```text
/skill:maglev-companion-repos maglev.wiki
/skill:maglev-companion-repos js-sdk wayfinder onebusaway-ios onebusaway-android
/skill:maglev-companion-repos oba-java
```

If no repo names are supplied, resolve all known companion repos.

Known repos:

```text
wayfinder
js-sdk
onebusaway-ios
onebusaway-android
onebusaway-application-modules
oba-java
maglev.wiki
```

## Steps

1. Call `maglev_workspace_context` with no `pr` unless the caller provided a PR number as separate context.
2. Parse requested repo names. If none were provided, omit `repos` when calling `maglev_companion_repos_resolve` so it resolves all known repos.
3. Call `maglev_companion_repos_resolve` with the requested `repos` array.
4. Report a compact table:

| Repo | Path | Class | Source | State | Caveats |
|------|------|-------|--------|-------|---------|

Where:

- **Class** is `reference-only` or `editable`.
- **Source** is `maintainer-root` or `OBA_WORKSPACE`.
- **State** includes `cloned`, `updated`, `dirty`, or `ok` as applicable.
- **Caveats** include all returned anomaly messages.

5. If any repo has an `error` anomaly, stop the calling workflow until the maintainer fixes the checkout or changes the workspace override.
6. Otherwise return the resolved paths and caveats to the caller.
