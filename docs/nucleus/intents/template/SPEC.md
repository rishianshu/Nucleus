# Spec Template

## Context & Goal
- What problem or opportunity does this work address?
- Why does it matter now, and what happens if we do nothing?
- Which existing specs or ADRs provide background?

## Outcomes
- What measurable changes should we observe?
- Which personas benefit, and how do they win?
- What scope is deliberately out of bounds?

## Stakeholders
- Who owns delivery, review, and sign-off?
- Which teams or services must be informed or trained?
- Are any external vendors or community members impacted?

## User Stories
- As a `<role>`, I can `<action>` so that `<value>`.
- Edge cases or failure scenarios to consider.
- Non-goals that keep the story focused.

## API Contract
- Describe endpoints, methods, payloads, and status codes.
- Reference or attach OpenAPI/GraphQL documents.
- Note versioning strategy and compatibility guarantees.

## Data Model
- Entities, attributes, and relationships introduced or modified.
- Storage locations (graph, KV, relational, blob, etc.).
- Migration/backfill requirements and data retention.

## Orchestration
- Workflows, jobs, or sequences required to deliver the feature.
- Idempotency, retries, and failure recovery expectations.
- Dependencies on schedules, triggers, or external signals.

## Security
- Authentication/authorization requirements and least privilege.
- Data sensitivity, encryption needs, and audit trails.
- Threats, mitigations, and compliance considerations.

## Observability
- Metrics, logs, and traces needed to prove success.
- Alerts or dashboards to add or update.
- Sampling, retention, or cost considerations.

## Acceptance Criteria
- Functional checks that demonstrate the outcomes.
- Tests across unit, integration, contract, and replay layers.
- Documentation or runbooks that must be updated.

## Rollout
- Environments, gating, and incremental release steps.
- Migration, backfill, or data seeding plans.
- Rollback strategy and contingency triggers.

## Open Questions
- Decisions that remain unresolved.
- Follow-up work or future iterations.
- Risks or assumptions that need validation.
