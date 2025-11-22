import type { KeyValueStore } from "@metadata/core";
import { createKeyValueStore } from "@metadata/core";

const CHECKPOINT_PREFIX = "ingest";

export type IngestionCheckpointKey = {
  endpointId: string;
  unitId: string;
  vendor?: string | null;
  sinkId?: string | null;
};

export type IngestionCheckpointRecord = {
  cursor?: unknown;
  lastUpdatedAt?: string;
  lastRunId?: string | null;
  lastError?: string | null;
  stats?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

let kvStore: KeyValueStore | null = null;
let kvStoreSignature: string | null = null;

function resolveStore(): KeyValueStore {
  const driver = process.env.INGESTION_KV_DRIVER;
  const filePath = process.env.INGESTION_KV_FILE;
  const signature = `${driver ?? "file"}:${filePath ?? ""}`;
  if (!kvStore || signature !== kvStoreSignature) {
    kvStore = createKeyValueStore({
      driver,
      filePath,
    });
    kvStoreSignature = signature;
  }
  return kvStore;
}

export async function readCheckpoint(args: IngestionCheckpointKey): Promise<{
  checkpoint: IngestionCheckpointRecord | null;
  version: string | null;
}> {
  const key = buildCheckpointKey(args);
  const { value, version } = await resolveStore().get<IngestionCheckpointRecord>(key);
  return {
    checkpoint: value,
    version,
  };
}

export async function writeCheckpoint(
  args: IngestionCheckpointKey,
  checkpoint: IngestionCheckpointRecord,
  options?: { expectedVersion?: string | null },
): Promise<string> {
  const key = buildCheckpointKey(args);
  const payload: IngestionCheckpointRecord = {
    ...checkpoint,
    lastUpdatedAt: checkpoint.lastUpdatedAt ?? new Date().toISOString(),
  };
  return resolveStore().put(key, payload, {
    expectedVersion: options?.expectedVersion ?? null,
  });
}

export async function updateCheckpoint(
  args: IngestionCheckpointKey,
  updater: (existing: IngestionCheckpointRecord | null) => IngestionCheckpointRecord,
): Promise<{ version: string; checkpoint: IngestionCheckpointRecord }> {
  const key = buildCheckpointKey(args);
  const { value, version } = await resolveStore().get<IngestionCheckpointRecord>(key);
  const next = updater(value ?? null);
  next.lastUpdatedAt = new Date().toISOString();
  return {
    version: await resolveStore().put(key, next, { expectedVersion: version }),
    checkpoint: next,
  };
}

export async function resetCheckpoint(args: IngestionCheckpointKey): Promise<void> {
  const key = buildCheckpointKey(args);
  await resolveStore().delete(key).catch(() => undefined);
}

function buildCheckpointKey({ endpointId, unitId, vendor, sinkId }: IngestionCheckpointKey): string {
  const parts = [CHECKPOINT_PREFIX];
  if (vendor) {
    parts.push(cleanSegment(vendor));
  }
  parts.push("endpoint", cleanSegment(endpointId), "unit", cleanSegment(unitId));
  if (sinkId) {
    parts.push("sink", cleanSegment(sinkId));
  }
  return parts.join("::");
}

function cleanSegment(value: string): string {
  return value.replace(/[:\s]+/g, "-").toLowerCase();
}

export function __resetCheckpointStoreForTests() {
  kvStore = null;
  kvStoreSignature = null;
}
