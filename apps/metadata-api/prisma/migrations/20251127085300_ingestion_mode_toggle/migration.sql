-- Rename existing mode column to runMode and add new mode column for raw/CDM selection.
ALTER TABLE "IngestionUnitConfig" RENAME COLUMN "mode" TO "runMode";

ALTER TABLE "IngestionUnitConfig"
    ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'raw';
