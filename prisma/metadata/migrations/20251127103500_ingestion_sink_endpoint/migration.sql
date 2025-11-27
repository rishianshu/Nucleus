ALTER TABLE "IngestionUnitConfig"
ADD COLUMN IF NOT EXISTS "sinkEndpointId" TEXT;
