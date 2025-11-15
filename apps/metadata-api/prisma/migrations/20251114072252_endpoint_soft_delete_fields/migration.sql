-- AlterTable
ALTER TABLE "MetadataEndpoint" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletionReason" TEXT;
