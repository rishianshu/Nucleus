/*
  Warnings:

  - Made the column `createdAt` on table `MetadataEndpointTemplate` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updatedAt` on table `MetadataEndpointTemplate` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "MetadataEndpoint" DROP CONSTRAINT "MetadataEndpoint_projectId_fkey";

-- DropForeignKey
ALTER TABLE "MetadataRecord" DROP CONSTRAINT "MetadataRecord_projectId_fkey";

-- AlterTable
ALTER TABLE "MetadataCollectionRun" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "MetadataDomain" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MetadataEndpoint" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MetadataEndpointTemplate" ALTER COLUMN "createdAt" SET NOT NULL,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" SET NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MetadataProject" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MetadataRecord" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "MetadataRecord" ADD CONSTRAINT "MetadataRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "MetadataProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetadataEndpoint" ADD CONSTRAINT "MetadataEndpoint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "MetadataProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "MetadataEndpoint_project_idx" RENAME TO "MetadataEndpoint_projectId_idx";

-- RenameIndex
ALTER INDEX "MetadataRecord_project_domain_idx" RENAME TO "MetadataRecord_projectId_domain_idx";
