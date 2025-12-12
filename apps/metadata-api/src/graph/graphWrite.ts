import type { GraphEntity, GraphScopeInput, GraphStore, TenantContext } from "@metadata/core";
import { getGraphStore } from "../context.js";
import { getPrismaClient } from "../prismaClient.js";

export type GraphWriteNodeInput = {
  nodeType: string;
  nodeId?: string;
  externalId?: string | Record<string, unknown>;
  properties: Record<string, unknown>;
  scope?: GraphScopeInput | null;
};

export type GraphWriteEdgeInput = {
  edgeType: string;
  fromNodeId: string;
  toNodeId: string;
  properties?: Record<string, unknown>;
  scope?: GraphScopeInput | null;
};

export interface GraphWrite {
  upsertNode(input: GraphWriteNodeInput): Promise<{ nodeId: string }>;
  upsertEdge(input: GraphWriteEdgeInput): Promise<void>;
}

export type GraphWriteErrorCode =
  | "UNKNOWN_NODE_TYPE"
  | "MISSING_REQUIRED_PROPS"
  | "UNKNOWN_EDGE_TYPE"
  | "NODE_NOT_FOUND"
  | "EDGE_NODE_TYPE_MISMATCH"
  | "INVALID_CONTEXT";

export class GraphWriteError extends Error {
  constructor(public readonly code: GraphWriteErrorCode, message: string, public readonly details?: unknown) {
    super(message);
    this.name = "GraphWriteError";
  }
}

export type KgNodeTypeRecord = {
  id: string;
  family: string;
  description?: string | null;
  idPrefix?: string | null;
  requiredProps?: string[] | null;
  optionalProps?: string[] | null;
  indexedProps?: string[] | null;
  labelTemplate?: string | null;
  icon?: string | null;
};

export type KgEdgeTypeRecord = {
  id: string;
  fromNodeTypeId: string;
  fromNodeTypes?: string[] | null;
  toNodeTypeId: string;
  direction?: string | null;
  description?: string | null;
  multiplicity?: string | null;
  symmetric?: boolean | null;
};

export const DEFAULT_NODE_TYPE_SEEDS: KgNodeTypeRecord[] = [
  {
    id: "cdm.work.item",
    family: "work",
    description: "CDM work item entity",
    idPrefix: "cdm.work.item:",
    requiredProps: [],
    optionalProps: ["status", "assignee"],
    indexedProps: ["projectKey", "sourceIssueKey"],
  },
  {
    id: "cdm.doc.item",
    family: "doc",
    description: "CDM document item",
    idPrefix: "cdm.doc.item:",
    requiredProps: [],
    optionalProps: ["workspace", "owner"],
    indexedProps: ["sourceDocId"],
  },
  {
    id: "cdm.column",
    family: "data",
    description: "Column within a dataset",
    idPrefix: "cdm.column:",
    requiredProps: [],
    optionalProps: ["tableId", "path"],
    indexedProps: ["canonicalPath"],
  },
  {
    id: "column.profile",
    family: "data",
    description: "Profiler output for a column",
    idPrefix: "column.profile:",
    requiredProps: ["createdAt"],
    optionalProps: ["summary", "profile"],
    indexedProps: ["canonicalPath"],
  },
  {
    id: "column.description",
    family: "data",
    description: "Description node for a column",
    idPrefix: "column.description:",
    requiredProps: ["createdAt"],
    optionalProps: ["text", "author"],
    indexedProps: ["canonicalPath"],
  },
  {
    id: "signal.instance",
    family: "signal",
    description: "Evaluated signal instance",
    idPrefix: "signal.instance:",
    requiredProps: [],
    optionalProps: ["severity", "status"],
    indexedProps: ["slug"],
  },
  {
    id: "kg.cluster",
    family: "cluster",
    description: "Cluster node representing grouping",
    idPrefix: "kg.cluster:",
    requiredProps: [],
    optionalProps: ["algo", "score"],
    indexedProps: ["label"],
  },
];

