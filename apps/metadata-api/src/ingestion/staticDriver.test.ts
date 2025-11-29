import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import type { MetadataEndpointTemplateDescriptor } from "@metadata/core";

const storeDir = mkdtempSync(path.join(os.tmpdir(), "metadata-static-driver-"));
process.env.METADATA_FORCE_FILE_STORE = "1";
process.env.METADATA_STORE_DIR = storeDir;

const { StaticIngestionDriver } = await import("./staticDriver.js");
const context = await import("../context.js");

test("listUnits falls back to template extras when endpoint config lacks explicit units", async () => {
  const store = await context.getMetadataStore();
  const template: MetadataEndpointTemplateDescriptor = {
    id: "test.semantic",
    title: "Semantic",
    family: "HTTP",
    vendor: "Test",
    description: "Semantic test endpoint",
    categories: ["semantic"],
    protocols: ["https"],
    fields: [],
    capabilities: [],
    connection: { urlTemplate: "{base_url}", defaultVerb: "GET" },
    extras: {
      ingestionUnits: [
        {
          unitId: "jira.projects",
          kind: "dataset",
          displayName: "Projects",
          description: "Jira project catalog",
          supportsIncremental: true,
          scope: { dataset: "jira.projects" },
        },
      ],
    },
  };
  await store.saveEndpointTemplates([template]);
  const endpoint = await store.registerEndpoint({
    id: "endpoint-template",
    name: "Template Endpoint",
    verb: "GET",
    url: "https://example.invalid",
    config: {
      templateId: "test.semantic",
    },
  });
  const driver = new StaticIngestionDriver();
  const units = await driver.listUnits(endpoint!.id!);
  assert.equal(units.length, 1);
  assert.equal(units[0].unitId, "jira.projects");
  assert.equal(units[0].displayName, "Projects");
  assert.equal(units[0].stats?.description, "Jira project catalog");
  assert.equal(units[0].stats?.supportsIncremental, true);
});

test("listUnits prefers ingestionUnits defined on the endpoint config", async () => {
  const store = await context.getMetadataStore();
  const endpoint = await store.registerEndpoint({
    id: "endpoint-config",
    name: "Config Endpoint",
    verb: "GET",
    url: "https://example.invalid",
    config: {
      ingestionUnits: [
        {
          unitId: "custom.unit",
          displayName: "Custom Unit",
          description: "Provided by endpoint config",
          supportsIncremental: false,
          scope: "custom",
        },
      ],
    },
  });
  const driver = new StaticIngestionDriver();
  const units = await driver.listUnits(endpoint!.id!);
  assert.equal(units.length, 1);
  assert.equal(units[0].unitId, "custom.unit");
  assert.equal(units[0].displayName, "Custom Unit");
  assert.equal(units[0].stats?.description, "Provided by endpoint config");
  assert.equal(units[0].stats?.supportsIncremental, false);
});

test("listUnits builds units from template dataset metadata when ingestionUnits missing", async () => {
  const store = await context.getMetadataStore();
  const template: MetadataEndpointTemplateDescriptor = {
    id: "docs.semantic",
    title: "Docs",
    family: "HTTP",
    vendor: "Docs Vendor",
    description: "Docs template with dataset metadata",
    categories: ["semantic"],
    protocols: ["https"],
    fields: [],
    capabilities: [],
    extras: {
      datasets: [
        {
          datasetId: "confluence.space",
          name: "Spaces",
          description: "Confluence spaces",
          ingestion: {
            unit_id: "confluence.space",
            display_name: "Spaces",
            description: "Knowledge spaces",
            supports_incremental: false,
            cdm_model_id: "cdm.doc.space",
          },
        },
      ],
    },
  };
  await store.saveEndpointTemplates([template]);
  const endpoint = await store.registerEndpoint({
    id: "docs-endpoint",
    name: "Docs Endpoint",
    verb: "GET",
    url: "https://docs.example.com",
    config: {
      templateId: template.id,
      parameters: {},
    },
  });
  const driver = new StaticIngestionDriver();
  const units = await driver.listUnits(endpoint!.id!);
  assert.equal(units.length, 1);
  assert.equal(units[0].unitId, "confluence.space");
  assert.equal(units[0].datasetId, "confluence.space");
  assert.equal(units[0].displayName, "Spaces");
  assert.equal(units[0].cdmModelId, "cdm.doc.space");
  assert.equal(units[0].stats?.description, "Knowledge spaces");
});
