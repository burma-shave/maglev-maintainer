---
name: librarian
description: Find, place, and organize Maglev maintainer documents. Use when creating or updating local plans, PR Bench notes, reports, or handoffs, or when asked where a document belongs or to move it out of a source checkout.
compatibility: Requires the Maglev PR Maintainer workspace context tool.
---

# Librarian

Keep maintainer working documents outside source checkouts unless the user
explicitly intends to commit them. Choose a location before writing a document.
Do not turn a request to find or discuss a document into an unsolicited move.

## Resolve the workspace

1. Call `maglev_pr_workspace_context` first. Pass `pr` when the user supplies a
   PR number; otherwise use the returned current PR Bench context if available.
2. Use the returned maintainer root and artifact paths, not hard-coded workspace
   assumptions. The default root is `/var/lib/maglev-pr-maintainer`, but it may
   be configured elsewhere.
3. If a document is PR-specific and no PR can be established, ask for the PR
   number. Do not guess from an unrelated active Bench or start a Bench merely
   to store a document. Path resolution does not require refreshing GitHub data.

## Placement rules

| Document | Location |
| --- | --- |
| General implementation/release plans, cross-PR design notes, long-lived maintainer planning | `<maintainerRoot>/plans/<topic>.md` |
| PR-specific plans, review notes, investigation reports, test summaries, and handoffs | Returned `artifacts.targetReportsDir`, normally `<maintainerRoot>/benches/pr-<PR>/reports/<topic>.md` |
| Documentation explicitly intended for a repository commit | Follow that repository's documentation instructions and existing layout |
| Canonical wiki specifications or approved wiki updates | Follow the relevant wiki skill and repository instructions |
| Prospective GitHub review JSON and triage state | Use their dedicated maintainer tools, not arbitrary Markdown/JSON files |

The existing general release plan is:

```text
<maintainerRoot>/plans/maglev-release-plan.md
```

With the default configuration, the two working-document homes are:

```text
/var/lib/maglev-pr-maintainer/plans/
/var/lib/maglev-pr-maintainer/benches/pr-<PR>/reports/
```

A general plan remains in `plans/` even if the session happens to run inside a
PR checkout. A plan solely about that PR belongs with its Bench reports.
Bench metadata and generated runtime files live elsewhere under the per-PR
Bench directory; do not overwrite tool-owned files such as logs,
state, or runtime configuration.

Respect an explicitly requested destination, subject to repository instructions.
Explain any conflict before proceeding. Local plans are not automatically
canonical specs or wiki updates just because they contain design decisions.

## Find, write, and maintain documents

- Search the relevant plans or per-PR reports directory before creating a new
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
- Bench lifecycle cleanup may remove per-PR artifacts. Keep long-lived,
  cross-PR documents in `plans/`; ask before archiving or moving Bench reports
  when closing a Bench. Do not initiate Bench cleanup from this skill.
- Finish with the exact document path and a brief summary of what changed.
  Carry forward relevant workspace/path warnings; do not claim a document is
  committed, published, or archived merely because it was written locally.
