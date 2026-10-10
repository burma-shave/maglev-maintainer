# Design

## Context

See `proposal.md` for motivation and `specs/triage-freshness/spec.md` for the behavior contract. A design is warranted because evaluation attribution crosses normalization, storage, freshness calculation, client output, and skill policy.

Observed implementation:

- `computeNeedsInference` in `extensions/triage.ts` compares meaningful activity and commit dates with `decidedAt`; a changed SHA is insufficient by itself.
- `saveDecision` in `extensions/decisions.ts` stamps every upsert with a new `decidedAt` and overwrites caller basis using the latest snapshot.
- `SnapshotPR.meaningfulUpdatedAt` combines commit activity with collected human comments/review summaries. It cannot independently describe discussion evidence.
- `DecisionBasis` has snapshot time, meaningful activity time, and head SHA. `normalizeDecision`, parameter schemas, tool-result formatters, and state queries need to preserve any additions.
- Queue construction and needs-inference selection already share a deterministic calculation. The queue removes stale recommendations from their ordinary bucket; no new interactive UI is necessary to surface applicability.
- Failed-analysis history is currently recorded by repeating the existing recommendation in an ordinary upsert. Cross-process locking covers each mutation but not an agent's preceding read/merge sequence.

## Goals / Non-Goals

**Goals:**

- Centralize applicability computation so clients agree about why reassessment is required.
- Keep provenance immutable with respect to ambient snapshot changes.
- Separate record-only writes from recommendation evaluation with an additive API change.
- Read legacy state conservatively without destructive migration or a new state file.

**Non-Goals:**

- Parse free-form analysis observations to infer recommendation completion or coverage.
- Redesign structured/atomic analysis history or solve every same-PR concurrent-write conflict.
- Guarantee live GitHub freshness beyond the inspected snapshot, or expand collection to inline threads.
- Add a post-review SHA confirmation gate to Claude completion or review-draft creation.
- See the proposal for the remaining workflow exclusions.

## Decisions

### 1. Derive applicability; do not persist a second mutable freshness flag

Introduce a pure assessment shared by needs-inference, queue, and state-query clients. It returns `current`, `superseded`, or `unknown`, plus reasons and per-dimension evidence.

- Known head mismatch => superseded regardless of commit dates.
- Known discussion evidence mismatch => superseded.
- Missing/invalid evidence => unknown unless a known mismatch already proves supersession.
- Matching known head and discussion evidence => current.
- No decision, invalid bucket, or invalid evaluation timestamp still requires inference.

Snapshot age remains a separate acquisition warning. A later fetch timestamp alone does not supersede an otherwise matching recommendation. Current means applicable to captured code/discussion facts, not reviewed/approved/mergeable.

Alternative: persist `stale` on every write. Rejected because the flag immediately becomes obsolete after another refresh and adds competing state.

### 2. Add a distinct human-discussion watermark

Add optional `discussionUpdatedAt` to snapshot PRs and decision basis. Compute the snapshot value from the latest currently collected non-bot comment/review timestamp, using PR creation time when the captured discussion is empty. Do not include commit dates, checks, or bot/status activity. Reuse the existing bot classification rather than changing it in this change.

For older snapshots, derive the current-side watermark from their existing comments/reviews and creation time. Do not fabricate the evaluated-side watermark for old decisions from current facts. Such decisions remain unknown until explicitly reevaluated. Keep `meaningfulUpdatedAt` for existing sorting/display consumers, but do not use it or `decidedAt` as the new discussion comparison cutoff.

Use equality of valid evaluated/current watermarks to establish matching discussion evidence; a changed watermark requires reassessment even if the timestamp moved backwards. This treats disappearance of the latest collected event conservatively.

Alternative: fingerprint every thread/comment body. Deferred because this first change uses the existing collection surface. Same-timestamp edits and uncollected threads remain explicit validation limits, not clean coverage guarantees.

### 3. Explicit basis is authoritative; omission is not consent to reattribute

On recommendation update:

