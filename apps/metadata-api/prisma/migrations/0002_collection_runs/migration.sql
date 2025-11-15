-- CreateEnum
CREATE TYPE "MetadataCollectionStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "MetadataEndpoint" ADD COLUMN "config" JSONB;

-- CreateTable
CREATE TABLE "MetadataCollectionRun" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "status" "MetadataCollectionStatus" NOT NULL DEFAULT 'QUEUED',
    "requestedBy" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "workflowId" TEXT,
    "temporalRunId" TEXT,
    "error" TEXT,
    "filters" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetadataCollectionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetadataCollectionRun_endpointId_idx" ON "MetadataCollectionRun"("endpointId");

-- AddForeignKey
ALTER TABLE "MetadataCollectionRun" ADD CONSTRAINT "MetadataCollectionRun_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "MetadataEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
