-- KG meta registry tables for node and edge types

CREATE TABLE "KgNodeType" (
    "id" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "description" TEXT,
    "idPrefix" TEXT,
    "requiredProps" TEXT[] NOT NULL DEFAULT '{}',
    "optionalProps" TEXT[] NOT NULL DEFAULT '{}',
    "indexedProps" TEXT[] NOT NULL DEFAULT '{}',
    "labelTemplate" TEXT,
    "icon" TEXT,

    CONSTRAINT "KgNodeType_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KgEdgeType" (
    "id" TEXT NOT NULL,
    "fromNodeTypeId" TEXT NOT NULL,
    "fromNodeTypes" TEXT[] NOT NULL DEFAULT '{}',
    "toNodeTypeId" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'out',
    "description" TEXT,
    "multiplicity" TEXT,
    "symmetric" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "KgEdgeType_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KgEdgeType_fromNodeTypeId_fkey" FOREIGN KEY ("fromNodeTypeId") REFERENCES "KgNodeType"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KgEdgeType_toNodeTypeId_fkey" FOREIGN KEY ("toNodeTypeId") REFERENCES "KgNodeType"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "KgEdgeType_fromNodeTypeId_idx" ON "KgEdgeType"("fromNodeTypeId");
CREATE INDEX "KgEdgeType_toNodeTypeId_idx" ON "KgEdgeType"("toNodeTypeId");

INSERT INTO "KgNodeType" ("id", "family", "description", "idPrefix", "requiredProps", "optionalProps", "indexedProps", "labelTemplate", "icon") VALUES
  ('cdm.work.item', 'work', 'CDM work item entity', 'cdm.work.item:', ARRAY[]::TEXT[], ARRAY['status', 'assignee']::TEXT[], ARRAY['projectKey', 'sourceIssueKey']::TEXT[], NULL, NULL),
  ('cdm.doc.item', 'doc', 'CDM document item', 'cdm.doc.item:', ARRAY[]::TEXT[], ARRAY['workspace', 'owner']::TEXT[], ARRAY['sourceDocId']::TEXT[], NULL, NULL),
  ('cdm.column', 'data', 'Column within a dataset', 'cdm.column:', ARRAY[]::TEXT[], ARRAY['tableId', 'path']::TEXT[], ARRAY['canonicalPath']::TEXT[], NULL, NULL),
  ('column.profile', 'data', 'Profiler output for a column', 'column.profile:', ARRAY['createdAt']::TEXT[], ARRAY['summary', 'profile']::TEXT[], ARRAY['canonicalPath']::TEXT[], NULL, NULL),
  ('column.description', 'data', 'Description node for a column', 'column.description:', ARRAY['createdAt']::TEXT[], ARRAY['text', 'author']::TEXT[], ARRAY['canonicalPath']::TEXT[], NULL, NULL),
  ('signal.instance', 'signal', 'Evaluated signal instance', 'signal.instance:', ARRAY[]::TEXT[], ARRAY['severity', 'status']::TEXT[], ARRAY['slug']::TEXT[], NULL, NULL),
  ('kg.cluster', 'cluster', 'Cluster node representing grouping', 'kg.cluster:', ARRAY[]::TEXT[], ARRAY['algo', 'score']::TEXT[], ARRAY['label']::TEXT[], NULL, NULL)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "KgEdgeType" ("id", "fromNodeTypeId", "fromNodeTypes", "toNodeTypeId", "direction", "description", "multiplicity", "symmetric") VALUES
  ('DESCRIBES', 'column.description', ARRAY[]::TEXT[], 'cdm.column', 'out', 'Description node -> column', 'one-to-one', false),
  ('PROFILE_OF', 'column.profile', ARRAY[]::TEXT[], 'cdm.column', 'out', 'Profile node -> column', 'one-to-one', false),
  ('HAS_SIGNAL', 'cdm.work.item', ARRAY['cdm.doc.item', 'kg.cluster']::TEXT[], 'signal.instance', 'out', 'Entity has signal instance', 'many-to-many', false),
  ('IN_CLUSTER', 'cdm.work.item', ARRAY['cdm.doc.item', 'cdm.column', 'column.profile', 'column.description', 'signal.instance']::TEXT[], 'kg.cluster', 'out', 'Entity grouped into cluster', 'many-to-one', false)
ON CONFLICT ("id") DO NOTHING;
