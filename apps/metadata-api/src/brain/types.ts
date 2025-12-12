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

export type VectorIndexEntryInput = {
  nodeId: string;
  profileId: string;
  chunkId: string;
  embedding: number[];
  tenantId: string;
  projectKey?: string | null;
  profileKind: string;
  sourceSystem?: string | null;
  rawMetadata?: Record<string, unknown> | null;
};

export type VectorIndexQueryFilter = {
  tenantId?: string;
  projectKeyIn?: string[];
  profileKindIn?: string[];
};

export interface VectorIndexStore {
  upsertEntries(entries: VectorIndexEntryInput[]): Promise<void>;
  query(args: {
    profileId: string;
    queryEmbedding: number[];
    topK: number;
    filter?: VectorIndexQueryFilter;
  }): Promise<Array<{ nodeId: string; score: number; metadata: Record<string, unknown> }>>;
}

export interface EmbeddingProvider {
  embedText(model: string, texts: string[]): Promise<number[][]>;
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
  }): Promise<Array<{ nodeId: string; score: number; profileId: string }>>;
}
