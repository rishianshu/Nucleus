import path from "node:path";
import { getPrismaClient } from "../prismaClient.js";
import type { VectorIndexEntryInput, VectorIndexQueryFilter, VectorIndexStore } from "./types.js";

type PrismaClientInstance = Awaited<ReturnType<typeof getPrismaClient>>;

export const VECTOR_DIMENSION = 1536;

export class PrismaVectorIndexStore implements VectorIndexStore {
  private readonly resolvePrisma: () => Promise<PrismaClientInstance>;

  constructor(resolvePrisma?: () => Promise<PrismaClientInstance>) {
    this.resolvePrisma = resolvePrisma ?? getPrismaClient;
  }

  async upsertEntries(entries: VectorIndexEntryInput[]): Promise<void> {
    if (!entries.length) {
      return;
    }
    const prisma = await this.resolvePrisma();
    await prisma.$transaction(async (tx: PrismaClientInstance) => {
      for (const entry of entries) {
        const embedding = this.normalizeEmbedding(entry.embedding);
        const vectorStr = `[${embedding.map((v: number) => v.toFixed(6)).join(",")}]`;
        const rawMetadata = entry.rawMetadata ? JSON.stringify(entry.rawMetadata) : null;
        await tx.$executeRawUnsafe(
          `INSERT INTO "vector_index_entries" (
              "node_id", "profile_id", "chunk_id", "embedding", "tenant_id", "project_key", "profile_kind", "source_system", "raw_metadata", "created_at", "updated_at"
            ) VALUES (
              $1, $2, $3, $4::vector, $5, $6, $7, $8, $9::jsonb, NOW(), NOW()
            )
            ON CONFLICT ("node_id", "profile_id", "chunk_id") DO UPDATE SET
              "embedding" = EXCLUDED."embedding",
              "tenant_id" = EXCLUDED."tenant_id",
              "project_key" = EXCLUDED."project_key",
              "profile_kind" = EXCLUDED."profile_kind",
              "source_system" = EXCLUDED."source_system",
              "raw_metadata" = EXCLUDED."raw_metadata",
              "updated_at" = NOW();`,
          entry.nodeId,
          entry.profileId,
          entry.chunkId,
          vectorStr,
          entry.tenantId,
          entry.projectKey ?? null,
          entry.profileKind,
          entry.sourceSystem ?? null,
          rawMetadata,
        );
      }
    });
  }

  async query(args: {
    profileId: string;
    queryEmbedding: number[];
    topK: number;
    filter?: VectorIndexQueryFilter;
  }): Promise<Array<{ nodeId: string; score: number; metadata: Record<string, unknown> }>> {
    const prisma = await this.resolvePrisma();
    const normalizedEmbedding = this.normalizeEmbedding(args.queryEmbedding);
    const vectorStr = `[${normalizedEmbedding.map((v: number) => v.toFixed(6)).join(",")}]`;

    // Build parameterized query dynamically
    const params: unknown[] = [args.profileId, vectorStr];
    const whereClauses = [`"profile_id" = $1`];
    let paramIndex = 3;

    if (args.filter?.tenantId) {
      params.push(args.filter.tenantId);
      whereClauses.push(`"tenant_id" = $${paramIndex++}`);
    }

    const projectKeys = normalizeList(args.filter?.projectKeyIn);
    if (projectKeys.length > 0) {
      const placeholders = projectKeys.map(() => `$${paramIndex++}`).join(", ");
      params.push(...projectKeys);
      whereClauses.push(`"project_key" IN (${placeholders})`);
    }

    const profileKinds = normalizeList(args.filter?.profileKindIn);
    if (profileKinds.length > 0) {
      const placeholders = profileKinds.map(() => `$${paramIndex++}`).join(", ");
      params.push(...profileKinds);
      whereClauses.push(`"profile_kind" IN (${placeholders})`);
    }

    const limit = Math.max(1, args.topK);
    params.push(limit);
    const limitParamIndex = paramIndex;

    const sql = `SELECT "node_id", "profile_id", "profile_kind", "project_key", "source_system", "tenant_id", "raw_metadata", ("embedding" <=> $2::vector) AS distance
        FROM "vector_index_entries"
        WHERE ${whereClauses.join(" AND ")}
        ORDER BY distance ASC
        LIMIT $${limitParamIndex}`;

    type RowType = {
      node_id: string;
      profile_id: string;
      profile_kind: string;
      project_key: string | null;
      source_system: string | null;
      tenant_id: string;
      raw_metadata: unknown;
      distance: number;
    };
    const rows = (await prisma.$queryRawUnsafe(sql, ...params)) as RowType[];
    return rows.map((row: RowType) => ({
      nodeId: row.node_id,
      score: 1 - Number(row.distance ?? 0),
      metadata: {
        profileId: row.profile_id,
        profileKind: row.profile_kind,
        projectKey: row.project_key,
        sourceSystem: row.source_system,
        tenantId: row.tenant_id,
        raw: (row.raw_metadata as Record<string, unknown> | null) ?? null,
      },
    }));
  }

  private normalizeEmbedding(embedding: number[]): number[] {
    if (embedding.length !== VECTOR_DIMENSION) {
      throw new Error(`embedding length must be ${VECTOR_DIMENSION}`);
    }
    return embedding.map((value: number) => (Number.isFinite(value) ? Number(value) : 0));
  }
}

function normalizeList(values?: string[]): string[] {
  return (values ?? [])
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value && value.length > 0));
}
