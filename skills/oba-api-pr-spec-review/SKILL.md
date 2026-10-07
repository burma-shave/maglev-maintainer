---
name: oba-api-pr-spec-review
description: Full Maglev PR workflow for OBA API/spec conformance and spec maintenance. Use for PRs needing SD-* deviation decisions, wiki update handoffs, or actionable PR comment handoffs. For a focused behavior/client/spec audit, use oba-api-change-review.
---

# OBA API PR Spec Review

Use this skill to review a Maglev pull request for OBA API / legacy Java / wiki spec conformance only. This is **not** a general code review skill.

Use this when you need the full PR/spec-maintenance process: confirm the true PR diff, gather PR comments, run/reuse `oba-api-change-review`, enumerate spec-deviation decisions with stable `SD-*` IDs, walk the user through those decisions, and write wiki/actionable-comment handoff files. For a smaller standalone behavior review, use `oba-api-change-review`.

This packaged version is integrated with Maglev PR Maintainer. At the start, call `maglev_pr_workspace_context`; if a PR number is known, pass it as `pr`. Prefer the returned `artifacts.targetReportsDir` for generated review reports and handoff files. Resolve companion repos through `maglev_pr_companion_repos` / packaged `oba-workspace`, not shell resolver scripts or hard-coded `/workspace` paths.

## Wiki specs quick reference

- Endpoint index: `maglev.wiki/OBA-API-Specs.md`
- Endpoint pages: `maglev.wiki/<endpoint>.md` using hyphenated endpoint names, e.g. `arrivals-and-departures-for-stop.md`
- Read the index before assuming a page mapping; some endpoint variants intentionally reference multiple pages.
- Deviation and defect context lives in endpoint-page **Suspected Defects** and **Implementation Decisions** sections, plus shared pages such as `OBA-API-Defect-Workshop.md` and `Multi-Agency-Static-Feeds-Stop-Consolidation.md`.
- For quick spec lookup without the PR workflow, use `oba-api-spec-finder`.

## Operating rules

- Do not push to any repo, including companion repos such as `maglev.wiki`.
- Scope `SD-*` issues to the PR's true diff unless explicitly noting a pre-existing spec deviation.
- Explain code and transit concepts for a reader unfamiliar with the code under review.
- Gather all PR comments before classification; do not filter comments during collection.
- Enumerate candidate/confirmed spec deviation issues with stable two-digit IDs (`SD-01`, `SD-02`, etc.) so the user can resolve them one-by-one.
- Keep IDs stable during the session. If an item is reclassified, update its classification/status but do not renumber later items.
- Treat spec maintenance as the primary output. PR comments are secondary and mainly used to determine whether a spec issue was already raised or addressed in the PR.
- Stop for user decisions before writing handoff files that request wiki updates or PR comments.

## Inputs

Usually invoked from a Maglev checkout or PR Bench checkout on a branch associated with a PR:

```text
/skill:oba-api-pr-spec-review
```

Optional argument: PR number or branch description. Prefer the current branch PR if no argument is supplied.

## Phase 0: Confirm PR and true diff

0. Load Maglev PR Maintainer context. If an explicit PR number was provided, call `maglev_pr_workspace_context` with that PR. If not, call it with no arguments, infer the PR from the current branch/PR Bench if possible, then call it again with the confirmed PR once known. Record `artifacts.targetReportsDir`; this is the preferred output directory for this workflow.

1. Confirm the PR:

```bash
gh pr view --repo OneBusAway/maglev --json number,title,body,headRefName,headRefOid,baseRefName,author,url
```

If a PR number was provided, pass it to `gh pr view`.

2. Compare local HEAD to the PR's pushed head:

```bash
git rev-parse HEAD
```

Report whether local `HEAD` matches `headRefOid`. If it differs, note that local commits may be unpushed or the branch may be stale.

3. Fetch/confirm the PR base ref as needed, then inspect the true PR diff using triple-dot. Use the `baseRefName` from `gh pr view` rather than assuming `main`:

```bash
git fetch origin <baseRefName>
git diff --name-only origin/<baseRefName>...HEAD
git diff origin/<baseRefName>...HEAD
```

Use `origin/<baseRefName>...HEAD`, not `branch..HEAD`, because long-lived branches can contain merge-from-base commits. If local `HEAD` differs from the PR `headRefOid`, note the caveat and use `gh pr diff <PR> --repo OneBusAway/maglev` for the authoritative pushed PR diff.

## Phase 1: Gather review inputs

### 1. Resolve reference repos needed for Java behavior

Resolve the legacy Java repo before evaluating Java behavior using `maglev_pr_companion_repos` directly or the packaged skill:

```text
/skill:oba-workspace oba-java
```

`oba-java` is an alias for `onebusaway-application-modules` and is treated as a reference-only repo, so the resolver fast-forwards it when safe. Include any resolver caveats in the final report. If an issue requires checking client impact and the API change review did not already do that, resolve the client repos through `maglev_pr_companion_repos` / packaged `oba-workspace` before running `oba-api-client-impact`.

