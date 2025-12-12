import assert from "node:assert/strict";
import test from "node:test";
import { GraphWriteError } from "./graphWrite.js";
import { createGraphWriteFixture } from "./graphWriteTestUtils.js";

test("GraphWrite.upsertNode enforces registry and required props", async (t) => {
  const { graphWrite, cleanup } = await createGraphWriteFixture();
  t.after(cleanup);

  const created = await graphWrite.upsertNode({
    nodeType: "column.profile",
    nodeId: "profile-1",
    properties: {
      createdAt: new Date().toISOString(),
      summary: "ok",
    },
  });
  assert.ok(created.nodeId);

  await assert.rejects(
    graphWrite.upsertNode({
      nodeType: "column.profile",
      nodeId: "profile-missing",
      properties: { summary: "missing createdAt" },
    }),
    (error: any) => {
      assert.equal((error as GraphWriteError).code, "MISSING_REQUIRED_PROPS");
      return true;
    },
  );

  await assert.rejects(
    graphWrite.upsertNode({ nodeType: "unknown.type", nodeId: "unknown-1", properties: {} }),
    (error: any) => {
      assert.equal((error as GraphWriteError).code, "UNKNOWN_NODE_TYPE");
      return true;
    },
  );
});
