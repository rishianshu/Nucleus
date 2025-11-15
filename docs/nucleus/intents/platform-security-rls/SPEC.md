# Spec: Security and Row-Level Security

## Context & Goal
- Enforce tenant and project isolation through consistent identity propagation, RLS policies, and short-lived access controls.
- Ensure signed URL usage, secrets handling, and credentials references align with compliance requirements.
- Provide implementation checklist applicable to new endpoints or features.

## Identity & Claims
- Identity provider: Keycloak issues JWT tokens with claims `tenant_id`, `project_id`, `roles`, `subject`, `credential_ref`.
- Services validate token signature and expiration; reject tokens missing tenant or project claims unless explicitly public.
- Internal automation uses service accounts with restricted scopes and signing keys rotated quarterly.

## Claims Mapping
- API gateway extracts `tenant_id` and `project_id` claims and injects them into downstream headers (`X-Tenant-Id`, `X-Project-Id`).
- Background workers receive claims via workflow context or service account config; workflow must set tenant/project before DB access.
- Missing `project_id` (tenant-wide actions) require explicit spec approval and audit log entry.

## RLS Invariants
- All tables with `tenant_id` or `project_id` enforce RLS with default deny.
- Policies:
  - `tenant_read`: users with matching `tenant_id` and role `reader` or higher.
  - `tenant_write`: users with matching `tenant_id` and `roles` containing `writer`.
  - `project_collaborator`: membership recorded in `project_members`.
  - `service_account_scope`: automation identities limited to declared tables/columns.
- RLS unit tests run as part of CI to ensure newly added tables include policies; missing policy fails build.

## Signed URL Policy
- Signed URLs for MinIO or external blob storage expire in 15 minutes or less; default 5 minutes.
- URLs bound to tenant/project via path and query parameters; downstream clients must not cache.
- Regenerate signed URLs for each request; sharing requires re-authentication.
- Audit trail records signed URL issuance with requester identity and purpose.

## Secrets & Credential References
- `credential_ref` claim maps to secret metadata stored in `ops/` managed vault; application retrieves actual secret via vault client.
- Secrets never embedded in payloads, logs, or spec documents.
- Credentials rotated according to environment policy (prod monthly, lower env quarterly).
- When features require new credentials, spec must document scope, storage location, and rotation process.

## Endpoint & Feature Checklist
1. Token validation verifies signature, expiration, and presence of tenant/project claims.
2. Database queries use parameterized tenant/project filters and rely on RLS.
3. KV keys follow tenant/project naming from `kv-checkpoints.md`.
4. Signed URL usage documented with expiry <= 15 minutes and logged.
5. Credential references stored as `credential_ref`; retrieval path documented.
6. Logs follow taxonomy and redact secrets; confirm correlation IDs present.
7. Audit entries captured for write operations and privilege elevation.
8. Tests include positive/negative access cases to confirm RLS/ACL behaviour.

## Acceptance Criteria
- Requests missing valid claims rejected with 401/403 and audited.
- RLS prevents cross-tenant reads in integration tests using synthetic data.
- Signed URL issuance limited to authorized roles; expired links denied.
- Credential references resolved through vault without exposing secrets.
- Checklist completed and archived for every new endpoint or feature.

## Open Questions
- Should we implement automatic token introspection for high-risk operations?
- Do we need differential audit retention per tenant?
- How to automate credential_ref creation during tenant onboarding?
