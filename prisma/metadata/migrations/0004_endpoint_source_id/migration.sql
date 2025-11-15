ALTER TABLE metadata."MetadataEndpoint" ADD COLUMN "sourceId" TEXT;
UPDATE metadata."MetadataEndpoint" SET "sourceId" = COALESCE("sourceId", "id");
ALTER TABLE metadata."MetadataEndpoint" ALTER COLUMN "sourceId" SET NOT NULL;
ALTER TABLE metadata."MetadataEndpoint" ADD CONSTRAINT "MetadataEndpoint_sourceId_key" UNIQUE ("sourceId");
