import assert from "node:assert/strict";
import test from "node:test";
import { BrainVectorSearchService } from "./vectorSearch.js";
import { PrismaIndexProfileStore } from "./indexProfileStore.js";
import { PrismaVectorIndexStore } from "./vectorIndexStore.js";
import { FakeEmbeddingProvider, buildOneHotVector, clearVectorIndex, prismaPromise } from "./testUtils.js";

test("BrainVectorSearch filters by metadata and sorts results", async () => {
  const prisma = await prismaPromise;
  await clearVectorIndex();
  const vectorStore = new PrismaVectorIndexStore();
  await vectorStore.upsertEntries([
    {
      nodeId: "doc-1",
      profileId: "cdm.doc.body",
      chunkId: "chunk-0",
      embedding: buildOneHotVector(1, 1),
      tenantId: "tenant-1",
      projectKey: "ENG",
      profileKind: "doc",
      sourceSystem: "confluence",
    },
    {
      nodeId: "doc-2",
      profileId: "cdm.doc.body",
      chunkId: "chunk-0",
      embedding: buildOneHotVector(2, 1),
      tenantId: "tenant-1",
      projectKey: "MKT",
      profileKind: "doc",
      sourceSystem: "confluence",
    },
  ]);

  const search = new BrainVectorSearchService({
    embeddingProvider: new FakeEmbeddingProvider(() => buildOneHotVector(1, 1)),
    profileStore: new PrismaIndexProfileStore(),
    vectorStore,
  });

  try {
    const results = await search.search({
      profileId: "cdm.doc.body",
      queryText: "project filter",
      topK: 5,
      tenantId: "tenant-1",
      projectKeyIn: ["ENG"],
    });
    assert.equal(results.length, 1);
    assert.equal(results[0]?.nodeId, "doc-1");
  } finally {
    await prisma.vectorIndexEntry.deleteMany({ where: { nodeId: { in: ["doc-1", "doc-2"] } } });
  }
});
