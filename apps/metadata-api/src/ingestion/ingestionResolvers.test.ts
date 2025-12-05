import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { mock } from "node:test";
import {
  FileMetadataStore,
  createGraphStore,
  registerIngestionDriver,
  registerIngestionSink,
  type IngestionSink,
  type IngestionUnitDescriptor,
  type MetadataEndpointTemplateDescriptor,
} from "@metadata/core";
import { createResolvers } from "../schema.js";
import { DEFAULT_ENDPOINT_TEMPLATES } from "../fixtures/default-endpoint-templates.js";
import { registerDefaultIngestionSinks } from "./index.js";
import type { IngestionUnitConfigRow } from "./configStore.js";

const ensureUnitStateStub = mock.fn(async () => ({
  endpointId: "",
  unitId: "",
  sinkId: "kb",
  state: "IDLE" as const,
  checkpoint: null,
  lastRunId: null,
  lastRunAt: null,
  lastError: null,
  stats: null,
}));
const markUnitStateStub = mock.fn(async () => {});
const getUnitStateStub = mock.fn(async () => null);
const listUnitStatesStub = mock.fn(async () => []);
const configStoreRows = new Map<string, IngestionUnitConfigRow>();

registerDefaultIngestionSinks();
class NullSink implements IngestionSink {
  async begin() {}
  async writeBatch() {
    return {};
  }
}
registerIngestionSink("raw-only-test", () => new NullSink());
const JIRA_TEMPLATE = DEFAULT_ENDPOINT_TEMPLATES.find((template) => template.id === "jira.http");
const JIRA_TEMPLATE_EXTRAS = (JIRA_TEMPLATE?.extras ?? {}) as Record<string, unknown>;
const JIRA_TEMPLATE_UNITS = templateUnitsFromExtras(JIRA_TEMPLATE_EXTRAS);
const CONFLUENCE_TEMPLATE = DEFAULT_ENDPOINT_TEMPLATES.find((template) => template.id === "http.confluence");
const CONFLUENCE_TEMPLATE_EXTRAS = (CONFLUENCE_TEMPLATE?.extras ?? {}) as Record<string, unknown>;
const CONFLUENCE_TEMPLATE_UNITS = templateUnitsFromExtras(CONFLUENCE_TEMPLATE_EXTRAS);
const TEST_STATIC_UNITS: IngestionUnitDescriptor[] = [...JIRA_TEMPLATE_UNITS, ...CONFLUENCE_TEMPLATE_UNITS].map(
  (entry) => ({
    unitId: String(entry.unitId),
    datasetId: typeof entry.datasetId === "string" ? entry.datasetId : String(entry.unitId),
    kind: typeof entry.kind === "string" ? entry.kind : "dataset",
    displayName: typeof entry.displayName === "string" ? entry.displayName : String(entry.unitId),
    defaultMode: typeof entry.defaultMode === "string" ? entry.defaultMode : undefined,
    supportedModes:
      entry.supportsIncremental === true
        ? ["FULL", "INCREMENTAL"]
        : Array.isArray(entry.supportedModes) && entry.supportedModes.length > 0
          ? (entry.supportedModes as string[])
          : ["FULL"],
    defaultPolicy: (entry.defaultPolicy as Record<string, unknown>) ?? null,
    defaultScheduleKind: typeof entry.defaultScheduleKind === "string" ? entry.defaultScheduleKind : undefined,
    defaultScheduleIntervalMinutes:
      typeof entry.defaultScheduleIntervalMinutes === "number" ? entry.defaultScheduleIntervalMinutes : undefined,
    stats:
      typeof entry.description === "string"
        ? { description: entry.description, supportsIncremental: Boolean(entry.supportsIncremental) }
        : null,
    cdmModelId: typeof entry.cdmModelId === "string" ? entry.cdmModelId : undefined,
  }),
);
registerIngestionDriver("static", () => new TestStaticDriver(TEST_STATIC_UNITS));

const TEST_TENANT = "tenant-ingestion";
const TEST_PROJECT = "project-ingestion";
const CATALOG_DOMAIN = process.env.METADATA_CATALOG_DOMAIN ?? "catalog.dataset";
const JIRA_DATASETS = ["jira.projects", "jira.issues", "jira.users", "jira.comments", "jira.worklogs"];
const CONFLUENCE_DATASETS = ["confluence.space", "confluence.page", "confluence.attachment"];

