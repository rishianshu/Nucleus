import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileMetadataStore, createGraphStore } from "@metadata/core";
import { createResolvers } from "./schema.js";
import type { CdmEntityEnvelope } from "./cdm/entityStore.js";
import type { CdmWorkItemRow, CdmWorkCommentRow, CdmWorkLogRow } from "./cdm/workStore.js";

const TEST_TENANT = "tenant-graph";
const TEST_PROJECT = "project-graph";

test("metadataEndpointTemplates exposes Confluence template", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-templates-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const previousRefreshSetting = process.env.METADATA_ENDPOINT_TEMPLATE_REFRESH_DISABLED;
  process.env.METADATA_ENDPOINT_TEMPLATE_REFRESH_DISABLED = "1";
  t.after(() => {
    process.env.METADATA_ENDPOINT_TEMPLATE_REFRESH_DISABLED = previousRefreshSetting;
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  const resolvers = createResolvers(store, { graphStore });
  const ctx = buildResolverContext();

  const templates = await (resolvers.Query.metadataEndpointTemplates as any)(null, { family: "HTTP" }, ctx as any);
  assert.ok(Array.isArray(templates));
  const confluence = templates.find((template: any) => template.id === "http.confluence");
  assert.ok(confluence, "expected Confluence template in HTTP family");
  assert.ok(
    Array.isArray(confluence.fields) && confluence.fields.some((field: any) => field.key === "include_archived"),
    "Confluence template should expose include_archived field",
  );
  assert.ok(
    Array.isArray(confluence.capabilities) && confluence.capabilities.some((cap: any) => cap.key === "metadata"),
    "Confluence template should expose metadata capability",
  );
});

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

  const nodes = await (resolvers.Query.graphNodes as any)(null, { filter: { limit: 10 } }, ctx as any);
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

  const edges = await (resolvers.Query.graphEdges as any)(null, { filter: { limit: 10 } }, ctx as any);
  assert.equal(edges.length, 1);
  const edge = edges[0];
  assert.equal(edge.sourceEntityId, source.id);
  assert.equal(edge.targetEntityId, target.id);
  assert.ok(edge.identity.logicalKey, "edge logical key should be populated");
  assert.ok(edge.identity.sourceLogicalKey, "edge source logical key should be set");
  assert.ok(edge.identity.targetLogicalKey, "edge target logical key should be set");
});

test("cdmEntities and cdmEntity surface work/doc envelopes", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-cdm-entities-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  const fakeEntityStore = new FakeCdmEntityStore();
  const resolvers = createResolvers(store, { graphStore, cdmEntityStore: fakeEntityStore as any });
  const ctx = buildResolverContext();

  const connection = await (resolvers.Query.cdmEntities as any)(
    null,
    { filter: { domain: "WORK_ITEM" }, first: 25 },
    ctx as any,
  );
  assert.equal(connection.edges.length, 1);
  assert.equal(connection.edges[0].node.domain, "WORK_ITEM");
  assert.equal(connection.edges[0].node.title, "Sample Work");
  assert.equal(connection.pageInfo.hasNextPage, false);

  const docEntity = await (resolvers.Query.cdmEntity as any)(
    null,
    { id: "cdm:doc:item:1", domain: "DOC_ITEM" },
    ctx as any,
  );
  assert.ok(docEntity);
  assert.equal(docEntity.domain, "DOC_ITEM");
  assert.equal(docEntity.sourceSystem, "confluence");
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

  const firstPage = await (resolvers.Query.kbNodes as any)(null, { type: "catalog.dataset", first: 1 }, ctx as any);
  assert.equal(firstPage.edges.length, 1);
  assert.equal(firstPage.totalCount, 2);
  const nextPage = await (resolvers.Query.kbNodes as any)(null, { type: "catalog.dataset", first: 5, after: firstPage.pageInfo.endCursor ?? undefined }, ctx as any);
  assert.equal(nextPage.edges.length, 1);

  const detail = await (resolvers.Query.kbNode as any)(null, { id: orders.id }, ctx as any);
  assert.equal(detail?.id, orders.id);
  assert.ok(detail?.identity.logicalKey);

  const edgesConnection = await (resolvers.Query.kbEdges as any)(null, { edgeType: "DEPENDENCY_OF", first: 10 }, ctx as any);
  assert.equal(edgesConnection.totalCount, 1);
  assert.equal(edgesConnection.edges[0].node.sourceEntityId, orders.id);
  assert.equal(edgesConnection.edges[0].node.targetEntityId, customers.id);

  const scene = await (resolvers.Query.kbScene as any)(null, { id: orders.id, depth: 2, limit: 10 }, ctx as any);
  assert.ok(scene.nodes.length >= 2);
  assert.equal(scene.summary.truncated, false);
});

