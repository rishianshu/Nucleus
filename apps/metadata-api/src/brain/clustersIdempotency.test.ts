import assert from "node:assert/strict";
import test from "node:test";
import { ClusterBuilderService } from "./clusters.js";
import type { BrainVectorSearch } from "./types.js";
import { createGraphWriteFixture } from "../graph/graphWriteTestUtils.js";

class FakeVectorSearch implements BrainVectorSearch {
  constructor(private readonly neighborIds: string[]) {}

  async search(args: {
    profileId: string;
    queryText: string;
    topK: number;
    tenantId: string;
    projectKeyIn?: string[];
    profileKindIn?: string[];
  }): Promise<Array<{ nodeId: string; score: number; profileId: string }>> {
    return this.neighborIds.slice(0, args.topK).map((nodeId, idx) => ({
      nodeId,
      score: 0.9 - idx * 0.1,
      profileId: args.profileId,
    }));
  }
}

test("Cluster building is idempotent across runs", async (t) => {
  const { graphWrite, graphStore, tenant, cleanup } = await createGraphWriteFixture({
    tenant: { tenantId: "tenant-idem", projectId: "PROJ" },
  });
  t.after(cleanup);

  const work = await graphWrite.upsertNode({
    nodeType: "cdm.work.item",
    nodeId: "work-idem-1",
    properties: { projectKey: tenant.projectId, summary: "Refine clustering" },
  });
  const doc = await graphWrite.upsertNode({
    nodeType: "cdm.doc.item",
    nodeId: "doc-idem-1",
    properties: { projectKey: tenant.projectId, title: "Clustering notes" },
  });

  const builder = new ClusterBuilderService({
    graphWrite,
    graphStore,
    vectorSearch: new FakeVectorSearch([doc.nodeId, work.nodeId]),
    scoreThreshold: 0,
    now: () => new Date("2024-03-01T00:00:00Z"),
  });

  const first = await builder.buildClustersForProject({ tenantId: tenant.tenantId, projectKey: tenant.projectId });
  const second = await builder.buildClustersForProject({ tenantId: tenant.tenantId, projectKey: tenant.projectId });
  assert.equal(first.clustersCreated, 1);
  assert.equal(second.clustersCreated, 0);

  const clusters = await graphStore.listEntities({ entityTypes: ["kg.cluster"] }, tenant);
  assert.equal(clusters.length, 1);
  const edges = await graphStore.listEdges({ edgeTypes: ["IN_CLUSTER"], targetEntityId: clusters[0].id }, tenant);
  assert.equal(edges.length, 2);
  const memberIds = edges.map((edge) => edge.sourceEntityId);
  assert.ok(memberIds.includes(work.nodeId));
  assert.ok(memberIds.includes(doc.nodeId));
});