test("ingestionUnits returns template extras for Jira endpoints", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-ingestion-resolvers-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  resetStateStoreMocks();
  resetConfigStore();
  const resolvers = createResolvers(store, {
    graphStore,
    ingestionStateStore: stateStoreOverrides(),
    ingestionConfigStore: configStoreOverrides(),
  });
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
  for (const datasetId of JIRA_DATASETS) {
    await seedCatalogDataset(store, endpoint.id!, datasetId);
  }

  const units = await resolvers.Query.ingestionUnits(null, { endpointId: endpoint.id! }, ctx as any);
  assert.ok(units.length >= 2, "jira units should be surfaced");
  const projectsUnit = units.find((unit) => unit.unitId === "jira.projects");
  assert.ok(projectsUnit, "jira.projects unit should be present");
  assert.equal(projectsUnit?.kind, "dataset");
  assert.equal(projectsUnit?.driverId, "static");
  assert.equal(projectsUnit?.sinkId, "kb");
  assert.equal(projectsUnit?.cdmModelId, "cdm.work.project");
});

test("ingestionUnits returns template extras for Confluence endpoints", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-ingestion-resolvers-confluence-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  resetStateStoreMocks();
  resetConfigStore();
  const resolvers = createResolvers(store, {
    graphStore,
    ingestionStateStore: stateStoreOverrides(),
    ingestionConfigStore: configStoreOverrides(),
  });
  const ctx = buildIngestionContext();
  const confluenceTemplate = DEFAULT_ENDPOINT_TEMPLATES.find((template) => template.id === "http.confluence");
  assert.ok(confluenceTemplate, "confluence template should exist in default fixtures");
  await store.saveEndpointTemplates([confluenceTemplate as unknown as MetadataEndpointTemplateDescriptor]);
  const endpoint = await store.registerEndpoint({
    id: "confluence-endpoint-1",
    name: "Confluence Dev",
    verb: "GET",
    url: "https://example.atlassian.net/wiki",
    projectId: ctx.auth.projectId,
    domain: "docs.confluence",
    config: {
      templateId: "http.confluence",
      parameters: {
        base_url: "https://example.atlassian.net/wiki",
        auth_type: "api_token",
        username: "bot@example.com",
        api_token: "token",
      },
    },
    capabilities: ["metadata"],
  });
  for (const datasetId of CONFLUENCE_DATASETS) {
    await seedCatalogDataset(store, endpoint.id!, datasetId);
  }
  const catalogRecords = await store.listRecords(CATALOG_DOMAIN, { projectId: ctx.auth.projectId });
  assert.equal(catalogRecords.length, CONFLUENCE_DATASETS.length);

  const units = await resolvers.Query.ingestionUnits(null, { endpointId: endpoint.id! }, ctx as any);
  assert.ok(units.length >= 1, "confluence units should be surfaced");
  const pagesUnit = units.find((unit) => unit.unitId === "confluence.page");
  assert.ok(pagesUnit, "confluence.page unit should be present");
  assert.equal(pagesUnit?.cdmModelId, "cdm.doc.item");
  assert.equal(pagesUnit?.defaultMode, "INCREMENTAL");
});

test("startIngestion bypass path succeeds for Jira units", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-ingestion-start-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  resetStateStoreMocks();
  resetConfigStore();
  const resolvers = createResolvers(store, {
    graphStore,
    ingestionStateStore: stateStoreOverrides(),
    ingestionConfigStore: configStoreOverrides(),
  });
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
  for (const datasetId of JIRA_DATASETS) {
    await seedCatalogDataset(store, endpoint.id!, datasetId);
  }
  ensureUnitStateStub.mock.resetCalls();
  markUnitStateStub.mock.resetCalls();
  const availableUnits = await resolvers.Query.ingestionUnits(null, { endpointId: endpoint.id! }, ctx as any);
  assert.ok(
    availableUnits.some((unit) => unit.unitId === "jira.projects"),
    "jira.projects unit should be available before start",
  );
  const result = await resolvers.Mutation.startIngestion(
    null,
    { endpointId: endpoint.id!, unitId: "jira.projects" },
    ctx as any,
  );
  assert.equal(result.state, "SUCCEEDED");
  assert.equal(result.message, "Bypass mode enabled");
  assert.equal(ensureUnitStateStub.mock.callCount(), 1);
  assert.equal(markUnitStateStub.mock.callCount(), 1);
});

