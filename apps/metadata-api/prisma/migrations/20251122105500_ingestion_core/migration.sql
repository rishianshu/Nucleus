-- CreateEnum
CREATE TYPE "IngestionState" AS ENUM ('IDLE', 'RUNNING', 'PAUSED', 'FAILED', 'SUCCEEDED');

-- CreateTable
CREATE TABLE "IngestionUnitState" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "sinkId" TEXT NOT NULL DEFAULT 'kb',
    "state" "IngestionState" NOT NULL DEFAULT 'IDLE',
    "checkpoint" JSONB,
    "lastRunId" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "stats" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IngestionUnitState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IngestionUnitState_endpointId_unitId_key" ON "IngestionUnitState"("endpointId", "unitId");

-- AddForeignKey
ALTER TABLE "IngestionUnitState" ADD CONSTRAINT "IngestionUnitState_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "MetadataEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
