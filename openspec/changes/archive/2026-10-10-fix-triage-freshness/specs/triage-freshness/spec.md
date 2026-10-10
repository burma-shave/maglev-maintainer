# Spec Delta

## Purpose

Determine whether a PR next-action recommendation still applies to the code and captured human discussion it evaluated, while retaining historical analysis without presenting it as current coverage.

## ADDED Requirements

### Requirement: Revision-based reassessment
The system SHALL require reassessment when the known current PR head differs from the known evaluated head, independently of commit dates or decision write timestamps. Historical analysis SHALL remain available without establishing coverage of the changed head.

#### Scenario: Older-dated commit becomes the current head
- **WHEN** a recommendation evaluated head A and the current head is B with a commit date earlier than the recommendation save time
- **THEN** the recommendation is superseded and the PR requires reassessment

#### Scenario: Unchanged code and discussion
- **WHEN** the known evaluated head and discussion evidence match the current captured evidence
- **THEN** the recommendation is current even if the snapshot was fetched again

### Requirement: Evidence-based discussion freshness
The system SHALL compare captured human discussion activity with the discussion basis evaluated for the recommendation, not with its last storage write time. Bot/status churn alone SHALL NOT supersede the recommendation. This requirement covers the human comments and review summaries currently collected, not uncollected inline threads.

#### Scenario: Human activity arrives before a delayed save
- **WHEN** human activity occurs after the evaluated discussion basis but before the result is saved
- **THEN** the saved recommendation requires reassessment despite its later save timestamp

#### Scenario: Only bot activity changes
- **WHEN** the head and captured human discussion basis remain unchanged while bot activity changes
- **THEN** the recommendation is not superseded by that bot activity

### Requirement: Truthful evaluation attribution
The system SHALL preserve explicitly supplied evaluation basis without replacing or filling its fields from newer snapshot facts. A recommendation saved without explicit basis SHALL retain existing attribution or remain unknown; the system SHALL NOT infer that the current snapshot was evaluated merely because a write occurred.

#### Scenario: Snapshot advances during analysis
- **WHEN** analysis evaluated snapshot S1 at head A and the stored snapshot becomes S2 at head B before saving
- **THEN** the saved result retains its S1/A attribution rather than claiming S2/B

#### Scenario: Partially supplied basis
- **WHEN** a result supplies an evaluated head but omits discussion attribution
- **THEN** its head attribution is retained and discussion attribution remains unknown rather than being supplied from the current snapshot

#### Scenario: Unattributed new recommendation
- **WHEN** a new recommendation is saved without an evaluated basis
- **THEN** it is saved with unknown applicability and does not establish current coverage

### Requirement: Superseded result retention
The system SHALL retain results evaluated against earlier facts instead of rejecting them solely because the snapshot changed. It SHALL expose their superseded applicability and original evidence, without presenting them as current recommendations or authorizing merge actions.

#### Scenario: Older analysis is still useful
- **WHEN** a completed result evaluated head A and the current head is B
- **THEN** the result and its evidence remain available and its recommendation is marked superseded

### Requirement: Record-only writes preserve recommendation evaluation
The system SHALL support recording analysis observations without changing an existing recommendation's bucket, priority, reason, evaluation timestamp, or basis. Failed, incomplete, blocked, and unresolved attempts SHALL use this behavior and SHALL NOT make a stale or unknown recommendation current.

#### Scenario: Failed analysis after a code update
- **WHEN** a PR requires reassessment and a failed analysis attempt is recorded
- **THEN** the attempt is retained, the previous recommendation and attribution are unchanged, and reassessment remains required

#### Scenario: Record-only attempt without an existing recommendation
- **WHEN** a failed attempt is recorded for a PR with no saved recommendation
- **THEN** the attempt is retained with a neutral blocked-analysis recommendation whose applicability is unknown and which does not imply completed evaluation

### Requirement: Explicit applicability assessment
The system SHALL expose current, superseded, and unknown applicability with concrete reasons through its queue, needs-inference discovery, and focused state query. Missing or unusable attribution SHALL be unknown unless known evidence already proves supersession. Both superseded and unknown recommendations SHALL require reassessment.

#### Scenario: Legacy decision lacks evaluated evidence
- **WHEN** an existing decision lacks the head or discussion attribution needed to establish applicability
- **THEN** it remains readable, is reported as unknown, and requires reassessment rather than being made current by its save date

#### Scenario: Known mismatch alongside missing discussion basis
- **WHEN** a decision has a known head mismatch and unknown discussion attribution
- **THEN** applicability is superseded with the head mismatch reason, and the discussion uncertainty is also exposed

### Requirement: Freshness remains separate from readiness
The system SHALL NOT treat CI, merge-state, or approval changes alone as code/discussion supersession in this capability. Current applicability SHALL NOT imply successful checks, maintainer approval, or permission to merge.

#### Scenario: CI finishes on unchanged evidence
- **WHEN** CI changes from pending to successful while the evaluated head and captured human discussion evidence remain unchanged
- **THEN** code/discussion applicability remains unchanged and the result does not establish merge authorization