test("startIngestion fails when dataset is missing", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-ingestion-start-missing-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  resetStateStoreMocks();
  resetConfigStore();
  const resolvers = createResolvers(store, {
    graphStore,
    ingestionStateStore: stateStoreOverrides(),
    ingestionConfigStore: configStoreOverrides(),
  });
  const ctx = buildIngestionContext({ bypassWrites: false, roles: ["viewer", "editor", "admin"] });
  const jiraTemplate = DEFAULT_ENDPOINT_TEMPLATES.find((template) => template.id === "jira.http");
  assert.ok(jiraTemplate);
  await store.saveEndpointTemplates([jiraTemplate as unknown as MetadataEndpointTemplateDescriptor]);
  const endpoint = await store.registerEndpoint({
    id: "jira-endpoint-start-missing",
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
  await assert.rejects(
    () =>
      resolvers.Mutation.startIngestion(null, { endpointId: endpoint.id!, unitId: "jira.projects" }, ctx as any),
    (error: any) => {
      assert.equal(error.extensions?.code, "E_INGESTION_DATASET_UNKNOWN");
      assert.equal(ensureUnitStateStub.mock.callCount(), 0);
      return true;
    },
  );
});

test("startIngestion fails when dataset is disabled", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-ingestion-start-disabled-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  resetStateStoreMocks();
  resetConfigStore();
  const resolvers = createResolvers(store, {
    graphStore,
    ingestionStateStore: stateStoreOverrides(),
    ingestionConfigStore: configStoreOverrides(),
  });
  const ctx = buildIngestionContext({ bypassWrites: false, roles: ["viewer", "editor", "admin"] });
  const jiraTemplate = DEFAULT_ENDPOINT_TEMPLATES.find((template) => template.id === "jira.http");
  assert.ok(jiraTemplate);
  await store.saveEndpointTemplates([jiraTemplate as unknown as MetadataEndpointTemplateDescriptor]);
  const endpoint = await store.registerEndpoint({
    id: "jira-endpoint-start-disabled",
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
  await seedCatalogDataset(store, endpoint.id!, "jira.projects");
  await configStoreOverrides().saveIngestionUnitConfig({
    endpointId: endpoint.id!,
    datasetId: "jira.projects",
    unitId: "jira.projects",
    enabled: false,
    runMode: "INCREMENTAL",
    mode: "raw",
    sinkId: "kb",
    policy: null,
    filter: null,
  });
  await assert.rejects(
    () =>
      resolvers.Mutation.startIngestion(null, { endpointId: endpoint.id!, unitId: "jira.projects" }, ctx as any),
    (error: any) => {
      assert.equal(error.extensions?.code, "E_INGESTION_DATASET_DISABLED");
      assert.equal(ensureUnitStateStub.mock.callCount(), 0);
      return true;
    },
  );
});

test("configureIngestionUnit persists Jira filters for Jira units", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-ingestion-config-filters-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  resetStateStoreMocks();
  resetConfigStore();
  const resolvers = createResolvers(store, {
    graphStore,
    ingestionStateStore: stateStoreOverrides(),
    ingestionConfigStore: configStoreOverrides(),
  });
  const ctx = buildIngestionContext({ bypassWrites: true, roles: ["viewer", "editor", "admin"] });
  const jiraTemplate = DEFAULT_ENDPOINT_TEMPLATES.find((template) => template.id === "jira.http");
  assert.ok(jiraTemplate);
  await store.saveEndpointTemplates([jiraTemplate as unknown as MetadataEndpointTemplateDescriptor]);
  const endpoint = await store.registerEndpoint({
    id: "jira-endpoint-config",
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
  for (const datasetId of JIRA_DATASETS) {
    await seedCatalogDataset(store, endpoint.id!, datasetId);
  }
  const filterInput = {
    projectKeys: ["ENG"],
    statuses: ["In Progress"],
    assigneeIds: ["acct-1"],
    updatedFrom: "2024-01-01T00:00:00.000Z",
  };
  const config = await resolvers.Mutation.configureIngestionUnit(
    null,
    {
      input: {
        endpointId: endpoint.id!,
        unitId: "jira.issues",
        enabled: true,
        runMode: "INCREMENTAL",
        mode: "raw",
        sinkId: "kb",
        scheduleKind: "MANUAL",
        jiraFilter: filterInput,
      },
    },
    ctx as any,
  );
  assert.deepEqual(config.jiraFilter?.projectKeys, ["ENG"]);
  assert.deepEqual(config.jiraFilter?.statuses, ["In Progress"]);
  assert.deepEqual(config.jiraFilter?.assigneeIds, ["acct-1"]);
  assert.equal(config.jiraFilter?.updatedFrom, "2024-01-01T00:00:00.000Z");
  const configs = await resolvers.Query.ingestionUnitConfigs(null, { endpointId: endpoint.id! }, ctx as any);
  assert.equal(configs.length, 1);
  assert.deepEqual(configs[0]?.jiraFilter?.projectKeys, ["ENG"]);
});

test("jiraIngestionFilterOptions returns metadata-driven options", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-ingestion-filter-options-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  resetStateStoreMocks();
  resetConfigStore();
  const resolvers = createResolvers(store, {
    graphStore,
    ingestionStateStore: stateStoreOverrides(),
    ingestionConfigStore: configStoreOverrides(),
  });
  const ctx = buildIngestionContext();
  const jiraTemplate = DEFAULT_ENDPOINT_TEMPLATES.find((template) => template.id === "jira.http");
  assert.ok(jiraTemplate);
  await store.saveEndpointTemplates([jiraTemplate as unknown as MetadataEndpointTemplateDescriptor]);
  const endpoint = await store.registerEndpoint({
    id: "jira-endpoint-options",
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
  await seedDimensionRecord(store, endpoint.id!, "jira.projects", { projectKey: "ENG", name: "Engineering" });
  await seedDimensionRecord(store, endpoint.id!, "jira.statuses", { id: "1", name: "To Do", category: "To Do" });
  await seedDimensionRecord(store, endpoint.id!, "jira.users", {
    accountId: "acct-1",
    displayName: "Jira Bot",
    emailAddress: "bot@example.com",
  });
  const options = await resolvers.Query.jiraIngestionFilterOptions(null, { endpointId: endpoint.id! }, ctx as any);
  const project = options.projects.find((entry) => entry.key === "ENG");
  assert.deepEqual(project, { key: "ENG", name: "Engineering" });
  const status = options.statuses.find((entry) => entry.id === "1");
  assert.deepEqual(status, { id: "1", name: "To Do", category: "To Do" });
  const user = options.users.find((entry) => entry.accountId === "acct-1");
  assert.deepEqual(user, { accountId: "acct-1", displayName: "Jira Bot", email: "bot@example.com" });
});

test("confluenceIngestionFilterOptions returns metadata-driven options", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-confluence-filter-options-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  resetStateStoreMocks();
  resetConfigStore();
  const resolvers = createResolvers(store, {
    graphStore,
    ingestionStateStore: stateStoreOverrides(),
    ingestionConfigStore: configStoreOverrides(),
  });
  const ctx = buildIngestionContext();
  const confluenceTemplate = DEFAULT_ENDPOINT_TEMPLATES.find((template) => template.id === "http.confluence");
  assert.ok(confluenceTemplate);
  await store.saveEndpointTemplates([confluenceTemplate as unknown as MetadataEndpointTemplateDescriptor]);
  const endpoint = await store.registerEndpoint({
    id: "confluence-endpoint-options",
    name: "Confluence Dev",
    verb: "GET",
    url: "https://starhealthinsurance.atlassian.net/wiki",
    projectId: ctx.auth.projectId,
    domain: "docs.confluence",
    config: {
      templateId: "http.confluence",
      parameters: {
        base_url: "https://starhealthinsurance.atlassian.net/wiki",
        auth_type: "api_token",
        username: "bot@starhealthinsurance.in",
        api_token: "token",
      },
    },
    capabilities: ["metadata"],
  });
  await seedDimensionRecord(store, endpoint.id!, "confluence.space", { spaceKey: "ENG", name: "Engineering Docs" });
  await seedDimensionRecord(store, endpoint.id!, "confluence.space", { spaceKey: "OPS", name: "Operations" });
  const options = await resolvers.Query.confluenceIngestionFilterOptions(null, { endpointId: endpoint.id! }, ctx as any);
  assert.equal(options.spaces.length, 2);
  const engSpace = options.spaces.find((entry) => entry.key === "ENG");
  assert.deepEqual(engSpace, { key: "ENG", name: "Engineering Docs" });
});

test("configureIngestionUnit persists Confluence filters for Confluence units", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-ingestion-config-confluence-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  resetStateStoreMocks();
  resetConfigStore();
  const resolvers = createResolvers(store, {
    graphStore,
    ingestionStateStore: stateStoreOverrides(),
    ingestionConfigStore: configStoreOverrides(),
  });
  const ctx = buildIngestionContext({ bypassWrites: true, roles: ["viewer", "editor", "admin"] });
  const confluenceTemplate = DEFAULT_ENDPOINT_TEMPLATES.find((template) => template.id === "http.confluence");
  assert.ok(confluenceTemplate);
  await store.saveEndpointTemplates([confluenceTemplate as unknown as MetadataEndpointTemplateDescriptor]);
  await store.registerEndpoint({
    id: "cdm-sink-1",
    name: "CDM Sink",
    verb: "POST",
    url: "postgres://localhost:5432/cdm",
    projectId: ctx.auth.projectId,
    domain: "cdm.sink",
    config: {
      templateId: "cdm.jdbc",
      parameters: {
        connection_url: "postgres://postgres:postgres@localhost:5432/cdm",
        schema: "cdm",
        table_prefix: "cdm_",
      },
    },
    capabilities: ["sink.cdm"],
  });
  const endpoint = await store.registerEndpoint({
    id: "confluence-endpoint-config",
    name: "Confluence Dev",
    verb: "GET",
    url: "https://starhealthinsurance.atlassian.net/wiki",
    projectId: ctx.auth.projectId,
    domain: "docs.confluence",
    config: {
      templateId: "http.confluence",
      parameters: {
        base_url: "https://starhealthinsurance.atlassian.net/wiki",
        auth_type: "api_token",
        username: "bot@starinsurance.in",
        api_token: "token",
      },
    },
    capabilities: ["metadata"],
  });
  await seedCatalogDataset(store, endpoint.id!, "confluence.page");
  const config = await resolvers.Mutation.configureIngestionUnit(
    null,
    {
      input: {
        endpointId: endpoint.id!,
        unitId: "confluence.page",
        enabled: true,
        runMode: "INCREMENTAL",
        mode: "cdm",
        sinkId: "cdm",
        sinkEndpointId: "cdm-sink-1",
        scheduleKind: "MANUAL",
        confluenceFilter: {
          spaceKeys: ["ENG", "OPS"],
          updatedFrom: "2024-02-01T00:00:00.000Z",
        },
      },
    },
    ctx as any,
  );
  assert.deepEqual(config.confluenceFilter?.spaceKeys, ["ENG", "OPS"]);
  assert.equal(config.confluenceFilter?.updatedFrom, "2024-02-01T00:00:00.000Z");
  const configs = await resolvers.Query.ingestionUnitConfigs(null, { endpointId: endpoint.id! }, ctx as any);
  assert.equal(configs.length, 1);
  assert.deepEqual(configs[0]?.confluenceFilter?.spaceKeys, ["ENG", "OPS"]);
});

test("configureIngestionUnit rejects CDM mode when sink lacks capability", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-ingestion-config-cdm-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  resetStateStoreMocks();
  resetConfigStore();
  const resolvers = createResolvers(store, {
    graphStore,
    ingestionStateStore: stateStoreOverrides(),
    ingestionConfigStore: configStoreOverrides(),
  });
  const ctx = buildIngestionContext({ bypassWrites: true, roles: ["viewer", "editor", "admin"] });
  const jiraTemplate = DEFAULT_ENDPOINT_TEMPLATES.find((template) => template.id === "jira.http");
  assert.ok(jiraTemplate);
  await store.saveEndpointTemplates([jiraTemplate as unknown as MetadataEndpointTemplateDescriptor]);
  const endpoint = await store.registerEndpoint({
    id: "jira-endpoint-cdm",
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
  await seedCatalogDataset(store, endpoint.id!, "jira.issues");
  await assert.rejects(
    resolvers.Mutation.configureIngestionUnit(
      null,
      {
        input: {
          endpointId: endpoint.id!,
          unitId: "jira.issues",
          runMode: "FULL",
          mode: "cdm",
          sinkId: "raw-only-test",
        },
      },
      ctx as any,
    ),
    (err: any) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Selected sink does not support/);
      return true;
    },
  );
});

test("ingestionSinks exposes registered sink capabilities", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-ingestion-sinks-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  const resolvers = createResolvers(store, { graphStore });
  const sinks = await resolvers.Query.ingestionSinks();
  assert.ok(Array.isArray(sinks));
  const cdmSink = sinks.find((sink) => sink.id === "cdm");
  assert.ok(cdmSink, "cdm sink should be registered");
  assert.ok(cdmSink?.supportedCdmModels?.includes("cdm.work.item"));
});

