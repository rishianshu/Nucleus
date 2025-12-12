import { getPrismaClient } from "../prismaClient.js";
import type { IndexProfile, IndexProfileStore } from "./types.js";

type PrismaClientInstance = Awaited<ReturnType<typeof getPrismaClient>>;

export class PrismaIndexProfileStore implements IndexProfileStore {
  private readonly resolvePrisma: () => Promise<PrismaClientInstance>;

  constructor(resolvePrisma?: () => Promise<PrismaClientInstance>) {
    this.resolvePrisma = resolvePrisma ?? getPrismaClient;
  }

  async listProfiles(): Promise<IndexProfile[]> {
    const prisma = await this.resolvePrisma();
    const rows = await prisma.vectorIndexProfile.findMany({ orderBy: { id: "asc" } });
    return rows.map(mapProfileRow);
  }

  async getProfile(id: string): Promise<IndexProfile | null> {
    const prisma = await this.resolvePrisma();
    const row = await prisma.vectorIndexProfile.findUnique({ where: { id } });
    return row ? mapProfileRow(row) : null;
  }
}

function mapProfileRow(row: any): IndexProfile {
  return {
    id: row.id,
    family: row.family,
    description: row.description ?? null,
    nodeType: row.nodeType,
    textSource: toRecord(row.textSource),
    embeddingModel: row.embeddingModel,
    chunking: row.chunking ? toRecord(row.chunking) : null,
    profileKind: row.profileKind,
    enabled: row.enabled ?? true,
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}
