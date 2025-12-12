import assert from "node:assert/strict";
import test from "node:test";
import { GraphWriteError } from "./graphWrite.js";
import { createGraphWriteFixture } from "./graphWriteTestUtils.js";

test("GraphWrite.upsertEdge validates edge types and endpoints", async (t) => {
  const { graphWrite, graphStore, tenant, cleanup } = await createGraphWriteFixture();
  t.after(cleanup);

  const column = await graphWrite.upsertNode({
    nodeType: "cdm.column",
    nodeId: "col-1",
    properties: { displayName: "Column 1" },
  });
  const profile = await graphWrite.upsertNode({
    nodeType: "column.profile",
    nodeId: "profile-1",
    properties: { createdAt: new Date().toISOString() },
  });

  await graphWrite.upsertEdge({
    edgeType: "PROFILE_OF",
    fromNodeId: profile.nodeId,
    toNodeId: column.nodeId,
    properties: { score: 1 },
  });

  const edges = await graphStore.listEdges(
    { edgeTypes: ["PROFILE_OF"], targetEntityId: column.nodeId },
    tenant,
  );
  assert.equal(edges.length, 1);
  assert.equal(edges[0].edgeType, "PROFILE_OF");

  await assert.rejects(
    graphWrite.upsertEdge({
      edgeType: "UNKNOWN_EDGE",
      fromNodeId: profile.nodeId,
      toNodeId: column.nodeId,
    }),
    (error: any) => {
      assert.equal((error as GraphWriteError).code, "UNKNOWN_EDGE_TYPE");
      return true;
    },
  );

  const description = await graphWrite.upsertNode({
    nodeType: "column.description",
    nodeId: "desc-1",
    properties: { createdAt: new Date().toISOString() },
  });

  await assert.rejects(
    graphWrite.upsertEdge({
      edgeType: "PROFILE_OF",
      fromNodeId: description.nodeId,
      toNodeId: column.nodeId,
    }),
    (error: any) => {
      assert.equal((error as GraphWriteError).code, "EDGE_NODE_TYPE_MISMATCH");
      return true;
    },
  );
});
