-- Brain vector index foundation tables

CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "vector_index_profiles" (
    "id" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "description" TEXT,
    "node_type" TEXT NOT NULL,
    "text_source" JSONB NOT NULL,
    "embedding_model" TEXT NOT NULL,
    "chunking" JSONB,
    "profile_kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vector_index_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vector_index_entries" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "node_id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "chunk_id" TEXT NOT NULL,
    "embedding" VECTOR(1536) NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "project_key" TEXT,
    "profile_kind" TEXT NOT NULL,
    "source_system" TEXT,
    "raw_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vector_index_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vector_index_entries_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "vector_index_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "vector_index_entries_node_id_profile_id_chunk_id_key"
  ON "vector_index_entries"("node_id", "profile_id", "chunk_id");
CREATE INDEX "vector_index_entries_profile_id_tenant_id_idx"
  ON "vector_index_entries"("profile_id", "tenant_id");
CREATE INDEX "vector_index_entries_project_key_idx"
  ON "vector_index_entries"("project_key");
CREATE INDEX "vector_index_entries_profile_kind_idx"
  ON "vector_index_entries"("profile_kind");
CREATE INDEX "vector_index_entries_embedding_idx"
  ON "vector_index_entries" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

INSERT INTO "vector_index_profiles" ("id", "family", "description", "node_type", "text_source", "embedding_model", "chunking", "profile_kind", "enabled")
VALUES
  (
    'cdm.work.summary',
    'work',
    'CDM work item summary profile',
    'cdm.work.item',
    '{"from":"cdm","field":"summary"}',
    'text-embedding-3-small',
    '{"maxTokens":512,"overlapTokens":64}',
    'work',
    TRUE
  ),
  (
    'cdm.doc.body',
    'doc',
    'CDM document body profile',
    'cdm.doc.item',
    '{"from":"cdm.doc","field":"body"}',
    'text-embedding-3-small',
    '{"maxTokens":1024,"overlapTokens":128}',
    'doc',
    TRUE
  )
ON CONFLICT ("id") DO NOTHING;
