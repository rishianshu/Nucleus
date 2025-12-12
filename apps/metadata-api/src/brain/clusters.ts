import { createHash } from "node:crypto";
import type { GraphEntity, GraphStore, TenantContext } from "@metadata/core";
import { clampBatchSize } from "../kg/utils.js";
import type { GraphWrite } from "../graph/graphWrite.js";
import type { BrainVectorSearch, ClusterBuilder, ClusterRead, ClusterSummary } from "./types.js";

const MEMBER_NODE_TYPES = new Set(["cdm.work.item", "cdm.doc.item"]);
const PROFILE_BY_NODE_TYPE: Record<string, { profileId: string; profileKind?: string; textKeys: string[] }> = {
  "cdm.work.item": { profileId: "cdm.work.summary", profileKind: "work", textKeys: ["summary", "title", "displayName"] },
  "cdm.doc.item": { profileId: "cdm.doc.body", profileKind: "doc", textKeys: ["body", "title", "text", "displayName"] },
};
const DEFAULT_CLUSTER_KIND = "work-doc-episode";
const DEFAULT_ALGO = "vector-neighbors-v1";
const DEFAULT_MAX_CLUSTER_SIZE = 5;
const DEFAULT_SCORE_THRESHOLD = 0.35;
const DEFAULT_MAX_SEEDS = 25;

type ClusterDraft = {
  clusterId: string;
  seedNodeIds: Set<string>;
  members: Set<string>;
  score: number;
  key: string;
};

export class ClusterBuilderService implements ClusterBuilder {
  private readonly graphWrite: GraphWrite;
  private readonly graphStore: GraphStore;
  private readonly vectorSearch: BrainVectorSearch;
  private readonly clusterKind: string;
  private readonly algoLabel: string;
  private readonly scoreThreshold: number;
  private readonly maxNeighbors: number;
  private readonly now: () => Date;

  constructor(options: {
    graphWrite: GraphWrite;
    graphStore: GraphStore;
    vectorSearch: BrainVectorSearch;
    clusterKind?: string;
    algoLabel?: string;
    scoreThreshold?: number;
    maxNeighbors?: number;
    now?: () => Date;
  }) {
    this.graphWrite = options.graphWrite;
    this.graphStore = options.graphStore;
    this.vectorSearch = options.vectorSearch;
    this.clusterKind = options.clusterKind ?? DEFAULT_CLUSTER_KIND;
    this.algoLabel = options.algoLabel ?? DEFAULT_ALGO;
    this.scoreThreshold = options.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
    this.maxNeighbors = Math.max(1, options.maxNeighbors ?? DEFAULT_MAX_CLUSTER_SIZE);
    this.now = options.now ?? (() => new Date());
  }

  async buildClustersForProject(args: {
    tenantId: string;
    projectKey: string;
    windowStart?: Date;
    windowEnd?: Date;
    maxSeeds?: number;
    maxClusterSize?: number;
  }): Promise<{ clustersCreated: number; membersLinked: number }> {
    const tenant = this.toTenant(args);
    const maxSeeds = clampBatchSize(args.maxSeeds, DEFAULT_MAX_SEEDS, 200);
    const maxClusterSize = Math.max(2, args.maxClusterSize ?? DEFAULT_MAX_CLUSTER_SIZE);
    const seeds = (await this.loadSeedNodes(tenant, args)).slice(0, maxSeeds);
    const nodesById = new Map<string, GraphEntity>(seeds.map((node) => [node.id, node]));
    const drafts = new Map<string, ClusterDraft>();

    for (const seed of seeds) {
      const { members, score } = await this.collectMembersForSeed({
        seed,
        tenant,
        args,
        nodesById,
        maxClusterSize,
      });
      if (members.size < 2) {
        continue;
      }
      const key = this.buildClusterKey(args, members);
      const clusterId = this.buildClusterId(key);
      const existing = drafts.get(key);
      if (existing) {
        members.forEach((memberId) => existing.members.add(memberId));
        existing.seedNodeIds.add(seed.id);
        existing.score = Math.max(existing.score, score);
        continue;
      }
      drafts.set(key, {
        clusterId,
        seedNodeIds: new Set([seed.id]),
        members,
        score,
        key,
      });
    }

    let clustersCreated = 0;
    let membersLinked = 0;
    for (const draft of drafts.values()) {
      const existing = await this.graphStore.getEntity(draft.clusterId, tenant);
      const properties = this.buildClusterProperties(args, draft, existing);
      if (!existing) {
        clustersCreated += 1;
      }
      await this.graphWrite.upsertNode({
        nodeType: "kg.cluster",
        nodeId: draft.clusterId,
        properties,
      });
      for (const memberId of draft.members) {
        await this.graphWrite.upsertEdge({
          edgeType: "IN_CLUSTER",
          fromNodeId: memberId,
          toNodeId: draft.clusterId,
        });
        membersLinked += 1;
      }
    }

    return { clustersCreated, membersLinked };
  }

