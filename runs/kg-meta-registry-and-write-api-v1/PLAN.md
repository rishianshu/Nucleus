## kg-meta-registry-and-write-api-v1 Plan

1. **Registry schema + seeds**
   - Add Prisma models/tables for kg_node_types and kg_edge_types with core fields.
   - Seed initial node/edge types (cdm.work.item, cdm.doc.item, cdm.column, column.profile, column.description, signal.instance, kg.cluster, DESCRIBES/PROFILE_OF/HAS_SIGNAL/IN_CLUSTER).

2. **GraphWrite service + validation**
   - Implement registry reader (Prisma + in-memory) and GraphWrite.upsertNode/upsertEdge validation/idempotent writes via GraphStore.
   - Ensure required properties and edge endpoint types enforced with typed errors.

3. **GraphWrite tests**
   - Add node/edge validation, idempotency, and enrichment coverage using GraphStore + registry seeds.

4. **Verification + handoff**
   - Run targeted tests, update TODO/LOG/STATE/STORY with outcomes.