test("provisionCdmSink delegates to provisioner service", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-provision-cdm-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  const sinkEndpoint = await store.registerEndpoint({
    id: "sink-endpoint-1",
    name: "CDM Sink",
    verb: "POST",
    url: "postgres://localhost:5432/jira_plus_plus",
    projectId: TEST_PROJECT,
    labels: ["sink:cdm"],
    config: {
      templateId: "cdm.jdbc",
      parameters: {
        connection_url: "postgres://postgres:postgres@localhost:5432/jira_plus_plus",
        schema: "cdm_work",
      },
    },
  });
  const provisioner = mock.fn(async () => ({
    datasetId: "cdm_work.cdm_work_item",
    schema: "cdm_work",
    tableName: "cdm_work_item",
  }));
  const resolvers = createResolvers(store, { graphStore, cdmProvisioner: provisioner });
  const ctx = buildIngestionContext();
  const result = await resolvers.Mutation.provisionCdmSink(
    null,
    { input: { sinkEndpointId: sinkEndpoint.id!, cdmModelId: "cdm.work.item" } },
    ctx as any,
  );
  assert.equal(result.ok, true);
  assert.equal(result.datasetId, "cdm_work.cdm_work_item");
  assert.equal(result.schema, "cdm_work");
  assert.equal(result.tableName, "cdm_work_item");
  assert.equal(provisioner.mock.callCount(), 1);
});

