# Acceptance Criteria

1) Node types are defined in a meta registry and enforced by GraphWrite.upsertNode  
   - Type: unit|integration  
   - Evidence:  
     - A test seeds the `kg_node_types` table with at least one node type
       (e.g., "column.profile") with required_props including "createdAt".  
     - The test calls `GraphWrite.upsertNode` with `nodeType="column.profile"`
       and a `properties` object that includes "createdAt" and any other props,
       and asserts that it succeeds and returns a non-empty nodeId.  
     - A second call omitting "createdAt" is asserted to throw a typed validation
       error (or return an error result) indicating missing required props.  
     - A third call with `nodeType="unknown.type"` is asserted to fail with an
       "unknown nodeType" error.  
     - Suggested path: `apps/metadata-api/src/graph/graphWriteNode.test.ts`.

2) Edge types are defined in a meta registry and enforced by GraphWrite.upsertEdge  
   - Type: unit|integration  
   - Evidence:  
     - A test seeds `kg_node_types` with "cdm.column" and "column.profile" types,
       and `kg_edge_types` with an edge "PROFILE_OF" from "column.profile" to
       "cdm.column".  
     - Using GraphWrite, the test creates a "cdm.column" node and a
       "column.profile" node, then calls `upsertEdge` with `edgeType="PROFILE_OF"`,
       from profile nodeId to column nodeId, and asserts success.  
     - Calling `upsertEdge` with `edgeType="UNKNOWN_EDGE"` is asserted to fail
       with an "unknown edgeType" error.  
     - Calling `upsertEdge` with "PROFILE_OF" but from/to nodeIds whose types do
       not match `from_node_type`/`to_node_type` is asserted to fail with a node
       type mismatch error.  
     - Suggested path: `apps/metadata-api/src/graph/graphWriteEdge.test.ts`.

3) GraphWrite persists nodes/edges idempotently into GraphStore  
   - Type: integration  
   - Evidence:  
     - A test uses GraphWrite to upsert a node with a fixed `nodeId` and some
       properties, then reads from GraphStore (or a higher-level KG read helper)
       and asserts that exactly one node exists with that nodeId and the expected
       properties.  
     - The test calls `upsertNode` again with the same `nodeId` and changed
       properties, then asserts that the node is updated in-place and no duplicate
       node is created.  
     - Similarly, the test calls `upsertEdge` twice with the same edgeType and
       from/to nodeIds, and then asserts that GraphStore contains exactly one
       edge (with updated properties if applicable).  
     - Suggested path: `apps/metadata-api/src/graph/graphWriteIdempotency.test.ts`.

4) Enrichment node types (e.g., column.profile and column.description) can be created via GraphWrite and are queryable  
   - Type: integration  
   - Evidence:  
     - A test seeds `kg_node_types` with "cdm.column", "column.profile", and
       "column.description", and `kg_edge_types` with DESCRIBES and PROFILE_OF.  
     - Using GraphWrite, the test:  
       - creates a "cdm.column" node,  
       - creates a "column.description" node and a "column.profile" node,  
       - creates DESCRIBES (description → column) and PROFILE_OF (profile → column)
         edges via `upsertEdge`.  
     - The test then uses an existing KG read helper (or GraphStore query) to:  
       - fetch the "cdm.column" node and verify that inbound edges from the
         description and profile nodes exist with the correct edge types,  
       - fetch the description/profile nodes and verify their properties.  
     - Suggested path: `apps/metadata-api/src/graph/graphWriteEnrichment.test.ts`.
