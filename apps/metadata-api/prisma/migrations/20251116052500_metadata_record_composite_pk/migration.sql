-- Drop the existing primary key on MetadataRecord.id
ALTER TABLE "MetadataRecord" DROP CONSTRAINT IF EXISTS "MetadataRecord_pkey";

-- Add a composite primary key on (domain, id)
ALTER TABLE "MetadataRecord"
ADD CONSTRAINT "MetadataRecord_pkey" PRIMARY KEY ("domain", "id");
