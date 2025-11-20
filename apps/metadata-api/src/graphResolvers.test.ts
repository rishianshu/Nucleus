import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileMetadataStore, createGraphStore } from "@metadata/core";
import { createResolvers } from "./schema.js";

const TEST_TENANT = "tenant-graph";
const TEST_PROJECT = "project-graph";

test("graphNodes query exposes scope and identity fields", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-graph-nodes-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  const resolvers = createResolvers(store, { graphStore });
  const ctx = buildResolverContext();
  const tenantContext = { tenantId: ctx.auth.tenantId, projectId: ctx.auth.projectId, actorId: ctx.userId ?? undefined };

  const entity = await graphStore.upsertEntity(
    {
      entityType: "catalog.dataset",
      displayName: "orders",
      canonicalPath: "postgres/orders",
      properties: { schema: "public", table: "orders" },
      scope: { orgId: ctx.auth.tenantId, projectId: ctx.auth.projectId },
      identity: {
        externalId: { datasetId: "orders" },
        originEndpointId: "endpoint-123",
        originVendor: "postgres",
      },
    },
    tenantContext,
  );

  const nodes = await resolvers.Query.graphNodes(null, { filter: { limit: 10 } }, ctx as any);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].id, entity.id);
  assert.equal(nodes[0].scope.orgId, TEST_TENANT);
  assert.equal(nodes[0].scope.projectId, TEST_PROJECT);
  assert.equal(nodes[0].identity.originEndpointId, "endpoint-123");
  assert.ok(nodes[0].identity.logicalKey, "logical key should be present");
});

test("graphEdges query returns hashed logical identity", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-graph-edges-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  const resolvers = createResolvers(store, { graphStore });
  const ctx = buildResolverContext();
  const tenantContext = { tenantId: ctx.auth.tenantId, projectId: ctx.auth.projectId, actorId: ctx.userId ?? undefined };

  const source = await graphStore.upsertEntity(
    {
      entityType: "catalog.dataset",
      displayName: "orders",
      properties: { schema: "public", table: "orders" },
      scope: { orgId: ctx.auth.tenantId, projectId: ctx.auth.projectId },
    },
    tenantContext,
  );
  const target = await graphStore.upsertEntity(
    {
      entityType: "catalog.dataset",
      displayName: "customers",
      properties: { schema: "public", table: "customers" },
      scope: { orgId: ctx.auth.tenantId, projectId: ctx.auth.projectId },
    },
    tenantContext,
  );

  await graphStore.upsertEdge(
    {
      edgeType: "RELATED_TO",
      sourceEntityId: source.id,
      targetEntityId: target.id,
      metadata: { confidence: 0.5 },
      scope: { orgId: ctx.auth.tenantId, projectId: ctx.auth.projectId },
    },
    tenantContext,
  );

  const edges = await resolvers.Query.graphEdges(null, { filter: { limit: 10 } }, ctx as any);
  assert.equal(edges.length, 1);
  const edge = edges[0];
  assert.equal(edge.sourceEntityId, source.id);
  assert.equal(edge.targetEntityId, target.id);
  assert.ok(edge.identity.logicalKey, "edge logical key should be populated");
  assert.ok(edge.identity.sourceLogicalKey, "edge source logical key should be set");
  assert.ok(edge.identity.targetLogicalKey, "edge target logical key should be set");
});

function buildResolverContext() {
  return {
    auth: {
      tenantId: TEST_TENANT,
      projectId: TEST_PROJECT,
      roles: ["viewer", "editor"],
      subject: "user-graph",
    },
    userId: "user-graph",
    bypassWrites: false,
  };
}
