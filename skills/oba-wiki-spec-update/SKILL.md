---
name: oba-wiki-spec-update
description: Applies approved maglev.wiki OBA API spec updates from a handoff, including Java behavior, Maglev Implementation Decisions, accepted deviations, defect references, and federation notes. Use after oba-api-pr-spec-review decisions; does not push.
---

# OBA Wiki Spec Update

Use this skill to update the `maglev.wiki` companion repo for OBA API specification documentation after the user has approved spec-maintenance decisions. It is intentionally generic: it can document accepted Maglev deviations, correct endpoint spec prose, document legacy Java defects, and update federation/multi-agency notes.

Usually run from a handoff produced by `oba-api-pr-spec-review`. Do not use this as an exploratory spec checker; use `oba-api-spec-check` for read-only checking. This skill edits `maglev.wiki`, asks before committing locally, and never pushes. This packaged version resolves repos through Maglev Maintainer tools, so call `maglev_workspace_context` first.

## Operating rules

- Do not push. Commit locally only when changes are complete and the user has asked for/approved the update.
- Treat legacy Java behavior as the default behavior described by spec prose.
- Put Maglev-specific deviations or implementation choices in the affected page's **Implementation Decisions** section.
- Add local pointers such as "see Implementation Decisions" everywhere prose is affected by a deviation; do not only document the deviation once.
- Cross-reference `OBA-API-Defect-Workshop.md` only for documented legacy Java defects, not deliberate Maglev design improvements.
- If a deviation is caused by Maglev's current single-static-feed limitation, update `Multi-Agency-Static-Feeds-Stop-Consolidation.md`, especially the section 10 deviation table.
- Preserve existing citation style and pinned commit SHA conventions on each page.

## Inputs

Usually invoked with a handoff file from `oba-api-pr-spec-review`:

```text
/skill:oba-wiki-spec-update <handoff-dir>/pr-<PR>-wiki-spec-updates.md
```

The handoff should enumerate updates with stable spec-deviation IDs such as `SD-01`.

## Phase 1: Resolve wiki and Java repos

Use `maglev_companion_repos_resolve` directly or the packaged `oba-workspace` skill to resolve `maglev.wiki` and the legacy Java reference repo:

```text
/skill:oba-workspace maglev.wiki oba-java
```

`oba-java` is an alias for `onebusaway-application-modules` and is treated as reference-only, so the resolver fast-forwards it when safe. If the resolver reports anomalies for either repo, stop on error anomalies and include warning/note caveats in the final response.

Record the resolved wiki path and Java repo path. All wiki edits happen in `maglev.wiki`, not in the Maglev repo. Use the Java repo to verify or refresh Java behavior citations rather than relying only on previously written handoff prose.

## Phase 2: Read the handoff and inspect target pages

First read the wiki endpoint index, `<wiki-path>/OBA-API-Specs.md`, so endpoint-to-page mappings and related shared pages are explicit before editing any page.

For each update item, record:

- stable ID (`SD-01`, `SD-02`, etc.)
- update type:
  - `accepted-maglev-deviation`
  - `spec-correction`
  - `legacy-java-defect`
  - `federation-note`
  - `other`
- endpoint/spec page
- related pages
- whether it is federation/single-feed related
- whether it is a legacy defect
- Java behavior and citations
- Maglev behavior / decision
- rationale and trade-offs
- client impact
- required wiki changes

Read the relevant wiki pages before editing. Identify:

- existing structure and headings
- existing **Implementation Decisions** section format
- existing Java source citation style
- pinned Java commit SHA used elsewhere on the page
- related links/cross-references

When the handoff includes Java behavior or asks for a spec correction/legacy defect entry, inspect the resolved `oba-java` repo for the cited behavior. Preserve existing pinned-SHA conventions; if a page pins Java citations to a specific commit, do not silently switch to an unpinned or different style.

If a required target page is unclear, stop and ask the user rather than guessing.

## Phase 3: Update endpoint/spec prose

For each update:

1. Correct main spec prose so it describes actual legacy Java behavior, with source citations matching the page's existing style.
2. If Maglev intentionally differs, add a short local pointer at each affected prose location, e.g.:

```markdown
Maglev intentionally differs for this case; see [Implementation Decisions](#implementation-decisions).
```

3. Do not rewrite large unrelated sections.
4. Do not describe aspirational Maglev behavior as if it were Java behavior.
5. Preserve existing page tone and formatting.

## Phase 4: Add or update Implementation Decisions

For accepted Maglev deviations or implementation choices, update the affected page's own **Implementation Decisions** section using its existing format. Include:

- stable ID from the handoff if appropriate
- what Java does
- what Maglev does instead
- reasoning
- trade-offs / client impact
- fallback if reconsidered
- links to relevant source citations or spec sections

If there is no **Implementation Decisions** section, add one in the most consistent location for that page and match neighboring pages' style when possible.

## Phase 5: Legacy defect handling

Only if the handoff says the update concerns a true legacy Java defect:

- add/update the appropriate endpoint page notes
- cross-reference `OBA-API-Defect-Workshop.md` following existing tracker format
- do not add design improvements or accepted Maglev deviations to the defect tracker unless they are specifically tied to a documented Java defect

## Phase 6: Federation / single-feed handling

If the update is caused by Maglev's current single static feed limitation or affects future federated feed support:

1. Open `Multi-Agency-Static-Feeds-Stop-Consolidation.md`.
2. Find section 10 and its deviation tracking table.
3. Add/update the row for the deviation so it can be revisited when multi-agency static feed support is implemented.
4. Cross-reference the endpoint/spec page and stable ID where useful.
5. Keep the table format intact.

## Phase 7: Review and ask before committing

Before committing:

```bash
git -C <wiki-path> diff
git -C <wiki-path> status --short
```

Verify:

- Java behavior prose is accurate and cited.
- Maglev-specific decisions are in Implementation Decisions.
- Affected prose has pointers to Implementation Decisions.
- Defect tracker was only touched for actual Java defects.
- Federation table was updated when required.
- No unrelated wiki files were changed.

Show the diff/status summary to the user and ask for approval before creating a local commit. If the user approves, commit locally with a clear message. Examples:

```bash
git -C <wiki-path> add <changed-files>
git -C <wiki-path> commit -m "Document Maglev OBA API deviation for <endpoint>"
```

or:

```bash
git -C <wiki-path> commit -m "Correct OBA API spec for <endpoint>"
```

Do not push.

## Final response

Report:

- wiki repo path
- update IDs handled
- files changed
- local commit hash/message
- any caveats from `maglev_companion_repos_resolve` / packaged `oba-workspace`
- anything intentionally not updated and why
