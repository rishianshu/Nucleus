-- Materialized registry support

CREATE TYPE metadata."MaterializedStatus" AS ENUM ('READY', 'INDEXING', 'INDEXED', 'FAILED');

CREATE TABLE metadata."MaterializedArtifact" (
    "id" TEXT PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "sourceRunId" TEXT NOT NULL,
    "artifactKind" TEXT NOT NULL,
    "sourceFamily" TEXT,
    "sinkEndpointId" TEXT,
    "handle" JSONB NOT NULL,
    "canonicalMeta" JSONB NOT NULL,
    "sourceMeta" JSONB,
    "status" metadata."MaterializedStatus" NOT NULL DEFAULT 'READY',
    "indexStatus" metadata."MaterializedStatus" NOT NULL DEFAULT 'READY',
    "counters" JSONB,
    "indexCounters" JSONB,
    "lastError" JSONB,
    "indexLastError" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX "MaterializedArtifact_tenant_run_kind_idx"
  ON metadata."MaterializedArtifact" ("tenantId", "sourceRunId", "artifactKind");

CREATE INDEX "MaterializedArtifact_tenant_kind_idx"
  ON metadata."MaterializedArtifact" ("tenantId", "artifactKind");

CREATE INDEX "MaterializedArtifact_tenant_status_idx"
  ON metadata."MaterializedArtifact" ("tenantId", "status");

CREATE INDEX "MaterializedArtifact_tenant_index_status_idx"
  ON metadata."MaterializedArtifact" ("tenantId", "indexStatus");
