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
      score: Math.max(0.1, 1 - idx * 0.1),
      profileId: args.profileId,
    }));
  }
}

test("ClusterBuilder groups seeded work and doc nodes via vector neighbors", async (t) => {
  const { graphWrite, graphStore, tenant, cleanup } = await createGraphWriteFixture({
    tenant: { tenantId: "tenant-build", projectId: "ENG" },
  });
  t.after(cleanup);

  const workPrimary = await graphWrite.upsertNode({
    nodeType: "cdm.work.item",
    nodeId: "work-build-1",
    properties: { projectKey: tenant.projectId, summary: "Investigate auth errors" },
  });
  const workSecondary = await graphWrite.upsertNode({
    nodeType: "cdm.work.item",
    nodeId: "work-build-2",
    properties: { projectKey: tenant.projectId, summary: "Document auth changes" },
  });
  const doc = await graphWrite.upsertNode({
    nodeType: "cdm.doc.item",
    nodeId: "doc-build-1",
    properties: { projectKey: tenant.projectId, title: "Auth design doc" },
  });

  const vectorSearch = new FakeVectorSearch([doc.nodeId, workSecondary.nodeId, workPrimary.nodeId]);
  const builder = new ClusterBuilderService({
    graphWrite,
    graphStore,
    vectorSearch,
    scoreThreshold: 0,
    now: () => new Date("2024-02-01T00:00:00Z"),
  });

  const result = await builder.buildClustersForProject({ tenantId: tenant.tenantId, projectKey: tenant.projectId, maxClusterSize: 4 });
  assert.equal(result.clustersCreated, 1);

  const clusters = await graphStore.listEntities({ entityTypes: ["kg.cluster"] }, tenant);
  assert.equal(clusters.length, 1);
  const cluster = clusters[0];
  assert.equal(cluster.properties.clusterKind, "work-doc-episode");
  const seedIds = Array.isArray(cluster.properties.seedNodeIds) ? (cluster.properties.seedNodeIds as string[]) : [];
  assert.ok(seedIds.includes(workPrimary.nodeId));
  assert.ok(seedIds.includes(doc.nodeId));

  const edges = await graphStore.listEdges({ edgeTypes: ["IN_CLUSTER"], targetEntityId: cluster.id }, tenant);
  const memberIds = new Set(edges.map((edge) => edge.sourceEntityId));
  assert.equal(memberIds.size, 3);
  assert.ok(memberIds.has(workPrimary.nodeId));
  assert.ok(memberIds.has(workSecondary.nodeId));
  assert.ok(memberIds.has(doc.nodeId));
});