export const DEFAULT_EDGE_TYPE_SEEDS: KgEdgeTypeRecord[] = [
  {
    id: "DESCRIBES",
    fromNodeTypeId: "column.description",
    fromNodeTypes: [],
    toNodeTypeId: "cdm.column",
    direction: "out",
    description: "Description node -> column",
    multiplicity: "one-to-one",
    symmetric: false,
  },
  {
    id: "PROFILE_OF",
    fromNodeTypeId: "column.profile",
    fromNodeTypes: [],
    toNodeTypeId: "cdm.column",
    direction: "out",
    description: "Profile node -> column",
    multiplicity: "one-to-one",
    symmetric: false,
  },
  {
    id: "HAS_SIGNAL",
    fromNodeTypeId: "cdm.work.item",
    fromNodeTypes: ["cdm.doc.item", "kg.cluster"],
    toNodeTypeId: "signal.instance",
    direction: "out",
    description: "Entity has signal instance",
    multiplicity: "many-to-many",
    symmetric: false,
  },
  {
    id: "IN_CLUSTER",
    fromNodeTypeId: "cdm.work.item",
    fromNodeTypes: ["cdm.doc.item", "cdm.column", "column.profile", "column.description", "signal.instance"],
    toNodeTypeId: "kg.cluster",
    direction: "out",
    description: "Entity grouped into cluster",
    multiplicity: "many-to-one",
    symmetric: false,
  },
];

export interface KgRegistry {
  getNodeType(id: string): Promise<KgNodeTypeRecord | null>;
  getEdgeType(id: string): Promise<KgEdgeTypeRecord | null>;
}

type MetadataPrismaClient = {
  kgNodeType?: {
    findUnique?: (args: { where: { id: string } }) => Promise<KgNodeTypeRecord | null>;
  };
  kgEdgeType?: {
    findUnique?: (args: { where: { id: string } }) => Promise<KgEdgeTypeRecord | null>;
  };
};

export class PrismaKgRegistry implements KgRegistry {
  constructor(private readonly prisma: MetadataPrismaClient) {}

  async getNodeType(id: string): Promise<KgNodeTypeRecord | null> {
    if (!this.prisma.kgNodeType?.findUnique) {
      return null;
    }
    const record = await this.prisma.kgNodeType.findUnique({ where: { id } });
    return record ? normalizeNodeType(record) : null;
  }

  async getEdgeType(id: string): Promise<KgEdgeTypeRecord | null> {
    if (!this.prisma.kgEdgeType?.findUnique) {
      return null;
    }
    const record = await this.prisma.kgEdgeType.findUnique({ where: { id } });
    return record ? normalizeEdgeType(record) : null;
  }
}

export class InMemoryKgRegistry implements KgRegistry {
  private readonly nodeTypes = new Map<string, KgNodeTypeRecord>();
  private readonly edgeTypes = new Map<string, KgEdgeTypeRecord>();

  constructor(seed?: { nodeTypes?: KgNodeTypeRecord[]; edgeTypes?: KgEdgeTypeRecord[] }) {
    seed?.nodeTypes?.forEach((record) => this.addNodeType(record));
    seed?.edgeTypes?.forEach((record) => this.addEdgeType(record));
  }

  addNodeType(record: KgNodeTypeRecord): void {
    const normalized = normalizeNodeType(record);
    this.nodeTypes.set(normalized.id, normalized);
  }

  addEdgeType(record: KgEdgeTypeRecord): void {
    const normalized = normalizeEdgeType(record);
    this.edgeTypes.set(normalized.id, normalized);
  }

  async getNodeType(id: string): Promise<KgNodeTypeRecord | null> {
    return this.nodeTypes.get(id) ?? null;
  }

  async getEdgeType(id: string): Promise<KgEdgeTypeRecord | null> {
    return this.edgeTypes.get(id) ?? null;
  }
}

export type GraphWriteDependencies = {
  graphStore: GraphStore;
  registry: KgRegistry;
  tenant: TenantContext;
  defaultScope?: GraphScopeInput | null;
};

