import assert from "node:assert/strict";
import test from "node:test";
import { ClusterBuilderService, ClusterReadService } from "./clusters.js";
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
      score: 0.95 - idx * 0.05,
      profileId: args.profileId,
    }));
  }
}

test("ClusterRead lists clusters and member nodes for a project", async (t) => {
  const { graphWrite, graphStore, tenant, cleanup } = await createGraphWriteFixture({
    tenant: { tenantId: "tenant-read", projectId: "OPS" },
  });
  t.after(cleanup);

  const work = await graphWrite.upsertNode({
    nodeType: "cdm.work.item",
    nodeId: "work-read-1",
    properties: { projectKey: tenant.projectId, summary: "Scale job queue" },
  });
  const doc = await graphWrite.upsertNode({
    nodeType: "cdm.doc.item",
    nodeId: "doc-read-1",
    properties: { projectKey: tenant.projectId, title: "Queue design doc" },
  });

  const builder = new ClusterBuilderService({
    graphWrite,
    graphStore,
    vectorSearch: new FakeVectorSearch([doc.nodeId, work.nodeId]),
    scoreThreshold: 0,
    now: () => new Date("2024-04-01T00:00:00Z"),
  });

  await builder.buildClustersForProject({ tenantId: tenant.tenantId, projectKey: tenant.projectId });

  const read = new ClusterReadService(graphStore);
  const clusters = await read.listClustersForProject({
    tenantId: tenant.tenantId,
    projectKey: tenant.projectId,
  });

  assert.equal(clusters.length, 1);
  const summary = clusters[0];
  assert.ok(summary.clusterNodeId);
  assert.equal(summary.clusterKind, "work-doc-episode");
  assert.ok(summary.memberNodeIds.includes(work.nodeId));
  assert.ok(summary.memberNodeIds.includes(doc.nodeId));
});
