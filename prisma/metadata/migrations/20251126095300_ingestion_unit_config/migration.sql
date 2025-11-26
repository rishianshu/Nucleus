-- CreateTable
CREATE TABLE "IngestionUnitConfig" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'FULL',
    "sinkId" TEXT NOT NULL DEFAULT 'kb',
    "scheduleKind" TEXT NOT NULL DEFAULT 'MANUAL',
    "scheduleIntervalMinutes" INTEGER,
    "policy" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IngestionUnitConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IngestionUnitConfig_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "MetadataEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "IngestionUnitConfig_endpointId_unitId_key" ON "IngestionUnitConfig"("endpointId", "unitId");

-- CreateIndex
CREATE INDEX "IngestionUnitConfig_datasetId_idx" ON "IngestionUnitConfig"("datasetId");
