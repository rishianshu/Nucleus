import assert from "node:assert/strict";
import test from "node:test";
import { createGraphWriteFixture } from "./graphWriteTestUtils.js";

test("GraphWrite upserts nodes and edges idempotently", async (t) => {
  const { graphWrite, graphStore, tenant, cleanup } = await createGraphWriteFixture();
  t.after(cleanup);

  await graphWrite.upsertNode({
    nodeType: "cdm.column",
    nodeId: "col-1",
    properties: {
      displayName: "Column 1",
      canonicalPath: "dataset.table.column1",
    },
  });

  await graphWrite.upsertNode({
    nodeType: "cdm.column",
    nodeId: "col-1",
    properties: {
      displayName: "Column 1 updated",
      canonicalPath: "dataset.table.column1",
      quality: "good",
    },
  });

  const nodes = await graphStore.listEntities({ entityTypes: ["cdm.column"] }, tenant);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].displayName, "Column 1 updated");
  assert.equal((nodes[0].properties as any).quality, "good");

  const description = await graphWrite.upsertNode({
    nodeType: "column.description",
    nodeId: "desc-1",
    properties: {
      createdAt: new Date().toISOString(),
      text: "first",
    },
  });

  await graphWrite.upsertEdge({
    edgeType: "DESCRIBES",
    fromNodeId: description.nodeId,
    toNodeId: "col-1",
    properties: { source: "first" },
  });

  await graphWrite.upsertEdge({
    edgeType: "DESCRIBES",
    fromNodeId: description.nodeId,
    toNodeId: "col-1",
    properties: { source: "updated" },
  });

  const edges = await graphStore.listEdges({ edgeTypes: ["DESCRIBES"], sourceEntityId: description.nodeId }, tenant);
  assert.equal(edges.length, 1);
  assert.equal((edges[0].metadata as any).source, "updated");
});