test("provisionCdmSink rejects non-CDM endpoints", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "metadata-provision-cdm-invalid-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const graphStore = createGraphStore({ metadataStore: store });
  const sinkEndpoint = await store.registerEndpoint({
    id: "sink-endpoint-raw",
    name: "Raw Sink",
    verb: "POST",
    url: "postgres://localhost:5432/raw",
    projectId: TEST_PROJECT,
    labels: [],
  });
  const resolvers = createResolvers(store, { graphStore });
  const ctx = buildIngestionContext();
  await assert.rejects(
    () =>
      resolvers.Mutation.provisionCdmSink(
        null,
        { input: { sinkEndpointId: sinkEndpoint.id!, cdmModelId: "cdm.work.item" } },
        ctx as any,
      ),
    /CDM sink/,
  );
});

function stateStoreOverrides() {
  return {
    getUnitState: getUnitStateStub,
    listUnitStates: listUnitStatesStub,
    markUnitState: markUnitStateStub,
    ensureUnitState: ensureUnitStateStub,
  };
}

function resetStateStoreMocks() {
  ensureUnitStateStub.mock.resetCalls();
  markUnitStateStub.mock.resetCalls();
  getUnitStateStub.mock.resetCalls();
  listUnitStatesStub.mock.resetCalls();
}

