ALTER TABLE metadata."MetadataEndpoint"
  ADD COLUMN "detectedVersion" TEXT,
  ADD COLUMN "versionHint" TEXT,
  ADD COLUMN "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE IF NOT EXISTS metadata."MetadataEndpointTemplate" (
  "id" TEXT PRIMARY KEY,
  "family" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "vendor" TEXT NOT NULL,
  "descriptor" JSONB NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
