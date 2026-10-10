---
name: maglev-handoff-script
description: Generate executable Maglev maintainer scripts for a human to run in an environment with GitHub write access or other privileges unavailable to sandboxed Pi. Use when asked for an issue-creation, review-submission, labeling, or other privileged-operation script; generating a script never authorizes executing the operation.
compatibility: Requires the Maglev Maintainer workspace context tool; generated shell scripts require Bash and their declared runtime dependencies.
---

# Maglev Handoff Script

Pi commonly runs as a sandboxed user with read-only GitHub access. Prepare a
reviewable script for the maintainer's authenticated environment instead of
attempting the privileged operation here. GitHub write access does not imply
OS root access: do not add `sudo`, request tokens, or change authentication.

## Resolve and place

1. Call `maglev_workspace_context` first. Use
   `artifacts.generatedScriptsDir`, or `<maintainerRoot>/scripts` if the running
   extension predates that field. Respect configured roots; do not hard-code
   `/home/pi/scripts`, `/workspace`, or a Bench checkout.
2. Keep generated scripts in that directory, outside source checkouts and
   per-Bench artifacts so Bench cleanup cannot remove them. The package's own
   `scripts/` directory is for shipped helpers, not generated handoffs.
3. Use descriptive lowercase kebab-case names, for example
   `create-maglev-etag-issue.sh` or `submit-maglev-pr-123-review.sh`. Inspect an
   existing destination before replacing it. Do not overwrite unrelated work
   or follow an unexpected symlink; choose a new name or ask when ambiguous.
4. Create the directory if missing. Ensure it and its parent directories are
   traversable by the intended operator. Set each generated shell script to
   mode `0755` (`chmod 0755 <script>`): readable/executable by all users, writable
   only by its owner. Use `0755` for newly created script directories. Do not
   recursively chmod existing directories or make anything world-writable.
5. "Globally executable" means any user can execute the script by absolute
   path, independent of cwd. It does not imply installing a command into every
   user's PATH. Do not alter `/usr/local/bin`, shell profiles, or permissions on
   existing parent directories without explicit authorization. Report access
   limitations rather than escalating privileges.

## Make actions easy to review

The script itself is the reviewable action plan. Prefer the smallest readable
Bash script with direct `gh` CLI calls. For bulk updates, use a simple loop over
literal issue IDs or put each `gh` invocation on its own line. Keep the target,
payload, and order of operations obvious without tracing helper functions.

- Execute the listed operations immediately when the human runs the script.
  Do not add dry-run modes, `--apply`/`--create` gates, argument parsers, or preview
  machinery unless the maintainer explicitly asks for them.
- Avoid embedded Python, generic API wrappers, dynamic target discovery, and
  elaborate preflight/reconciliation frameworks for straightforward operations.
- Use short comments to explain scope, prerequisites, and partial failure.
  A small inline state check is appropriate when needed to preserve a requested
  scope, such as open issues only. Preserve essential workflow safeguards.
- For example, updating 20 issues should normally be a literal list of those
  20 IDs with the relevant `gh` calls directly inside the loop, not a migration
  engine. Use direct API calls only when the CLI lacks the required operation.

## Generate safely

- Use `#!/usr/bin/env bash` and `set -euo pipefail`.
- Include the explicit repository (`--repo OneBusAway/maglev` for `gh` commands,
  or an explicit API repository path) and validated issue/PR IDs. Do not depend
  on the operator's current repository or directory.
- Document required executables and permissions in a short comment and the
  handoff. Use the operator's existing authentication; never embed credentials,
  tokens, or sandbox environment dumps.
- Embed settled text/data safely, using quoted heredocs with noncolliding
  delimiters or properly serialized JSON. Treat issue/review text as data, not
  shell code. Quote paths and arguments; never use `eval`.
- Prefer self-contained scripts. If companion payload files are necessary, put
  them alongside the script, resolve their paths relative to the script itself,
  and make nonsecret payload files readable by the intended operator. Do not
  rely on sandbox-only paths, expiring temporary files, or a source checkout.
- Issue bodies should distinguish verified facts from proposed reproduction
  steps. Never invent findings, claim unexecuted tests passed, or add labels,
  assignees, milestones, or unrelated writes not requested by the maintainer.
- For review submissions, use the dedicated review JSON workflow to package
  already-decided findings first. Include the expected reviewed commit and
  verify the live PR head before submitting; stop on mismatch.
- Explain repeat-run behavior and warn when rerunning can duplicate operations
  or overwrite intervening changes. Do not build an idempotency framework just
  to support reruns, and do not silently retry potentially successful writes.
- Let direct CLI failures stop the script with a nonzero status. Use simple
  `echo` messages or CLI output to show progress. Explain that earlier writes
  remain on failure; do not imply transactionality.

## Validate and hand off

1. Run `bash -n <script>` and inspect the generated contents.
2. Use ShellCheck if available, and report whether it was run. Do not execute
   the generated script: it performs writes immediately. If execution testing is
   useful, use a stubbed `gh` in an isolated local test, never real GitHub writes.
3. Verify mode `0755`, parent-directory traversal permissions, and that targets
   are explicit and independent of cwd. Do not run the script to verify access.
4. Finish with the exact script path, its direct execution command,
   prerequisites, and any repeat-run/partial-failure warning. State explicitly
   that the external operation has not been performed.

An explicit request to generate a script authorizes local artifact creation,
not execution in the sandbox or publication to GitHub. Preserve the safety and
approval requirements of the underlying workflow, especially destructive work.
