# Spec: API Registry Domain

## Context & Goal
- Maintain authoritative registry of APIs, versions, endpoints, and their relationships to code implementations.
- Store OpenAPI/GraphQL specifications securely, versioned, and linked to MinIO blobs with verified hashes.
- Support deprecation lifecycle, discoverability, and auditing across tenants.

## Scope
- Entities: `api_service`, `api_endpoint`, `api_spec_version`.
- Relationships: service owns endpoints, endpoints implemented by code files, services linked to teams.
- Storage: metadata in Postgres, spec blobs in MinIO, hash recorded in metadata.
- Versioning: semantic version per service with deprecation and sunset tracking.

## Data Model Mapping
- `api_service`: `service_id`, `tenant_id`, `project_id`, `display_name`, `domain`, `owner_team`, `description`, `lifecycle_status`, `latest_version`, `spec_ref`.
- `api_spec_version`: `spec_version_id`, `service_id`, `version`, `hash`, `blob_uri`, `published_at`, `deprecated_at`, `sunset_at`, `change_log`.
- `api_endpoint`: `endpoint_id`, `service_id`, `method`, `path`, `operation_id`, `summary`, `request_schema_ref`, `response_schema_ref`, `deprecated`, `spec_version_id`.
- Junction table `api_endpoint_code_link`: `link_id`, `endpoint_id`, `code_file_id`, `line_range`, `evidence`, `confidence`.

## Spec Storage Policy
- Upload canonical OpenAPI documents to MinIO under `apis/<tenant>/<service>/<version>.yaml` with server-side encryption.
- Record SHA256 hash in `api_spec_version.hash`; enforce match before activation.
- Maintain signed URL access for 1 hour by default; longer expirations require security approval.
- Dry-run validation ensures spec passes linting and backward compatibility checks before publishing.

## Versioning & Lifecycle
- Semantic versioning: MAJOR.MINOR.PATCH; MAJOR changes require deprecation plan.
- Set `deprecated_at` when version announced for retirement; `sunset_at` marks removal date.
- `latest_version` on service points to currently supported spec; older versions remain accessible until sunset.
- Deprecation policy requires notification to code owners and consumers with links to ADRs.

## Links to Code
- Link endpoints to implementing files via `api_endpoint_code_link`.
- Evidence may include annotations, generated client pointers, or manual verification notes.
- Confidence score indicates automated inference vs manual confirmation; low confidence requires review.
- Missing links flagged as technical debt and surfaced in dashboards.

## Access & Security
- RLS ensures services visible only to tenant/project; shared APIs require explicit grants.
- Publishing new spec versions requires service account with `api:write` scope and spec reference.
- Audit logs capture spec uploads, activation, deprecations, and code link changes.

## Deprecation Workflow
- Create ADR documenting rationale.
- Update `api_spec_version` with `deprecated_at` and communication plan reference.
- Monitor usage metrics; escalate if clients fail to migrate before sunset.
- Archive spec in MinIO with retention policy aligned to compliance requirements.

## Acceptance Criteria
- Registry lists endpoints per service and version including method, path, and operation ID.
- MinIO blob hash matches metadata entry; mismatches block activation.
- Code linkage records exist for active endpoints or documented exceptions.
- Deprecation metadata visible via API; consumers can filter deprecated endpoints.
- Audit trail includes spec publication, updates, and deprecation events.

## Open Questions
- Should we auto-generate client SDKs from spec updates?
- Do we need per-endpoint SLO annotations in this domain?
- How to handle GraphQL federation metadata within the same registry?
