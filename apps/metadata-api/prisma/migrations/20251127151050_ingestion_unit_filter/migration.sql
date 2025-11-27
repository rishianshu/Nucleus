-- Add Jira filter JSON column to ingestion configs
ALTER TABLE "IngestionUnitConfig"
ADD COLUMN "filter" JSONB;
