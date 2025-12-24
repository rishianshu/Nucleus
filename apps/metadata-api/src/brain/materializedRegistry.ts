import { getPrismaClient } from "../prismaClient.js";
import type { MaterializedArtifact, MaterializedRegistry, MaterializedStatus } from "./types.js";

type PrismaClientInstance = Awaited<ReturnType<typeof getPrismaClient>>;

type RegistryUpsertInput = {
  tenantId: string;
  sourceRunId: string;
  artifactKind: string;
  sourceFamily?: string | null;
  sinkEndpointId?: string | null;
  handle: Record<string, unknown>;
  canonicalMeta: Record<string, unknown>;
  sourceMeta?: Record<string, unknown> | null;
};

export class PrismaMaterializedRegistry implements MaterializedRegistry {
  private readonly resolvePrisma: () => Promise<PrismaClientInstance>;

  constructor(resolvePrisma?: () => Promise<PrismaClientInstance>) {
    this.resolvePrisma = resolvePrisma ?? getPrismaClient;
  }

  async upsertArtifact(input: RegistryUpsertInput): Promise<MaterializedArtifact> {
    const prisma = await this.resolvePrisma();
    const existing = await prisma.materializedArtifact.findUnique({
      where: {
        tenantId_sourceRunId_artifactKind: {
          tenantId: input.tenantId,
          sourceRunId: input.sourceRunId,
          artifactKind: input.artifactKind,
        },
      },
    });
    if (existing) {
      const updated = await prisma.materializedArtifact.update({
        where: { id: existing.id },
        data: {
          status: "READY",
          indexStatus: "READY",
          sourceFamily: input.sourceFamily ?? existing.sourceFamily,
          sinkEndpointId: input.sinkEndpointId ?? existing.sinkEndpointId,
          handle: input.handle,
          canonicalMeta: input.canonicalMeta,
          sourceMeta: input.sourceMeta ?? existing.sourceMeta ?? null,
          lastError: null,
          counters: null,
          indexLastError: null,
          indexCounters: null,
        },
      });
      return mapRecord(updated);
    }

    const created = await prisma.materializedArtifact.create({
      data: {
        tenantId: input.tenantId,
        sourceRunId: input.sourceRunId,
        artifactKind: input.artifactKind,
        sourceFamily: input.sourceFamily ?? null,
        sinkEndpointId: input.sinkEndpointId ?? null,
        handle: input.handle,
        canonicalMeta: input.canonicalMeta,
        sourceMeta: input.sourceMeta ?? null,
        status: "READY",
        indexStatus: "READY",
      },
    });
    return mapRecord(created);
  }

  async markIndexing(id: string): Promise<MaterializedArtifact> {
    const prisma = await this.resolvePrisma();
    const updated = await prisma.materializedArtifact.update({
      where: { id },
      data: {
        status: "INDEXING",
        indexStatus: "INDEXING",
        lastError: null,
        indexLastError: null,
      },
    });
    return mapRecord(updated);
  }

  async completeIndexRun(
    id: string,
    args: { status: MaterializedStatus; counters?: Record<string, unknown>; lastError?: unknown },
  ): Promise<MaterializedArtifact> {
    const prisma = await this.resolvePrisma();
    const status: MaterializedStatus = args.status === "FAILED" ? "FAILED" : args.status === "INDEXED" ? "INDEXED" : "INDEXED";
    const updated = await prisma.materializedArtifact.update({
      where: { id },
      data: {
        status,
        indexStatus: status,
        counters: args.counters ?? null,
        indexCounters: args.counters ?? null,
        lastError: args.lastError ?? null,
        indexLastError: args.lastError ?? null,
      },
    });
    return mapRecord(updated);
  }

  async getArtifact(id: string): Promise<MaterializedArtifact | null> {
    const prisma = await this.resolvePrisma();
    const record = await prisma.materializedArtifact.findUnique({ where: { id } });
    return record ? mapRecord(record) : null;
  }
}

