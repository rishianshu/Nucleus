import { GrpcKVStore, getGrpcKVStore } from "./grpcKVStore.js";

const CHECKPOINT_PREFIX = "ingest";

export type IngestionCheckpointKey = {
  endpointId: string;
  unitId: string;
  vendor?: string | null;
  sinkId?: string | null;
};

export type IngestionCheckpointRecord = {
  // Primary field for incremental ingestion - RFC3339 timestamp
  watermark?: string | null;
  // Scalar cursor - MUST be string or null, never an object (same value as watermark for compatibility)
  cursor?: string | null;
  // Metadata fields
  lastUpdatedAt?: string;
  lastRunId?: string | null;
  lastError?: string | null;
  stats?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

let kvStore: GrpcKVStore | null = null;

/**
 * Resolve the KV store - uses gRPC store-core service for PostgreSQL-backed persistence
 */
function resolveStore(): GrpcKVStore {
  if (!kvStore) {
    kvStore = getGrpcKVStore();
    console.log("[checkpoints] Using gRPC KV store for checkpoint persistence");
  }
  return kvStore;
}

export async function readCheckpoint(args: IngestionCheckpointKey): Promise<{
  checkpoint: IngestionCheckpointRecord | null;
  version: string | null;
}> {
  const key = buildCheckpointKey(args);
  const { value, version } = await resolveStore().get<IngestionCheckpointRecord>(key);
  console.log("[checkpoint-debug] readCheckpoint gRPC result:", {
    key,
    hasCheckpoint: value != null,
    checkpointKeys: value ? Object.keys(value) : [],
    version,
  });
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
  console.log("[checkpoint-debug] writeCheckpoint gRPC:", {
    key,
    watermark: payload.watermark,
    cursor: payload.cursor,
    version: options?.expectedVersion,
  });
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
}