### 2. Run OBA API review

Use the packaged `oba-api-change-review` skill. Follow `../librarian/SKILL.md`: save the report under `<artifacts.targetReportsDir>/oba-api-change-review-pr-<PR>.md` for the selected PR/Bench; an associated branch Bench retains its original reports path. If no applicable target directory is available, use `<maintainerRoot>/plans/oba-api-change-review-pr-<PR>.md`. Respect explicitly requested destinations; do not default to checkout-local `tmp/` or start a Bench solely for report storage.

If invoking manually, use an output flag equivalent to:

```text
/skill:oba-api-change-review <PR> --output <chosen-report-path>
```

Use the resulting report as an input; do not treat every claim as true without confirmation.

### 3. Gather all PR comments and reviews

Collect all available PR review material verbatim, including human reviewers, CodeRabbit, SonarQubeCloud, issue comments, review summaries, inline review comments, and review threads.

Start with:

```bash
gh pr view <PR> --repo OneBusAway/maglev --json comments,reviews
```

Also attempt to gather inline review comments / threads. Use `gh api` or GraphQL as needed. Preserve enough information to cite each comment later: author, URL if available, file path, line, body, and resolved/outdated state if available.

Do **not** filter comments during collection.

When reconciling comments, focus on:

- whether the comment identifies a spec-deviation issue
- whether the latest PR diff already addresses the comment
- whether the comment is outdated because the code changed
- whether it affects the wiki/spec decision

Do not turn general code-quality comments into review findings unless they affect an OBA API/spec deviation.

### 4. Read the PR diff directly

Review the production behavior affected by the diff, focusing only on OBA API/spec behavior:

- endpoint response shape and field names
- parameter parsing, defaults, validation, ignored parameters, filters, limits, sorting
- error responses and status codes
- reference lists and response wrappers
- GTFS time/date behavior
- single-feed vs legacy federation behavior
- database queries that change endpoint behavior
- test changes that imply or assert API behavior

## Phase 2: Enumerate spec deviation issues

Assign stable IDs only to **candidate or confirmed spec deviation issues**: places where Maglev, legacy Java, the OpenAPI contract, or `maglev.wiki` may disagree, or where the PR may need to choose between conformance and documenting a deliberate deviation.

Use this prefix:

```text
SD-01  Spec deviation issue, candidate deviation, or deviation-handling decision
```

Do not create separate IDs for every PR review comment. Map PR comments to the `SD-*` issue they support, or list them in a short comments-reviewed appendix. Do not assign stable IDs to false positives, general code-quality issues, or clearly out-of-scope comments.

Use two digits. If more than 99 items occur, continue naturally with `SD-100` rather than renumbering.

If an issue is reclassified, keep its original `SD-*` ID and update `Current classification`; do not create a duplicate unless there are truly separate deviation issues.

### Spec-deviation issue format

Each `SD-*` item must be detailed enough for a user who is not familiar with the code, endpoint, or GTFS concepts to discuss the decision. Avoid assuming the summary table is enough to decide.

Use this format:

```markdown
### SD-01 — <short title>

Status: pending user decision
Current classification: candidate spec deviation / confirmed spec deviation / spec correction needed / no deviation after investigation
Endpoint(s):
- `/api/where/...`

#### Plain-English summary
Explain the issue in ordinary language. Include what the endpoint is for, what parameter/field/function is involved, and why a client or spec reader would care.

#### Background needed to understand this
Briefly explain relevant GTFS or OBA concepts. Examples: service dates, trips, stops, routes, blocks, agencies, feed federation, stop consolidation, GTFS-RT vs static GTFS. Only include concepts needed for this issue.

#### What changed or is under review
Describe the PR change and cite the Maglev files/functions/queries involved. Explain the role of important parameters or functions.

#### Java behavior
Describe what legacy Java actually does, with source citations from the resolved `oba-java` / `onebusaway-application-modules` repo when known. If the Java source location is not found or behavior remains ambiguous, say so explicitly rather than treating the wiki as proof of Java behavior.

#### Maglev behavior
Describe what Maglev does on this branch. Distinguish current PR behavior from pre-existing Maglev behavior.

#### Spec/wiki state
Describe what `maglev.wiki` or OpenAPI currently says and whether it matches Java, Maglev, both, or neither.

#### PR comment status
List related PR comments, if any, and whether each appears addressed by the latest diff, still open, outdated, or unrelated to this spec decision.

#### Client impact
Summarize client impact from `oba-api-change-review` or `oba-api-client-impact`; run/reuse client impact if needed.

#### Decision to make
State the concrete decision in one or two sentences.
Options:
1. Request PR change to match Java/spec
2. Accept and document Maglev deviation
3. Correct the wiki/spec because it inaccurately describes Java
4. Investigate further
5. No action
```

For out-of-scope or false-positive comments, do not include them in the decision list. Summarize them briefly in a separate `PR comments checked for addressed status` appendix, without stable IDs.

### Client impact

