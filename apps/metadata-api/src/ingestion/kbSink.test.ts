import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileMetadataStore, createGraphStore } from "@metadata/core";
import type { IngestionSinkContext, NormalizedBatch } from "@metadata/core";
import { KnowledgeBaseSink } from "./kbSink.js";

const TENANT_CONTEXT = { tenantId: "dev", projectId: "global", actorId: "test" };

test("knowledge base sink upserts normalized records into the graph store", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "kb-sink-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const metadataStore = new FileMetadataStore({ rootDir: tempDir });
  const graphStore = createGraphStore({ metadataStore });
  const sink = new KnowledgeBaseSink(graphStore);
  const context: IngestionSinkContext = { endpointId: "endpoint-1", unitId: "unit-1", sinkId: "kb", runId: "run-1" };

  const batch: NormalizedBatch = {
    records: [
      {
        entityType: "work.item",
        logicalId: "WI-100",
        displayName: "Sample Work Item",
        scope: { orgId: "dev-org", projectId: "global" },
        provenance: { endpointId: "endpoint-1", vendor: "jira" },
        payload: { canonicalPath: "work.item/wi-100", severity: "high" },
      },
    ],
  };

  const stats = await sink.writeBatch(batch, context);
  assert.equal(stats.upserts, 1);
  assert.equal(stats.edges, 0);
  await sink.commit(context);

  const nodes = await graphStore.listEntities(
    { entityTypes: ["work.item"], limit: 10 },
    TENANT_CONTEXT,
  );
  assert.equal(nodes.length, 1);
  const node = nodes[0];
  assert.equal(node.displayName, "Sample Work Item");
  assert.equal(node.identity.originEndpointId, "endpoint-1");
  assert.equal(node.scope.orgId, "dev-org");
  assert.equal(node.scope.projectId, "global");
});

test("knowledge base sink generates logical keys when absent", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "kb-sink-missing-key-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const metadataStore = new FileMetadataStore({ rootDir: tempDir });
  const graphStore = createGraphStore({ metadataStore });
  const sink = new KnowledgeBaseSink(graphStore);
  const context: IngestionSinkContext = { endpointId: "endpoint-2", unitId: "unit-1", sinkId: "kb", runId: "run-2" };

  const batch: NormalizedBatch = {
    records: [
      {
        entityType: "catalog.dataset",
        scope: { orgId: "tenant-two", projectId: "alpha", domainId: "catalog" },
        provenance: { endpointId: "endpoint-2", vendor: "custom" },
        payload: { schema: "public", table: "orders" },
      },
    ],
  };
  await sink.writeBatch(batch, context);

  const nodes = await graphStore.listEntities(
    { entityTypes: ["catalog.dataset"], limit: 10 },
    { tenantId: "dev", projectId: "alpha", actorId: "endpoint-2" },
  );
  assert.equal(nodes.length, 1);
  assert.ok(nodes[0].identity.logicalKey, "logical key should be generated");
});

test("knowledge base sink emits doc link relations", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "kb-sink-doc-link-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const metadataStore = new FileMetadataStore({ rootDir: tempDir });
  const graphStore = createGraphStore({ metadataStore });
  const sink = new KnowledgeBaseSink(graphStore);
  const context: IngestionSinkContext = { endpointId: "endpoint-docs", unitId: "unit-docs", sinkId: "kb", runId: "run-docs" };

  const batch: NormalizedBatch = {
    records: [
      {
        entityType: "cdm.doc.link",
        logicalId: "link-1",
        displayName: "Doc Link",
        scope: { orgId: "dev", projectId: "docs" },
        provenance: { endpointId: "endpoint-docs", vendor: "confluence" },
        payload: {
          from_item_cdm_id: "cdm:doc:item:confluence:123",
          to_item_cdm_id: "cdm:doc:item:confluence:456",
          link_type: "reference",
          source_system: "confluence",
        },
      },
    ],
  };

  const stats = await sink.writeBatch(batch, context);
  await sink.commit(context);
  assert.equal(stats.upserts, 0, "doc link should not upsert main entity");
  assert.equal(stats.edges, 1, "doc link should emit one relation edge");

  const nodes = await graphStore.listEntities({ entityTypes: ["doc.item"], limit: 10 }, { tenantId: "dev", projectId: "docs", actorId: "endpoint-docs" });
  const ids = nodes.map((n) => n.id);
  assert.ok(ids.includes("cdm:doc:item:confluence:123"));
  assert.ok(ids.includes("cdm:doc:item:confluence:456"));

  const edges = await graphStore.listEdges({ edgeTypes: ["rel.doc_links_doc"], limit: 10 }, { tenantId: "dev", projectId: "docs", actorId: "endpoint-docs" });
  assert.equal(edges.length, 1);
  assert.equal(edges[0].sourceEntityId, "cdm:doc:item:confluence:123");
  assert.equal(edges[0].targetEntityId, "cdm:doc:item:confluence:456");
});