export class NoopMaterializedRegistry implements MaterializedRegistry {
  async upsertArtifact(input: RegistryUpsertInput): Promise<MaterializedArtifact> {
    return {
      id: "noop",
      tenantId: input.tenantId,
      sourceRunId: input.sourceRunId,
      artifactKind: input.artifactKind,
      sourceFamily: input.sourceFamily ?? null,
      sinkEndpointId: input.sinkEndpointId ?? null,
      handle: input.handle,
      canonicalMeta: input.canonicalMeta,
      sourceMeta: input.sourceMeta ?? null,
      status: "READY",
      indexStatus: "READY",
      counters: null,
      indexCounters: null,
      lastError: null,
      indexLastError: null,
    };
  }

  async markIndexing(id: string): Promise<MaterializedArtifact> {
    return {
      id,
      tenantId: "noop",
      sourceRunId: "noop",
      artifactKind: "noop",
      sourceFamily: null,
      sinkEndpointId: null,
      handle: { uri: "noop" },
      canonicalMeta: {},
      sourceMeta: null,
      status: "INDEXING",
      indexStatus: "INDEXING",
      counters: null,
      indexCounters: null,
      lastError: null,
      indexLastError: null,
    };
  }

  async completeIndexRun(
    id: string,
    args: { status: MaterializedStatus; counters?: Record<string, unknown>; lastError?: unknown },
  ): Promise<MaterializedArtifact> {
    return {
      id,
      tenantId: "noop",
      sourceRunId: "noop",
      artifactKind: "noop",
      sourceFamily: null,
      sinkEndpointId: null,
      handle: { uri: "noop" },
      canonicalMeta: {},
      sourceMeta: null,
      status: args.status,
      indexStatus: args.status,
      counters: args.counters ?? null,
      indexCounters: args.counters ?? null,
      lastError: args.lastError ?? null,
      indexLastError: args.lastError ?? null,
    };
  }

  async getArtifact(): Promise<MaterializedArtifact | null> {
    return {
      id: "noop",
      tenantId: "noop",
      sourceRunId: "noop",
      artifactKind: "noop",
      sourceFamily: null,
      sinkEndpointId: null,
      handle: { uri: "noop" },
      canonicalMeta: {},
      sourceMeta: null,
      status: "READY",
      indexStatus: "READY",
      counters: null,
      indexCounters: null,
      lastError: null,
      indexLastError: null,
    };
  }
}

function mapRecord(record: any): MaterializedArtifact {
  return {
    id: record.id,
    tenantId: record.tenantId,
    sourceRunId: record.sourceRunId,
    artifactKind: record.artifactKind,
    sourceFamily: record.sourceFamily ?? null,
    sinkEndpointId: record.sinkEndpointId ?? null,
    handle: (record.handle as Record<string, unknown>) ?? {},
    canonicalMeta: (record.canonicalMeta as Record<string, unknown>) ?? {},
    sourceMeta: (record.sourceMeta as Record<string, unknown> | null) ?? null,
    status: (record.status as MaterializedStatus) ?? "READY",
    indexStatus: (record.indexStatus as MaterializedStatus) ?? (record.status as MaterializedStatus) ?? "READY",
    counters: (record.counters as Record<string, unknown> | null) ?? null,
    indexCounters: (record.indexCounters as Record<string, unknown> | null) ?? null,
    lastError: record.lastError ?? null,
    indexLastError: record.indexLastError ?? record.lastError ?? null,
  };
}

export async function listMaterializedArtifactsForTenant(
  prisma: { materializedArtifact: { findMany: (query: Record<string, unknown>) => Promise<any[]> } },
  args: {
    tenantId: string;
    filter?: { projectKey?: string | null; sourceFamily?: string | null; status?: string | null; artifactKind?: string | null };
    limit?: number | null;
    after?: string | null;
  },
): Promise<MaterializedArtifact[]> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const where: Record<string, unknown> = { tenantId: args.tenantId };
  if (args.filter?.sourceFamily) {
    where.sourceFamily = args.filter.sourceFamily;
  }
  if (args.filter?.status) {
    where.status = args.filter.status;
  }
  if (args.filter?.artifactKind) {
    where.artifactKind = args.filter.artifactKind;
  }
  if (args.filter?.projectKey) {
    where.canonicalMeta = { path: ["projectKey"], equals: args.filter.projectKey };
  }
  const rows = await prisma.materializedArtifact.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: args.after ? 1 : 0,
    cursor: args.after ? { id: args.after } : undefined,
  });
  return rows.map(mapRecord);
}

