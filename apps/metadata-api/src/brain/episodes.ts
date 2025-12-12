import type { GraphEntity, GraphStore, TenantContext } from "@metadata/core";
import { toIsoString } from "../kg/utils.js";
import type { SignalInstance, SignalStore } from "../signals/types.js";
import type { ClusterRead, ClusterSummary } from "./types.js";

export type BrainEpisodeMember = {
  nodeId: string;
  nodeType: string;
  entityKind: string;
  cdmModelId?: string;
  title?: string;
  summary?: string;
  projectKey?: string;
  docUrl?: string;
  workKey?: string;
};

export type BrainEpisodeSignal = {
  id: string;
  severity: string;
  status: string;
  summary: string;
  definitionSlug: string;
};

export type BrainEpisode = {
  id: string;
  tenantId: string;
  projectKey: string;
  clusterKind: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  windowStart?: string;
  windowEnd?: string;
  summary?: string;
  members: BrainEpisodeMember[];
  signals: BrainEpisodeSignal[];
};

export type BrainEpisodesConnection = {
  nodes: BrainEpisode[];
  totalCount: number;
};

const SIGNAL_EDGE_TYPE = "HAS_SIGNAL";
const CLUSTER_EDGE_TYPE = "IN_CLUSTER";
const MAX_SIGNALS_PER_SOURCE = 200;

export class BrainEpisodeReadService {
  constructor(
    private readonly graphStore: GraphStore,
    private readonly clusterRead: ClusterRead,
    private readonly signalStore: SignalStore,
  ) {}

  async listEpisodes(args: {
    tenantId: string;
    projectKey: string;
    windowStart?: Date;
    windowEnd?: Date;
    limit?: number;
    offset?: number;
    actorId?: string | null;
  }): Promise<BrainEpisodesConnection> {
    const tenant = this.buildTenant(args);
    const summaries = await this.clusterRead.listClustersForProject({
      tenantId: args.tenantId,
      projectKey: args.projectKey,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
    });
    if (!summaries.length) {
      return { nodes: [], totalCount: 0 };
    }
    const summaryById = new Map<string, ClusterSummary>();
    summaries.forEach((summary) => summaryById.set(summary.clusterNodeId, summary));
    const clusters = await this.loadClusters(Array.from(summaryById.keys()), tenant);
    const scoped = clusters
      .map((cluster) => ({ cluster, summary: summaryById.get(cluster.id) }))
      .filter(
        (entry): entry is { cluster: GraphEntity; summary: ClusterSummary } =>
          Boolean(entry.summary) && Boolean(entry.cluster),
      )
      .filter((entry) => this.matchesScope(entry.cluster, args.tenantId, args.projectKey));
    const sorted = scoped.sort((left, right) => this.compareClusterRecency(left.cluster, right.cluster));
    const offset = Math.max(0, args.offset ?? 0);
    const limit = Math.max(0, args.limit ?? sorted.length);
    const window = sorted.slice(offset, offset + limit);
    const nodes: BrainEpisode[] = [];
    for (const entry of window) {
      const episode = await this.hydrateEpisode(entry.cluster, entry.summary.memberNodeIds, tenant);
      if (episode) {
        nodes.push(episode);
      }
    }
    return {
      nodes,
      totalCount: scoped.length,
    };
  }

  async getEpisode(args: {
    tenantId: string;
    projectKey: string;
    id: string;
    actorId?: string | null;
  }): Promise<BrainEpisode | null> {
    const tenant = this.buildTenant(args);
    const cluster = await this.graphStore.getEntity(args.id, tenant);
    if (!cluster || cluster.entityType !== "kg.cluster" || !this.matchesScope(cluster, args.tenantId, args.projectKey)) {
      return null;
    }
    const summaries = await this.clusterRead.listClustersForProject({
      tenantId: args.tenantId,
      projectKey: args.projectKey,
    });
    const summary = summaries.find((entry) => entry.clusterNodeId === args.id);
    const memberNodeIds = summary ? summary.memberNodeIds : await this.loadMemberIds(cluster.id, tenant);
    return this.hydrateEpisode(cluster, memberNodeIds, tenant);
  }

  private buildTenant(args: { tenantId: string; projectKey: string; actorId?: string | null }): TenantContext {
    return {
      tenantId: args.tenantId,
      projectId: args.projectKey,
      actorId: args.actorId ?? undefined,
    };
  }

