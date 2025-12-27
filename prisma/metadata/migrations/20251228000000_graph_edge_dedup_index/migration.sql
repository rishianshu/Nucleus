-- Add unique index for edge deduplication (from+to+type)
-- Note: Uses snake_case to match the table/columns that Go code inserts into
-- The GraphEdge table is the Prisma-managed table, but graph_edges is used by Go
CREATE UNIQUE INDEX IF NOT EXISTS graph_edges_tenant_source_target_type_idx
ON graph_edges (tenant_id, source_entity_id, target_entity_id, edge_type);
