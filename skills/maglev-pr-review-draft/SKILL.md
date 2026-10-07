---
name: maglev-pr-review-draft
compatibility: Requires the Maglev PR Maintainer extension tools and GitHub read access for draft validation.
description: Create, revise, inspect, or clear prospective Maglev PR review JSON from already-settled findings using the review JSON tools. Use automatically whenever settled actionable PR review findings emerge in any context, or when discussing a saved draft; never submits to GitHub or performs a new code review.
---

# Maglev PR review draft

This skill packages an already-decided review. Whenever settled actionable PR review findings emerge in any context, invoke this skill and save a prospective draft without waiting for a separate request. There is no review-only mode: drafts are the useful output of reviews. Report the saved path and event, or the concrete blocker to saving; findings without a saved draft are not a completed handoff. Findings can come from Claude Code, API/spec reviews, manual investigation, or the maintainer. Do not invent findings, run a new review, or treat raw unvalidated reviewer output as settled evidence. If findings or the desired outcome are missing/ambiguous, ask for them or hand back to the relevant review workflow.

## Workflow

1. Resolve the PR number and call `maglev_pr_workspace_context` with `pr`. Use returned artifact paths. A draft does not require a running Bench and does not authorize opening one.
2. When discussing or revising an existing draft, use `maglev_pr_review_json_list` to locate it, then `maglev_pr_review_json_load`. Merely viewing or discussing a draft does not change it; newly settled findings automatically invoke the save flow. For creation, check for an existing draft as well; preserve settled comments unless the requested replacement deliberately supersedes them. The writer overwrites the one current draft for that PR.
3. Establish the settled review event and findings:
   - `REQUEST_CHANGES` for blocking findings.
   - `COMMENT` for non-blocking review notes.
   - `APPROVE` only when approval is explicitly settled; no findings alone is not approval.
   If the settled outcome is no prospective review, use `maglev_pr_review_json_clear` rather than creating an empty/comment-only placeholder or an automatic approval. Do not clear a saved draft merely because a review failed or its output was incomplete.
4. For Claude Code reviews, assume findings apply to the PR it reviewed; do not require a reviewed SHA or perform additional SHA checks before drafting. For other supplied findings explicitly referring to an older revision, check their continued applicability or return them for focused validation; do not silently attach stale findings to a new commit. The writer reads the live GitHub head and diff, so do not call it when live GitHub reads are prohibited. Report the limitation instead.
5. Compose a concise PR-facing summary body and actionable comments. Each finding should explain the problem, impact/trigger, relevant evidence, and requested change. Include validation limitations only when they materially qualify a finding. Exclude temporary-file cleanup, checkout cleanliness, local artifact/log paths, agent/tool workflow, and assurances that nothing was committed or submitted. Keep those details in the conversation or maintainer notes; never paste the internal report wholesale into the draft.
6. Call `maglev_pr_review_json` with `pr`, `repo: "OneBusAway/maglev"`, `event`, `body`, and optional `comments`. Inline comments use repository-relative `path`, positive `line`, `side: "RIGHT"` for new lines or `"LEFT"` for old lines, and `body`. Use only accurate commentable diff locations; put broader findings in the top-level body. The tool validates locations, not the truth of findings. If validation fails, inspect and correct the location or move a genuinely broader finding to the summary; never fabricate an anchor just to pass validation.
7. Check the tool result, including the saved commit, event, comment count, and `outputPath`. Do not add a SHA-confirmation gate for Claude Code findings. For other findings known to refer to an older revision, flag the draft as needing revalidation before use; do not claim it is ready. Report the artifact path and outcome concisely.

## Boundaries

- Write/overwrite prospective review JSON only through `maglev_pr_review_json`; never use shell redirection, `write`, or `edit` for the artifact. Clear only through `maglev_pr_review_json_clear`.
- This is a local prospective draft, not a submitted review. Never call GitHub write APIs or execute a submission script in this workflow.
- Use `maglev-pr-code-review` for a separately requested Claude Code review. The explicit Bench kickoff composes that skill followed by this one; neither skill starts automatically with a Bench.