  private async loadClusters(ids: string[], tenant: TenantContext): Promise<GraphEntity[]> {
    const clusters: GraphEntity[] = [];
    for (const id of ids) {
      const entity = await this.graphStore.getEntity(id, tenant);
      if (entity) {
        clusters.push(entity);
      }
    }
    return clusters;
  }

  private async loadMemberIds(clusterId: string, tenant: TenantContext): Promise<string[]> {
    const edges = await this.graphStore.listEdges(
      { edgeTypes: [CLUSTER_EDGE_TYPE], targetEntityId: clusterId, limit: 500 },
      tenant,
    );
    return Array.from(new Set(edges.map((edge) => edge.sourceEntityId)));
  }

  private async hydrateEpisode(
    cluster: GraphEntity,
    memberNodeIds: string[],
    tenant: TenantContext,
  ): Promise<BrainEpisode | null> {
    if (cluster.entityType !== "kg.cluster") {
      return null;
    }
    const properties = cluster.properties ?? {};
    const projectKey = this.resolveProjectKey(cluster) ?? tenant.projectId ?? "";
    const members = await this.loadMembers(memberNodeIds, tenant, projectKey);
    const signals = await this.loadSignals([...memberNodeIds, cluster.id], tenant);
    const tenantId = this.resolveTenantId(cluster) ?? tenant.tenantId;
    const createdAt =
      toIsoString((properties.createdAt as string | Date | null | undefined) ?? (cluster as any).createdAt) ??
      new Date().toISOString();
    const updatedAt =
      toIsoString(
        (properties.updatedAt as string | Date | null | undefined) ??
          (cluster as any).updatedAt ??
          (properties.createdAt as string | Date | null | undefined),
      ) ?? createdAt;
    return {
      id: cluster.id,
      tenantId,
      projectKey,
      clusterKind: this.normalizeString(properties.clusterKind) ?? "unknown",
      size: this.coerceNumber(properties.size) ?? members.length,
      createdAt,
      updatedAt,
      windowStart: toIsoString(properties.windowStart as string | Date | null | undefined) ?? undefined,
      windowEnd: toIsoString(properties.windowEnd as string | Date | null | undefined) ?? undefined,
      summary: this.normalizeString(properties.summary ?? cluster.displayName) ?? undefined,
      members,
      signals,
    };
  }

  private async loadMembers(
    memberIds: string[],
    tenant: TenantContext,
    projectKey: string,
  ): Promise<BrainEpisodeMember[]> {
    const members: BrainEpisodeMember[] = [];
    for (const memberId of memberIds) {
      const entity = await this.graphStore.getEntity(memberId, tenant);
      if (!entity || !this.matchesScope(entity, tenant.tenantId, projectKey)) {
        continue;
      }
      members.push(this.mapMember(entity, projectKey));
    }
    return members;
  }

  private mapMember(entity: GraphEntity, fallbackProjectKey: string): BrainEpisodeMember {
    const properties = entity.properties ?? {};
    const projectKey = this.resolveProjectKey(entity) ?? fallbackProjectKey;
    const workKey = this.normalizeString(properties.sourceIssueKey ?? properties.workKey ?? properties.canonicalPath);
    const docUrl = this.normalizeString(properties.sourceUrl ?? properties.url ?? properties.canonicalPath);
    const title =
      this.normalizeString(properties.title) ??
      this.normalizeString(properties.displayName ?? entity.displayName) ??
      workKey ??
      docUrl ??
      undefined;
    const summary =
      this.normalizeString(properties.summary) ??
      this.normalizeString(properties.description ?? entity.displayName) ??
      undefined;
    const entityKind = this.normalizeString(properties.entityKind ?? entity.entityType) ?? entity.entityType;
    const cdmModelId = this.normalizeString(properties.cdmModelId ?? properties.modelId) ?? undefined;
    return {
      nodeId: entity.id,
      nodeType: entity.entityType,
      entityKind,
      cdmModelId,
      title,
      summary,
      projectKey: projectKey ?? undefined,
      docUrl: docUrl ?? undefined,
      workKey: workKey ?? undefined,
    };
  }

