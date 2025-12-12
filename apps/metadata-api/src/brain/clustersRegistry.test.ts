import assert from "node:assert/strict";
import test from "node:test";
import { ClusterBuilderService } from "./clusters.js";
import type { BrainVectorSearch } from "./types.js";
import { createGraphWriteFixture } from "../graph/graphWriteTestUtils.js";

class FakeVectorSearch implements BrainVectorSearch {
  constructor(private readonly neighborId: string) {}

  async search(args: {
    profileId: string;
    queryText: string;
    topK: number;
    tenantId: string;
    projectKeyIn?: string[];
    profileKindIn?: string[];
  }): Promise<Array<{ nodeId: string; score: number; profileId: string }>> {
    if (!this.neighborId) {
      return [];
    }
    return [{ nodeId: this.neighborId, score: 0.9, profileId: args.profileId }];
  }
}

test("kg.cluster registry exists and supports IN_CLUSTER creation", async (t) => {
  const { graphWrite, graphStore, registry, tenant, cleanup } = await createGraphWriteFixture({
    tenant: { tenantId: "tenant-registry", projectId: "ENG" },
  });
  t.after(cleanup);

  const nodeType = await registry.getNodeType("kg.cluster");
  assert.ok(nodeType, "kg.cluster node type should exist");
  assert.ok(nodeType.requiredProps?.includes("tenantId"));
  assert.ok(nodeType.requiredProps?.includes("projectKey"));

  const edgeType = await registry.getEdgeType("IN_CLUSTER");
  assert.ok(edgeType, "IN_CLUSTER edge type should exist");
  assert.equal(edgeType?.toNodeTypeId, "kg.cluster");

  const work = await graphWrite.upsertNode({
    nodeType: "cdm.work.item",
    nodeId: "work-reg-1",
    properties: { projectKey: tenant.projectId, summary: "Seed work" },
  });
  const doc = await graphWrite.upsertNode({
    nodeType: "cdm.doc.item",
    nodeId: "doc-reg-1",
    properties: { projectKey: tenant.projectId, title: "Doc neighbor" },
  });

  const builder = new ClusterBuilderService({
    graphWrite,
    graphStore,
    vectorSearch: new FakeVectorSearch(doc.nodeId),
    scoreThreshold: 0,
    now: () => new Date("2024-01-01T00:00:00Z"),
  });

  const result = await builder.buildClustersForProject({ tenantId: tenant.tenantId, projectKey: tenant.projectId });
  assert.equal(result.clustersCreated, 1);

  const clusters = await graphStore.listEntities({ entityTypes: ["kg.cluster"] }, tenant);
  assert.equal(clusters.length, 1);
  const edges = await graphStore.listEdges({ edgeTypes: ["IN_CLUSTER"], targetEntityId: clusters[0].id }, tenant);
  const memberIds = edges.map((edge) => edge.sourceEntityId);
  assert.ok(memberIds.includes(work.nodeId));
  assert.ok(memberIds.includes(doc.nodeId));
});
