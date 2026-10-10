---
name: maglev-checkout
compatibility: Requires the Maglev Maintainer extension tools.
description: Resolve or clone the main OneBusAway/maglev source checkout independently of a PR Bench. Use when Maglev source is needed for investigation or development, or the user asks to clone/check out Maglev's default branch, branch, tag, or commit.
---

# Maglev Checkout

1. Call `maglev_pr_workspace_context` first. Its `maglevCheckout.path` is the managed source checkout; do not assume `/workspace/maglev` exists.
2. Call `maglev_pr_checkout` to inspect or plan. It defaults to `<maintainer-root>/checkouts/maglev`, or `$OBA_WORKSPACE/maglev` when set. Pass `path` for an explicitly supplied checkout root.
3. Set `apply: true` only when the user explicitly requests a clone/checkout. Otherwise show the missing-checkout plan and ask permission before cloning. Dry-run does not create directories or access the network.
4. Use the returned path only when `ready: true`. Report revision, branch/detached HEAD, dirty state, and all warnings/errors. `ok: true` with `ready: false` means only a plan, not an available checkout.

## Ref policy

- Omit `ref` to clone the remote default branch. For an existing checkout, omission preserves its current branch/revision; it does **not** imply that checkout is on the default branch or fresh.
- Explicit `ref` accepts a branch, tag, full ref name, or commit SHA. A new clone checks it out at detached HEAD.
- Existing checkouts are inspected read-only, never fetched, pulled, switched, reset, or cleaned—even with `apply: true`.
- A requested ref on an existing checkout must resolve locally to its current HEAD. Otherwise the tool refuses. Ask for a separate `path` to clone that ref, rather than discarding or switching local work.
- Failed clones are not published; only the tool's own temporary staging directory is cleaned up.
- For a specific PR's review environment, use `maglev-pr-bench` instead. This tool does not create a tmux session, start Pi, run tests, or start API services.

Examples:

```json
{}
{"apply":true}
{"ref":"main","path":"/custom/maglev-main","apply":true}
{"ref":"v1.0.0","path":"/custom/maglev-release","apply":true}
```
