-- CreateTable
CREATE TABLE "GraphNode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "entityType" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "canonicalPath" TEXT,
    "sourceSystem" TEXT,
    "specRef" TEXT,
    "properties" JSONB NOT NULL DEFAULT '{}',
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GraphNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphEdge" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
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
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "externalId" JSONB,
    "phase" TEXT,
    "provenance" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GraphEdge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GraphEdge_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "GraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GraphEdge_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "GraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GraphNode_logicalKey_key" ON "GraphNode"("logicalKey");

-- CreateIndex
CREATE INDEX "GraphNode_scopeOrgId_entityType_idx" ON "GraphNode"("scopeOrgId", "entityType");

-- CreateIndex
CREATE INDEX "GraphNode_scopeOrgId_scopeProjectId_idx" ON "GraphNode"("scopeOrgId", "scopeProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "GraphEdge_logicalKey_key" ON "GraphEdge"("logicalKey");

-- CreateIndex
CREATE INDEX "GraphEdge_scopeOrgId_edgeType_idx" ON "GraphEdge"("scopeOrgId", "edgeType");

-- CreateIndex
CREATE INDEX "GraphEdge_sourceLogicalKey_idx" ON "GraphEdge"("sourceLogicalKey");

-- CreateIndex
CREATE INDEX "GraphEdge_targetLogicalKey_idx" ON "GraphEdge"("targetLogicalKey");