type MaterializedMetadataInput = {
  artifactKind: string;
  sourceFamily?: string | null;
  datasetId?: string | null;
  datasetSlug?: string | null;
  datasetRecord?: Record<string, unknown> | null;
};

export function buildMaterializedMetadata(input: MaterializedMetadataInput): {
  canonicalMeta: Record<string, unknown>;
  sourceMeta: Record<string, unknown> | null;
} {
  const payload = normalizeObject((input.datasetRecord as any)?.payload) ?? normalizeObject(input.datasetRecord) ?? {};
  const metadata = normalizeObject(payload?._metadata) ?? {};
  const datasetPayload = normalizeObject(payload?.dataset) ?? {};
  const projectKey = extractProjectKey({
    datasetId: input.datasetId,
    datasetSlug: input.datasetSlug,
    payload,
    datasetPayload,
    metadata,
  });
  const normalizedFamily = normalizeSourceFamily(input.sourceFamily);
  const canonicalMeta = {
    projectKey: projectKey ?? "unknown",
    sourceKind: deriveSourceKind(input.artifactKind, normalizedFamily),
    sourceId: extractSourceId({
      datasetId: input.datasetId,
      projectKey,
      payload,
      datasetPayload,
      metadata,
    }),
    sourceUrl: extractSourceUrl({ payload, datasetPayload, metadata }),
    title: extractTitle({ payload, datasetPayload }),
    updatedAt: extractUpdatedAt({ payload, datasetPayload }),
  };
  const sourceMeta = buildSourceMeta({
    sourceFamily: normalizedFamily,
    projectKey: projectKey ?? null,
    payload,
    datasetPayload,
    metadata,
  });
  return { canonicalMeta, sourceMeta };
}

function normalizeSourceFamily(sourceFamily?: string | null): string | null {
  if (!sourceFamily) return null;
  const trimmed = sourceFamily.trim().toLowerCase();
  if (!trimmed) return null;
  const parts = trimmed.split(/[.:]/).filter(Boolean);
  if (parts.length === 0) {
    return trimmed;
  }
  return parts[parts.length - 1];
}

function deriveSourceKind(artifactKind: string, sourceFamily: string | null): string {
  const lower = artifactKind.toLowerCase();
  if (lower.includes("code")) return "code";
  if (lower.includes("doc")) return "doc";
  if (lower.includes("work")) return "work";
  if (lower.includes("schema")) return "schema";
  if (sourceFamily === "github") return "code";
  if (sourceFamily === "confluence") return "doc";
  if (sourceFamily === "jira") return "work";
  return "unknown";
}

function extractProjectKey(input: {
  datasetId?: string | null;
  datasetSlug?: string | null;
  payload: Record<string, unknown>;
  datasetPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}): string | null {
  const candidates = [
    input.payload?.projectKey,
    input.datasetPayload?.projectKey,
    input.metadata?.projectKey,
    input.datasetPayload?.key,
    input.metadata?.spaceKey,
    input.payload?.spaceKey,
  ];
  for (const candidate of candidates) {
    const asStr = toString(candidate);
    if (asStr) return asStr;
  }
  const parsed = parseDatasetIdProject(input.datasetId);
  if (parsed) return parsed;
  return input.datasetSlug ?? null;
}

function extractSourceId(input: {
  datasetId?: string | null;
  projectKey: string | null;
  payload: Record<string, unknown>;
  datasetPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}): string | null {
  const candidates = [
    input.payload?.sourceId,
    (input.payload as any)?.source_id,
    input.metadata?.source_id,
    input.metadata?.sourceId,
    input.datasetPayload?.sourceId,
    input.datasetPayload?.id,
    input.projectKey,
  ];
  for (const candidate of candidates) {
    const asStr = toString(candidate);
    if (asStr) return asStr;
  }
  const parsed = parseDatasetIdProject(input.datasetId);
  return parsed ?? null;
}