export class GraphWriteService implements GraphWrite {
  constructor(private readonly deps: GraphWriteDependencies) {}

  async upsertNode(input: GraphWriteNodeInput): Promise<{ nodeId: string }> {
    const tenant = this.requireTenant();
    const registryEntry = await this.requireNodeType(input.nodeType);
    const properties = normalizeProperties(input.properties);
    const missing = collectMissingProperties(registryEntry.requiredProps ?? [], properties);
    if (missing.length) {
      throw new GraphWriteError(
        "MISSING_REQUIRED_PROPS",
        `Missing required properties for ${input.nodeType}: ${missing.join(", ")}`,
        { missing },
      );
    }
    const scope = this.resolveScope(input.scope, tenant);
    const entity = await this.deps.graphStore.upsertEntity(
      {
        id: input.nodeId,
        entityType: input.nodeType,
        displayName: resolveDisplayName(properties, input.nodeId, input.nodeType),
        canonicalPath: resolveCanonicalPath(properties),
        properties,
        scope,
        identity: buildNodeIdentity(input, registryEntry),
      },
      tenant,
    );
    return { nodeId: entity.id };
  }

  async upsertEdge(input: GraphWriteEdgeInput): Promise<void> {
    const tenant = this.requireTenant();
    const edgeType = await this.requireEdgeType(input.edgeType);
    const source = await this.deps.graphStore.getEntity(input.fromNodeId, tenant);
    if (!source) {
      throw new GraphWriteError("NODE_NOT_FOUND", `Source node ${input.fromNodeId} not found`, {
        nodeId: input.fromNodeId,
      });
    }
    const target = await this.deps.graphStore.getEntity(input.toNodeId, tenant);
    if (!target) {
      throw new GraphWriteError("NODE_NOT_FOUND", `Target node ${input.toNodeId} not found`, {
        nodeId: input.toNodeId,
      });
    }

    this.validateEdgeEndpoints(edgeType, source, target);
    const scope = this.resolveScope(input.scope ?? source.scope, tenant);

    await this.deps.graphStore.upsertEdge(
      {
        edgeType: edgeType.id,
        sourceEntityId: source.id,
        targetEntityId: target.id,
        metadata: normalizeProperties(input.properties ?? {}),
        scope,
        identity: {
          sourceLogicalKey: source.identity.logicalKey,
          targetLogicalKey: target.identity.logicalKey,
        },
      },
      tenant,
    );
  }

  private async requireNodeType(id: string): Promise<KgNodeTypeRecord> {
    const record = await this.deps.registry.getNodeType(id);
    if (!record) {
      throw new GraphWriteError("UNKNOWN_NODE_TYPE", `Unknown nodeType: ${id}`);
    }
    return record;
  }

  private async requireEdgeType(id: string): Promise<KgEdgeTypeRecord> {
    const record = await this.deps.registry.getEdgeType(id);
    if (!record) {
      throw new GraphWriteError("UNKNOWN_EDGE_TYPE", `Unknown edgeType: ${id}`);
    }
    return record;
  }

  private validateEdgeEndpoints(edge: KgEdgeTypeRecord, source: GraphEntity, target: GraphEntity): void {
    const allowedSources = collectAllowedSources(edge);
    if (allowedSources.length > 0 && !allowedSources.includes(source.entityType)) {
      throw new GraphWriteError(
        "EDGE_NODE_TYPE_MISMATCH",
        `Edge ${edge.id} requires fromNodeType in [${allowedSources.join(", ")}], got ${source.entityType}`,
        { expected: allowedSources, actual: source.entityType, endpoint: "from" },
      );
    }
    if (edge.toNodeTypeId && target.entityType !== edge.toNodeTypeId) {
      throw new GraphWriteError(
        "EDGE_NODE_TYPE_MISMATCH",
        `Edge ${edge.id} requires toNodeType ${edge.toNodeTypeId}, got ${target.entityType}`,
        { expected: edge.toNodeTypeId, actual: target.entityType, endpoint: "to" },
      );
    }
  }

