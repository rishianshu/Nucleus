-- Add cdm_id to doc access tables so CDM sink upserts can target a stable primary key.
ALTER TABLE "metadata"."cdm_doc_access"
ADD COLUMN "cdm_id" TEXT;

ALTER TABLE "cdm_work"."cdm_doc_access"
ADD COLUMN "cdm_id" TEXT;

-- Ensure non-null and uniqueness for upsert semantics (tables are currently empty in dev).
ALTER TABLE "metadata"."cdm_doc_access"
ALTER COLUMN "cdm_id" SET NOT NULL;

ALTER TABLE "cdm_work"."cdm_doc_access"
ALTER COLUMN "cdm_id" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "cdm_doc_access_cdm_id_key" ON "metadata"."cdm_doc_access"("cdm_id");
CREATE UNIQUE INDEX IF NOT EXISTS "cdm_work_cdm_doc_access_cdm_id_key" ON "cdm_work"."cdm_doc_access"("cdm_id");