test("knowledge base sink emits doc attachment relations", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "kb-sink-doc-attachments-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const metadataStore = new FileMetadataStore({ rootDir: tempDir });
  const graphStore = createGraphStore({ metadataStore });
  const sink = new KnowledgeBaseSink(graphStore);
  const context: IngestionSinkContext = { endpointId: "endpoint-docs", unitId: "unit-docs", sinkId: "kb", runId: "run-docs" };

  const batch: NormalizedBatch = {
    records: [
      {
        entityType: "doc.item",
        logicalId: "doc-1",
        displayName: "Doc 1",
        scope: { orgId: "dev", projectId: "docs" },
        provenance: { endpointId: "endpoint-docs", vendor: "confluence" },
        payload: {
          canonicalPath: "doc/1",
          attachments: [
            { id: "att-1", filename: "design.pdf", size: 123 },
            { id: "att-2", filename: "notes.txt", size: 10 },
          ],
        },
      },
    ],
  };

  const stats = await sink.writeBatch(batch, context);
  await sink.commit(context);
  assert.equal(stats.upserts, 1, "should upsert the doc entity");
  assert.equal(stats.edges, 2, "should emit two attachment relations");

  const attachments = await graphStore.listEntities(
    { entityTypes: ["doc.attachment"], limit: 10 },
    { tenantId: "dev", projectId: "docs", actorId: "endpoint-docs" },
  );
  const ids = attachments.map((n) => n.id);
  assert.ok(ids.some((id) => id.includes("att-1")));
  assert.ok(ids.some((id) => id.includes("att-2")));

  const edges = await graphStore.listEdges(
    { edgeTypes: ["rel.doc_contains_attachment"], limit: 10 },
    { tenantId: "dev", projectId: "docs", actorId: "endpoint-docs" },
  );
  assert.equal(edges.length, 2);
  assert.ok(edges.every((edge) => edge.sourceEntityId === "doc-1"));
});

test("knowledge base sink emits work_links_work when both targets are present", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "kb-sink-work-links-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const metadataStore = new FileMetadataStore({ rootDir: tempDir });
  const graphStore = createGraphStore({ metadataStore });
  const sink = new KnowledgeBaseSink(graphStore);
  const context: IngestionSinkContext = { endpointId: "endpoint-work", unitId: "unit-work", sinkId: "kb", runId: "run-work" };

  const batch: NormalizedBatch = {
    records: [
      {
        entityType: "work.item",
        logicalId: "work-1",
        displayName: "Issue 1",
        scope: { orgId: "dev", projectId: "work" },
        provenance: { endpointId: "endpoint-work", vendor: "jira" },
        payload: { canonicalPath: "work/1", relations: [{ type: "blocks", targetLogicalId: "work-2" }] },
      },
      {
        entityType: "work.item",
        logicalId: "work-2",
        displayName: "Issue 2",
        scope: { orgId: "dev", projectId: "work" },
        provenance: { endpointId: "endpoint-work", vendor: "jira" },
        payload: { canonicalPath: "work/2" },
      },
    ],
  };

  const stats = await sink.writeBatch(batch, context);
  await sink.commit(context);
  assert.equal(stats.upserts, 2);
  assert.equal(stats.edges, 1, "one work_links_work edge expected");

  const edges = await graphStore.listEdges(
    { edgeTypes: ["rel.work_links_work"], limit: 10 },
    { tenantId: "dev", projectId: "work", actorId: "endpoint-work" },
  );
  assert.equal(edges.length, 1);
  assert.equal(edges[0].sourceEntityId, "work-1");
  assert.equal(edges[0].targetEntityId, "work-2");
});

test("knowledge base sink emits drive_contains_item from doc.item parent references", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "kb-sink-drive-items-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  const metadataStore = new FileMetadataStore({ rootDir: tempDir });
  const graphStore = createGraphStore({ metadataStore });
  const sink = new KnowledgeBaseSink(graphStore);
  const context: IngestionSinkContext = { endpointId: "endpoint-drive", unitId: "unit-drive", sinkId: "kb", runId: "run-drive" };

  const batch: NormalizedBatch = {
    records: [
      {
        entityType: "doc.space",
        logicalId: "cdm:doc:space:onedrive:drive-1",
        displayName: "Drive 1",
        scope: { orgId: "dev", projectId: "docs" },
        provenance: { endpointId: "endpoint-drive", vendor: "onedrive" },
        payload: { canonicalPath: "drive-1" },
      },
      {
        entityType: "doc.item",
        logicalId: "cdm:doc:item:onedrive:drive-1:folder-1",
        displayName: "Folder 1",
        scope: { orgId: "dev", projectId: "docs" },
        provenance: { endpointId: "endpoint-drive", vendor: "onedrive" },
        payload: {
          canonicalPath: "drive-1/folder-1",
          parent_item_cdm_id: null,
          space_cdm_id: "cdm:doc:space:onedrive:drive-1",
        },
      },
      {
        entityType: "doc.item",
        logicalId: "cdm:doc:item:onedrive:drive-1:file-1",
        displayName: "File 1",
        scope: { orgId: "dev", projectId: "docs" },
        provenance: { endpointId: "endpoint-drive", vendor: "onedrive" },
        payload: {
          canonicalPath: "drive-1/folder-1/file-1",
          parent_item_cdm_id: "cdm:doc:item:onedrive:drive-1:folder-1",
          space_cdm_id: "cdm:doc:space:onedrive:drive-1",
        },
      },
    ],
  };

  const stats = await sink.writeBatch(batch, context);
  await sink.commit(context);
  assert.equal(stats.upserts, 3);

  const edges = await graphStore.listEdges(
    { edgeTypes: ["rel.drive_contains_item"], limit: 10 },
    { tenantId: "dev", projectId: "docs", actorId: "endpoint-drive" },
  );
  const edgeSources = edges.map((e) => e.sourceEntityId);
  const edgeTargets = edges.map((e) => e.targetEntityId);
  assert.ok(edgeSources.includes("cdm:doc:space:onedrive:drive-1"));
  assert.ok(edgeTargets.includes("cdm:doc:item:onedrive:drive-1:folder-1"));
  assert.ok(edgeSources.includes("cdm:doc:item:onedrive:drive-1:folder-1"));
  assert.ok(edgeTargets.includes("cdm:doc:item:onedrive:drive-1:file-1"));
});
