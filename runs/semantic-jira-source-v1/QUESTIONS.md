### 2025-11-23 — How should the Python ingestion worker persist KB nodes? _(resolved 2025-11-23)_

Clarified with reviewer: the Python worker will **not** talk to KB/GraphQL directly. It should return `{ newCheckpoint, stats, normalizedRecords }` to the TS ingestion core, and the TS activity will feed `normalizedRecords` into the existing `KnowledgeBaseSink`. No Python GraphStore client is required.
