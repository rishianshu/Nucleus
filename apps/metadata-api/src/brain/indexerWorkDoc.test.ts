import assert from "node:assert/strict";
import test from "node:test";
import { GraphNodeIndexer } from "./indexer.js";
import { VECTOR_DIMENSION } from "./vectorIndexStore.js";
import { FakeEmbeddingProvider, clearVectorIndex, createGraphNode, hashTextToVector, prismaPromise } from "./testUtils.js";

test("NodeIndexer embeds work and doc nodes with normalized metadata", async () => {
  const prisma = await prismaPromise;
  await clearVectorIndex();
  const nodeIds: string[] = [];
  try {
    const workNode = await createGraphNode(prisma, {
      entityType: "cdm.work.item",
      sourceSystem: "jira",
      scopeOrgId: "tenant-1",
      scopeProjectId: "ENG",
      properties: { summary: "Fix onboarding bug", projectKey: "ENG" },
    });
    const docNode = await createGraphNode(prisma, {
      entityType: "cdm.doc.item",
      sourceSystem: "confluence",
      scopeOrgId: "tenant-1",
      scopeProjectId: "ENG",
      properties: { body: "Document body content", projectKey: "ENG" },
    });
    nodeIds.push(workNode.id, docNode.id);

    const indexer = new GraphNodeIndexer({ embeddingProvider: new FakeEmbeddingProvider(hashTextToVector) });
    await indexer.indexNodesForProfile({ profileId: "cdm.work.summary" });
    await indexer.indexNodesForProfile({ profileId: "cdm.doc.body" });

    type VectorIndexRow = {
      profile_id: string;
      node_id: string;
      tenant_id: string;
      project_key: string | null;
      profile_kind: string;
      embedding_text: string;
    };
    const rows = await prisma.$queryRaw<VectorIndexRow[]>`SELECT profile_id, node_id, tenant_id, project_key, profile_kind, embedding::text AS embedding_text FROM "vector_index_entries"`;

    const workEntry = rows.find((row: VectorIndexRow) => row.profile_id === "cdm.work.summary");
    const docEntry = rows.find((row: VectorIndexRow) => row.profile_id === "cdm.doc.body");
    assert.ok(workEntry, "work entry should be present");
    assert.ok(docEntry, "doc entry should be present");
    assert.equal(workEntry?.node_id, workNode.id);
    assert.equal(docEntry?.node_id, docNode.id);
    assert.equal(workEntry?.tenant_id, "tenant-1");
    assert.equal(docEntry?.tenant_id, "tenant-1");
    assert.equal(workEntry?.project_key, "ENG");
    assert.equal(docEntry?.project_key, "ENG");
    assert.equal(workEntry?.profile_kind, "work");
    assert.equal(docEntry?.profile_kind, "doc");
    assert.equal(workEntry?.embedding_text.split(",").length, VECTOR_DIMENSION);
  } finally {
    await prisma.vectorIndexEntry.deleteMany();
    await prisma.graphNode.deleteMany({ where: { id: { in: nodeIds } } });
  }
});
