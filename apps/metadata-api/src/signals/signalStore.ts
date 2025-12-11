import { getPrismaClient } from "../prismaClient.js";
import type {
  CreateSignalDefinitionInput,
  SignalDefinition,
  SignalDefinitionFilter,
  SignalImplMode,
  SignalInstance,
  SignalInstanceFilter,
  SignalInstancePage,
  SignalInstancePageFilter,
  SignalInstanceStatus,
  SignalSeverity,
  SignalStatus,
  SignalStore,
  UpdateSignalDefinitionInput,
  UpsertSignalInstanceInput,
} from "./types.js";

type PrismaClientInstance = Awaited<ReturnType<typeof getPrismaClient>>;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapDefinition(row: any): SignalDefinition {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: row.status as SignalStatus,
    implMode: (row.implMode as SignalImplMode) ?? "DSL",
    sourceFamily: row.sourceFamily ?? null,
    entityKind: row.entityKind ?? null,
    processKind: row.processKind,
    policyKind: row.policyKind,
    severity: row.severity as SignalSeverity,
    tags: row.tags ?? [],
    cdmModelId: row.cdmModelId,
    surfaceHints: (row.surfaceHints as Record<string, unknown> | null) ?? null,
    owner: row.owner,
    definitionSpec: (row.definitionSpec ?? {}) as Record<string, unknown>,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function mapInstance(row: any, definition?: SignalDefinition | null): SignalInstance {
  return {
    id: row.id,
    definitionId: row.definitionId,
    status: row.status,
    entityRef: row.entityRef,
    entityKind: row.entityKind,
    severity: row.severity,
    summary: row.summary,
    details: row.details ?? null,
    firstSeenAt: toDate(row.firstSeenAt),
    lastSeenAt: toDate(row.lastSeenAt),
    resolvedAt: row.resolvedAt ? toDate(row.resolvedAt) : null,
    sourceRunId: row.sourceRunId ?? null,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    definition: definition ?? (row.definition ? mapDefinition(row.definition) : undefined),
  };
}

function buildInstanceWhere(filter?: SignalInstanceFilter) {
  const definitionIds = filter?.definitionIds && filter.definitionIds.length ? { in: filter.definitionIds } : undefined;
  const definitionSlugs =
    filter?.definitionSlugs && filter.definitionSlugs.length ? { slug: { in: filter.definitionSlugs } } : undefined;
  const entityRefs = filter?.entityRefs && filter.entityRefs.length ? { in: filter.entityRefs } : undefined;
  const statusFilter = filter?.status && filter.status.length ? { in: filter.status } : undefined;
  const severityFilter = filter?.severity && filter.severity.length ? { in: filter.severity } : undefined;
  return {
    definitionId: definitionIds,
    definition: definitionSlugs,
    entityRef: entityRefs,
    entityKind: filter?.entityKind ?? undefined,
    status: statusFilter,
    severity: severityFilter,
  };
}

export class PrismaSignalStore implements SignalStore {
  private readonly resolvePrisma: () => Promise<PrismaClientInstance>;

  constructor(resolvePrisma?: () => Promise<PrismaClientInstance>) {
    this.resolvePrisma = resolvePrisma ?? getPrismaClient;
  }

  async getDefinition(id: string): Promise<SignalDefinition | null> {
    const prisma = await this.resolvePrisma();
    const row = await prisma.signalDefinition.findUnique({ where: { id } });
    return row ? mapDefinition(row) : null;
  }

  async getDefinitionBySlug(slug: string): Promise<SignalDefinition | null> {
    const prisma = await this.resolvePrisma();
    const row = await prisma.signalDefinition.findUnique({ where: { slug } });
    return row ? mapDefinition(row) : null;
  }

  async listDefinitions(filter?: SignalDefinitionFilter): Promise<SignalDefinition[]> {
    const prisma = await this.resolvePrisma();
    const statusFilter = filter?.status && filter.status.length ? { in: filter.status } : undefined;
    const entityFilter = filter?.entityKind && filter.entityKind.length ? { in: filter.entityKind } : undefined;
    const sourceFamilyFilter = filter?.sourceFamily && filter.sourceFamily.length ? { in: filter.sourceFamily } : undefined;
    const implModeFilter = filter?.implMode && filter.implMode.length ? { in: filter.implMode } : undefined;
    const tagsFilter = filter?.tags && filter.tags.length ? { hasSome: filter.tags } : undefined;
    const rows = await prisma.signalDefinition.findMany({
      where: {
        status: statusFilter,
        entityKind: entityFilter,
        sourceFamily: sourceFamilyFilter,
        implMode: implModeFilter,
        tags: tagsFilter,
      },
      orderBy: [{ createdAt: "desc" }, { slug: "asc" }],
    });
    return rows.map(mapDefinition);
  }

  async createDefinition(input: CreateSignalDefinitionInput): Promise<SignalDefinition> {
    const prisma = await this.resolvePrisma();
    const row = await prisma.signalDefinition.create({
      data: {
        slug: input.slug,
        title: input.title,
        description: input.description ?? null,
        status: input.status,
        implMode: input.implMode ?? "DSL",
        sourceFamily: input.sourceFamily ?? null,
        entityKind: input.entityKind ?? null,
        processKind: input.processKind ?? null,
        policyKind: input.policyKind ?? null,
        severity: input.severity,
        tags: input.tags ?? [],
        cdmModelId: input.cdmModelId ?? null,
        surfaceHints: input.surfaceHints ?? null,
        owner: input.owner ?? null,
        definitionSpec: input.definitionSpec ?? {},
      },
    });
    return mapDefinition(row);
  }

  async updateDefinition(id: string, patch: UpdateSignalDefinitionInput): Promise<SignalDefinition> {
    const prisma = await this.resolvePrisma();
    const data: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(patch, "slug")) data.slug = patch.slug;
    if (Object.prototype.hasOwnProperty.call(patch, "title")) data.title = patch.title;
    if (Object.prototype.hasOwnProperty.call(patch, "description")) data.description = patch.description ?? null;
    if (Object.prototype.hasOwnProperty.call(patch, "status")) data.status = patch.status;
    if (Object.prototype.hasOwnProperty.call(patch, "implMode")) data.implMode = patch.implMode;
    if (Object.prototype.hasOwnProperty.call(patch, "sourceFamily")) data.sourceFamily = patch.sourceFamily ?? null;
    if (Object.prototype.hasOwnProperty.call(patch, "entityKind")) data.entityKind = patch.entityKind;
    if (Object.prototype.hasOwnProperty.call(patch, "processKind")) data.processKind = patch.processKind ?? null;
    if (Object.prototype.hasOwnProperty.call(patch, "policyKind")) data.policyKind = patch.policyKind ?? null;
    if (Object.prototype.hasOwnProperty.call(patch, "severity")) data.severity = patch.severity;
    if (Object.prototype.hasOwnProperty.call(patch, "tags")) data.tags = patch.tags ?? [];
    if (Object.prototype.hasOwnProperty.call(patch, "cdmModelId")) data.cdmModelId = patch.cdmModelId ?? null;
    if (Object.prototype.hasOwnProperty.call(patch, "surfaceHints")) data.surfaceHints = patch.surfaceHints ?? null;
    if (Object.prototype.hasOwnProperty.call(patch, "owner")) data.owner = patch.owner ?? null;
    if (Object.prototype.hasOwnProperty.call(patch, "definitionSpec")) data.definitionSpec = patch.definitionSpec;
    const row = await prisma.signalDefinition.update({
      where: { id },
      data,
    });
    return mapDefinition(row);
  }

  async getInstance(id: string): Promise<SignalInstance | null> {
    const prisma = await this.resolvePrisma();
    const row = await prisma.signalInstance.findUnique({
      where: { id },
      include: { definition: true },
    });
    if (!row) {
      return null;
    }
    return mapInstance(row, mapDefinition(row.definition));
  }

  async listInstances(filter?: SignalInstanceFilter): Promise<SignalInstance[]> {
    const prisma = await this.resolvePrisma();
    const take = Math.min(Math.max(filter?.limit ?? 50, 1), 200);
    const where = buildInstanceWhere(filter);
    const rows = await prisma.signalInstance.findMany({
      where,
      orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
      take,
      include: { definition: true },
    });
    return rows.map((row: any) => mapInstance(row, row.definition ? mapDefinition(row.definition) : undefined));
  }

  async listInstancesPaged(filter?: SignalInstancePageFilter): Promise<SignalInstancePage> {
    const prisma = await this.resolvePrisma();
    const take = Math.min(Math.max(filter?.limit ?? 200, 1), 200);
    const offset = decodeCursor(filter?.after ?? null);
    const where = buildInstanceWhere(filter);
    const rows = await prisma.signalInstance.findMany({
      where,
      orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
      skip: offset,
      take: take + 1,
      include: { definition: true },
    });
    const pageRows = rows.slice(0, take);
    const hasNextPage = rows.length > take;
    return {
      rows: pageRows.map((row: any) => mapInstance(row, row.definition ? mapDefinition(row.definition) : undefined)),
      cursorOffset: offset,
      hasNextPage,
    };
  }

  async upsertInstance(input: UpsertSignalInstanceInput): Promise<SignalInstance> {
    const prisma = await this.resolvePrisma();
    const now = input.timestamp ? toDate(input.timestamp) : new Date();
    const nextStatus: SignalInstanceStatus = input.status ?? "OPEN";

    const result = await prisma.$transaction(async (tx: any) => {
      const existing = await tx.signalInstance.findFirst({
        where: {
          definitionId: input.definitionId,
          entityRef: input.entityRef,
        },
        orderBy: { createdAt: "desc" },
        include: { definition: true },
      });

      if (existing) {
        const nextResolvedAt =
          nextStatus === "RESOLVED"
            ? input.resolvedAt
              ? toDate(input.resolvedAt)
              : existing.resolvedAt ?? now
            : null;
        const updated = await tx.signalInstance.update({
          where: { id: existing.id },
          data: {
            status: nextStatus,
            severity: input.severity ?? existing.severity,
            summary: input.summary ?? existing.summary,
            details: input.details ?? existing.details,
            lastSeenAt: now,
            resolvedAt: nextResolvedAt,
            sourceRunId: input.sourceRunId ?? existing.sourceRunId,
          },
          include: { definition: true },
        });
        return mapInstance(updated, updated.definition ? mapDefinition(updated.definition) : undefined);
      }

      const created = await tx.signalInstance.create({
        data: {
          definitionId: input.definitionId,
          status: nextStatus,
          entityRef: input.entityRef,
          entityKind: input.entityKind,
          severity: input.severity,
          summary: input.summary,
          details: input.details ?? null,
          firstSeenAt: now,
          lastSeenAt: now,
          resolvedAt:
            nextStatus === "RESOLVED"
              ? input.resolvedAt
                ? toDate(input.resolvedAt)
                : now
              : null,
          sourceRunId: input.sourceRunId ?? null,
        },
        include: { definition: true },
      });
      return mapInstance(created, created.definition ? mapDefinition(created.definition) : undefined);
    });

    return result;
  }

  async updateInstanceStatus(
    id: string,
    status: SignalInstanceStatus,
    resolvedAt?: Date | string | null,
  ): Promise<SignalInstance> {
    const prisma = await this.resolvePrisma();
    const row = await prisma.signalInstance.update({
      where: { id },
      data: {
        status,
        resolvedAt: status === "RESOLVED" ? (resolvedAt ? toDate(resolvedAt) : new Date()) : null,
        lastSeenAt: new Date(),
      },
      include: { definition: true },
    });
    return mapInstance(row, row.definition ? mapDefinition(row.definition) : undefined);
  }
}

function decodeCursor(cursor: string | null): number {
  if (!cursor) {
    return 0;
  }
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf-8");
    const value = Number.parseInt(decoded, 10);
    if (Number.isNaN(value) || value < 0) {
      return 0;
    }
    return value;
  } catch {
    return 0;
  }
}
