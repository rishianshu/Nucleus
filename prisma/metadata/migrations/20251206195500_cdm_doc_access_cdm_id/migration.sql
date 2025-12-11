-- Ensure cdm_id is available for cdm_doc_access (metadata and cdm_work schemas)

ALTER TABLE metadata.cdm_doc_access ADD COLUMN IF NOT EXISTS cdm_id TEXT;
UPDATE metadata.cdm_doc_access SET cdm_id = COALESCE(cdm_id, doc_cdm_id);
ALTER TABLE metadata.cdm_doc_access ALTER COLUMN cdm_id SET NOT NULL;

ALTER TABLE cdm_work.cdm_doc_access ADD COLUMN IF NOT EXISTS cdm_id TEXT;
UPDATE cdm_work.cdm_doc_access SET cdm_id = COALESCE(cdm_id, doc_cdm_id);
ALTER TABLE cdm_work.cdm_doc_access ALTER COLUMN cdm_id SET NOT NULL;
