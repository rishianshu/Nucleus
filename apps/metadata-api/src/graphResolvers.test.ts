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

test("kbNodes and kbEdges expose scope-aware data with pagination and scenes", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-kb-resolvers-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  const resolvers = createResolvers(store, { graphStore });
  const ctx = buildResolverContext();
  const tenantContext = { tenantId: ctx.auth.tenantId, projectId: ctx.auth.projectId, actorId: ctx.userId ?? undefined };

  const orders = await graphStore.upsertEntity(
    {
      entityType: "catalog.dataset",
      displayName: "Sample Orders",
      canonicalPath: "postgres.orders",
      properties: { schema: "public", table: "orders" },
      scope: { orgId: ctx.auth.tenantId, projectId: ctx.auth.projectId },
    },
    tenantContext,
  );
  const customers = await graphStore.upsertEntity(
    {
      entityType: "catalog.dataset",
      displayName: "Sample Customers",
      canonicalPath: "postgres.customers",
      properties: { schema: "public", table: "customers" },
      scope: { orgId: ctx.auth.tenantId, projectId: ctx.auth.projectId },
    },
    tenantContext,
  );
  await graphStore.upsertEntity(
    {
      entityType: "catalog.dataset",
      displayName: "Other org node",
      properties: {},
      scope: { orgId: "another-tenant", projectId: ctx.auth.projectId },
    },
    { tenantId: "another-tenant", projectId: ctx.auth.projectId, actorId: ctx.userId ?? undefined },
  );
  await graphStore.upsertEdge(
    {
      edgeType: "DEPENDENCY_OF",
      sourceEntityId: orders.id,
      targetEntityId: customers.id,
      scope: { orgId: ctx.auth.tenantId, projectId: ctx.auth.projectId },
    },
    tenantContext,
  );

  const firstPage = await resolvers.Query.kbNodes(null, { type: "catalog.dataset", first: 1 }, ctx as any);
  assert.equal(firstPage.edges.length, 1);
  assert.equal(firstPage.totalCount, 2);
  const nextPage = await resolvers.Query.kbNodes(null, { type: "catalog.dataset", first: 5, after: firstPage.pageInfo.endCursor ?? undefined }, ctx as any);
  assert.equal(nextPage.edges.length, 1);

  const detail = await resolvers.Query.kbNode(null, { id: orders.id }, ctx as any);
  assert.equal(detail?.id, orders.id);
  assert.ok(detail?.identity.logicalKey);

  const edgesConnection = await resolvers.Query.kbEdges(null, { edgeType: "DEPENDENCY_OF", first: 10 }, ctx as any);
  assert.equal(edgesConnection.totalCount, 1);
  assert.equal(edgesConnection.edges[0].node.sourceEntityId, orders.id);
  assert.equal(edgesConnection.edges[0].node.targetEntityId, customers.id);

  const scene = await resolvers.Query.kbScene(null, { id: orders.id, depth: 2, limit: 10 }, ctx as any);
  assert.ok(scene.nodes.length >= 2);
  assert.equal(scene.summary.truncated, false);
});

test("kbNodes and kbEdges fall back to sample graph data when store is empty", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-kb-sample-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  const resolvers = createResolvers(store, { graphStore });
  const ctx = buildResolverContext();

  const nodesConnection = await resolvers.Query.kbNodes(null, { first: 5 }, ctx as any);
  assert.ok(nodesConnection.totalCount > 0, "sample kb nodes should be available");
  const sampleNodeId = nodesConnection.edges[0]?.node.id;
  assert.ok(sampleNodeId, "sample node id present");

  const nodeDetail = await resolvers.Query.kbNode(null, { id: sampleNodeId! }, ctx as any);
  assert.equal(nodeDetail?.id, sampleNodeId);

  const edgesConnection = await resolvers.Query.kbEdges(null, { first: 5 }, ctx as any);
  assert.ok(edgesConnection.totalCount > 0, "sample kb edges should be available");

  const scene = await resolvers.Query.kbScene(null, { id: sampleNodeId!, depth: 2, limit: 25 }, ctx as any);
  assert.ok(scene.nodes.length >= 1);
});

test("kbFacets aggregates node and edge facets for the active tenant", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-kb-facets-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  const resolvers = createResolvers(store, { graphStore });
  const ctx = buildResolverContext();
  const tenantContext = { tenantId: ctx.auth.tenantId, projectId: ctx.auth.projectId, actorId: ctx.userId ?? undefined };

  const datasetA = await graphStore.upsertEntity(
    {
      entityType: "catalog.dataset",
      displayName: "Dataset A",
      scope: { orgId: ctx.auth.tenantId, projectId: ctx.auth.projectId },
    },
    tenantContext,
  );
  const datasetB = await graphStore.upsertEntity(
    {
      entityType: "catalog.dataset",
      displayName: "Dataset B",
      scope: { orgId: ctx.auth.tenantId, projectId: ctx.auth.projectId, teamId: "data" },
    },
    tenantContext,
  );
  await graphStore.upsertEdge(
    {
      edgeType: "DEPENDENCY_OF",
      sourceEntityId: datasetA.id,
      targetEntityId: datasetB.id,
      scope: { orgId: ctx.auth.tenantId, projectId: ctx.auth.projectId },
    },
    tenantContext,
  );

  const facets = await resolvers.Query.kbFacets(null, {}, ctx as any);
  assert.ok(facets.nodeTypes.length > 0, "node facets should exist");
  const datasetFacet = facets.nodeTypes.find((entry) => entry.value === "catalog.dataset");
  assert.equal(datasetFacet?.count, 2);
  const dependencyFacet = facets.edgeTypes.find((entry) => entry.value === "DEPENDENCY_OF");
  assert.equal(dependencyFacet?.count, 1);
});

test("kbMeta query returns required node and edge types", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-kb-meta-resolver-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  const resolvers = createResolvers(store, { graphStore });
  const ctx = buildResolverContext();

  const meta = await resolvers.Query.kbMeta(null, { scope: null }, ctx as any);
  assert.ok(meta.version.length > 0, "version should be populated");
  const dataset = meta.nodeTypes.find((entry) => entry.value === "catalog.dataset");
  const endpoint = meta.nodeTypes.find((entry) => entry.value === "metadata.endpoint");
  const doc = meta.nodeTypes.find((entry) => entry.value === "doc.page");
  const documentedBy = meta.edgeTypes.find((entry) => entry.value === "DOCUMENTED_BY");
  const dependency = meta.edgeTypes.find((entry) => entry.value === "DEPENDENCY_OF");

  assert.ok(dataset, "catalog.dataset should exist");
  assert.equal(dataset?.label, "Datasets");
  assert.ok(endpoint, "metadata.endpoint should exist");
  assert.ok(doc, "doc.page should exist");
  assert.ok(documentedBy, "DOCUMENTED_BY should exist");
  assert.equal(documentedBy?.label, "Documented by");
  assert.ok(dependency, "DEPENDENCY_OF should exist");
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
