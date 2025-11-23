-- CreateTable
CREATE TABLE "IngestionUnitState" (
    "endpointId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "sinkId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'IDLE',
    "checkpoint" JSONB,
    "lastRunId" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "stats" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionUnitState_pkey" PRIMARY KEY ("endpointId","unitId")
);

-- CreateIndex
CREATE INDEX "IngestionUnitState_endpointId_idx" ON "IngestionUnitState"("endpointId");
