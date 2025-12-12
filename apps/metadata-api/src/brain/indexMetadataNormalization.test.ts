import assert from "node:assert/strict";
import test from "node:test";
import { BrainVectorSearchService } from "./vectorSearch.js";
import { PrismaIndexProfileStore } from "./indexProfileStore.js";
import { PrismaVectorIndexStore } from "./vectorIndexStore.js";
import { FakeEmbeddingProvider, buildOneHotVector, clearVectorIndex, prismaPromise } from "./testUtils.js";

test("search respects normalized project/profile filters across sources", async () => {
  const prisma = await prismaPromise;
  await clearVectorIndex();
  const vectorStore = new PrismaVectorIndexStore();
  await vectorStore.upsertEntries([
    {
      nodeId: "work-node-1",
      profileId: "cdm.work.summary",
      chunkId: "chunk-0",
      embedding: buildOneHotVector(3, 1),
      tenantId: "tenant-1",
      projectKey: "SHARED",
      profileKind: "work",
      sourceSystem: "jira",
    },
    {
      nodeId: "doc-node-1",
      profileId: "cdm.doc.body",
      chunkId: "chunk-0",
      embedding: buildOneHotVector(3, 1),
      tenantId: "tenant-1",
      projectKey: "SHARED",
      profileKind: "doc",
      sourceSystem: "confluence",
    },
  ]);

  const search = new BrainVectorSearchService({
    embeddingProvider: new FakeEmbeddingProvider(() => buildOneHotVector(3, 1)),
    profileStore: new PrismaIndexProfileStore(),
    vectorStore,
  });

  try {
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
  } finally {
    await prisma.vectorIndexEntry.deleteMany({ where: { nodeId: { in: ["work-node-1", "doc-node-1"] } } });
  }
});
