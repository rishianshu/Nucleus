import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileMetadataStore, createGraphStore, type MetadataEndpointTemplateDescriptor } from "@metadata/core";
import { createResolvers } from "../schema.js";
import { DEFAULT_ENDPOINT_TEMPLATES } from "../fixtures/default-endpoint-templates.js";
import * as stateStore from "./stateStore.js";

const TEST_TENANT = "tenant-ingestion";
const TEST_PROJECT = "project-ingestion";

test("ingestionUnits returns template extras for Jira endpoints", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-ingestion-resolvers-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  const resolvers = createResolvers(store, { graphStore });
  const ctx = buildIngestionContext();
  const jiraTemplate = DEFAULT_ENDPOINT_TEMPLATES.find((template) => template.id === "jira.http");
  assert.ok(jiraTemplate, "jira template should exist in default fixtures");
  await store.saveEndpointTemplates([jiraTemplate as unknown as MetadataEndpointTemplateDescriptor]);
  const endpoint = await store.registerEndpoint({
    id: "jira-endpoint-1",
    name: "Jira Dev",
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
  assert.ok(units.length >= 2, "jira units should be surfaced");
  const projectsUnit = units.find((unit) => unit.unitId === "jira.projects");
  assert.ok(projectsUnit, "jira.projects unit should be present");
  assert.equal(projectsUnit?.kind, "dataset");
  assert.equal(projectsUnit?.driverId, "static");
  assert.equal(projectsUnit?.sinkId, "kb");
});

test("startIngestion bypass path succeeds for Jira units", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-ingestion-start-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  const resolvers = createResolvers(store, { graphStore });
  const ctx = buildIngestionContext({ bypassWrites: true, roles: ["viewer", "editor", "admin"] });
  const jiraTemplate = DEFAULT_ENDPOINT_TEMPLATES.find((template) => template.id === "jira.http");
  assert.ok(jiraTemplate);
  await store.saveEndpointTemplates([jiraTemplate as unknown as MetadataEndpointTemplateDescriptor]);
  const endpoint = await store.registerEndpoint({
    id: "jira-endpoint-start",
    name: "Jira Dev",
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
  const ensureSpy = t.mock.method(stateStore, "ensureUnitState", async () => {});
  const markSpy = t.mock.method(stateStore, "markUnitState", async () => {});
  const result = await resolvers.Mutation.startIngestion(
    null,
    { endpointId: endpoint.id!, unitId: "jira.projects" },
    ctx as any,
  );
  assert.equal(result.state, "SUCCEEDED");
  assert.equal(result.message, "Bypass mode enabled");
  assert.equal(ensureSpy.mock.callCount(), 1);
  assert.equal(markSpy.mock.callCount(), 1);
});

function buildIngestionContext(overrides?: { bypassWrites?: boolean; roles?: string[] }) {
  return {
    auth: {
      tenantId: TEST_TENANT,
      projectId: TEST_PROJECT,
      roles: overrides?.roles ?? ["viewer", "editor", "admin"],
      subject: "ingestion-user",
    },
    userId: "ingestion-user",
    bypassWrites: overrides?.bypassWrites ?? false,
  };
}
