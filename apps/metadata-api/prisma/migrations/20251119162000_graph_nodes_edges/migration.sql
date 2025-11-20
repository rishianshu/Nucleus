CREATE TABLE "GraphNode" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "tenantId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "canonicalPath" TEXT,
    "sourceSystem" TEXT,
    "specRef" TEXT,
    "properties" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "scopeOrgId" TEXT NOT NULL,
    "scopeDomainId" TEXT,
    "scopeProjectId" TEXT,
    "scopeTeamId" TEXT,
    "originEndpointId" TEXT,
    "originVendor" TEXT,
    "logicalKey" TEXT NOT NULL,
    "externalId" JSONB,
    "phase" TEXT,
    "provenance" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "GraphNode_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GraphNode"
  ADD CONSTRAINT "GraphNode_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES "MetadataProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "GraphNode_logicalKey_key" ON "GraphNode"("logicalKey");
CREATE INDEX "GraphNode_scopeOrgId_entityType_idx" ON "GraphNode"("scopeOrgId", "entityType");

CREATE TABLE "GraphEdge" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "tenantId" TEXT NOT NULL,
    "edgeType" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "sourceLogicalKey" TEXT NOT NULL,
    "targetLogicalKey" TEXT NOT NULL,
    "scopeOrgId" TEXT NOT NULL,
    "scopeDomainId" TEXT,
    "scopeProjectId" TEXT,
    "scopeTeamId" TEXT,
    "originEndpointId" TEXT,
    "originVendor" TEXT,
    "logicalKey" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "specRef" TEXT,
    "metadata" JSONB,
    "externalId" JSONB,
    "phase" TEXT,
    "provenance" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "GraphEdge_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GraphEdge"
  ADD CONSTRAINT "GraphEdge_projectId_fkey" FOREIGN KEY ("projectId")
  REFERENCES "MetadataProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GraphEdge"
  ADD CONSTRAINT "GraphEdge_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId")
  REFERENCES "GraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GraphEdge"
  ADD CONSTRAINT "GraphEdge_targetNodeId_fkey" FOREIGN KEY ("targetNodeId")
  REFERENCES "GraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "GraphEdge_logicalKey_key" ON "GraphEdge"("logicalKey");
CREATE INDEX "GraphEdge_scopeOrgId_edgeType_idx" ON "GraphEdge"("scopeOrgId", "edgeType");
CREATE INDEX "GraphEdge_sourceLogicalKey_idx" ON "GraphEdge"("sourceLogicalKey");
CREATE INDEX "GraphEdge_targetLogicalKey_idx" ON "GraphEdge"("targetLogicalKey");
