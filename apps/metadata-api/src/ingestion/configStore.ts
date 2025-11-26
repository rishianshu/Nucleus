import { getPrismaClient } from "../prismaClient.js";

export type IngestionUnitConfigRow = {
  id: string;
  endpointId: string;
  datasetId: string;
  unitId: string;
  enabled: boolean;
  mode: string;
  sinkId: string;
  scheduleKind: string;
  scheduleIntervalMinutes: number | null;
  policy: Record<string, unknown> | null;
};

type SaveConfigInput = {
  endpointId: string;
  datasetId: string;
  unitId: string;
  enabled?: boolean;
  mode?: string;
  sinkId?: string;
  scheduleKind?: string;
  scheduleIntervalMinutes?: number | null;
  policy?: Record<string, unknown> | null;
};

type Prisma = Awaited<ReturnType<typeof getPrismaClient>>;

export async function listIngestionUnitConfigs(endpointId: string): Promise<IngestionUnitConfigRow[]> {
  const prisma = await getPrismaClient();
  const rows = await prisma.ingestionUnitConfig.findMany({
    where: { endpointId },
    orderBy: { datasetId: "asc" },
  });
  return rows as IngestionUnitConfigRow[];
}

export async function getIngestionUnitConfig(endpointId: string, unitId: string): Promise<IngestionUnitConfigRow | null> {
  const prisma = await getPrismaClient();
  const row = await prisma.ingestionUnitConfig.findUnique({
    where: {
      endpointId_unitId: {
        endpointId,
        unitId,
      },
    },
  });
  return (row as IngestionUnitConfigRow) ?? null;
}

export async function findConfigByDataset(endpointId: string, datasetId: string): Promise<IngestionUnitConfigRow | null> {
  const prisma = await getPrismaClient();
  const row = await prisma.ingestionUnitConfig.findFirst({
    where: {
      endpointId,
      datasetId,
    },
  });
  return (row as IngestionUnitConfigRow) ?? null;
}

export async function saveIngestionUnitConfig(input: SaveConfigInput): Promise<IngestionUnitConfigRow> {
  const prisma = await getPrismaClient();
  const normalized = normalizeConfigInput(input);
  const row = await prisma.ingestionUnitConfig.upsert({
    where: {
      endpointId_unitId: {
        endpointId: normalized.endpointId,
        unitId: normalized.unitId,
      },
    },
    update: {
      datasetId: normalized.datasetId,
      enabled: normalized.enabled,
      mode: normalized.mode,
      sinkId: normalized.sinkId,
      scheduleKind: normalized.scheduleKind,
      scheduleIntervalMinutes: normalized.scheduleIntervalMinutes,
      policy: normalized.policy,
    },
    create: normalized,
  });
  return row as IngestionUnitConfigRow;
}

function normalizeConfigInput(input: SaveConfigInput) {
  return {
    endpointId: input.endpointId,
    datasetId: input.datasetId,
    unitId: input.unitId,
    enabled: input.enabled ?? false,
    mode: input.mode ?? "FULL",
    sinkId: input.sinkId ?? process.env.INGESTION_DEFAULT_SINK ?? "kb",
    scheduleKind: normalizeScheduleKind(input.scheduleKind),
    scheduleIntervalMinutes: normalizeInterval(input.scheduleKind, input.scheduleIntervalMinutes),
    policy: input.policy ?? null,
  };
}

function normalizeScheduleKind(kind?: string) {
  const normalized = typeof kind === "string" ? kind.toUpperCase() : "MANUAL";
  if (normalized === "INTERVAL") {
    return "INTERVAL";
  }
  return "MANUAL";
}

function normalizeInterval(kind: string | undefined, interval?: number | null) {
  if ((kind ?? "").toUpperCase() !== "INTERVAL") {
    return null;
  }
  if (typeof interval !== "number" || Number.isNaN(interval)) {
    return 15;
  }
  return Math.max(1, Math.trunc(interval));
}
