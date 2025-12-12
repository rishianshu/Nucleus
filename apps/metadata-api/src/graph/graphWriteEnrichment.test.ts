import assert from "node:assert/strict";
import test from "node:test";
import { createGraphWriteFixture } from "./graphWriteTestUtils.js";

test("GraphWrite creates enrichment nodes and edges that are queryable", async (t) => {
  const { graphWrite, graphStore, tenant, cleanup } = await createGraphWriteFixture();
  t.after(cleanup);

  const column = await graphWrite.upsertNode({
    nodeType: "cdm.column",
    nodeId: "col-1",
    properties: {
      displayName: "Column 1",
      canonicalPath: "dataset.table.column1",
    },
  });

  const description = await graphWrite.upsertNode({
    nodeType: "column.description",
    nodeId: "desc-1",
    properties: {
      createdAt: new Date().toISOString(),
      text: "Column description",
    },
  });

  const profile = await graphWrite.upsertNode({
    nodeType: "column.profile",
    nodeId: "profile-1",
    properties: {
      createdAt: new Date().toISOString(),
      summary: "Profile summary",
    },
  });

  await graphWrite.upsertEdge({
    edgeType: "DESCRIBES",
    fromNodeId: description.nodeId,
    toNodeId: column.nodeId,
    properties: { source: "test" },
  });

  await graphWrite.upsertEdge({
    edgeType: "PROFILE_OF",
    fromNodeId: profile.nodeId,
    toNodeId: column.nodeId,
    properties: { score: 0.9 },
  });

  const inboundEdges = await graphStore.listEdges(
    { targetEntityId: column.nodeId, edgeTypes: ["DESCRIBES", "PROFILE_OF"] },
    tenant,
  );
  const edgeTypes = inboundEdges.map((edge) => edge.edgeType).sort();
  assert.deepEqual(edgeTypes, ["DESCRIBES", "PROFILE_OF"]);

  const descriptionNode = await graphStore.getEntity(description.nodeId, tenant);
  assert.equal(descriptionNode?.entityType, "column.description");
  assert.equal((descriptionNode?.properties as any).text, "Column description");

  const profileNode = await graphStore.getEntity(profile.nodeId, tenant);
  assert.equal(profileNode?.entityType, "column.profile");
  assert.equal((profileNode?.properties as any).summary, "Profile summary");
});
