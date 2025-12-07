import assert from "node:assert/strict";
import test from "node:test";
import type { GraphEdge, GraphEntity, GraphStore, TenantContext } from "@metadata/core";
import { upsertJdbcRelations } from "./jdbcRelations.js";

class StubGraphStore implements GraphStore {
  entities: GraphEntity[] = [];
  edges: GraphEdge[] = [];

  async capabilities() {
    return { vectorSearch: false, pathQueries: false, annotations: false };
  }

  async upsertEntity(input: any, context: TenantContext): Promise<GraphEntity> {
    const entity: GraphEntity = {
      id: input.id ?? `node-${this.entities.length + 1}`,
      entityType: input.entityType,
      displayName: input.displayName,
      canonicalPath: input.canonicalPath,
      sourceSystem: input.sourceSystem,
      specRef: input.specRef,
      properties: input.properties ?? {},
      scope: {
        orgId: context.tenantId,
        projectId: context.projectId ?? null,
      },
      identity: {
        logicalKey: input.identity?.logicalKey ?? "",
        externalId: input.identity?.externalId ?? null,
        originEndpointId: input.identity?.originEndpointId ?? null,
        originVendor: input.identity?.originVendor ?? null,
        phase: input.identity?.phase ?? null,
        provenance: input.identity?.provenance ?? null,
      },
      tenantId: context.tenantId,
      projectId: context.projectId ?? null,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.entities.push(entity);
    return entity;
  }

  async getEntity(): Promise<GraphEntity | null> {
    return null;
  }

  async listEntities(): Promise<GraphEntity[]> {
    return [];
  }

  async upsertEdge(input: any, context: TenantContext): Promise<GraphEdge> {
    const edge: GraphEdge = {
      id: input.id ?? `edge-${this.edges.length + 1}`,
      edgeType: input.edgeType,
      sourceEntityId: input.sourceEntityId,
      targetEntityId: input.targetEntityId,
      confidence: input.confidence,
      specRef: input.specRef,
      metadata: input.metadata ?? {},
      tenantId: context.tenantId,
      projectId: context.projectId ?? null,
      scope: input.scope ?? { orgId: context.tenantId, projectId: context.projectId ?? null },
      identity: {
        logicalKey: input.identity?.logicalKey ?? "",
        externalId: input.identity?.externalId ?? null,
        originEndpointId: input.identity?.originEndpointId ?? null,
        originVendor: input.identity?.originVendor ?? null,
        phase: input.identity?.phase ?? null,
        provenance: input.identity?.provenance ?? null,
        sourceLogicalKey: input.identity?.sourceLogicalKey ?? null,
        targetLogicalKey: input.identity?.targetLogicalKey ?? null,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.edges.push(edge);
    return edge;
  }

  async listEdges(): Promise<GraphEdge[]> {
    return [];
  }

  async putEmbedding(): Promise<any> {
    return null;
  }

  async searchEmbeddings(): Promise<any[]> {
    return [];
  }
}

test("upsertJdbcRelations emits containment and PK/FK edges", async () => {
  const graphStore = new StubGraphStore();
  const datasetIdentity = {
    id: "dataset::dev::global::source::public::orders",
    tenantId: "dev",
    projectId: "global",
    sourceId: "source",
    schema: "public",
    table: "orders",
    database: null,
    canonicalPath: "source/public/orders",
  };
  const payload = {
    source: "postgres",
    schema_fields: [
      { name: "id", data_type: "integer", ordinal_position: 1, is_nullable: "NO" },
      { name: "customer_id", data_type: "integer", ordinal_position: 2, is_nullable: "YES" },
    ],
    constraints: [
      {
        name: "orders_pkey",
        constraint_type: "PRIMARY KEY",
        columns: [{ column_name: "id", position: 1 }],
      },
      {
        name: "orders_customer_id_fkey",
        constraint_type: "FOREIGN KEY",
        columns: [{ column_name: "customer_id", position: 1, referenced_column: "id" }],
        referenced_table: "public.customers",
        referenced_fields: ["id"],
        delete_rule: "CASCADE",
      },
    ],
  };
  const context = { tenantId: "dev", projectId: "global" };

  await upsertJdbcRelations(graphStore, datasetIdentity as any, payload, context);

  const tableId = "table:source:public.orders";
  const columnIds = new Set(graphStore.entities.filter((e) => e.entityType === "catalog.column").map((e) => e.id));

  assert.ok(graphStore.entities.find((e) => e.id === tableId && e.entityType === "catalog.table"), "table node created");
  assert.ok(columnIds.has("column:source:public.orders.id"), "primary column created");
  assert.ok(columnIds.has("column:source:public.orders.customer_id"), "fk column created");

  const containsTable = graphStore.edges.find((edge) => edge.edgeType === "rel.contains.table");
  assert.ok(containsTable, "dataset->table edge created");

  const pkEdge = graphStore.edges.find((edge) => edge.edgeType === "rel.pk_of");
  assert.ok(pkEdge, "pk edge created");
  assert.equal(pkEdge?.targetEntityId, "column:source:public.orders.id");

  const fkEdge = graphStore.edges.find((edge) => edge.edgeType === "rel.fk_references");
  assert.ok(fkEdge, "fk edge created");
  assert.equal(fkEdge?.sourceEntityId, "column:source:public.orders.customer_id");
  assert.equal(fkEdge?.targetEntityId, "column:source:public.customers.id");
});
