# SPEC — Brain Vector Index Foundation v1

## Problem

Nucleus has a unified KG with CDM entities and Signals, but no shared vector index
for semantic retrieval. Today, any embedding or retrieval is ad-hoc and not tied
to KG node IDs or a common metadata schema. This blocks Brain API, GraphRAG, and
cluster/episode formation.

We need a base layer for:
- declaring *index profiles* (what to embed and how),
- storing embeddings keyed by KG node IDs,
- querying by text + metadata filters, returning node IDs for graph traversal.

## Interfaces / Contracts

### 1. Index profiles

Table: `vector_index_profiles`

Fields:
- `id` (PK, string): e.g., "cdm.work.summary", "cdm.doc.body"
- `family` (string): "work", "doc", "code", etc.
- `description` (text)
- `node_type` (string): KG nodeType this profile targets
- `text_source` (jsonb): where to get text, e.g., `{"from": "cdm", "field": "summary"}`
- `embedding_model` (string): model identifier
- `chunking` (jsonb): e.g., `{"maxTokens": 512, "overlapTokens": 64}`
- `profile_kind` (string): e.g., "work", "doc", "code"
- `enabled` (boolean)

```ts
export interface IndexProfile {
  id: string;
  nodeType: string;
  profileKind: string;
  embeddingModel: string;
}

export interface IndexProfileStore {
  listProfiles(): Promise<IndexProfile[]>;
  getProfile(id: string): Promise<IndexProfile | null>;
}
```

### 2. Vector index store

Table: `vector_index_entries`

Fields:
- `id` (PK)
- `node_id` (string): KG nodeId
- `profile_id` (string, FK)
- `chunk_id` (string)
- `embedding` (vector): pgvector column
- `tenant_id` (string)
- `project_key` (string, nullable)
- `profile_kind` (string)
- `source_system` (string, nullable)
- `raw_metadata` (jsonb)
- `created_at`, `updated_at` (timestamps)

```ts
export interface VectorIndexStore {
  upsertEntries(entries: VectorIndexEntryInput[]): Promise<void>;
  query(args: {
    profileId: string;
    queryEmbedding: number[];
    topK: number;
    filter?: {
      tenantId?: string;
      projectKeyIn?: string[];
      profileKindIn?: string[];
    };
  }): Promise<Array<{ nodeId: string; score: number; metadata: Record<string, unknown> }>>;
}
```

### 3. Indexing API

```ts
export interface NodeIndexer {
  indexNodesForProfile(args: {
    profileId: string;
    nodeIds?: string[];
    batchSize?: number;
  }): Promise<{ indexed: number }>;
}
```

### 4. Query API

```ts
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
```

## Data & State

### Storage
- Profiles: `vector_index_profiles` table with migrations and seeds
- Entries: `vector_index_entries` table with pgvector indexes

### Idempotency
- `upsertEntries` is idempotent on (node_id, profile_id, chunk_id)

### Embedding provider
```ts
export interface EmbeddingProvider {
  embedText(model: string, texts: string[]): Promise<number[][]>;
}
```

## Acceptance Mapping
- AC1 → Runtime index profiles via IndexProfileStore
- AC2 → Batch indexer for CDM work/doc via NodeIndexer
- AC3 → Query API with filters via BrainVectorSearch
- AC4 → Normalized metadata keys for cross-source querying