For every spec deviation, include client impact. If `oba-api-change-review` already includes `oba-api-client-impact`, reuse it. If not, use the `oba-api-client-impact` skill for the affected endpoint/behavior.

## Phase 3: Work through spec decisions one-by-one

A compact summary table is okay for orientation, but do not ask the user to decide from the table alone.

First present a short summary table with only spec-deviation issues:

```markdown
| ID | Short title | Why it matters |
|----|-------------|----------------|
| SD-01 | <short title> | <one-sentence consequence> |
| SD-02 | <short title> | <one-sentence consequence> |
```

Then work through the `SD-*` issues one at a time. For the first unresolved issue, present the full spec-deviation issue format from Phase 2, then ask for that issue's decision only.

Example prompt:

```text
Let's decide SD-01 first. Options: document, request-change, correct-spec, investigate, no-action.
What should happen for SD-01?
```

After the user decides SD-01, record it in the decision log and move to SD-02. Do not batch multiple decisions unless the user explicitly asks to decide several IDs at once.

Do not include informational, mapped, false-positive, or out-of-scope PR comments in the decision list. After the spec decisions, include a brief appendix if useful:

```markdown
## PR comments checked for addressed status

- CodeRabbit recursive scan concern: relates to SD-01; still present in latest diff / addressed by commit <sha> / outdated because code moved.
- SonarQube quality gate: no OBA API/spec effect found; not part of this spec-maintenance review.
```

Do not update the wiki and do not prepare final PR comment handoffs until the user confirms decisions.

## Phase 4: Decision log

After user decisions, maintain a decision log:

```markdown
## Decision Log

- SD-01: document in wiki.
- SD-02: request PR author to conform to Java behavior.
- SD-03: no action after investigation.
```

If a decision changes a classification, keep the original ID and record the new classification/status.

## Phase 5: Write handoff files

Create the chosen handoff directory if needed. Follow `../librarian/SKILL.md`: use `artifacts.targetReportsDir` from `maglev_pr_workspace_context` for the applicable PR or branch Bench; if unavailable, use `<maintainerRoot>/plans/`. Preserve an explicitly requested destination. Never default handoffs to checkout-local `tmp/`.

### Wiki spec update handoff

For decisions that require wiki documentation, write:

```text
<handoff-dir>/pr-<PR>-wiki-spec-updates.md
```

Use this structure:

```markdown
# OBA Wiki Spec Updates

Source PR: <PR>
Repo: OneBusAway/maglev
PR URL: <url>

## SD-01 — <title>

Type: accepted-maglev-deviation | spec-correction | legacy-java-defect | federation-note | other
Endpoint/spec page: <page if known>
Related page(s): <pages if known>
Federation/single-feed related: yes/no
Legacy defect: yes/no

### Java behavior
<include source citations>

### Maglev behavior / decision
<what Maglev does and what the user decided>

### Rationale and trade-offs
<why this is accepted or documented>

### Client impact
<impact summary>

### Required wiki changes
- <main prose changes>
- <Implementation Decisions entry>
- <pointers to add>
- <multi-agency section 10 update, if applicable>
```

Tell the user to run:

```text
/skill:oba-wiki-spec-update <handoff-dir>/pr-<PR>-wiki-spec-updates.md
```

### Actionable PR comments handoff

This is secondary to spec maintenance. Only write a PR-comments handoff if, after discussing an `SD-*` issue, the user decides that the PR should be changed (`request-change`) or that a code-side clarification is required.

For those decisions, write:

```text
<handoff-dir>/pr-<PR>-actionable-comments.md
```

Only include comments that require action in the PR. Do not include informational-only, tracking-only, already-addressed, out-of-scope, false-positive, or purely pre-existing items.

Use this structure:

````markdown
# Actionable PR Review Comments

Source PR: <PR>
Repo: OneBusAway/maglev
PR URL: <url>
Review mode: REQUEST_CHANGES

## SD-02 — <title>

Path: internal/restapi/example.go
Line: 123
Side: RIGHT

```text
<actionable review comment explaining what must change and why>
```

## SD-03 — <title>

Path:
Line:
Side:

```text
<general PR-level actionable comment if no safe inline location exists>
```
````

For a requested prospective review draft, pass these settled comments, the reviewed
head SHA, and validation evidence to the packaged draft skill:

```text
/skill:maglev-pr-review-draft <PR> <handoff-dir>/pr-<PR>-actionable-comments.md
```

That skill uses `maglev_pr_review_json` to validate diff locations and save the
centralized draft; it does not publish. If the maintainer separately requests a
publication script, use `privileged-handoff-script` with that saved draft. Preserve
user approval before publication; creating either artifact never authorizes
executing a GitHub write.

## Final response

End with:

- PR identity and diff caveats
- path to OBA API review report
- decision log
- path to wiki handoff file, if any
- path to actionable comments handoff file, if any request-change decisions require PR feedback
- `SD-*` IDs with no action and why
- PR comments that were checked and found already addressed, outdated, or irrelevant to spec maintenance
