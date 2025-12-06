- title: Docs access graph and RLS v1
- slug: docs-access-graph-and-rls-v1
- type: feature
- context:
  - runtime_core/cdm/docs/* (docs CDM entities)
  - apps/metadata-api/src/schema.ts (CDM + KB resolvers)
  - apps/metadata-api/src/graph/* (KB persistence + query)
  - apps/metadata-ui (CDM Docs Explorer + KB admin views)
  - platform/spark-ingestion (Confluence/OneDrive/Jira docs ingestion units)
  - docs/meta/nucleus-architecture/kb-meta-registry-v1.md
  - docs/meta/nucleus-architecture/INGESTION-SOURCE-STAGING-SINK-v1.md
- why_now: We now ingest docs from Confluence and OneDrive into CDM Docs and can explore them, but access control is largely implicit at the connector or environment level. To use Nucleus as a safe “brain” for downstream apps, we must understand who can see which docs and enforce that in explorers and agents. This requires ingesting doc ACLs into the KB as edges (user/group/team → doc), and applying row-level security (RLS) in CDM Docs queries so documents are only surfaced to authorized principals.
- scope_in:
  - Define a minimal docs-access graph model in KB: nodes and edges representing users/groups/teams and doc access.
  - Implement ingestion units that pull ACL information from Confluence and OneDrive (via real or stub APIs) and write access edges into KB.
  - Extend CDM Docs resolvers to optionally filter docs by current principal based on KB access edges.
  - Update Docs Explorer UI to respect RLS (hide docs without access) and show basic access metadata (e.g., visibility or “shared with” summary).
  - Add KB admin views (or extend existing ones) so admins can inspect and debug docs-access edges.
- scope_out:
  - Fine-grained content masking inside doc bodies (v1 is doc-level allow/deny).
  - Complex org policy modeling (sensitivity labels, legal holds, etc.).
  - Runtime usage logging / “who viewed what” audit trails.
  - PK/FK and structural relations for tables/columns (handled by a later kb-relations-and-lineage-v1 slug).
- acceptance:
  1. Docs access edges (user/group/team ↔ doc) are ingested into KB for Confluence and OneDrive docs.
  2. CDM Docs resolvers can filter docs based on the current principal’s effective access derived from KB edges.
  3. Docs Explorer hides docs the current user does not have access to when RLS is enabled.
  4. Docs Explorer shows basic access info in the doc detail pane (e.g., public/private/shared/groups).
  5. KB admin tools can list and inspect docs-access edges for debugging.
  6. `pnpm ci-check` remains green with new docs/Kb tests.
- constraints:
  - KB schema changes must be additive (no breaking existing nodes/edges).
  - Access enforcement must be implemented at resolver/service level; UI should not rely on client-only filtering.
  - Ingestion of ACLs must be bounded and incremental (no O(N²) re-sync per run).
- non_negotiables:
  - No doc should be returned by the “secured” CDM Docs queries to a principal that lacks an allow edge in KB (taking group membership into account).
  - ACL ingestion and RLS behavior must be deterministic and testable with seeded fixtures/stubs.
- refs:
  - intents/semantic-confluence-source-v1/*
  - intents/semantic-onedrive-source-v1/*
  - intents/cdm-docs-model-and-semantic-binding-v1/*
  - intents/cdm-docs-explorer-v1/*
  - intents/kb-admin-console-v1/*
- status: in-progress