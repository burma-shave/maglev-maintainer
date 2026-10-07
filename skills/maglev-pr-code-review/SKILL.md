---
name: maglev-pr-code-review
compatibility: Requires the Maglev PR Maintainer extension tools and an authenticated Claude Code CLI with /code-review available.
description: Run a Claude Code review of a Maglev PR from an existing checkout, validate its findings, and report results. Use when asked for a Claude Code PR review; does not create a review draft unless separately requested.
---

# Maglev PR code review

This skill owns review and focused validation, not Bench lifecycle or draft creation. A review request does not authorize starting/resetting a Bench, implementing fixes, or submitting a GitHub review.

## Workflow

1. Resolve the PR number and call `maglev_pr_workspace_context` with `pr`. Use the returned checkout/artifact paths, not hard-coded paths. Inspect the existing PR Bench with `maglev_pr_bench_inspect`; an associated branch Bench keeps its original identity and checkout. If the user supplies another checkout, verify its repository and revision. If no usable checkout exists, report the blocker; use `maglev-pr-bench` only when explicitly asked to open one.
2. Before relying on snapshot PR facts, call `maglev_pr_snapshot_staleness` and refresh when `shouldRefresh` is true, unless live GitHub calls are prohibited. Load only this PR with `maglev_pr_load_metadata` when context/prior feedback is needed. Inspect Git HEAD and checkout state before reviewing; preserve pre-existing dirty and ignored files. Report head mismatches and do not silently reset or review a different revision as the current PR.
3. Call `maglev_pr_code_review` with `pr` and explicit `workingDirectory` set to the checkout root. The default timeout is 1200 seconds; `timeoutSeconds` may be set up to 3600. Do not invoke Claude Code directly or the old `claude-code-pr-review` skill. Do not conduct a separate initial manual Pi review unless the tool fails; disclose any fallback and its limitations.
4. Inspect the returned status, output, and `logPath`. Read the full log when output is truncated or needed to assess findings. A failed, timed-out, or incomplete run is not a clean review. Report blockers rather than inventing findings or claiming completion.
5. Validate concrete findings with focused code inspection and existing tests/runtime reproductions where feasible. Distinguish code-inspection evidence from runtime confirmation; state any validation limitation. Do not implement fixes, modify production code, commit, push, install dependencies, or run formatters. Temporary test-only files/fixtures/harnesses are allowed; remove only your own validation changes afterward and report anything that cannot be safely cleaned up. Starting services still requires explicit authorization.
6. Report settled findings, rejected/unconfirmed candidates, tests/results, blockers, reviewed revision, and the full log path concisely. Account for prior PR feedback where relevant: addressed, unaddressed, or unclear. For each settled finding preserve impact, evidence, requested change, blocking/non-blocking assessment, and candidate diff location (path, line, side) if known.

## Handoff

Stop after reporting by default; do not create, overwrite, or clear prospective review JSON from a review-only request. Do not equate no findings with approval.

When the user requests both review and a draft, or explicitly invokes the combined Bench kickoff, read `../maglev-pr-review-draft/SKILL.md` and pass the settled findings, PR number, reviewed head SHA, validation evidence/limitations, and proposed event. The draft skill accepts findings from any review source; it must not rerun this review merely to package them.