  private resolveScope(scope: GraphScopeInput | null | undefined, tenant: TenantContext): GraphScopeInput {
    if (scope) {
      return scope;
    }
    if (this.deps.defaultScope) {
      return this.deps.defaultScope;
    }
    return { orgId: tenant.tenantId, projectId: tenant.projectId ?? null };
  }

  private requireTenant(): TenantContext {
    if (!this.deps.tenant) {
      throw new GraphWriteError("INVALID_CONTEXT", "Tenant context is required for GraphWrite operations.");
    }
    return this.deps.tenant;
  }
}

export async function createGraphWrite(
  tenant: TenantContext,
  options?: { graphStore?: GraphStore; registry?: KgRegistry; scope?: GraphScopeInput | null },
): Promise<GraphWriteService> {
  const graphStore = options?.graphStore ?? (await getGraphStore());
  const registry = options?.registry ?? new PrismaKgRegistry(await getPrismaClient());
  return new GraphWriteService({
    graphStore,
    registry,
    tenant,
    defaultScope: options?.scope ?? null,
  });
}

function normalizeNodeType(record: KgNodeTypeRecord): KgNodeTypeRecord {
  return {
    id: record.id,
    family: record.family,
    description: record.description ?? null,
    idPrefix: record.idPrefix ?? null,
    requiredProps: [...(record.requiredProps ?? [])],
    optionalProps: [...(record.optionalProps ?? [])],
    indexedProps: [...(record.indexedProps ?? [])],
    labelTemplate: record.labelTemplate ?? null,
    icon: record.icon ?? null,
  };
}

function normalizeEdgeType(record: KgEdgeTypeRecord): KgEdgeTypeRecord {
  return {
    id: record.id,
    fromNodeTypeId: record.fromNodeTypeId,
    fromNodeTypes: [...(record.fromNodeTypes ?? [])],
    toNodeTypeId: record.toNodeTypeId,
    direction: record.direction ?? "out",
    description: record.description ?? null,
    multiplicity: record.multiplicity ?? null,
    symmetric: record.symmetric ?? false,
  };
}

function normalizeProperties(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") {
    return {};
  }
  return { ...(input as Record<string, unknown>) };
}

function collectMissingProperties(required: string[], properties: Record<string, unknown>): string[] {
  return required.filter((key) => !Object.prototype.hasOwnProperty.call(properties, key));
}

function resolveDisplayName(properties: Record<string, unknown>, nodeId: string | undefined, fallbackType: string): string {
  const preferred = properties.displayName ?? properties.name ?? properties.title;
  if (typeof preferred === "string" && preferred.trim().length > 0) {
    return preferred;
  }
  if (nodeId && nodeId.trim().length > 0) {
    return nodeId;
  }
  return fallbackType;
}

function resolveCanonicalPath(properties: Record<string, unknown>): string | undefined {
  const candidate = properties.canonicalPath ?? properties.path;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function buildNodeIdentity(input: GraphWriteNodeInput, registry: KgNodeTypeRecord) {
  const externalId = normalizeExternalId(input.externalId);
  const logicalKey = input.nodeId ? `${registry.id}:${input.nodeId}` : undefined;
  return logicalKey || externalId
    ? {
        logicalKey,
        externalId,
      }
    : undefined;
}

function normalizeExternalId(externalId: string | Record<string, unknown> | undefined) {
  if (!externalId) {
    return undefined;
  }
  if (typeof externalId === "string") {
    return { value: externalId } as Record<string, unknown>;
  }
  if (typeof externalId === "object") {
    return externalId as Record<string, unknown>;
  }
  return undefined;
}

function collectAllowedSources(edge: KgEdgeTypeRecord): string[] {
  const values = [edge.fromNodeTypeId, ...(edge.fromNodeTypes ?? [])].filter((value) => Boolean(value?.length));
  return Array.from(new Set(values));
}
