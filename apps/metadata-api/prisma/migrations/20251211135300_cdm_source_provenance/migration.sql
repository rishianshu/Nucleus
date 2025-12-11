-- Add source provenance fields to CDM work/docs tables
ALTER TABLE cdm_work.cdm_work_item
  ADD COLUMN IF NOT EXISTS source_id TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS raw_source JSONB;

ALTER TABLE cdm_docs.cdm_doc_item
  ADD COLUMN IF NOT EXISTS source_id TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS raw_source JSONB;
