import type { GraphEdge, GraphEntity, GraphStore, TenantContext } from "@metadata/core";
import type { BrainVectorSearch, BrainVectorSearchHit } from "./types.js";

export type BrainSearchFilter = {
  tenantId: string;
  projectKey?: string | null;
  profileKindIn?: string[];
  secured?: boolean | null;
};

export type BrainSearchOptions = {
  topK?: number | null;
  maxEpisodes?: number | null;
  expandDepth?: number | null;
  maxNodes?: number | null;
  includeEpisodes?: boolean | null;
  includeSignals?: boolean | null;
  includeClusters?: boolean | null;
};

export type BrainSearchHit = {
  nodeId: string;
  nodeType: string;
  profileId: string;
  profileKind: string;
  score: number;
  title?: string;
  url?: string | null;
};

export type BrainGraphNode = {
  nodeId: string;
  nodeType: string;
  label?: string | null;
  properties?: Record<string, unknown> | null;
};

export type BrainGraphEdge = {
  edgeType: string;
  fromNodeId: string;
  toNodeId: string;
  properties?: Record<string, unknown> | null;
};

export type BrainSearchEpisode = {
  clusterNodeId: string;
  clusterKind: string;
  projectKey: string;
  score: number;
  size: number;
  memberNodeIds: string[];
};

export type BrainRagPassage = {
  sourceNodeId: string;
  sourceKind: string;
  text: string;
  url?: string | null;
};

export type BrainPromptPack = {
  contextMarkdown: string;
  citations: Array<Record<string, unknown>>;
};

export type BrainSearchResult = {
  hits: BrainSearchHit[];
  episodes: BrainSearchEpisode[];
  graphNodes: BrainGraphNode[];
  graphEdges: BrainGraphEdge[];
  passages: BrainRagPassage[];
  promptPack: BrainPromptPack;
};

const DEFAULT_PROFILES: Array<{ profileId: string; profileKind?: string }> = [
  { profileId: "cdm.work.summary", profileKind: "work" },
  { profileId: "cdm.doc.body", profileKind: "doc" },
];

const DEFAULT_TOP_K = 20;
const DEFAULT_MAX_EPISODES = 10;
const DEFAULT_EXPAND_DEPTH = 1;
const DEFAULT_MAX_NODES = 200;
const MAX_PASSAGE_TOTAL_CHARS = 30000;
const MAX_PASSAGE_PER_NODE = 2000;
const DEFAULT_PROJECT_KEY = "global";

export class BrainSearchService {
  private readonly graphStore: GraphStore;
  private readonly vectorSearch: BrainVectorSearch;
  private readonly defaultProfiles: Array<{ profileId: string; profileKind?: string }>;
  private readonly maxPassageChars: number;
  private readonly maxPassagePerNode: number;

  constructor(options: {
    graphStore: GraphStore;
    vectorSearch: BrainVectorSearch;
    defaultProfiles?: Array<{ profileId: string; profileKind?: string }>;
    maxPassageCharacters?: number;
    maxPassagePerNode?: number;
  }) {
    this.graphStore = options.graphStore;
    this.vectorSearch = options.vectorSearch;
    this.defaultProfiles = options.defaultProfiles?.length ? options.defaultProfiles : DEFAULT_PROFILES;
    this.maxPassageChars = Math.max(1000, options.maxPassageCharacters ?? MAX_PASSAGE_TOTAL_CHARS);
    this.maxPassagePerNode = Math.max(200, options.maxPassagePerNode ?? MAX_PASSAGE_PER_NODE);
  }