  private async loadSeedNodes(tenant: TenantContext, args: { projectKey: string; windowStart?: Date; windowEnd?: Date }): Promise<GraphEntity[]> {
    const nodes = await this.graphStore.listEntities({ entityTypes: Array.from(MEMBER_NODE_TYPES) }, tenant);
    return nodes
      .filter((node) => matchesProject(node, args.projectKey))
      .filter((node) => withinWindow(node, args.windowStart, args.windowEnd))
      .sort(sortByRecency);
  }

  private async collectMembersForSeed(input: {
    seed: GraphEntity;
    tenant: TenantContext;
    args: { tenantId: string; projectKey: string; windowStart?: Date; windowEnd?: Date };
    nodesById: Map<string, GraphEntity>;
    maxClusterSize: number;
  }): Promise<{ members: Set<string>; score: number }> {
    const members = new Set<string>([input.seed.id]);
    const profile = PROFILE_BY_NODE_TYPE[input.seed.entityType];
    if (!profile) {
      return { members, score: 0 };
    }
    const queryText = this.resolveQueryText(input.seed, profile.textKeys);
    const topK = Math.min(this.maxNeighbors, Math.max(1, input.maxClusterSize - 1));
    const results = await this.vectorSearch.search({
      profileId: profile.profileId,
      queryText,
      topK,
      tenantId: input.args.tenantId,
      projectKeyIn: [input.args.projectKey],
      profileKindIn: profile.profileKind ? [profile.profileKind] : undefined,
    });
    let topScore = 0;
    for (const result of results) {
      if (!result || typeof result.nodeId !== "string") {
        continue;
      }
      if (result.nodeId === input.seed.id) {
        continue;
      }
      if (typeof result.score === "number") {
        topScore = Math.max(topScore, result.score);
        if (result.score < this.scoreThreshold) {
          continue;
        }
      }
      const member = await this.resolveMemberNode(result.nodeId, input.tenant, input.args.projectKey, input.nodesById);
      if (!member) {
        continue;
      }
      members.add(member.id);
      if (members.size >= input.maxClusterSize) {
        break;
      }
    }
    return { members, score: topScore };
  }

  private async resolveMemberNode(
    nodeId: string,
    tenant: TenantContext,
    projectKey: string,
    cache: Map<string, GraphEntity>,
  ): Promise<GraphEntity | null> {
    const cached = cache.get(nodeId);
    if (cached) {
      return cached;
    }
    const node = await this.graphStore.getEntity(nodeId, tenant);
    if (!node) {
      return null;
    }
    if (!MEMBER_NODE_TYPES.has(node.entityType)) {
      return null;
    }
    if (!matchesProject(node, projectKey)) {
      return null;
    }
    cache.set(nodeId, node);
    return node;
  }

