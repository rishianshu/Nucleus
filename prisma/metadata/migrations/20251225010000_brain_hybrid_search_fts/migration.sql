-- Brain hybrid search foundation: FTS + temporal columns
-- Adds tsvector for keyword search, temporal columns for filtering

-- Add content and temporal columns to vector_index_entries
-- Note: Temporal columns added WITHOUT defaults first, then backfilled, then defaults added
ALTER TABLE "vector_index_entries"
  ADD COLUMN IF NOT EXISTS "content_text" TEXT,
  ADD COLUMN IF NOT EXISTS "source_family" TEXT,
  ADD COLUMN IF NOT EXISTS "entity_kind" TEXT,
  ADD COLUMN IF NOT EXISTS "dataset_slug" TEXT,
  ADD COLUMN IF NOT EXISTS "first_seen_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_activity_at" TIMESTAMP(3);

-- P2 Fix: Backfill temporal columns from existing timestamps (preserves historical accuracy)
UPDATE "vector_index_entries"
SET 
  first_seen_at = COALESCE(created_at, CURRENT_TIMESTAMP),
  last_activity_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
WHERE first_seen_at IS NULL;

-- Now add defaults for new rows only
ALTER TABLE "vector_index_entries"
  ALTER COLUMN "first_seen_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "last_activity_at" SET DEFAULT CURRENT_TIMESTAMP;

-- Add tsvector column for full-text search
ALTER TABLE "vector_index_entries"
  ADD COLUMN IF NOT EXISTS "tsv" TSVECTOR;

-- Create function to update tsvector on content_text changes
CREATE OR REPLACE FUNCTION update_vector_entry_tsv()
RETURNS TRIGGER AS $$
BEGIN
  NEW.tsv := to_tsvector('english', COALESCE(NEW.content_text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update tsvector
DROP TRIGGER IF EXISTS trg_vector_entry_tsv ON "vector_index_entries";
CREATE TRIGGER trg_vector_entry_tsv
  BEFORE INSERT OR UPDATE OF content_text
  ON "vector_index_entries"
  FOR EACH ROW
  EXECUTE FUNCTION update_vector_entry_tsv();

-- Populate tsv for existing rows
UPDATE "vector_index_entries"
SET tsv = to_tsvector('english', COALESCE(content_text, ''))
WHERE tsv IS NULL AND content_text IS NOT NULL;

-- Create GIN index for full-text search (fast tsv lookups)
CREATE INDEX IF NOT EXISTS "vector_index_entries_tsv_idx"
  ON "vector_index_entries" USING GIN (tsv);

-- Create indexes for temporal filtering
CREATE INDEX IF NOT EXISTS "vector_index_entries_first_seen_at_idx"
  ON "vector_index_entries" ("first_seen_at");
CREATE INDEX IF NOT EXISTS "vector_index_entries_last_activity_at_idx"
  ON "vector_index_entries" ("last_activity_at");

-- Create indexes for source/entity/dataset filtering
CREATE INDEX IF NOT EXISTS "vector_index_entries_source_family_idx"
  ON "vector_index_entries" ("source_family");
CREATE INDEX IF NOT EXISTS "vector_index_entries_entity_kind_idx"
  ON "vector_index_entries" ("entity_kind");
CREATE INDEX IF NOT EXISTS "vector_index_entries_dataset_slug_idx"
  ON "vector_index_entries" ("dataset_slug");

-- Create composite index for hybrid search queries
CREATE INDEX IF NOT EXISTS "vector_index_entries_hybrid_search_idx"
  ON "vector_index_entries" ("tenant_id", "profile_id", "source_family", "entity_kind");
