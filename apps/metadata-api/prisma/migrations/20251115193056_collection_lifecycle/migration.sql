-- AlterTable
ALTER TABLE "MetadataCollectionRun" ADD COLUMN     "collectionId" TEXT;

-- CreateTable
CREATE TABLE "MetadataCollection" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "scheduleCron" TEXT,
    "scheduleTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "temporalScheduleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetadataCollection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetadataCollection_endpointId_idx" ON "MetadataCollection"("endpointId");

-- CreateIndex
CREATE INDEX "MetadataCollectionRun_collectionId_idx" ON "MetadataCollectionRun"("collectionId");

-- AddForeignKey
ALTER TABLE "MetadataCollection" ADD CONSTRAINT "MetadataCollection_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "MetadataEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetadataCollectionRun" ADD CONSTRAINT "MetadataCollectionRun_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "MetadataCollection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
