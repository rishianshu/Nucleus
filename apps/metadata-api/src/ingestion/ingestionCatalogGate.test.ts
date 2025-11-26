import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileMetadataStore, createGraphStore, type MetadataEndpointTemplateDescriptor } from "@metadata/core";
import { createResolvers } from "../schema.js";
import { DEFAULT_ENDPOINT_TEMPLATES } from "../fixtures/default-endpoint-templates.js";
import { registerDefaultIngestionSinks } from "./index.js";

const TEST_PROJECT = "project-ingestion";
const TEST_TENANT = "tenant-ingestion";
const CATALOG_DOMAIN = process.env.METADATA_CATALOG_DOMAIN ?? "catalog.dataset";
const JIRA_DATASETS = ["jira.projects", "jira.issues", "jira.users", "jira.comments", "jira.worklogs"];

registerDefaultIngestionSinks();

test("ingestion units are only returned when catalog datasets exist", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-ingestion-catalog-"));
  process.env.METADATA_STORE_DIR = rootDir;
  process.env.METADATA_FORCE_FILE_STORE = "1";
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
    delete process.env.METADATA_STORE_DIR;
    delete process.env.METADATA_FORCE_FILE_STORE;
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  const resolvers = createResolvers(store, { graphStore });
  const ctx = buildContext();
  const jiraTemplate = DEFAULT_ENDPOINT_TEMPLATES.find((template) => template.id === "jira.http");
  assert.ok(jiraTemplate, "jira template should exist in fixtures");
  await store.saveEndpointTemplates([jiraTemplate as unknown as MetadataEndpointTemplateDescriptor]);
  const endpoint = await store.registerEndpoint({
    id: "jira-endpoint-catalog",
    name: "Jira Catalog",
    verb: "GET",
    url: "https://example.atlassian.net",
    projectId: ctx.auth.projectId,
    domain: "work.jira",
    config: {
      templateId: "jira.http",
      parameters: {
        base_url: "https://example.atlassian.net",
        auth_type: "basic",
        username: "bot@example.com",
        api_token: "token",
      },
    },
    capabilities: ["metadata"],
  });
  for (const datasetId of JIRA_DATASETS) {
    await seedCatalogDataset(store, endpoint.id!, datasetId);
  }
  const units = await resolvers.Query.ingestionUnits(null, { endpointId: endpoint.id! }, ctx as any);
  assert.equal(units.length, JIRA_DATASETS.length);
  const unitIds = units.map((unit) => unit.unitId).sort();
  assert.deepEqual(unitIds, [...JIRA_DATASETS].sort());
});

test("ingestion units return empty when catalog lacks datasets", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-ingestion-no-catalog-"));
  process.env.METADATA_STORE_DIR = rootDir;
  process.env.METADATA_FORCE_FILE_STORE = "1";
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
    delete process.env.METADATA_STORE_DIR;
    delete process.env.METADATA_FORCE_FILE_STORE;
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  const resolvers = createResolvers(store, { graphStore });
  const ctx = buildContext();
  const jiraTemplate = DEFAULT_ENDPOINT_TEMPLATES.find((template) => template.id === "jira.http");
  assert.ok(jiraTemplate);
  await store.saveEndpointTemplates([jiraTemplate as unknown as MetadataEndpointTemplateDescriptor]);
  const endpoint = await store.registerEndpoint({
    id: "jira-endpoint-empty",
    name: "Jira Empty",
    verb: "GET",
    url: "https://example.atlassian.net",
    projectId: ctx.auth.projectId,
    domain: "work.jira",
    config: {
      templateId: "jira.http",
      parameters: {
        base_url: "https://example.atlassian.net",
        auth_type: "basic",
        username: "bot@example.com",
        api_token: "token",
      },
    },
    capabilities: ["metadata"],
  });
  const units = await resolvers.Query.ingestionUnits(null, { endpointId: endpoint.id! }, ctx as any);
  assert.equal(units.length, 0, "No catalog datasets => no ingestion units");
});

function buildContext() {
  return {
    auth: {
      tenantId: TEST_TENANT,
      projectId: TEST_PROJECT,
      roles: ["viewer", "editor", "admin"],
      subject: "ingestion-user",
    },
    userId: "ingestion-user",
    bypassWrites: false,
  };
}

async function seedCatalogDataset(store: FileMetadataStore, endpointId: string, datasetId: string) {
  await store.upsertRecord({
    id: datasetId,
    projectId: TEST_PROJECT,
    domain: CATALOG_DOMAIN,
    labels: [`endpoint:${endpointId}`],
    payload: {
      metadata_endpoint_id: endpointId,
      dataset: {
        id: datasetId,
        name: datasetId,
        schema: "jira",
        entity: datasetId.split(".").pop(),
      },
    },
  });
}