  async search(args: {
    queryText: string;
    filter: BrainSearchFilter;
    options?: BrainSearchOptions | null;
    actorId?: string | null;
  }): Promise<BrainSearchResult> {
    const tenantId = this.normalizeString(args.filter.tenantId);
    if (!tenantId) {
      throw new Error("tenantId is required for brainSearch");
    }
    const projectKey = this.normalizeString(args.filter.projectKey) ?? DEFAULT_PROJECT_KEY;
    if (args.filter.secured !== false && !args.actorId) {
      throw new Error("Brain search requires an authenticated principal when secured=true");
    }
    const projectKeyFilter = args.filter.projectKey ? [projectKey] : undefined;
    const profileKindFilter = this.normalizeList(args.filter.profileKindIn);
    const topK = this.clampNumber(args.options?.topK, 1, 200, DEFAULT_TOP_K);
    const maxEpisodes = this.clampNumber(args.options?.maxEpisodes, 0, 200, DEFAULT_MAX_EPISODES);
    const expandDepth = this.clampNumber(args.options?.expandDepth, 0, 3, DEFAULT_EXPAND_DEPTH);
    const maxNodes = this.clampNumber(args.options?.maxNodes, 1, 1000, DEFAULT_MAX_NODES);
    const includeEpisodes = args.options?.includeEpisodes !== false;
    const includeSignals = args.options?.includeSignals !== false;
    const includeClusters = args.options?.includeClusters !== false || includeEpisodes;
    const tenant: TenantContext = { tenantId, projectId: projectKey, actorId: args.actorId ?? undefined };

    const vectorHits = await this.runVectorSearch({
      queryText: args.queryText,
      topK,
      tenantId,
      projectKeyFilter,
      profileKindFilter,
    });
    const hitNodes = await this.loadNodes(
      vectorHits.map((hit) => hit.nodeId),
      tenant,
      args.filter.secured !== false,
    );
    const hits: BrainSearchHit[] = vectorHits
      .map((hit) => this.mapHit(hit, hitNodes.get(hit.nodeId)))
      .filter((hit): hit is BrainSearchHit => Boolean(hit));
    const seeds = hits
      .map((hit) => hitNodes.get(hit.nodeId))
      .filter((node): node is GraphEntity => Boolean(node));
    const { nodes: graphNodeMap, edges: graphEdgeMap } = await this.expandGraph({
      seedNodes: seeds,
      tenant,
      depth: expandDepth,
      maxNodes,
      includeSignals,
      includeClusters,
      enforceSecured: args.filter.secured !== false,
    });
    const episodes = includeEpisodes
      ? this.buildEpisodes(graphEdgeMap, hits, graphNodeMap, tenant, maxEpisodes)
      : [];
    const graphNodes = Array.from(graphNodeMap.values())
      .map((node) => this.mapGraphNode(node))
      .sort((a, b) => a.nodeId.localeCompare(b.nodeId));
    const graphEdges = Array.from(graphEdgeMap.values())
      .map((edge) => this.mapGraphEdge(edge))
      .sort((a, b) => {
        if (a.edgeType !== b.edgeType) return a.edgeType.localeCompare(b.edgeType);
        if (a.fromNodeId !== b.fromNodeId) return a.fromNodeId.localeCompare(b.fromNodeId);
        return a.toNodeId.localeCompare(b.toNodeId);
      });
    const passages = this.buildPassages(hits, graphNodeMap);
    const promptPack = this.buildPromptPack(args.queryText, hits, episodes, passages);

    return {
      hits,
      episodes,
      graphNodes,
      graphEdges,
      passages,
      promptPack,
    };
  }