  private resolveQueryText(node: GraphEntity, textKeys: string[]): string {
    const properties = node.properties ?? {};
    for (const key of textKeys) {
      const value = properties[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    if (typeof node.displayName === "string" && node.displayName.trim().length > 0) {
      return node.displayName;
    }
    return node.id;
  }

  private buildClusterKey(args: { tenantId: string; projectKey: string; windowStart?: Date; windowEnd?: Date }, members: Set<string>): string {
    const windowKey = [args.windowStart ? args.windowStart.toISOString() : "", args.windowEnd ? args.windowEnd.toISOString() : ""].join("|");
    return [args.tenantId, args.projectKey, windowKey, Array.from(members).sort().join("|")].join("::");
  }

  private buildClusterId(key: string): string {
    const hash = createHash("sha1").update(key).digest("hex").slice(0, 16);
    return `cluster:${hash}`;
  }

  private buildClusterProperties(
    args: { tenantId: string; projectKey: string; windowStart?: Date; windowEnd?: Date },
    draft: ClusterDraft,
    existing?: GraphEntity | null,
  ): Record<string, unknown> {
    const now = this.now().toISOString();
    const createdAt = coerceDateString(existing?.properties?.createdAt) ?? now;
    const sortedSeeds = Array.from(draft.seedNodeIds).sort();
    return {
      tenantId: args.tenantId,
      projectKey: args.projectKey,
      clusterKind: this.clusterKind,
      seedNodeIds: sortedSeeds,
      size: draft.members.size,
      createdAt,
      updatedAt: now,
      windowStart: args.windowStart ? args.windowStart.toISOString() : undefined,
      windowEnd: args.windowEnd ? args.windowEnd.toISOString() : undefined,
      score: draft.score,
      algo: this.algoLabel,
    };
  }

  private toTenant(args: { tenantId: string; projectKey: string }): TenantContext {
    return { tenantId: args.tenantId, projectId: args.projectKey };
  }
}

export class ClusterReadService implements ClusterRead {
  constructor(private readonly graphStore: GraphStore) {}

  async listClustersForProject(args: {
    tenantId: string;
    projectKey: string;
    windowStart?: Date;
    windowEnd?: Date;
  }): Promise<ClusterSummary[]> {
    const tenant: TenantContext = { tenantId: args.tenantId, projectId: args.projectKey };
    const clusters = await this.graphStore.listEntities({ entityTypes: ["kg.cluster"] }, tenant);
    const filtered = clusters
      .filter((node) => matchesProject(node, args.projectKey))
      .filter((node) => withinWindow(node, args.windowStart, args.windowEnd));

    const summaries: ClusterSummary[] = [];
    for (const cluster of filtered) {
      const edges = await this.graphStore.listEdges({ edgeTypes: ["IN_CLUSTER"], targetEntityId: cluster.id }, tenant);
      const memberNodeIds = Array.from(new Set(edges.map((edge) => edge.sourceEntityId))).sort();
      summaries.push({
        clusterNodeId: cluster.id,
        clusterKind: String(cluster.properties?.clusterKind ?? "unknown"),
        memberNodeIds,
      });
    }
    return summaries;
  }
}

function matchesProject(node: GraphEntity, projectKey: string): boolean {
  const properties = node.properties ?? {};
  const candidates = [
    properties.projectKey,
    properties.project_key,
    properties.project,
    properties.sourceProjectKey,
    properties.projectId,
  ];
  const scopeProject = node.scope?.projectId ?? node.projectId;
  if (typeof scopeProject === "string" && scopeProject.length > 0 && scopeProject === projectKey) {
    return true;
  }
  const match = candidates.find((value) => typeof value === "string" && value.length > 0);
  return match === projectKey;
}

function withinWindow(node: GraphEntity, windowStart?: Date, windowEnd?: Date): boolean {
  if (!windowStart && !windowEnd) {
    return true;
  }
  const timestamp = resolveTimestamp(node);
  if (!timestamp) {
    return true;
  }
  if (windowStart && timestamp < windowStart) {
    return false;
  }
  if (windowEnd && timestamp > windowEnd) {
    return false;
  }
  return true;
}

function resolveTimestamp(node: GraphEntity): Date | null {
  const properties = node.properties ?? {};
  return (
    toDate(properties.updatedAt) ??
    toDate(properties.createdAt) ??
    toDate(node.updatedAt) ??
    toDate(node.createdAt) ??
    null
  );
}

function toDate(value: unknown): Date | null {
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

function coerceDateString(value: unknown): string | undefined {
  const parsed = toDate(value);
  return parsed ? parsed.toISOString() : undefined;
}

function sortByRecency(a: GraphEntity, b: GraphEntity): number {
  const left = resolveTimestamp(a);
  const right = resolveTimestamp(b);
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return right.getTime() - left.getTime();
}
