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
    "properties" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "scopeOrgId" TEXT NOT NULL,
    "scopeProjectId" TEXT,
    "scopeDomainId" TEXT,
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
    "scopeProjectId" TEXT,
    "scopeDomainId" TEXT,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GraphEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GraphNode_logicalKey_key" ON "GraphNode"("logicalKey");

-- CreateIndex
CREATE INDEX "GraphNode_tenantId_scopeOrgId_updatedAt_idx" ON "GraphNode"("tenantId", "scopeOrgId", "updatedAt");

-- CreateIndex
CREATE INDEX "GraphNode_scopeOrgId_entityType_updatedAt_idx" ON "GraphNode"("scopeOrgId", "entityType", "updatedAt");

-- CreateIndex
CREATE INDEX "GraphNode_scopeOrgId_scopeProjectId_updatedAt_idx" ON "GraphNode"("scopeOrgId", "scopeProjectId", "updatedAt");

-- CreateIndex
CREATE INDEX "GraphNode_scopeOrgId_scopeDomainId_updatedAt_idx" ON "GraphNode"("scopeOrgId", "scopeDomainId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GraphEdge_logicalKey_key" ON "GraphEdge"("logicalKey");

-- CreateIndex
CREATE INDEX "GraphEdge_tenantId_scopeOrgId_updatedAt_idx" ON "GraphEdge"("tenantId", "scopeOrgId", "updatedAt");

-- CreateIndex
CREATE INDEX "GraphEdge_scopeOrgId_edgeType_updatedAt_idx" ON "GraphEdge"("scopeOrgId", "edgeType", "updatedAt");

-- CreateIndex
CREATE INDEX "GraphEdge_scopeOrgId_sourceNodeId_idx" ON "GraphEdge"("scopeOrgId", "sourceNodeId");

-- CreateIndex
CREATE INDEX "GraphEdge_scopeOrgId_targetNodeId_idx" ON "GraphEdge"("scopeOrgId", "targetNodeId");

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "GraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "GraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
