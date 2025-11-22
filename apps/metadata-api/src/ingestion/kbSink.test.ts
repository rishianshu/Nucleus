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
