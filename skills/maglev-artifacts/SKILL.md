---
name: maglev-artifacts
description: Find, place, and organize Maglev maintainer artifacts, including plans, Bench notes, reports, handoffs, and generated scripts. Use when creating, updating, locating, or moving working artifacts, or deciding which dedicated tool owns an artifact. Does not mutate tool-owned canonical state.
compatibility: Requires the Maglev Maintainer workspace context tool.
---

# Maglev Artifacts

Keep maintainer working artifacts outside source checkouts unless the user
explicitly intends to commit them. Choose a location before writing an artifact.
Do not turn a request to find or discuss an artifact into an unsolicited move.

This skill owns placement and organization guidance, not every artifact's
creation or mutation. Use dedicated skills/tools for generated scripts, review
drafts, runtime files, and canonical state. Never relocate or overwrite tool-owned
artifacts merely to make their layout more consistent.

## Resolve the workspace

1. Call `maglev_workspace_context` first. Pass `pr` when the user supplies a
   PR number, or `benchId` for a supplied branch Bench ID (mutually exclusive).
   Otherwise use the returned current Bench context if it matches the subject.
2. Use the returned maintainer root and artifact paths, not hard-coded workspace
   assumptions. The default root is `/var/lib/maglev-maintainer`, but it may
   be configured elsewhere.
3. If a document is PR-specific and no PR can be established, ask for the PR
   number. Do not guess from an unrelated active Bench or start a Bench merely
   to store a document. Path resolution does not require refreshing GitHub data.

## Placement rules

| Artifact | Location |
| --- | --- |
| General implementation/release plans, cross-PR design notes, long-lived maintainer planning | `<maintainerRoot>/plans/<topic>.md` |
| PR- or branch-Bench-specific plans, review notes, investigation reports, test summaries, and handoffs | Returned `artifacts.targetReportsDir`; normally `<maintainerRoot>/benches/<bench-id>/reports/<topic>.md`. PR association preserves an existing branch Bench's ID/path. |
| Reports or handoffs without an applicable Bench | `<maintainerRoot>/plans/<topic>.md`; never a default checkout-local `tmp/` fallback |
| Documentation explicitly intended for a repository commit | Follow that repository's documentation instructions and existing layout |
| Canonical wiki specifications or approved wiki updates | Follow the relevant wiki skill and repository instructions |
| Generated privileged handoff scripts | Returned `artifacts.generatedScriptsDir`; follow `../maglev-handoff-script/SKILL.md` for generation and validation, never execute merely because a script was generated |
| Prospective GitHub review JSON, triage state, Bench manifests, and runtime files/logs | Use their dedicated maintainer tools; do not manually mutate or move tool-owned artifacts |

The existing general release plan is:

```text
<maintainerRoot>/plans/maglev-release-plan.md
```

With the default configuration, working-document homes include:

```text
/var/lib/maglev-maintainer/plans/
/var/lib/maglev-maintainer/benches/pr-<PR>/reports/
/var/lib/maglev-maintainer/benches/branch-<slug>-<hash>/reports/
```

A general plan remains in `plans/` even if the session happens to run inside a
Bench checkout. A plan solely about that Bench/PR belongs with its reports.
Resolving a report directory does not require starting a Bench. Runtime files
live under `<maintainerRoot>/runtimes/`; metadata, logs, state, and runtime
configuration are tool-owned and must not be overwritten as working documents.

Respect an explicitly requested destination, subject to repository instructions.
Explain any conflict before proceeding. Local plans are not automatically
canonical specs or wiki updates just because they contain design decisions.

## Find, write, and maintain working artifacts

- Search the relevant plans or per-Bench reports directory before creating a new
  document. Read and update an existing matching document rather than making
  competing copies. Use descriptive lowercase kebab-case filenames.
- Use `read` to inspect documents, `edit` for targeted updates, and `write` for
  new documents or complete rewrites. Use bash for directory/file operations.
- Create only the required destination directory. Never stage, commit, push,
  or publish a document unless requested.
- Record the subject and status clearly. For PR reports, include the PR and
  source revision when known; for dated records, use absolute dates.
- When asked to move a document, preserve its contents, check for destination
  conflicts, and move without overwriting another file. Update affected links
  within the requested scope. If the source is tracked, explain the repository
  deletion/change before moving it unless that change was explicitly requested.
- Leave editor swap/lock files and unrelated user changes untouched. If a file
  appears open in an editor, mention that its new path should be reopened.
- Bench lifecycle cleanup may remove per-Bench artifacts. Keep long-lived,
  cross-PR documents in `plans/`; ask before archiving or moving Bench reports
  when closing a Bench. Do not initiate Bench cleanup from this skill.
- Finish with the exact artifact path and a brief summary of what changed.
  Carry forward relevant workspace/path warnings; do not claim a document is
  committed, published, or archived merely because it was written locally.
