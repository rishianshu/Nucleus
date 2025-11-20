# Acceptance Criteria

1) Distinct nodes across scopes
   - Type: integration
   - Evidence: Upsert "public.users" from two endpoints/projects under different orgs → two nodes with different `logical_key` & `scope`; neither overwrites the other.

2) Idempotent upsert by logicalKey
   - Type: unit + integration
   - Evidence: Re-apply the same write (identical logicalKey) → row count unchanged; `updated_at` advances.

3) Safe edge linking & isolation
   - Type: integration
   - Evidence: DOCUMENTED_BY created within same org succeeds; cross-org attempt is rejected by resolver (insufficient scope).

4) Backfill safety & audit
   - Type: migration
   - Evidence: After backfill, 100% nodes/edges have `logical_key`; collisions split; a report (counts + sample IDs) is produced; `provenance.migration="graph-identity-hardening"` present.

5) GraphQL additive fields
   - Type: contract
   - Evidence: `identity` and `scope` fields are returned for Node/Edge; no changes required to existing clients.
