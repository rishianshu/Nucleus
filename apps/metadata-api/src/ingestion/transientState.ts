import type { KeyValueStore } from "@metadata/core";
import { createKeyValueStore } from "@metadata/core";

const TRANSIENT_STATE_PREFIX = "ingest_state";

type TransientStateKey = {
  endpointId: string;
  unitId: string;
  sinkId?: string | null;
};

export type TransientStateRecord = {
  state: Record<string, unknown>;
  lastUpdatedAt?: string;
};

let kvStore: KeyValueStore | null = null;
let kvStoreSignature: string | null = null;

function resolveStore(): KeyValueStore {
  const driver = process.env.INGESTION_KV_DRIVER;
  const filePath = process.env.INGESTION_KV_FILE;
  const signature = `${driver ?? "file"}:${filePath ?? ""}`;
  if (!kvStore || kvStoreSignature !== signature) {
    kvStore = createKeyValueStore({
      driver,
      filePath,
    });
    kvStoreSignature = signature;
  }
  return kvStore;
}

export async function readTransientState(key: TransientStateKey): Promise<{
  state: Record<string, unknown> | null;
  version: string | null;
}> {
  const storeKey = buildTransientKey(key);
  const { value, version } = await resolveStore().get<TransientStateRecord>(storeKey);
  if (!value || typeof value !== "object") {
    return { state: null, version };
  }
  if (value.state && typeof value.state === "object") {
    return { state: value.state as Record<string, unknown>, version };
  }
  return { state: value as Record<string, unknown>, version };
}

export async function writeTransientState(
  key: TransientStateKey,
  state: Record<string, unknown> | null,
  options?: { expectedVersion?: string | null },
): Promise<string> {
  const storeKey = buildTransientKey(key);
  if (!state || Object.keys(state).length === 0) {
    await resolveStore()
      .delete(storeKey, { expectedVersion: options?.expectedVersion ?? null })
      .catch(() => undefined);
    return "";
  }
  const record: TransientStateRecord = {
    state,
    lastUpdatedAt: new Date().toISOString(),
  };
  return resolveStore().put(storeKey, record, { expectedVersion: options?.expectedVersion ?? null });
}

function buildTransientKey({ endpointId, unitId, sinkId }: TransientStateKey): string {
  const parts = [TRANSIENT_STATE_PREFIX, "endpoint", cleanSegment(endpointId), "unit", cleanSegment(unitId)];
  if (sinkId) {
    parts.push("sink", cleanSegment(sinkId));
  }
  return parts.join("::");
}

function cleanSegment(value: string): string {
  return value.replace(/[:\s]+/g, "-").toLowerCase();
}

export function __resetTransientStateStoreForTests() {
  kvStore = null;
  kvStoreSignature = null;
}
