# review-provider-independence Specification

## Purpose

Keep Maglev Maintainer's durable PR evidence and prospective review drafts independent of the extension or reviewer that performs code analysis.

## Requirements

### Requirement: No bundled review execution or kickoff
Maglev Maintainer SHALL NOT expose `maglev_pr_code_review`, `maglev_pr_review_instructions_load`, or the `maglev-pr-code-review` skill. Its available resources SHALL NOT provide a provider-specific review launch agent, kickoff template, compatibility alias, or replacement dispatcher.

#### Scenario: Maintainer loads without a review provider
- **WHEN** Maglev Maintainer is loaded without a Claude Code review extension or CLI
- **THEN** its tools and retained skills load without requiring a review provider
- **AND** neither removed tool, the removed skill, nor a provider-specific launch agent is advertised

#### Scenario: Workspace capabilities are queried
- **WHEN** a caller requests workspace context after the removal
- **THEN** the capabilities omit the removed review-instructions loader
- **AND** retained history, draft, and lifecycle capabilities remain available

### Requirement: Independently discovered review providers
Maglev Maintainer SHALL leave review-provider discovery and invocation to Pi and independently loaded resources. It SHALL NOT install or enforce a review-provider dependency, invoke a fallback reviewer, or use shell execution to replace the removed workflow.

#### Scenario: External review resources are loaded
- **WHEN** Pi loads Maglev Maintainer alongside a separate review extension
- **THEN** the external tool and skill are available through Pi's normal discovery
- **AND** Maglev Maintainer provides no duplicate runner or intermediary launcher

#### Scenario: No external review resource is available
- **WHEN** Maglev Maintainer is loaded without external review resources
- **THEN** it does not install a reviewer, dispatch review execution, or create a fallback tool

### Requirement: Reviewer-independent analysis guidance
Retained maintainer instructions SHALL require durable analysis records and same-SHA, same-scope reuse checks independently of the review provider. They SHALL preserve distinctions between completed, incomplete, failed, historical, and unknown-SHA evidence without requiring a removed tool or skill.

#### Scenario: External analysis is completed
- **WHEN** analysis of an identified Maglev PR is performed by an external reviewer
- **THEN** maintainer guidance requires a durable record with the actual analyzed SHA or explicit unknown, scope, outcome, evidence, and limits
- **AND** no removed launcher is required to record that evidence

#### Scenario: Equivalent review already exists
- **WHEN** saved completed analysis covers the current SHA and requested scope without a concrete new validation reason or explicit rerun override
- **THEN** retained guidance calls for reusing that evidence rather than launching a redundant review
- **AND** reuse does not imply a new review, approval, or permission to merge

### Requirement: Reviewer-independent prospective drafts
The retained draft workflow SHALL accept settled actionable findings from any review source through its validated draft tools. It SHALL NOT require a particular reviewer or infer clean coverage from failed or incomplete analysis. No findings alone SHALL NOT constitute approval.

#### Scenario: Actionable external findings are settled
- **WHEN** actionable findings from an external review are validated for a Maglev PR
- **THEN** maintainer guidance requires saving a prospective draft through the existing draft tools and reporting its path/event or a concrete blocker
- **AND** the workflow does not submit a GitHub review

#### Scenario: External review fails
- **WHEN** a review attempt fails or remains incomplete
- **THEN** maintainer guidance does not treat it as a clean review or clear an existing draft on that basis

### Requirement: Existing state and Bench behavior are preserved
Removing review-provider integration SHALL NOT migrate or delete stored analysis observations, prospective drafts, review logs, or Bench artifacts. Bench start and recovery SHALL retain their background-context semantics and SHALL NOT launch review execution.

#### Scenario: Removal is deployed over existing state
- **WHEN** the package is updated with existing history, drafts, logs, and Benches
- **THEN** those artifacts remain available without a data migration or cleanup operation

#### Scenario: Bench starts with background context
- **WHEN** a new Bench Pi window is explicitly started with background context
- **THEN** existing startup-context behavior is preserved
- **AND** no review task or kickoff is automatically submitted
