import assert from "node:assert/strict";
import test from "node:test";
import type { BrainVectorSearch } from "./types.js";

test("search respects normalized project/profile filters across sources", async () => {
  const fakeHits = [
    {
      nodeId: "work-node-1",
      score: 1,
      metadata: { profileKind: "work", projectKey: "SHARED", sourceSystem: "jira", tenantId: "tenant-1" },
    },
    {
      nodeId: "doc-node-1",
      score: 1,
      metadata: { profileKind: "doc", projectKey: "SHARED", sourceSystem: "confluence", tenantId: "tenant-1" },
    },
  ];

  class FakeVectorSearch implements BrainVectorSearch {
    async search(): Promise<any[]> {
      return fakeHits;
    }
  }
  const search = new FakeVectorSearch();

  const results = await search.search({
    profileId: "cdm.doc.body",
    queryText: "shared project query",
    topK: 5,
    tenantId: "tenant-1",
    projectKeyIn: ["SHARED"],
    profileKindIn: ["work", "doc"],
  });
  const nodeIds = new Set(results.map((result) => result.nodeId));
  assert.equal(nodeIds.has("work-node-1"), true);
  assert.equal(nodeIds.has("doc-node-1"), true);
});