  private async loadSignals(sourceIds: string[], tenant: TenantContext): Promise<BrainEpisodeSignal[]> {
    const signalIds = new Set<string>();
    for (const sourceId of sourceIds) {
      const edges = await this.graphStore.listEdges(
        { edgeTypes: [SIGNAL_EDGE_TYPE], sourceEntityId: sourceId, limit: MAX_SIGNALS_PER_SOURCE },
        tenant,
      );
      edges.forEach((edge) => signalIds.add(edge.targetEntityId));
    }
    if (!signalIds.size) {
      return [];
    }
    const signals: BrainEpisodeSignal[] = [];
    const definitionSlugCache = new Map<string, string | null>();
    for (const signalId of signalIds) {
      const instance = await this.signalStore.getInstance(signalId);
      const signalNode = await this.graphStore.getEntity(signalId, tenant);
      const definitionId = instance?.definitionId ?? (signalNode?.properties?.definitionId as string | undefined);
      let definitionSlug = instance?.definition?.slug ?? null;
      if (!definitionSlug && definitionId) {
        if (definitionSlugCache.has(definitionId)) {
          definitionSlug = definitionSlugCache.get(definitionId) ?? null;
        } else {
          const definition = await this.signalStore.getDefinition(definitionId);
          definitionSlug = definition?.slug ?? null;
          definitionSlugCache.set(definitionId, definitionSlug ?? null);
        }
      }
      const severity =
        this.normalizeString((instance?.severity ?? signalNode?.properties?.severity) as string | undefined) ??
        "INFO";
      const status =
        this.normalizeString((instance?.status ?? signalNode?.properties?.status) as string | undefined) ?? "OPEN";
      const summary =
        this.normalizeString(instance?.summary ?? (signalNode?.properties?.summary as string | undefined)) ??
        signalNode?.displayName ??
        signalId;
      signals.push({
        id: instance?.id ?? signalNode?.id ?? signalId,
        severity,
        status,
        summary,
        definitionSlug: definitionSlug ?? definitionId ?? "unknown",
      });
    }
    return signals;
  }

  private resolveTenantId(entity: GraphEntity): string | null {
    const properties = entity.properties ?? {};
    const fromProps = this.normalizeString(properties.tenantId as string | undefined);
    if (fromProps) {
      return fromProps;
    }
    const scopeTenant = this.normalizeString(entity.scope?.orgId ?? (entity as any).tenantId);
    return scopeTenant ?? null;
  }

  private resolveProjectKey(entity: GraphEntity): string | null {
    const properties = entity.properties ?? {};
    const candidates = [
      properties.projectKey,
      properties.project_key,
      properties.project,
      properties.sourceProjectKey,
      properties.projectId,
    ];
    for (const value of candidates) {
      const normalized = this.normalizeString(value as string | undefined);
      if (normalized) {
        return normalized;
      }
    }
    const scopeProject = this.normalizeString(entity.scope?.projectId ?? (entity as any).projectId);
    return scopeProject ?? null;
  }

  private matchesScope(entity: GraphEntity, tenantId: string, projectKey: string): boolean {
    const entityTenant = this.resolveTenantId(entity);
    if (entityTenant && entityTenant !== tenantId) {
      return false;
    }
    const entityProject = this.resolveProjectKey(entity);
    if (entityProject && entityProject !== projectKey) {
      return false;
    }
    return true;
  }

  private compareClusterRecency(left: GraphEntity, right: GraphEntity): number {
    const leftTimestamp = this.resolveTimestamp(left);
    const rightTimestamp = this.resolveTimestamp(right);
    if (!leftTimestamp && !rightTimestamp) {
      return 0;
    }
    if (!leftTimestamp) {
      return 1;
    }
    if (!rightTimestamp) {
      return -1;
    }
    return rightTimestamp.getTime() - leftTimestamp.getTime();
  }

  private resolveTimestamp(entity: GraphEntity): Date | null {
    const properties = entity.properties ?? {};
    return (
      this.toDate(properties.updatedAt) ??
      this.toDate(properties.createdAt) ??
      this.toDate((entity as any).updatedAt) ??
      this.toDate((entity as any).createdAt) ??
      null
    );
  }

  private toDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  private coerceNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private normalizeString(value?: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    const str = String(value).trim();
    return str.length > 0 ? str : null;
  }
}
