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
const TEMPLATE_UNITS = Array.isArray(JIRA_TEMPLATE_EXTRAS.ingestionUnits)
  ? (JIRA_TEMPLATE_EXTRAS.ingestionUnits as Record<string, unknown>[])
  : [];
const TEST_STATIC_UNITS: IngestionUnitDescriptor[] = TEMPLATE_UNITS.map((entry) => ({
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
}));
registerIngestionDriver("static", () => new TestStaticDriver(TEST_STATIC_UNITS));

const TEST_TENANT = "tenant-ingestion";
const TEST_PROJECT = "project-ingestion";
const CATALOG_DOMAIN = process.env.METADATA_CATALOG_DOMAIN ?? "catalog.dataset";
const JIRA_DATASETS = ["jira.projects", "jira.issues", "jira.users", "jira.comments", "jira.worklogs"];

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
