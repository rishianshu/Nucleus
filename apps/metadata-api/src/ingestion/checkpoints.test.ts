import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  __resetCheckpointStoreForTests,
  readCheckpoint,
  writeCheckpoint,
  updateCheckpoint,
  resetCheckpoint,
  type IngestionCheckpointKey,
} from "./checkpoints.js";

test("checkpoints persist values and support reset", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ingestion-checkpoints-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  process.env.INGESTION_KV_FILE = path.join(tempDir, "kv.json");
  __resetCheckpointStoreForTests();
  const key: IngestionCheckpointKey = { endpointId: "endpoint-a", unitId: "unit-a", vendor: "vendor-a" };

  const initial = await readCheckpoint(key);
  assert.equal(initial.checkpoint, null);
  assert.equal(initial.version, null);

  const version = await writeCheckpoint(key, { cursor: { offset: 10 }, stats: { processed: 5 } });
  assert.ok(version, "write should return version token");

  const afterWrite = await readCheckpoint(key);
  assert.deepEqual(afterWrite.checkpoint?.cursor, { offset: 10 });
  assert.equal(afterWrite.version, version);

  await resetCheckpoint(key);
  const afterReset = await readCheckpoint(key);
  assert.equal(afterReset.checkpoint, null);
  assert.equal(afterReset.version, null);
});

test("updateCheckpoint enforces optimistic concurrency", async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ingestion-checkpoints-cas-"));
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });
  process.env.INGESTION_KV_FILE = path.join(tempDir, "kv.json");
  __resetCheckpointStoreForTests();
  const key: IngestionCheckpointKey = { endpointId: "endpoint-b", unitId: "unit-b", vendor: "vendor-b" };

  const first = await updateCheckpoint(key, () => ({ cursor: { offset: 1 } }));
  assert.equal(extractOffset(first.checkpoint.cursor), 1);

  const second = await updateCheckpoint(key, (previous) => {
    const offset = extractOffset(previous?.cursor) + 1;
    return {
      ...previous,
      cursor: { offset },
      lastRunId: "run-123",
    };
  });
  assert.equal(extractOffset(second.checkpoint.cursor), 2);
  assert.equal(second.checkpoint.lastRunId, "run-123");

  await writeCheckpoint(key, { cursor: { offset: 99 } });
  await assert.rejects(
    () =>
      updateCheckpoint(
        key,
        () => ({
          cursor: { offset: -1 },
        }),
      ),
    /CAS mismatch/i,
  );
});

function extractOffset(cursor: unknown): number {
  if (cursor && typeof cursor === "object" && "offset" in (cursor as Record<string, unknown>)) {
    const raw = (cursor as Record<string, unknown>).offset;
    return typeof raw === "number" ? raw : 0;
  }
  return 0;
}
