ALTER TABLE "MetadataRecord" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '';

UPDATE "MetadataRecord"
SET "searchText" = COALESCE("payload"::text, '');
