-- Signals & EPP foundation: definitions and instances

-- Enums
CREATE TYPE "SignalStatus" AS ENUM ('ACTIVE', 'DISABLED', 'DRAFT');
CREATE TYPE "SignalInstanceStatus" AS ENUM ('OPEN', 'RESOLVED', 'SUPPRESSED');
CREATE TYPE "SignalSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- Tables
CREATE TABLE "signal_definitions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug" TEXT NOT NULL UNIQUE,
  "title" TEXT NOT NULL,
  "description" TEXT NULL,
  "status" "SignalStatus" NOT NULL,
  "entity_kind" TEXT NOT NULL,
  "process_kind" TEXT NULL,
  "policy_kind" TEXT NULL,
  "severity" "SignalSeverity" NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "cdm_model_id" TEXT NULL,
  "owner" TEXT NULL,
  "definition_spec" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "signal_instances" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "definition_id" UUID NOT NULL REFERENCES "signal_definitions" ("id") ON DELETE CASCADE,
  "status" "SignalInstanceStatus" NOT NULL,
  "entity_ref" TEXT NOT NULL,
  "entity_kind" TEXT NOT NULL,
  "severity" "SignalSeverity" NOT NULL,
  "summary" TEXT NOT NULL,
  "details" JSONB NULL,
  "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "resolved_at" TIMESTAMPTZ NULL,
  "source_run_id" TEXT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_signal_instances_definition_status" ON "signal_instances" ("definition_id", "status");
CREATE INDEX "idx_signal_instances_entity_ref_definition" ON "signal_instances" ("entity_ref", "definition_id");
CREATE INDEX "idx_signal_instances_entity_kind_status_severity" ON "signal_instances" ("entity_kind", "status", "severity");
CREATE UNIQUE INDEX "uniq_signal_instance_definition_entity" ON "signal_instances" ("definition_id", "entity_ref");

-- Seed example signal definitions (work + doc) and sample instances
WITH inserted_defs AS (
  INSERT INTO "signal_definitions" (
    "slug",
    "title",
    "description",
    "status",
    "entity_kind",
    "process_kind",
    "policy_kind",
    "severity",
    "tags",
    "cdm_model_id",
    "owner",
    "definition_spec"
  )
  VALUES
    (
      'work.stale_item',
      'Stale work item',
      'Work item has not been updated within the freshness window.',
      'ACTIVE',
      'WORK_ITEM',
      'DELIVERY_FLOW',
      'FRESHNESS',
      'WARNING',
      ARRAY['work', 'freshness', 'signals'],
      'cdm.work.item',
      'signals-team',
      jsonb_build_object('thresholdDays', 14, 'kind', 'stale_work')
    ),
    (
      'doc.orphaned',
      'Orphaned document',
      'Document is missing ownership or linkage in the workspace graph.',
      'ACTIVE',
      'DOC',
      'KNOWLEDGE_FLOW',
      'OWNERSHIP',
      'WARNING',
      ARRAY['docs', 'ownership', 'signals'],
      'cdm.doc.item',
      'signals-team',
      jsonb_build_object('requiresOwner', true, 'kind', 'orphaned_doc')
    )
  RETURNING id, slug
)
INSERT INTO "signal_instances" (
  "definition_id",
  "status",
  "entity_ref",
  "entity_kind",
  "severity",
  "summary",
  "details",
  "first_seen_at",
  "last_seen_at",
  "source_run_id"
)
SELECT
  id,
  'OPEN',
  CASE slug
    WHEN 'work.stale_item' THEN 'cdm.work.item:sample-stale'
    ELSE 'cdm.doc.item:sample-orphaned'
  END,
  CASE slug
    WHEN 'work.stale_item' THEN 'WORK_ITEM'
    ELSE 'DOC'
  END,
  'WARNING',
  CASE slug
    WHEN 'work.stale_item' THEN 'Sample stale work item'
    ELSE 'Sample orphaned document'
  END,
  jsonb_build_object('note', 'seed example'),
  NOW(),
  NOW(),
  'seed'
FROM inserted_defs;
