# Spec: Code Domain Index

## Context & Goal
- Index GitHub repositories to capture repositories, commits, file descriptors, dependency relationships, and codeownership.
- Provide deterministic descriptors and edges that power cross-domain metadata and compliance workflows.
- Maintain KV checkpoints for last scanned commit per repository to support incremental sync.

## Scope
- GitHub as primary source (REST + GraphQL APIs).
- Entities: `repo`, `commit`, `file`, `module`, optional `symbol`.
- Relationships: ownership (codeowners), dependencies, links to API registry entries.
- No binary blob storage by default; leverage GitHub-native blobs unless explicitly required.

## Ingestion Flow
1. Enumerate repositories per tenant/project via allowlists or organization membership.
2. Fetch repository metadata (default branch, topics, visibility).
3. Retrieve commits since last checkpoint stored in KV (`tenant/code/<repo>/last-sha`).
4. For each commit: list changed files, compute descriptors, update edges.
5. Optionally extract symbols (functions, classes) when spec mandates; store lightweight metadata.
6. Register edges between code files and API registry endpoints when references detected.

## Data Model Mapping
- `code_repo` descriptor: `repo_id`, `tenant_id`, `project_id`, `name`, `visibility`, `default_branch`, `topics`, `owners`, `spec_ref`, `version`.
- `code_commit` descriptor: `commit_id`, `repo_id`, `sha`, `author`, `authored_at`, `committed_at`, `message_digest`, `files_changed`.
- `code_file` descriptor: `file_id`, `repo_id`, `path`, `language`, `size_bytes`, `hash`, `last_commit_id`, `codeowner_team`.
- `code_symbol` descriptor (optional): `symbol_id`, `file_id`, `symbol_type`, `name`, `signature`, `documentation_preview`.
- `code_dependency_edge`: `edge_id`, `source_file_id`, `target_package`, `version_constraint`, `discovery_method`.

## Codeowners & Ownership
- Parse `.github/CODEOWNERS` or repo config to populate `codeowner_team`.
- Generate edges between `code_file` and `team` entities in metadata graph.
- Missing codeowner entries trigger warnings and optional fallbacks to repo owners.

## KV Checkpoints
- Maintain checkpoint per repo stored in KV: key `tenant/<tenant_id>/project/<project_id>/code/<repo_slug>/last_sha`.
- Value includes `commit_sha`, `indexed_at`, `worker_id`, and `spec_ref`.
- CAS semantics ensure only one worker advances checkpoint; conflicts retried with exponential backoff.

## Optional Symbol Extraction
- Triggered by spec flag for critical repositories.
- Extract top-level functions, classes, APIs; store signature metadata but no source blobs.
- Link symbols to API endpoints or service descriptors when reference patterns match.

## Edges to APIs
- When code references API registry entries (e.g., via annotations or path matches), create edges `code_file -> api_endpoint`.
- Ensure edges include context metadata (line range, commit SHA) for auditability.
- Missing references escalate to domain owners for manual linking.

## Acceptance Criteria
- Repository descriptors include required metadata and map to tenants/projects correctly.
- Commits processed incrementally; re-run with same checkpoint results in no duplicate descriptors.
- KV checkpoints advance atomically; conflicts produce retries logged per log taxonomy.
- Codeowner data populates edges to team entities; missing entries flagged.
- Optional symbol extraction produces descriptors without storing raw blobs.
- Integration with API registry yields edges for referenced endpoints.
- "Done" means descriptors written, dependency edges created, checkpoint persisted.

## SLOs & Observability
- p95 repo sync time under 10 minutes for repos < 10k files.
- Alerts on checkpoint staleness > 24 hours unless paused via schedule.
- Logs emit `INFO` for repo start/end, `WARN` for checkpoint conflicts, `ERROR` for rate limit exhaustion.

## Open Questions
- Should we cache GitHub content locally for faster reprocessing?
- Need to support self-hosted Git providers under same spec?
- How to handle large monorepos without blowing throughput budgets?