- Explicit basis is retained as supplied, including partial attribution. Missing fields remain unknown; never fill from the current snapshot.
- Omitted basis preserves an existing decision's basis; a new decision has unknown basis.
- The calling triage workflow captures its actual head/discussion/snapshot basis and supplies it after successful evaluation.
- The writer may compare that basis with the latest stored snapshot to return applicability, but comparison never rewrites provenance or rejects a superseded result solely for being older.

`decidedAt` remains the recommendation evaluation/save timestamp for compatibility, but applicability is evidence-based and does not become current because the timestamp advanced.

Alternative: infer basis from the latest snapshot whenever it is omitted. Rejected because the writer cannot establish that the caller evaluated that snapshot. Direct manual decisions remain allowed; they need explicit evaluated evidence to establish freshness.

### 4. Add record-only mutation intent to the existing decision API

Add an optional mutation mode to upsert input: `recommendation` (default, preserving ordinary call shape) or `record-only`. Apply the branch under the existing decision-file lock.

For `record-only` with an existing decision, preserve bucket, priority, reason, source, `decidedAt`, and basis from the locked read. Merge supplied observations into existing observations and deduplicate identical strings. Caller-supplied recommendation/basis fields must not change these preserved fields. For no existing decision, retain observations using a neutral `review`/blocked-analysis recommendation with unknown basis; that placeholder cannot establish completed evaluation.

Update analysis-record and triage guidance to use record-only for failed, incomplete, blocked, unresolved, or superseded attempts that are not accepted as a new recommendation. A completed recommendation update can carry its own explicit older basis and be saved as superseded. Attempt-specific SHA/basis remains in the existing observation format and is distinct from the recommendation's basis.

This narrow locked merge is necessary for record-only semantics, but it is not the planned general atomic-history redesign. Ordinary recommendation replacement still requires callers to preserve older observations; do not claim this change fixes all concurrent history loss.

Alternative: infer intent by parsing `status=failed` text. Rejected because prose is not a reliable control-plane API.

### 5. Reuse existing queue clients and expose reasons

Keep existing bucket/filter behavior while adding applicability and concrete reassessment reasons to queue rows, compact discovery, and focused state-query results. Historical decision details remain available on stale rows; this does not introduce a redesigned pin overlay or interactive queue.

Update the read-only triage analyst's result basis to include the captured discussion watermark. Superseded and unknown recommendations are eligible for reassessment. Do not turn this eligibility into an unconditional repeated general code review: existing SHA/scope history policy remains separate.

## Risks / Trade-offs

- Legacy decisions lack discussion attribution => expect a one-time reassessment queue; do not stamp them with current facts to hide it.
- Timestamp-only discussion evidence cannot detect all edits => document the collection limitation; a later discussion-evidence change can add stronger identity without weakening provenance.
- Old caller behavior may omit basis => recommendation remains saved but unknown or tied to earlier evidence; update packaged callers and tool descriptions together.
- Superseded accepted results can replace the displayed historical recommendation => show applicability explicitly and preserve observations; unresolved attempts use record-only instead.
- Same-PR concurrent recommendation replacement remains possible => retain existing coordination guidance; do not describe the record-only path as a complete history concurrency fix.
- Tool/skill/schema drift => add executable mutation and assessment tests alongside reference/documentation checks and verify isolated Pi registration loading when schemas change.

## Migration Plan

1. Add optional fields and mutation intent to types, schemas, normalization, fixtures, and adapters without deleting existing state.
2. Introduce discussion watermark derivation and shared assessment; stop treating write time as evaluated coverage.
3. Add provenance-preserving and record-only writer branches, keeping the current filesystem lock around mutations.
4. Update packaged triage/analysis callers and output to carry/show the new evidence.
5. Validate using isolated temporary state and all existing tests; never mutate real maintainer state in development tests.
6. On deployment, disclose legacy unknown attribution and allow normal explicit reevaluation to establish evidence. Back up state before rollout. Rollback requires restoring that backup or accepting that the old implementation will ignore new metadata and resume its previous freshness semantics; no claim of safe semantic rollback is made.