  private async runVectorSearch(input: {
    queryText: string;
    topK: number;
    tenantId: string;
    projectKeyFilter?: string[];
    profileKindFilter?: string[];
  }): Promise<BrainVectorSearchHit[]> {
    const merged = new Map<string, BrainVectorSearchHit>();
    for (const profile of this.defaultProfiles) {
      const results = await this.vectorSearch.search({
        profileId: profile.profileId,
        queryText: input.queryText,
        topK: input.topK,
        tenantId: input.tenantId,
        projectKeyIn: input.projectKeyFilter,
        profileKindIn: input.profileKindFilter,
      });
      for (const result of results) {
        const existing = merged.get(result.nodeId);
        if (!existing || (result.score ?? 0) > (existing.score ?? 0)) {
          merged.set(result.nodeId, result);
        }
      }
    }
    return Array.from(merged.values())
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, input.topK);
  }

  private async loadNodes(
    nodeIds: string[],
    tenant: TenantContext,
    enforceSecured: boolean,
  ): Promise<Map<string, GraphEntity>> {
    const map = new Map<string, GraphEntity>();
    for (const nodeId of nodeIds) {
      const entity = await this.graphStore.getEntity(nodeId, tenant);
      if (!entity) {
        continue;
      }
      if (enforceSecured && this.isSecuredNode(entity)) {
        continue;
      }
      map.set(nodeId, entity);
    }
    return map;
  }

  private mapHit(hit: BrainVectorSearchHit, node?: GraphEntity | null): BrainSearchHit | null {
    if (!node) {
      return null;
    }
    const profileKind = this.normalizeString(hit.profileKind) ?? this.inferProfileKind(node.entityType) ?? "unknown";
    const properties = node.properties ?? {};
    const title =
      this.normalizeString(properties.title) ??
      this.normalizeString(properties.summary) ??
      this.normalizeString(node.displayName) ??
      undefined;
    const url = this.resolveUrl(properties, node);
    return {
      nodeId: node.id,
      nodeType: node.entityType,
      profileId: hit.profileId,
      profileKind,
      score: Number(hit.score ?? 0),
      title,
      url,
    };
  }

  private async expandGraph(input: {
    seedNodes: GraphEntity[];
    tenant: TenantContext;
    depth: number;
    maxNodes: number;
    includeSignals: boolean;
    includeClusters: boolean;
    enforceSecured: boolean;
  }): Promise<{ nodes: Map<string, GraphEntity>; edges: Map<string, GraphEdge> }> {
    const nodes = new Map<string, GraphEntity>();
    const edges = new Map<string, GraphEdge>();
    const queue: Array<{ id: string; depth: number }> = [];
    for (const node of input.seedNodes) {
      nodes.set(node.id, node);
      queue.push({ id: node.id, depth: 0 });
    }
    while (queue.length > 0 && nodes.size < input.maxNodes) {
      const current = queue.shift();
      if (!current) {
        break;
      }
      if (current.depth >= input.depth) {
        continue;
      }
      const neighborEdges = await this.collectEdges(current.id, input, input.maxNodes - nodes.size);
      for (const edge of neighborEdges) {
        if (!input.includeSignals && edge.edgeType === "HAS_SIGNAL") {
          continue;
        }
        if (!input.includeClusters && edge.edgeType === "IN_CLUSTER") {
          continue;
        }
        edges.set(edge.id, edge);
        const neighborId = edge.sourceEntityId === current.id ? edge.targetEntityId : edge.sourceEntityId;
        if (!nodes.has(neighborId) && nodes.size < input.maxNodes) {
          const entity = await this.graphStore.getEntity(neighborId, input.tenant);
          if (!entity) {
            continue;
          }
          if (input.enforceSecured && this.isSecuredNode(entity)) {
            continue;
          }
          nodes.set(neighborId, entity);
          queue.push({ id: neighborId, depth: current.depth + 1 });
        }
      }
    }
    return { nodes, edges };
  }

  private async collectEdges(
    nodeId: string,
    input: {
      tenant: TenantContext;
      depth: number;
      maxNodes: number;
    },
    remainingNodes: number,
  ): Promise<GraphEdge[]> {
    const limit = Math.max(10, Math.min(remainingNodes * 4, 500));
    const outbound = await this.graphStore.listEdges({ sourceEntityId: nodeId, limit }, input.tenant);
    const inbound = await this.graphStore.listEdges({ targetEntityId: nodeId, limit }, input.tenant);
    const all = [...outbound, ...inbound];
    const seen = new Set<string>();
    const deduped: GraphEdge[] = [];
    for (const edge of all) {
      if (seen.has(edge.id)) {
        continue;
      }
      seen.add(edge.id);
      deduped.push(edge);
    }
    return deduped;
  }

  private buildEpisodes(
    edges: Map<string, GraphEdge>,
    hits: BrainSearchHit[],
    nodes: Map<string, GraphEntity>,
    tenant: TenantContext,
    maxEpisodes: number,
  ): BrainSearchEpisode[] {
    const hitScores = new Map<string, number>();
    hits.forEach((hit) => hitScores.set(hit.nodeId, hit.score));
    const clusterMembers = new Map<string, Set<string>>();
    edges.forEach((edge) => {
      if (edge.edgeType !== "IN_CLUSTER") {
        return;
      }
      const memberId = edge.sourceEntityId;
      const clusterId = edge.targetEntityId;
      if (!clusterMembers.has(clusterId)) {
        clusterMembers.set(clusterId, new Set<string>());
      }
      clusterMembers.get(clusterId)?.add(memberId);
    });
    const episodes: BrainSearchEpisode[] = [];
    for (const [clusterId, members] of clusterMembers.entries()) {
      const score = Array.from(members).reduce((total, memberId) => total + (hitScores.get(memberId) ?? 0), 0);
      if (score <= 0) {
        continue;
      }
      const clusterNode = nodes.get(clusterId);
      const clusterKind =
        this.normalizeString(clusterNode?.properties?.clusterKind as string | undefined) ?? "unknown";
      const projectKey = this.resolveProjectKey(clusterNode) ?? tenant.projectId ?? DEFAULT_PROJECT_KEY;
      const size = this.coerceNumber(clusterNode?.properties?.size) ?? members.size;
      episodes.push({
        clusterNodeId: clusterId,
        clusterKind,
        projectKey,
        score,
        size,
        memberNodeIds: Array.from(members).sort(),
      });
    }
    episodes.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.clusterNodeId.localeCompare(b.clusterNodeId);
    });
    return episodes.slice(0, maxEpisodes);
  }

  private mapGraphNode(node: GraphEntity): BrainGraphNode {
    return {
      nodeId: node.id,
      nodeType: node.entityType,
      label: this.normalizeString(node.displayName) ?? null,
      properties: node.properties ?? null,
    };
  }

  private mapGraphEdge(edge: GraphEdge): BrainGraphEdge {
    return {
      edgeType: edge.edgeType,
      fromNodeId: edge.sourceEntityId,
      toNodeId: edge.targetEntityId,
      properties: edge.metadata ?? null,
    };
  }

  private buildPassages(hits: BrainSearchHit[], nodes: Map<string, GraphEntity>): BrainRagPassage[] {
    const passages: BrainRagPassage[] = [];
    let remaining = this.maxPassageChars;
    for (const hit of hits) {
      if (remaining <= 0) {
        break;
      }
      const node = nodes.get(hit.nodeId);
      if (!node) {
        continue;
      }
      const text = this.extractPassageText(node);
      if (!text) {
        continue;
      }
      const snippet = text.slice(0, Math.min(text.length, Math.min(this.maxPassagePerNode, remaining)));
      if (!snippet.length) {
        continue;
      }
      passages.push({
        sourceNodeId: hit.nodeId,
        sourceKind: this.inferProfileKind(node.entityType) ?? hit.profileKind ?? "other",
        text: snippet,
        url: this.resolveUrl(node.properties, node),
      });
      remaining -= snippet.length;
    }
    return passages;
  }

  private extractPassageText(node: GraphEntity): string | null {
    const props = node.properties ?? {};
    const candidates = [
      props.summary,
      props.description,
      props.body,
      props.text,
      props.content,
      props.title,
      node.displayName,
    ];
    const chosen = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
    return chosen ? String(chosen).slice(0, this.maxPassagePerNode) : null;
  }

  private buildPromptPack(
    queryText: string,
    hits: BrainSearchHit[],
    episodes: BrainSearchEpisode[],
    passages: BrainRagPassage[],
  ): BrainPromptPack {
    const lines: string[] = [];
    lines.push("# Brain Search Context");
    lines.push(`Query: ${queryText}`);
    if (episodes.length) {
      lines.push("Episodes:");
      episodes.forEach((episode, idx) => {
        lines.push(
          `${idx + 1}. ${episode.clusterNodeId} [${episode.clusterKind}] score=${episode.score.toFixed(3)} members=${episode.memberNodeIds.join(",")}`,
        );
      });
    }
    if (hits.length) {
      lines.push("Hits:");
      hits.forEach((hit, idx) => {
        lines.push(
          `${idx + 1}. ${hit.title ?? hit.nodeId} (${hit.nodeType}) score=${hit.score.toFixed(3)} id=${hit.nodeId}`,
        );
      });
    }
    if (passages.length) {
      lines.push("Passages:");
      passages.forEach((passage, idx) => {
        lines.push(`${idx + 1}. (${passage.sourceKind}) ${passage.text}`);
      });
    }
    const citations = hits.map((hit) => ({
      sourceNodeId: hit.nodeId,
      url: hit.url ?? null,
      title: hit.title ?? null,
      nodeType: hit.nodeType,
    }));
    return { contextMarkdown: lines.join("\n"), citations };
  }

  private isSecuredNode(node: GraphEntity): boolean {
    const properties = node.properties ?? {};
    return Boolean((properties.secured ?? properties.isSecured) === true);
  }

  private normalizeList(values?: string[] | null): string[] | undefined {
    const normalized = (values ?? [])
      .map((value) => this.normalizeString(value))
      .filter((value): value is string => Boolean(value));
    return normalized.length ? normalized : undefined;
  }

  private normalizeString(value: unknown): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    const trimmed = String(value).trim();
    return trimmed.length ? trimmed : undefined;
  }

  private clampNumber(value: number | null | undefined, min: number, max: number, fallback: number): number {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return fallback;
    }
    const bounded = Math.max(min, Math.min(max, Math.floor(value)));
    return bounded;
  }

  private inferProfileKind(entityType: string): string | undefined {
    if (entityType.startsWith("cdm.work")) {
      return "work";
    }
    if (entityType.startsWith("cdm.doc")) {
      return "doc";
    }
    if (entityType.startsWith("signal.")) {
      return "signal";
    }
    if (entityType.startsWith("kg.cluster")) {
      return "cluster";
    }
    return undefined;
  }

  private resolveUrl(properties: Record<string, unknown>, node: GraphEntity): string | null {
    const candidates = [
      properties.url,
      properties.sourceUrl,
      properties.canonicalPath,
      node.canonicalPath,
    ];
    const url = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
    return url ? String(url) : null;
  }

  private resolveProjectKey(node?: GraphEntity | null): string | undefined {
    if (!node) {
      return undefined;
    }
    const properties = node.properties ?? {};
    const candidates = [
      properties.projectKey,
      properties.project_key,
      properties.projectId,
      properties.project,
      properties.sourceProjectKey,
      node.projectId,
      node.scope?.projectId,
    ];
    const project = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
    return project ? String(project) : undefined;
  }

  private coerceNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  }
}