test("kbEdges supports edgeTypes filters, direction, and limits", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-kb-edge-filters-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  const resolvers = createResolvers(store, { graphStore });
  const ctx = buildResolverContext();
  const tenantContext = { tenantId: ctx.auth.tenantId, projectId: ctx.auth.projectId, actorId: ctx.userId ?? undefined };

  const a = await graphStore.upsertEntity(
    {
      entityType: "work.item",
      displayName: "A",
      scope: { orgId: ctx.auth.tenantId, projectId: ctx.auth.projectId },
    },
    tenantContext,
  );
  const b = await graphStore.upsertEntity(
    {
      entityType: "work.item",
      displayName: "B",
      scope: { orgId: ctx.auth.tenantId, projectId: ctx.auth.projectId },
    },
    tenantContext,
  );
  const attachment = await graphStore.upsertEntity(
    {
      entityType: "doc.attachment",
      displayName: "Attachment",
      scope: { orgId: ctx.auth.tenantId, projectId: ctx.auth.projectId },
    },
    tenantContext,
  );

  await graphStore.upsertEdge(
    {
      edgeType: "rel.work_links_work",
      sourceEntityId: a.id,
      targetEntityId: b.id,
      metadata: { link_type: "blocks" },
      scope: { orgId: ctx.auth.tenantId, projectId: ctx.auth.projectId },
    },
    tenantContext,
  );
  await graphStore.upsertEdge(
    {
      edgeType: "rel.work_links_work",
      sourceEntityId: b.id,
      targetEntityId: a.id,
      metadata: { link_type: "relates" },
      scope: { orgId: ctx.auth.tenantId, projectId: ctx.auth.projectId },
    },
    tenantContext,
  );
  await graphStore.upsertEdge(
    {
      edgeType: "rel.doc_contains_attachment",
      sourceEntityId: b.id,
      targetEntityId: attachment.id,
      metadata: { attachment_id: "att-1" },
      scope: { orgId: ctx.auth.tenantId, projectId: ctx.auth.projectId },
    },
    tenantContext,
  );

  const filtered = await (resolvers.Query.kbEdges as any)(
    null,
    { edgeTypes: ["rel.doc_contains_attachment"], first: 5 },
    ctx as any,
  );
  assert.equal(filtered.totalCount, 1);
  assert.equal(filtered.edges[0].node.edgeType, "rel.doc_contains_attachment");

  const inbound = await (resolvers.Query.kbEdges as any)(
    null,
    { edgeTypes: ["rel.work_links_work"], direction: "INBOUND", sourceId: b.id, first: 10 },
    ctx as any,
  );
  assert.equal(inbound.totalCount, 1);
  assert.equal(inbound.edges[0].node.targetEntityId, b.id);

  const both = await (resolvers.Query.kbEdges as any)(
    null,
    { edgeTypes: ["rel.work_links_work"], direction: "BOTH", sourceId: b.id, first: 10 },
    ctx as any,
  );
  assert.equal(both.totalCount, 2);

  const limited = await (resolvers.Query.kbEdges as any)(null, { first: 1 }, ctx as any);
  assert.ok(limited.edges.length <= 1);
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

  const nodesConnection = await (resolvers.Query.kbNodes as any)(null, { first: 5 }, ctx as any);
  assert.ok(nodesConnection.totalCount > 0, "sample kb nodes should be available");
  const sampleNodeId = nodesConnection.edges[0]?.node.id;
  assert.ok(sampleNodeId, "sample node id present");

  const nodeDetail = await (resolvers.Query.kbNode as any)(null, { id: sampleNodeId! }, ctx as any);
  assert.equal(nodeDetail?.id, sampleNodeId);

  const edgesConnection = await (resolvers.Query.kbEdges as any)(null, { first: 5 }, ctx as any);
  assert.ok(edgesConnection.totalCount > 0, "sample kb edges should be available");

  const scene = await (resolvers.Query.kbScene as any)(null, { id: sampleNodeId!, depth: 2, limit: 25 }, ctx as any);
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

  const facets = await (resolvers.Query.kbFacets as any)(null, {}, ctx as any);
  assert.ok(facets.nodeTypes.length > 0, "node facets should exist");
  const datasetFacet = facets.nodeTypes.find((entry: any) => entry.value === "catalog.dataset");
  assert.equal(datasetFacet?.count, 2);
  const dependencyFacet = facets.edgeTypes.find((entry: any) => entry.value === "DEPENDENCY_OF");
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

  const meta = await (resolvers.Query.kbMeta as any)(null, { scope: null }, ctx as any);
  assert.ok(meta.version.length > 0, "version should be populated");
  const dataset = meta.nodeTypes.find((entry: any) => entry.value === "catalog.dataset");
  const endpoint = meta.nodeTypes.find((entry: any) => entry.value === "metadata.endpoint");
  const doc = meta.nodeTypes.find((entry: any) => entry.value === "doc.page");
  const documentedBy = meta.edgeTypes.find((entry: any) => entry.value === "DOCUMENTED_BY");
  const dependency = meta.edgeTypes.find((entry: any) => entry.value === "DEPENDENCY_OF");

  assert.ok(dataset, "catalog.dataset should exist");
  assert.equal(dataset?.label, "Datasets");
  assert.ok(endpoint, "metadata.endpoint should exist");
  assert.ok(doc, "doc.page should exist");
  assert.ok(documentedBy, "DOCUMENTED_BY should exist");
  assert.equal(documentedBy?.label, "Documented by");
  assert.ok(dependency, "DEPENDENCY_OF should exist");
});

