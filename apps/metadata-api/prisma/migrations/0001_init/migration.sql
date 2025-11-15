CREATE SCHEMA IF NOT EXISTS metadata;

CREATE TABLE IF NOT EXISTS metadata."MetadataProject" (
    "id" TEXT PRIMARY KEY,
    "slug" TEXT NOT NULL UNIQUE,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "labels" TEXT[] NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metadata."MetadataRecord" (
    "id" TEXT PRIMARY KEY,
    "projectId" TEXT NOT NULL REFERENCES metadata."MetadataProject"("id") ON DELETE CASCADE,
    "domain" TEXT NOT NULL,
    "labels" TEXT[] NOT NULL DEFAULT '{}',
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "MetadataRecord_project_domain_idx"
  ON metadata."MetadataRecord" ("projectId", "domain");

CREATE TABLE IF NOT EXISTS metadata."MetadataEndpoint" (
    "id" TEXT PRIMARY KEY,
    "projectId" TEXT REFERENCES metadata."MetadataProject"("id") ON DELETE CASCADE,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "verb" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "authPolicy" TEXT,
    "domain" TEXT,
    "labels" TEXT[] NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "MetadataEndpoint_project_idx"
  ON metadata."MetadataEndpoint" ("projectId");

CREATE TABLE IF NOT EXISTS metadata."MetadataDomain" (
    "id" TEXT PRIMARY KEY,
    "key" TEXT NOT NULL UNIQUE,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
