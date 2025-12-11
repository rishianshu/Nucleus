-- Signals extensibility: impl mode and metadata fields

CREATE TYPE "SignalImplMode" AS ENUM ('DSL', 'CODE');

ALTER TABLE "signal_definitions"
  ADD COLUMN "impl_mode" "SignalImplMode" NOT NULL DEFAULT 'DSL',
  ADD COLUMN "source_family" TEXT NULL,
  ALTER COLUMN "entity_kind" DROP NOT NULL,
  ADD COLUMN "surface_hints" JSONB NULL;

UPDATE "signal_definitions" SET "impl_mode" = 'DSL' WHERE "impl_mode" IS NULL;
