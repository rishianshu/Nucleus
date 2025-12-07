-- CDM doc access table for RLS (principal → doc)
CREATE TABLE IF NOT EXISTS cdm_doc_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  source_system TEXT NOT NULL,
  access_mode TEXT NOT NULL DEFAULT 'view',
  dataset_id TEXT,
  endpoint_id TEXT,
  granted_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  properties JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT cdm_doc_access_unique UNIQUE (doc_id, principal_id, access_mode, source_system)
);

CREATE INDEX IF NOT EXISTS idx_cdm_doc_access_doc_id ON cdm_doc_access (doc_id);
CREATE INDEX IF NOT EXISTS idx_cdm_doc_access_principal_id ON cdm_doc_access (principal_id);
