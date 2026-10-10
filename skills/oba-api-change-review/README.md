# OBA API review skills

Maglev Maintainer-packaged skills for reviewing changes to the Maglev OBA REST API:

| Skill | Purpose |
|---|---|
| `oba-api-change-review` | Entry point. Figures out which of the other checks apply and runs them. |
| `oba-api-goal-check` | Checks whether a change fully accomplishes a stated goal, including test coverage. |
| `oba-api-client-impact` | Checks whether a change affects Wayfinder + the JS SDK, iOS, or Android. |
| `oba-api-spec-check` | Checks a change against the endpoint's `maglev.wiki` spec and deviation records. |
| `oba-api-pr-spec-review` | Full PR/spec-maintenance workflow with `SD-*` decisions and handoff files. |
| `oba-wiki-spec-update` | Applies approved wiki updates from a handoff; never pushes. |

Usually you only need `oba-api-change-review` for focused review or `oba-api-pr-spec-review` for full spec-maintenance decisions.

## Maglev Maintainer integration

These package-local skills should call `maglev_workspace_context` at the start of a workflow. If a PR number is known, pass it as `pr`. Use the returned PR Bench and artifact paths instead of assuming a fixed `/workspace` layout or repo-local `tmp` output directory.

Generated reports and handoffs should prefer `artifacts.targetReportsDir`, normally:

```text
/var/lib/maglev-maintainer/benches/pr-<PR>/reports
```

For an unassociated branch Bench, pass `benchId` or use detected current Bench
context and use its returned `artifacts.targetReportsDir`. PR association preserves
that directory. With no applicable Bench, use `<maintainerRoot>/plans/` for saved
reports/handoffs. Follow `maglev-artifacts`, respect explicit output destinations, and do
not default to checkout-local `tmp/` or start a Bench solely for storage.

Review production and draft packaging are independent: settled findings from
these API reviews can feed `maglev-pr-review-draft` when a draft is requested.
That skill writes through `maglev_pr_review_draft_save`; no GitHub review is submitted.
For a separately requested publication script, use `privileged-handoff-script`.

## Companion repos

Client/spec/Java checks resolve companion repos through `maglev_companion_repos_resolve` or the packaged `oba-workspace` skill. By default checkouts live under:

```text
/var/lib/maglev-maintainer/companion-repos
```

Set `$OBA_WORKSPACE` only when you intentionally want to use another directory.

Reference-only repos (`wayfinder`, `js-sdk`, `onebusaway-ios`, `onebusaway-android`, `onebusaway-application-modules` / `oba-java`) may be cloned or fast-forwarded when clean on `main`/`master`. Editable `maglev.wiki` is cloned on first use but not pulled automatically after that. Any resolver warnings or notes should be included as caveats in review reports.

## Usage examples

```text
/skill:oba-api-change-review 123
/skill:oba-api-change-review fix/route-ids-paging
/skill:oba-api-change-review
/skill:oba-api-change-review "remove situationIds from stops-for-route"
/skill:oba-api-change-review 123 --output
/skill:oba-api-pr-spec-review 123
```
