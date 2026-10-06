# Maglev Bug Triage Criteria

This file is the authoritative rubric for `maglev-bug-triage`. Read it on every triage. Keep criteria here rather than duplicating the scales in the workflow.

## Verdict

| Verdict | Required evidence |
|---|---|
| **Confirmed** | A safe reproduction demonstrates a defect against established expected behavior, or a conclusive code-path analysis identifies concrete triggering inputs and explains why the implementation violates that behavior. State the affected revision and conditions. |
| **Unconfirmed** | The report is plausible but evidence is incomplete, expected behavior is unresolved, the relevant environment is unavailable, or the suspected code path cannot be established conclusively. |
| **Not a bug** | Positive evidence establishes intended behavior, an unsupported scenario outside the supported contract, or a cause outside Maglev rather than a Maglev defect. Explain that evidence. |

Rules:
- Failure to reproduce is not proof that a report is not a bug.
- Issue labels/state, an existing failing test, or agreement with legacy Java alone do not establish the verdict.
- Invalid input or configuration does not excuse a separate defect in required validation, error handling, or security.
- A bug fixed in a newer revision can still be confirmed for the reported older revision; state where it is fixed if established.
- Duplicate reports may still describe confirmed bugs. Duplication is not a validity verdict.
- Split independent claims when they have different verdicts; do not generalize a partial confirmation to the whole report.

## Severity

Severity measures the bug's impact—not fix urgency, ease of repair, or the component's perceived importance.

| Level | Criteria | Maglev examples |
|---|---|---|
| **S1 — Critical** | Service unusable, major security exposure, or widespread data corruption. | API unavailable across the deployment; authentication bypass granting protected access; GTFS import corrupts active data broadly. |
| **S2 — Major** | Core transit functionality substantially broken, with no reasonable workaround. | Arrivals missing across many stops; service-day handling makes core arrival results unusable; API response incompatibility breaks supported clients' core functionality. |
| **S3 — Moderate** | Limited incorrect behavior; core service remains usable, or a reasonable workaround exists. | Incorrect pagination; a missing optional field with meaningful but limited impact; wrong arrivals under a specific edge condition. |
| **S4 — Minor** | Cosmetic, documentation, or low-impact usability defect. | Typo; confusing error wording without functional impact; harmless formatting inconsistency. |

Assignment rules:
1. Describe the demonstrated or credibly established impact and affected users, requests, endpoints, agencies, or deployments. Distinguish observed scope from inferred scope.
2. Assess frequency and trigger conditions, but do not automatically downgrade a serious security or data-corruption defect just because its trigger is rare.
3. Evaluate whether a workaround is realistic for affected users. Disabling core functionality or requiring ordinary riders to patch a client is not a reasonable workaround.
4. Choose the highest level supported by the evidence, not a hypothetical worst case. When multiple levels seem plausible, explain the boundary and missing evidence.
5. Example labels are illustrative, not automatic mappings: a pagination error causing broad core-service failure is not necessarily S3, and an optional-field omission causing supported clients to crash is not necessarily minor.
6. For **Unconfirmed**, use a **provisional** severity only when potential impact and scope can be meaningfully assessed. Otherwise use **Undetermined**. A confirmed defect can also have undetermined severity if its impact is not yet understood.
7. For **Not a bug**, use **N/A**.

## Fix effort

Effort measures the work to deliver a tested fix, independently of severity and priority. Include necessary investigation, implementation, regression tests, integration validation, and rollout/migration work. Do not count queue time, staffing availability, or release urgency as engineering effort.

| Effort | Criteria | Typical shape |
|---|---|---|
| **Low** | Localized, understood change with straightforward testing and little integration risk. | Fix a well-isolated handler condition or mapping and validate it with a focused regression case. |
| **Medium** | Multiple code paths/components, meaningful remaining investigation, or nontrivial integration testing; no broad redesign. | Adjust shared service-date handling across several endpoints and test timezone/calendar boundaries. |
| **High** | Architectural changes, migrations, cross-system coordination, or substantial implementation/testing complexity. | Redesign feed ingestion or shared identity handling with data migration and broad compatibility validation. |

Assignment rules:
- Base the estimate on the likely fix scope established by investigation. Explain affected components, testing needs, and assumptions.
- A small patch can require High effort if safe validation or migration is substantial. A Critical bug can require Low effort.
- Unknown root cause alone does not justify High effort. Use **Not yet estimable** when the evidence cannot support a useful estimate.
- For **Unconfirmed**, label an assessable estimate **provisional**, conditional on the suspected defect being established.
- For **Not a bug**, use **N/A** rather than estimating work for an unrelated feature request or external repair.
- Do not imply fixed hour/day commitments from these categories.

### Estimate confidence

Report confidence separately from effort size:
- **High:** Cause, change boundaries, and validation requirements are well understood.
- **Medium:** A likely cause and fix scope are identified, but material assumptions remain.
- **Low:** An estimate is possible but relies on substantial unverified assumptions.
- **N/A:** Effort is not yet estimable or there is no Maglev defect to fix.
