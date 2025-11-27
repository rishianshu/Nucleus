import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { readTransientState, writeTransientState, __resetTransientStateStoreForTests } from "./transientState.js";

test("transient state read/write/delete round trip", async (t) => {
  const kvFile = path.join(os.tmpdir(), `transient-state-${Date.now().toString(36)}.json`);
  const previousDriver = process.env.INGESTION_KV_DRIVER;
  const previousFile = process.env.INGESTION_KV_FILE;
  process.env.INGESTION_KV_DRIVER = "file";
  process.env.INGESTION_KV_FILE = kvFile;
  t.after(() => {
    process.env.INGESTION_KV_DRIVER = previousDriver;
    process.env.INGESTION_KV_FILE = previousFile;
    __resetTransientStateStoreForTests();
  });
  const key = { endpointId: "ep-1", unitId: "jira.issues", sinkId: "kb" };
  const initial = await readTransientState(key);
  assert.equal(initial.state, null);
  assert.equal(initial.version, null);
  const version = await writeTransientState(key, { projects: { ENG: { lastUpdated: "2024-01-01T00:00:00.000Z" } } });
  assert.ok(version);
  const afterWrite = await readTransientState(key);
  assert.deepEqual(afterWrite.state, { projects: { ENG: { lastUpdated: "2024-01-01T00:00:00.000Z" } } });
  assert.equal(afterWrite.version, version);
  await writeTransientState(key, null, { expectedVersion: version });
  const cleared = await readTransientState(key);
  assert.equal(cleared.state, null);
  assert.equal(cleared.version, null);
});
