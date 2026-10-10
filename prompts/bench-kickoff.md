Review PR #{{prNumber}} for OneBusAway/maglev using the PR Bench checkout at `{{benchPath}}`.

This is a review-only kickoff pass: do not implement fixes or change production code. Do not commit, push, install dependencies, or run formatters. Runtime validation is allowed, including running existing tests and creating temporary test-only files, fixtures, or diagnostic harnesses to reproduce findings. Inspect the checkout state first, preserve all pre-existing changes, and remove only your temporary validation changes afterward. Report the tests run, their results, and any validation changes that could not be cleaned up safely. Package prospective PR review findings only via the `maglev_pr_review_json` tool in the centralized Maglev Maintainer review JSON directory; never write review JSON with shell redirection, `write`, or `edit`.

Explicit combined review workflow:
- This kickoff composes the standalone `maglev-pr-code-review` and `maglev-pr-review-draft` skills. Read both skills through Pi's available skill locations before proceeding. It is not run automatically when a Bench starts or recovers.
- Follow `maglev-pr-code-review` first: inspect the checkout, run the review, and validate findings. Then follow `maglev-pr-review-draft` to package settled actionable findings. This explicit kickoff requests both phases; a standalone code-review request does not authorize draft creation.
- Use the `maglev_pr_code_review` tool for PR #{{prNumber}} with `workingDirectory` set to `{{benchPath}}`.
- Do not invoke Claude Code directly, invoke the `claude-code-pr-review` skill, or perform a separate manual Pi review unless the tool fails. After the delegated review completes, focused code inspection and runtime tests to validate its findings are allowed; this is not a separate initial review.
- Validate concrete findings where feasible before packaging them, using runtime reproductions when practical. If validation is blocked or incomplete, state why and distinguish code-inspection evidence from runtime confirmation.
- After Claude Code exits and any focused validation completes, summarize the results concisely for the maintainer, including blocking errors if any.
- If Claude Code identifies concrete actionable findings suitable for PR review comments, package those findings with `maglev_pr_review_json` before the final summary. If the settled outcome is no prospective review, use `maglev_pr_review_json_clear`; do not automatically approve. A failed or incomplete review does not justify clearing an existing draft. Do not submit a GitHub review.

Goal:
- Delegate the initial review to Claude Code now; do not implement fixes.
- Preserve Claude Code's concrete issues, questions, risks, and likely follow-up checks.
- When summarizing, account for the PR context and existing PR comments/reviews below when it is useful.
- Store settled actionable findings as prospective PR review JSON with `maglev_pr_review_json`, using `REQUEST_CHANGES` for blocking findings and `COMMENT` for non-blocking review notes. Include only findings with validated diff locations as inline comments; put broader context in the top-level body.
- Keep the review JSON top-level body and inline comments PR-facing: actionable findings, impact, relevant reproduction evidence, and requested changes. Exclude internal housekeeping such as temporary-file cleanup, checkout cleanliness, local artifact/log paths, agent/tool workflow, and assurances that nothing was committed or submitted. Report these only in the conversation or maintainer notes. Include validation limitations only when they materially qualify a finding; do not paste the internal review report wholesale into the draft.
- Stop after producing concise review notes and any review JSON artifact path; do not implement fixes.

PR context:
- Title: {{title}}
- Author: {{author}}
- URL: {{url}}
- Base: {{baseRef}}
- Head: {{headRef}}
- Draft: {{draft}}
- Review decision: {{reviewDecision}}
- Merge state: {{mergeState}}
- Bad checks: {{badChecks}}
- Meaningful updated at: {{meaningfulUpdatedAt}}
- Snapshot head: {{headOid}}
{{stackMetadata}}
Triage decision:
- Bucket: {{decisionBucket}}
- Priority: {{decisionPriority}}
- Reason: {{decisionReason}}
- Observations:
{{decisionObservations}}

Recent activity:
- Last commit: {{lastCommit}}
- Last human review: {{lastHumanReview}}
- Last change request: {{lastChangeRequest}}
- Last human comment: {{lastHumanComment}}
- Last maintainer chase: {{lastChase}}

Existing PR reviews to account for:
{{existingReviews}}

Existing PR comments to account for:
{{existingComments}}

When summarizing the Claude Code review, call out which prior feedback appears addressed, which appears still unaddressed, and which is unclear from the current code when that can be determined.

Changed files:
{{changedFiles}}
{{handoffSection}}
Please run the `maglev_pr_code_review` tool now, store any settled actionable findings with `maglev_pr_review_json`, and produce concise review notes from its output and any focused validation. Focus on actual observations and potential review findings, not a plan for a future review.