function configStoreOverrides() {
  return {
    findConfigByDataset: async (endpointId: string, datasetId: string) =>
      Array.from(configStoreRows.values()).find(
        (row) => row.endpointId === endpointId && row.datasetId === datasetId,
      ) ?? null,
    getIngestionUnitConfig: async (endpointId: string, unitId: string) =>
      configStoreRows.get(configKey(endpointId, unitId)) ?? null,
    listIngestionUnitConfigs: async (endpointId: string) =>
      Array.from(configStoreRows.values()).filter((row) => row.endpointId === endpointId),
    saveIngestionUnitConfig: async (input: {
      endpointId: string;
      datasetId: string;
      unitId: string;
      enabled?: boolean;
      runMode?: string;
      mode?: string;
      sinkId?: string;
      sinkEndpointId?: string | null;
      scheduleKind?: string;
      scheduleIntervalMinutes?: number | null;
      policy?: Record<string, unknown> | null;
      filter?: Record<string, unknown> | null;
    }) => {
      const row: IngestionUnitConfigRow = {
        id: configKey(input.endpointId, input.unitId),
        endpointId: input.endpointId,
        datasetId: input.datasetId,
        unitId: input.unitId,
        enabled: input.enabled ?? false,
        runMode: (input.runMode ?? "FULL").toUpperCase(),
        mode: (input.mode ?? "raw"),
        sinkId: input.sinkId ?? "kb",
        sinkEndpointId: input.sinkEndpointId ?? null,
        scheduleKind: (input.scheduleKind ?? "MANUAL").toUpperCase(),
        scheduleIntervalMinutes:
          (input.scheduleKind ?? "MANUAL").toUpperCase() === "INTERVAL" ? input.scheduleIntervalMinutes ?? 15 : null,
        policy: input.policy ?? null,
        filter: input.filter ?? null,
      };
      configStoreRows.set(configKey(row.endpointId, row.unitId), row);
      return row;
    },
  };
}