class FakeCdmEntityStore {
  private readonly work: CdmEntityEnvelope = {
    domain: "WORK_ITEM",
    cdmId: "cdm:work:item:1",
    sourceSystem: "jira",
    title: "Sample Work",
    createdAt: new Date("2024-11-01T12:00:00Z").toISOString(),
    updatedAt: new Date("2024-11-01T13:00:00Z").toISOString(),
    state: "In Progress",
    data: { summary: "Sample Work", projectCdmId: "cdm:work:project:1" },
  };

  private readonly doc: CdmEntityEnvelope = {
    domain: "DOC_ITEM",
    cdmId: "cdm:doc:item:1",
    sourceSystem: "confluence",
    title: "Doc Title",
    createdAt: new Date("2024-11-02T09:00:00Z").toISOString(),
    updatedAt: new Date("2024-11-02T10:00:00Z").toISOString(),
    state: "page",
    data: { docType: "page", spaceCdmId: "cdm:doc:space:ENG" },
  };

  async listEntities() {
    return {
      rows: [this.work],
      cursorOffset: 0,
      hasNextPage: false,
    };
  }

  async getEntity(args: { domain: string; cdmId: string }): Promise<CdmEntityEnvelope | null> {
    if (args.domain === "DOC_ITEM" && args.cdmId === this.doc.cdmId) {
      return this.doc;
    }
    if (args.domain === "WORK_ITEM" && args.cdmId === this.work.cdmId) {
      return this.work;
    }
    return null;
  }
}

const SAMPLE_WORK_ITEM_ROW: CdmWorkItemRow = {
  cdm_id: "cdm:work:item:jira:ENG-1",
  source_system: "jira",
  source_issue_key: "ENG-1",
  project_cdm_id: "cdm:work:project:jira:ENG",
  summary: "Seeded Jira issue",
  status: "In Progress",
  priority: "High",
  assignee_cdm_id: "cdm:work:user:jira:assignee",
  reporter_cdm_id: "cdm:work:user:jira:reporter",
  source_id: "ENG-1",
  source_url: "https://jira.example.com/browse/ENG-1",
  created_at: new Date("2024-01-02T00:00:00Z"),
  updated_at: new Date("2024-01-03T00:00:00Z"),
  closed_at: null,
  reporter_display_name: "Reporter",
  reporter_email: "reporter@example.com",
  assignee_display_name: "Assignee",
  assignee_email: "assignee@example.com",
  properties: {
    _metadata: {
      sourceDatasetId: "jira.issues",
      sourceEndpointId: "endpoint-1",
    },
    rawFields: { key: "ENG-1" },
  },
  raw_source: {},
};

const SAMPLE_WORK_COMMENT_ROW: CdmWorkCommentRow = {
  cdm_id: "cdm:work:comment:jira:ENG-1:1",
  source_system: "jira",
  item_cdm_id: SAMPLE_WORK_ITEM_ROW.cdm_id,
  author_cdm_id: "cdm:work:user:jira:commenter",
  body: "First comment",
  created_at: new Date("2024-01-03T10:00:00Z"),
  updated_at: new Date("2024-01-03T11:00:00Z"),
  author_display_name: "Commenter",
  author_email: "commenter@example.com",
  visibility: null,
  properties: {
    _metadata: {
      sourceDatasetId: "jira.comments",
      sourceEndpointId: "endpoint-1",
    },
  },
  item_project_cdm_id: SAMPLE_WORK_ITEM_ROW.project_cdm_id,
  item_source_issue_key: SAMPLE_WORK_ITEM_ROW.source_issue_key,
};

