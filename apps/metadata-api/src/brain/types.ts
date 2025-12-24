export type IndexProfile = {
  id: string;
  family: string;
  description?: string | null;
  nodeType: string;
  textSource: Record<string, unknown>;
  embeddingModel: string;
  chunking?: Record<string, unknown> | null;
  profileKind: string;
  enabled: boolean;
};

export interface IndexProfileStore {
  listProfiles(): Promise<IndexProfile[]>;
  getProfile(id: string): Promise<IndexProfile | null>;
}

export interface NodeIndexer {
  indexNodesForProfile(args: { profileId: string; nodeIds?: string[]; batchSize?: number }): Promise<{ indexed: number }>;
}

export interface BrainVectorSearch {
  search(args: {
    profileId: string;
    queryText: string;
    topK: number;
    tenantId: string;
    projectKeyIn?: string[];
    profileKindIn?: string[];
  }): Promise<BrainVectorSearchHit[]>;
}

export type MaterializedStatus = "READY" | "INDEXING" | "INDEXED" | "FAILED";

export type MaterializedArtifactHandle = {
  uri: string;
  bucket?: string | null;
  basePrefix?: string | null;
  datasetSlug?: string | null;
  sinkId?: string | null;
};

export type MaterializedArtifact = {
  id: string;
  tenantId: string;
  sourceRunId: string;
  artifactKind: string;
  sourceFamily?: string | null;
  sinkEndpointId?: string | null;
  handle: Record<string, unknown>;
  canonicalMeta: Record<string, unknown>;
  sourceMeta?: Record<string, unknown> | null;
  status: MaterializedStatus;
  counters?: Record<string, unknown> | null;
  lastError?: unknown;
  indexStatus?: MaterializedStatus;
  indexCounters?: Record<string, unknown> | null;
  indexLastError?: unknown;
};

export interface MaterializedRegistry {
  upsertArtifact(args: {
    tenantId: string;
    sourceRunId: string;
    artifactKind: string;
    sourceFamily?: string | null;
    sinkEndpointId?: string | null;
    handle: Record<string, unknown>;
    canonicalMeta: Record<string, unknown>;
    sourceMeta?: Record<string, unknown> | null;
  }): Promise<MaterializedArtifact>;
  markIndexing(id: string): Promise<MaterializedArtifact>;
  completeIndexRun(
    id: string,
    args: { status: MaterializedStatus; counters?: Record<string, unknown>; lastError?: unknown },
  ): Promise<MaterializedArtifact>;
  getArtifact(id: string): Promise<MaterializedArtifact | null>;
}

export type ClusterSummary = {
  clusterNodeId: string;
  clusterKind: string;
  memberNodeIds: string[];
};

export type BrainVectorSearchHit = {
  nodeId: string;
  score: number;
  profileId: string;
  profileKind?: string | null;
  projectKey?: string | null;
  sourceSystem?: string | null;
  tenantId?: string | null;
  metadata?: Record<string, unknown> | null;
};

export interface ClusterBuilder {
  buildClustersForProject(args: {
    tenantId: string;
    projectKey: string;
    windowStart?: Date;
    windowEnd?: Date;
    maxSeeds?: number;
    maxClusterSize?: number;
  }): Promise<{ clustersCreated: number; membersLinked: number }>;
}

export interface ClusterRead {
  listClustersForProject(args: {
    tenantId: string;
    projectKey: string;
    windowStart?: Date;
    windowEnd?: Date;
  }): Promise<ClusterSummary[]>;
}