function resetConfigStore() {
  configStoreRows.clear();
}

function configKey(endpointId: string, unitId: string) {
  return `${endpointId}:${unitId}`;
}

class TestStaticDriver {
  constructor(private readonly units: IngestionUnitDescriptor[]) {}

  async listUnits(): Promise<IngestionUnitDescriptor[]> {
    return this.units;
  }

  async syncUnit() {
    return {
      newCheckpoint: {},
      stats: null,
      batches: [],
      sourceEventIds: [],
      errors: [],
    };
  }
}

function templateUnitsFromExtras(extras: Record<string, unknown> | undefined): Record<string, unknown>[] {
  const explicit = Array.isArray(extras?.ingestionUnits)
    ? (extras!.ingestionUnits as Record<string, unknown>[])
    : [];
  const datasetDerived: Record<string, unknown>[] = [];
  if (Array.isArray(extras?.datasets)) {
    for (const datasetEntry of extras.datasets as Record<string, unknown>[]) {
      if (!datasetEntry || typeof datasetEntry !== "object") {
        continue;
      }
      const dataset = datasetEntry as Record<string, unknown>;
      const datasetId = typeof dataset.datasetId === "string" ? dataset.datasetId : null;
      const ingestion =
        dataset.ingestion && typeof dataset.ingestion === "object"
          ? (dataset.ingestion as Record<string, unknown>)
          : null;
      if (!ingestion) {
        continue;
      }
      const unitId = typeof ingestion.unitId === "string" ? ingestion.unitId : datasetId;
      if (!unitId) {
        continue;
      }
      datasetDerived.push({
        unitId,
        datasetId: datasetId ?? unitId,
        displayName:
          typeof ingestion.displayName === "string"
            ? ingestion.displayName
            : typeof dataset.name === "string"
              ? dataset.name
              : unitId,
        description:
          typeof ingestion.description === "string"
            ? ingestion.description
            : typeof dataset.description === "string"
              ? dataset.description
              : undefined,
        supportsIncremental: ingestion.supportsIncremental === true,
        defaultPolicy: ingestion.defaultPolicy,
        cdmModelId: typeof ingestion.cdmModelId === "string" ? ingestion.cdmModelId : undefined,
      });
    }
  }
  return [...explicit, ...datasetDerived];
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
        extras: {
          datasetId,
        },
      },
      extras: {
        datasetId,
      },
    },
  });
}

async function seedDimensionRecord(
  store: FileMetadataStore,
  endpointId: string,
  datasetId: string,
  value: Record<string, unknown>,
) {
  const identifier =
    value.id ??
    value.projectKey ??
    value.accountId ??
    value.spaceKey ??
    value.key ??
    Date.now().toString(36);
  await store.upsertRecord({
    id: `${datasetId}-${identifier}`,
    projectId: TEST_PROJECT,
    domain: datasetId,
    labels: [`endpoint:${endpointId}`],
    payload: {
      value,
      ...value,
    },
  });
}

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