const SAMPLE_WORK_LOG_ROW: CdmWorkLogRow = {
  cdm_id: "cdm:work:worklog:jira:ENG-1:1",
  source_system: "jira",
  item_cdm_id: SAMPLE_WORK_ITEM_ROW.cdm_id,
  author_cdm_id: "cdm:work:user:jira:logger",
  started_at: new Date("2024-01-04T09:00:00Z"),
  time_spent_seconds: 3600,
  comment: "Investigating",
  author_display_name: "Logger",
  author_email: "logger@example.com",
  properties: {
    _metadata: {
      sourceDatasetId: "jira.worklogs",
      sourceEndpointId: "endpoint-1",
    },
  },
  item_project_cdm_id: SAMPLE_WORK_ITEM_ROW.project_cdm_id,
  item_source_issue_key: SAMPLE_WORK_ITEM_ROW.source_issue_key,
};

class FakeCdmWorkStore {
  async listProjects() {
    return [];
  }

  async listWorkItems() {
    return { rows: [SAMPLE_WORK_ITEM_ROW], cursorOffset: 0, hasNextPage: false };
  }

  async listWorkComments() {
    return { rows: [SAMPLE_WORK_COMMENT_ROW], cursorOffset: 0, hasNextPage: false };
  }

  async listWorkLogs() {
    return { rows: [SAMPLE_WORK_LOG_ROW], cursorOffset: 0, hasNextPage: false };
  }

  async getWorkItemDetail() {
    return {
      item: SAMPLE_WORK_ITEM_ROW,
      comments: [SAMPLE_WORK_COMMENT_ROW],
      worklogs: [SAMPLE_WORK_LOG_ROW],
    };
  }
}

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

test("cdmWork queries surface dataset metadata per entity", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-cdm-work-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  const fakeWorkStore = new FakeCdmWorkStore();
  const fakePrisma = {
    ingestionUnitConfig: {
      findMany: async () => [
        { id: "cfg-issues", datasetId: "jira.issues", endpointId: "endpoint-1", endpoint: { id: "endpoint-1", name: "Customer Success Jira" } },
        { id: "cfg-comments", datasetId: "jira.comments", endpointId: "endpoint-1", endpoint: { id: "endpoint-1", name: "Customer Success Jira" } },
        { id: "cfg-worklogs", datasetId: "jira.worklogs", endpointId: "endpoint-1", endpoint: { id: "endpoint-1", name: "Customer Success Jira" } },
      ],
    },
  };
  globalThis.__metadataPrismaClient = fakePrisma;
  t.after(() => {
    delete globalThis.__metadataPrismaClient;
  });
  const resolvers = createResolvers(store, { graphStore, cdmWorkStore: fakeWorkStore as any });
  const ctx = buildResolverContext();

  const issues = await (resolvers.Query.cdmWorkItems as any)(null, { first: 10 }, ctx as any);
  assert.equal(issues.edges.length, 1);
  assert.equal(issues.edges[0].node.datasetId, "jira.issues");
  assert.equal(issues.edges[0].node.sourceEndpointId, "endpoint-1");

  const comments = await (resolvers.Query.cdmWorkComments as any)(null, { first: 10 }, ctx as any);
  assert.equal(comments.edges.length, 1);
  assert.equal(comments.edges[0].node.parentIssueKey, "ENG-1");
  assert.equal(comments.edges[0].node.datasetId, "jira.comments");

  const worklogs = await (resolvers.Query.cdmWorkLogs as any)(null, { first: 10 }, ctx as any);
  assert.equal(worklogs.edges.length, 1);
  assert.equal(worklogs.edges[0].node.datasetId, "jira.worklogs");
  assert.equal(worklogs.edges[0].node.timeSpentSeconds, 3600);

  const datasets = await (resolvers.Query.cdmWorkDatasets as any)(null, {}, ctx as any);
  assert.equal(datasets.length, 3);
  const commentDataset = datasets.find((entry: any) => entry.datasetId === "jira.comments");
  assert.equal(commentDataset.entityKind, "COMMENT");
  assert.ok(commentDataset.label.includes("Customer Success Jira"));
});