function extractSourceUrl(input: {
  payload: Record<string, unknown>;
  datasetPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}): string | null {
  const candidates = [
    input.datasetPayload?.htmlUrl,
    input.datasetPayload?.url,
    input.payload?.sourceUrl,
    input.payload?.url,
    input.metadata?.htmlUrl,
  ];
  for (const candidate of candidates) {
    const asStr = toString(candidate);
    if (asStr) return asStr;
  }
  return null;
}

function extractTitle(input: { payload: Record<string, unknown>; datasetPayload: Record<string, unknown> }): string | null {
  const candidates = [input.datasetPayload?.name, input.payload?.name, input.payload?.title];
  for (const candidate of candidates) {
    const asStr = toString(candidate);
    if (asStr) return asStr;
  }
  return null;
}

function extractUpdatedAt(input: { payload: Record<string, unknown>; datasetPayload: Record<string, unknown> }): string | null {
  const candidates = [input.payload?.updatedAt, input.payload?.updated_at, input.datasetPayload?.updatedAt];
  for (const candidate of candidates) {
    const asStr = toString(candidate);
    if (asStr) return asStr;
  }
  return null;
}

function buildSourceMeta(input: {
  sourceFamily: string | null;
  projectKey: string | null;
  payload: Record<string, unknown>;
  datasetPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}): Record<string, unknown> | null {
  if (!input.sourceFamily) {
    return null;
  }
  if (input.sourceFamily === "github") {
    const repoKey = input.projectKey ?? parseDatasetIdProject(toString(input.datasetPayload?.id));
    const ownerRepo = repoKey?.split("/") ?? [];
    const owner = ownerRepo[0] ?? null;
    const repo = ownerRepo.slice(1).join("/") || null;
    const defaultBranch = toString(input.datasetPayload?.defaultBranch) ?? toString(input.metadata?.defaultBranch);
    const htmlUrl = extractSourceUrl({
      payload: input.payload,
      datasetPayload: input.datasetPayload,
      metadata: input.metadata,
    });
    const githubMeta: Record<string, unknown> = {
      repoKey: repoKey ?? null,
      owner,
      repo,
      defaultBranch: defaultBranch ?? null,
      htmlUrl: htmlUrl ?? null,
    };
    return { github: githubMeta };
  }
  if (input.sourceFamily === "confluence") {
    const spaceKey =
      toString(input.datasetPayload?.spaceKey) ?? toString(input.metadata?.spaceKey) ?? input.projectKey ?? null;
    const spaceId = toString(input.datasetPayload?.spaceId) ?? toString(input.metadata?.spaceId);
    const baseUrl =
      toString(input.metadata?.baseUrl) ?? toString(input.datasetPayload?.baseUrl) ?? toString(input.payload?.baseUrl);
    const confluenceMeta: Record<string, unknown> = {
      spaceKey,
      spaceId: spaceId ?? null,
      baseUrl: baseUrl ?? null,
    };
    return { confluence: confluenceMeta };
  }
  if (input.sourceFamily === "jira") {
    const projectKey = input.projectKey ?? null;
    const cloudId = toString(input.metadata?.cloudId) ?? toString(input.payload?.cloudId);
    const siteUrl = toString(input.metadata?.siteUrl) ?? toString(input.payload?.siteUrl);
    const jql = toString((input.payload?.query as any)?.jql) ?? toString((input.payload?.filter as any)?.jql);
    const jiraMeta: Record<string, unknown> = {
      projectKey,
      cloudId: cloudId ?? null,
      siteUrl: siteUrl ?? null,
      jql: jql ?? null,
    };
    return { jira: jiraMeta };
  }
  return null;
}

function parseDatasetIdProject(datasetId?: string | null): string | null {
  if (!datasetId) return null;
  const parts = datasetId.split(":").filter(Boolean);
  if (parts.length >= 4 && parts[0] === "catalog.dataset") {
    return parts.slice(3).join(":");
  }
  if (parts.length >= 2) {
    return parts[parts.length - 1];
  }
  return null;
}

function normalizeObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}
