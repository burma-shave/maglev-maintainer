# Proposal

## Why

The attention queue can miss changed PR heads when commit dates precede a saved decision, and decision writes can attribute earlier reasoning to newer snapshot facts. Recording a failed analysis can also make an unchanged recommendation appear freshly evaluated, undermining trust in the queue.

## What Changes

- Detect differences between known evaluated and current head SHAs independently of commit dates.
- Evaluate discussion freshness against discussion evidence actually considered, not the last decision-file write time.
- Preserve explicitly supplied evaluation basis without substituting current snapshot values; represent missing attribution as unknown.
- Retain results evaluated against older facts and expose them as superseded rather than rejecting or relabeling them.
- Distinguish recommendation updates from record-only analysis writes so failed/incomplete attempts cannot refresh the existing recommendation.
- Expose current, superseded, and unknown attribution consistently through queue/discovery/state-query clients and add deterministic regression tests.
- Keep analysis observations in the existing decision store; do not introduce a structured analysis-history redesign.

## Capabilities

### New Capabilities

- `triage-freshness`: Evidence-based applicability of PR next-action recommendations, including SHA/discussion comparison, truthful evaluation attribution, and record-only writes.

### Modified Capabilities

None. The project currently has no durable OpenSpec capability specs; this change introduces a specification for the existing triage behavior being corrected.

## Impact

Affected areas include `extensions/triage.ts`, `decisions.ts`, `types.ts`, `schemas.ts`, GitHub discussion normalization, decision normalization/storage, queue/state-query/tool-result adapters, and the triage/analysis-record skills. Existing state needs conservative handling of missing discussion evidence; no new service or dependency is required. Mutation intent and freshness fields are additive, but consumers must not interpret a recent `decidedAt` as proof of evaluated coverage.

Out of scope: CI/merge-readiness freshness, collecting review threads, atomic structured analysis history, Bench reset/cleanup changes, Claude execution isolation, new interactive queue UI, and post-review SHA gates for Claude completion or draft creation.
