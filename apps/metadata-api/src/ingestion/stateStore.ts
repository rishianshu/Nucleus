import { getPrismaClient } from "../prismaClient.js";

export type IngestionState = "IDLE" | "RUNNING" | "PAUSED" | "FAILED" | "SUCCEEDED";

const DEFAULT_SINK_ID = process.env.INGESTION_DEFAULT_SINK ?? "kb";

export type IngestionUnitStateRow = {
  endpointId: string;
  unitId: string;
  sinkId: string | null;
  state: IngestionState | null;
  checkpoint: unknown;
  lastRunId: string | null;
  lastRunAt: Date | string | null;
  lastError: string | null;
  stats: Record<string, unknown> | null;
};

type UnitKey = {
  endpointId: string;
  unitId: string;
  sinkId?: string | null;
};

type StatePatch = {
  state?: IngestionState;
  checkpoint?: unknown;
  lastRunId?: string | null;
  lastRunAt?: Date | string | null;
  lastError?: string | null;
  stats?: Record<string, unknown> | null;
};

type PrismaClient = Awaited<ReturnType<typeof getPrismaClient>>;

export async function getUnitState(key: UnitKey): Promise<IngestionUnitStateRow | null> {
  const prisma = await getPrismaClient();
  const row = await prisma.ingestionUnitState.findUnique({
    where: {
      endpointId_unitId: {
        endpointId: key.endpointId,
        unitId: key.unitId,
      },
    },
  });
  return (row as IngestionUnitStateRow) ?? null;
}

export async function listUnitStates(endpointId: string): Promise<IngestionUnitStateRow[]> {
  const prisma = await getPrismaClient();
  const rows = await prisma.ingestionUnitState.findMany({
    where: { endpointId },
    orderBy: { updatedAt: "desc" },
  });
  return rows as IngestionUnitStateRow[];
}

export async function upsertUnitState(key: UnitKey, patch: StatePatch): Promise<IngestionUnitStateRow> {
  const prisma = await getPrismaClient();
  const row = await prisma.ingestionUnitState.upsert({
    where: {
      endpointId_unitId: {
        endpointId: key.endpointId,
        unitId: key.unitId,
      },
    },
    update: normalizePatch(patch),
    create: {
      endpointId: key.endpointId,
      unitId: key.unitId,
      sinkId: key.sinkId ?? DEFAULT_SINK_ID,
      state: patch.state ?? "IDLE",
      checkpoint: patch.checkpoint ?? null,
      lastRunId: patch.lastRunId ?? null,
      lastRunAt: normalizeDateValue(patch.lastRunAt),
      lastError: patch.lastError ?? null,
      stats: patch.stats ?? null,
    },
  });
  return row as IngestionUnitStateRow;
}

export async function markUnitState(key: UnitKey, patch: StatePatch) {
  const prisma = await getPrismaClient();
  await prisma.ingestionUnitState.updateMany({
    where: {
      endpointId: key.endpointId,
      unitId: key.unitId,
    },
    data: normalizePatch(patch),
  });
}

export async function ensureUnitState(key: UnitKey): Promise<IngestionUnitStateRow> {
  const existing = await getUnitState(key);
  if (existing) {
    return existing;
  }
  return upsertUnitState(key, { state: "IDLE" });
}

function normalizePatch(patch: StatePatch) {
  const normalized: Record<string, unknown> = {};
  if (patch.state) {
    normalized.state = patch.state;
  }
  if (patch.checkpoint !== undefined) {
    normalized.checkpoint = patch.checkpoint ?? null;
  }
  if (patch.lastRunId !== undefined) {
    normalized.lastRunId = patch.lastRunId ?? null;
  }
  if (patch.lastRunAt !== undefined) {
    normalized.lastRunAt = normalizeDateValue(patch.lastRunAt);
  }
  if (patch.lastError !== undefined) {
    normalized.lastError = patch.lastError ?? null;
  }
  if (patch.stats !== undefined) {
    normalized.stats = patch.stats ?? null;
  }
  return normalized;
}

function normalizeDateValue(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
}
