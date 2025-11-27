import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execa } from "execa";
import {
  getIngestionSink,
  type GraphStore,
  type MetadataRecord,
  type TenantContext,
  type IngestionSinkContext,
} from "@metadata/core";
import { getPrismaClient } from "../prismaClient.js";
import { getMetadataStore, getGraphStore } from "../context.js";
import { deriveDatasetIdentity, imprintDatasetIdentity } from "../metadata/datasetIdentity.js";
import { readCheckpoint, updateCheckpoint, writeCheckpoint, type IngestionCheckpointRecord, type IngestionCheckpointKey } from "../ingestion/checkpoints.js";
import { markUnitState, upsertUnitState } from "../ingestion/stateStore.js";
import { EndpointTemplate, EndpointBuildResult, EndpointTestResult } from "../types.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_SCRIPT_PATH = path.resolve(
  moduleDir,
  "..",
  "..",
  "..",
  "..",
  "platform",
  "spark-ingestion",
  "scripts",
  "endpoint_registry_cli.py",
);
const SPARK_PACKAGES_ROOT = path.resolve(moduleDir, "..", "..", "..", "..", "platform", "spark-ingestion", "packages");
const REGISTRY_PYTHONPATH_ENTRIES = [
  path.join(SPARK_PACKAGES_ROOT, "runtime-common", "src"),
  path.join(SPARK_PACKAGES_ROOT, "core", "src"),
  path.join(SPARK_PACKAGES_ROOT, "metadata-service", "src"),
  path.join(SPARK_PACKAGES_ROOT, "metadata-gateway", "src"),
].filter((entry) => entry && entry.length > 0);

const DEFAULT_SINK_ID = process.env.INGESTION_DEFAULT_SINK ?? "kb";
const DEFAULT_STAGING_PROVIDER = process.env.INGESTION_DEFAULT_STAGING_PROVIDER ?? "in_memory";

export type MetadataActivities = {
  createCollectionRun(input: {
    endpointId: string;
    collectionId?: string | null;
    requestedBy?: string | null;
    reason?: string | null;
  }): Promise<{ runId: string }>;
  markRunStarted(input: { runId: string; workflowId: string; temporalRunId: string }): Promise<void>;
  markRunCompleted(input: { runId: string }): Promise<void>;
  markRunSkipped(input: { runId: string; reason: string }): Promise<void>;
  markRunFailed(input: { runId: string; error: string }): Promise<void>;
  prepareCollectionJob(input: { runId: string }): Promise<CollectionJobPlan>;
  persistCatalogRecords(input: { runId: string; records?: CatalogRecordInput[]; recordsPath?: string | null }): Promise<void>;
  listEndpointTemplates(input: { family?: "JDBC" | "HTTP" | "STREAM" }): Promise<EndpointTemplate[]>;
  buildEndpointConfig(input: {
    templateId: string;
    parameters: Record<string, string>;
    extras?: { labels?: string[] };
  }): Promise<EndpointBuildResult>;
  testEndpointConnection(input: { templateId: string; parameters: Record<string, string> }): Promise<EndpointTestResult>;
  startIngestionRun(input: StartIngestionRunInput): Promise<StartIngestionRunResult>;
  completeIngestionRun(input: CompleteIngestionRunInput): Promise<void>;
  failIngestionRun(input: FailIngestionRunInput): Promise<void>;
  persistIngestionBatches(input: PersistIngestionBatchesInput): Promise<void>;
};

const DEFAULT_METADATA_PROJECT = process.env.METADATA_DEFAULT_PROJECT ?? "global";

export type CollectionJobRequest = {
  runId: string;
  endpointId: string;
  sourceId: string;
  endpointName: string;
  connectionUrl: string;
  schemas: string[];
  projectId?: string | null;
  labels?: string[];
  config?: Record<string, unknown> | null;
};

export type CollectionJobPlan =
  | { kind: "skip"; reason: string; capability?: string }
  | { kind: "run"; job: CollectionJobRequest };

export type CatalogRecordInput = {
  id?: string;
  projectId?: string | null;
  domain: string;
  labels?: string[];
  payload: Record<string, unknown>;
};

const CATALOG_DATASET_DOMAIN = "catalog.dataset";

type StartIngestionRunInput = {
  endpointId: string;
  unitId: string;
  sinkId?: string | null;
};

type StartIngestionRunResult = {
  runId: string;
  sinkId: string;
  vendorKey: string;
  checkpoint: IngestionCheckpointRecord | null;
  checkpointVersion: string | null;
  stagingProviderId: string;
  policy: Record<string, unknown> | null;
  mode: string | null;
};

type CompleteIngestionRunInput = {
  endpointId: string;
  unitId: string;
  sinkId: string;
  vendorKey: string;
  runId: string;
  checkpointVersion: string | null;
  newCheckpoint: unknown;
  stats: Record<string, unknown> | null;
};

type FailIngestionRunInput = {
  endpointId: string;
  unitId: string;
  sinkId: string;
  vendorKey: string;
  runId: string;
  error: string;
};

type NormalizedRecordInput = {
  entityType: string;
  logicalId?: string | null;
  displayName?: string | null;
  scope: {
    orgId: string;
    projectId?: string | null;
    domainId?: string | null;
    teamId?: string | null;
  };
  provenance: {
    endpointId: string;
    vendor?: string | null;
    sourceEventId?: string | null;
  };
  payload: Record<string, unknown> | unknown;
  phase?: string | null;
  edges?: Array<{
    type: string;
    sourceLogicalId: string;
    targetLogicalId: string;
    properties?: Record<string, unknown> | null;
  }>;
};

type PersistIngestionBatchesInput = {
  endpointId: string;
  unitId: string;
  sinkId: string;
  runId: string;
  records: NormalizedRecordInput[];
  stats?: Record<string, unknown> | null;
};

type PrismaClient = Awaited<ReturnType<typeof getPrismaClient>>;

export const activities: MetadataActivities = {
  async createCollectionRun({
    endpointId,
    collectionId,
    requestedBy,
    reason,
  }: {
    endpointId: string;
    collectionId?: string | null;
    requestedBy?: string | null;
    reason?: string | null;
  }) {
    const prisma = await getPrismaClient();
    const run = await prisma.metadataCollectionRun.create({
      data: {
        endpointId,
        collectionId: collectionId ?? null,
        status: "QUEUED",
        requestedBy: requestedBy ?? reason ?? null,
      },
      select: { id: true },
    });
    return { runId: run.id };
  },
  async markRunStarted({
    runId,
    workflowId,
    temporalRunId,
  }: {
    runId: string;
    workflowId: string;
    temporalRunId: string;
  }) {
    const prisma = await getPrismaClient();
    await updateRunOrWarn(prisma, runId, {
      status: "RUNNING",
      startedAt: new Date(),
      workflowId,
      temporalRunId,
      error: null,
    });
  },
  async persistCatalogRecords({
    runId,
    records,
    recordsPath,
  }: {
    runId: string;
    records?: CatalogRecordInput[];
    recordsPath?: string | null;
  }) {
    const resolvedRecords = await loadRecords(records, recordsPath);
    if (!resolvedRecords.length) {
      return;
    }
    await deleteTempFile(recordsPath);
    const prisma = await getPrismaClient();
    const run = await prisma.metadataCollectionRun.findUnique({
      where: { id: runId },
      include: { endpoint: true },
    });
    if (!run || !run.endpoint) {
      throw new Error("Metadata collection run not found");
    }
    const store = await getMetadataStore();
    const graphStore = await getGraphStore();
    const projectCache = new Map<string, string>();
    const tenantId = process.env.TENANT_ID ?? "dev";
    await Promise.all(
      resolvedRecords.map(async (record) => {
        const requestedProjectId = record.projectId || run.endpoint.projectId || DEFAULT_METADATA_PROJECT;
        const projectId = await getOrCreateProjectId(prisma, projectCache, requestedProjectId);
        const labelSet = new Set(record.labels ?? []);
        labelSet.add(`endpoint:${run.endpoint.id}`);
        if (run.endpoint.sourceId) {
          labelSet.add(`source:${run.endpoint.sourceId}`);
        }
        const payload = normalizeRecordPayload(record.payload);
        const datasetIdentity =
          record.domain === CATALOG_DATASET_DOMAIN
            ? deriveDatasetIdentity(payload, {
                tenantId,
                projectId,
                fallbackSourceId: run.endpoint.sourceId ?? run.endpoint.id,
                labels: Array.from(labelSet),
              })
            : null;
        if (datasetIdentity) {
          imprintDatasetIdentity(payload, datasetIdentity);
        }
        const providedRecordId =
          typeof record.id === "string" && record.id.trim().length > 0 ? record.id.trim() : null;
        const savedRecord = await store.upsertRecord({
          id: datasetIdentity?.id ?? providedRecordId ?? `${run.endpoint.id}-${randomUUID()}`,
          projectId,
          domain: record.domain,
          labels: Array.from(labelSet),
          payload,
        });
        await syncRecordToGraph(savedRecord, graphStore, {
          tenantId,
          projectId,
          actorId: run.endpoint.id,
        });
      }),
    );
  },
  async markRunCompleted({ runId }: { runId: string }) {
    const prisma = await getPrismaClient();
    await updateRunOrWarn(prisma, runId, {
      status: "SUCCEEDED",
      completedAt: new Date(),
      error: null,
    });
  },
  async markRunSkipped({ runId, reason }: { runId: string; reason: string }) {
    const prisma = await getPrismaClient();
    await updateRunOrWarn(prisma, runId, {
      status: "SKIPPED",
      completedAt: new Date(),
      error: reason,
    });
  },
  async markRunFailed({ runId, error }: { runId: string; error: string }) {
    const prisma = await getPrismaClient();
    await updateRunOrWarn(prisma, runId, {
      status: "FAILED",
      completedAt: new Date(),
      error,
    });
  },
  async prepareCollectionJob({ runId }: { runId: string }) {
    const prisma = await getPrismaClient();
    const run = await prisma.metadataCollectionRun.findUnique({
      where: { id: runId },
      include: { endpoint: true },
    });
    if (!run || !run.endpoint) {
      throw new Error("Metadata collection run or endpoint not found");
    }
    if (!run.endpoint.url) {
      throw new Error("Endpoint missing connection URL");
    }

    const schemas = resolveSchemas(run);
    const endpointCapabilities: string[] = Array.isArray(run.endpoint.capabilities) ? run.endpoint.capabilities : [];
    if (endpointCapabilities.length > 0 && !endpointCapabilities.includes("metadata")) {
      return {
        kind: "skip",
        capability: "metadata",
        reason: `Collection skipped: ${run.endpoint.name} does not expose the "metadata" capability.`,
      };
    }
    return {
      kind: "run",
      job: {
        runId: run.id,
        endpointId: run.endpoint.id,
        sourceId: run.endpoint.sourceId ?? run.endpoint.id,
        endpointName: run.endpoint.name,
        connectionUrl: run.endpoint.url,
        schemas,
        projectId: run.endpoint.projectId ?? null,
        labels: run.endpoint.labels ?? [],
        config: (run.endpoint.config as Record<string, unknown>) ?? null,
      },
    };
  },
  async listEndpointTemplates({ family }: { family?: "JDBC" | "HTTP" | "STREAM" }) {
    const stdout = await runRegistryCommand(["list", ...(family ? ["--family", family] : [])]);
    return JSON.parse(stdout || "[]") as EndpointTemplate[];
  },
  async buildEndpointConfig({
    templateId,
    parameters,
    extras,
  }: {
    templateId: string;
    parameters: Record<string, string>;
    extras?: { labels?: string[] };
  }) {
    const stdout = await runRegistryCommand([
      "build",
      "--template",
      templateId,
      "--parameters",
      JSON.stringify(parameters ?? {}),
    ]);
    const payload = JSON.parse(stdout || "{}") as EndpointBuildResult;
    if (extras?.labels?.length) {
      const merged = new Set([...(payload.labels ?? []), ...extras.labels]);
      payload.labels = Array.from(merged);
    }
    return payload;
  },
  async testEndpointConnection({ templateId, parameters }: { templateId: string; parameters: Record<string, string> }) {
    const startedAt = Date.now();
    emitProbeEvent("endpoint_probe_started", { templateId, parameterKeys: Object.keys(parameters ?? {}) });
    try {
      const stdout = await runRegistryCommand([
        "test",
        "--template",
        templateId,
        "--parameters",
        JSON.stringify(parameters ?? {}),
      ]);
      const result = JSON.parse(stdout || "{}") as EndpointTestResult;
      const latencyMs = Date.now() - startedAt;
      emitProbeEvent("endpoint_probe_success", {
        templateId,
        detectedVersion: result.detectedVersion ?? null,
        capabilities: result.capabilities ?? [],
        latencyMs,
      });
      emitProbeEvent("metadata.endpoint.test.latency_ms", { templateId, latencyMs });
      return result;
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      emitProbeEvent(
        "endpoint_probe_failed",
        {
          templateId,
          latencyMs,
          message: error instanceof Error ? error.message : String(error),
        },
        "error",
      );
      throw error;
    }
  },
  async startIngestionRun({ endpointId, unitId, sinkId }: StartIngestionRunInput): Promise<StartIngestionRunResult> {
    const store = await getMetadataStore();
    const endpoints = await store.listEndpoints();
    const endpoint = endpoints.find((entry) => entry.id === endpointId);
    if (!endpoint) {
      throw new Error(`Endpoint ${endpointId} not found`);
    }
    const prisma = await getPrismaClient();
    const config = await prisma.ingestionUnitConfig.findUnique({
      where: {
        endpointId_unitId: {
          endpointId,
          unitId,
        },
      },
    });
    if (config && !config.enabled) {
      throw new Error(`Ingestion config disabled for unit ${unitId}`);
    }
    const resolvedSinkId = resolveSinkId(config?.sinkId ?? sinkId);
    if (!getIngestionSink(resolvedSinkId)) {
      throw new Error(`Ingestion sink "${resolvedSinkId}" is not registered`);
    }
    const vendorKey = endpoint.domain ?? endpoint.sourceId ?? endpoint.id ?? endpointId;
    const stagingProviderId = resolveStagingProvider(endpoint);
    const policyOverrides =
      config?.policy && typeof config.policy === "object" ? (config.policy as Record<string, unknown>) : null;
    const policy = mergeIngestionPolicies(resolveIngestionPolicy(endpoint), policyOverrides);
    const checkpointKey: IngestionCheckpointKey = {
      endpointId,
      unitId,
      sinkId: resolvedSinkId,
      vendor: vendorKey,
    };
    const checkpointState = await readCheckpoint(checkpointKey);
    const runId = randomUUID();
    await upsertUnitState(
      { endpointId, unitId, sinkId: resolvedSinkId },
      {
        state: "RUNNING",
        lastRunId: runId,
        lastRunAt: new Date(),
        lastError: null,
      },
    );
    return {
      runId,
      sinkId: resolvedSinkId,
      vendorKey,
      checkpoint: checkpointState.checkpoint,
      checkpointVersion: checkpointState.version,
      stagingProviderId,
      policy,
      mode: config?.runMode ?? null,
    };
  },
  async completeIngestionRun({
    endpointId,
    unitId,
    sinkId,
    vendorKey,
    runId,
    checkpointVersion,
    newCheckpoint,
    stats,
  }: CompleteIngestionRunInput): Promise<void> {
    const checkpointKey = buildCheckpointKey({ endpointId, unitId, sinkId, vendorKey });
    const record: IngestionCheckpointRecord = {
      cursor: newCheckpoint ?? null,
      lastRunId: runId,
      stats,
    };
    await writeCheckpoint(checkpointKey, record, {
      expectedVersion: checkpointVersion ?? undefined,
    });
    await markUnitState(
      { endpointId, unitId, sinkId },
      {
        state: "SUCCEEDED",
        checkpoint: record,
        lastRunId: runId,
        lastRunAt: new Date(),
        lastError: null,
        stats,
      },
    );
  },
  async failIngestionRun({
    endpointId,
    unitId,
    sinkId,
    vendorKey,
    runId,
    error,
  }: FailIngestionRunInput): Promise<void> {
    const sanitized = sanitizeIngestionError(error);
    await markUnitState(
      { endpointId, unitId, sinkId },
      {
        state: "FAILED",
        lastRunId: runId,
        lastRunAt: new Date(),
        lastError: sanitized,
      },
    );
    await updateCheckpoint(buildCheckpointKey({ endpointId, unitId, sinkId, vendorKey }), (existing) => ({
      ...(existing ?? {}),
      lastRunId: runId,
      lastError: sanitized,
    }));
  },
  async persistIngestionBatches({
    endpointId,
    unitId,
    sinkId,
    runId,
    records,
    stats,
  }: PersistIngestionBatchesInput): Promise<void> {
    if (!records || records.length === 0) {
      return;
    }
    const sink = getIngestionSink(sinkId);
    if (!sink) {
      throw new Error(`Ingestion sink "${sinkId}" is not registered`);
    }
    const context: IngestionSinkContext = {
      endpointId,
      unitId,
      sinkId,
      runId,
    };
    await sink.begin(context);
    await sink.writeBatch({ records }, context);
    if (sink.commit) {
      await sink.commit(context, stats ?? null);
    }
  },
};

function resolveSchemas(run: any): string[] {
  const filterSchemas = run.filters?.schemas;
  if (Array.isArray(filterSchemas) && filterSchemas.length > 0) {
    return normalizeSchemas(filterSchemas);
  }
  const endpointSchemas = run.endpoint.config?.schemas;
  if (Array.isArray(endpointSchemas) && endpointSchemas.length > 0) {
    return normalizeSchemas(endpointSchemas);
  }
  return ["public"];
}

function normalizeSchemas(input: unknown[]): string[] {
  return input
    .map((schema) => (typeof schema === "string" ? schema.trim() : ""))
    .filter((schema) => Boolean(schema)) as string[];
}

async function runRegistryCommand(args: string[]) {
  const pythonPathParts = [...REGISTRY_PYTHONPATH_ENTRIES];
  if (process.env.PYTHONPATH && process.env.PYTHONPATH.length > 0) {
    pythonPathParts.push(process.env.PYTHONPATH);
  }
  const env = {
    ...process.env,
    PYTHONPATH: pythonPathParts.join(path.delimiter),
  };
  const subprocess = await execa("python3", [REGISTRY_SCRIPT_PATH, ...args], {
    stdout: "pipe",
    stderr: "inherit",
    env,
  });
  return subprocess.stdout.trim();
}

function emitProbeEvent(event: string, payload: Record<string, unknown>, level: "info" | "error" = "info") {
  const label = `[metadata.endpoint] ${event}`;
  if (level === "error") {
    console.error(label, payload);
  } else {
    console.info(label, payload);
  }
}

async function getOrCreateProjectId(
  prisma: any,
  cache: Map<string, string>,
  requestedId?: string | null,
): Promise<string> {
  const key = (requestedId && requestedId.trim()) || DEFAULT_METADATA_PROJECT;
  if (cache.has(key)) {
    return cache.get(key)!;
  }
  const existingById = await prisma.metadataProject.findUnique({ where: { id: key } });
  if (existingById) {
    cache.set(key, existingById.id);
    return existingById.id;
  }
  const slug = slugifyProjectId(key);
  const existingBySlug = await prisma.metadataProject.findUnique({ where: { slug } });
  if (existingBySlug) {
    cache.set(key, existingBySlug.id);
    return existingBySlug.id;
  }
  const project = await prisma.metadataProject.create({
    data: {
      id: key,
      slug,
      displayName: key === DEFAULT_METADATA_PROJECT ? "Global Metadata" : key,
    },
  });
  cache.set(key, project.id);
  return project.id;
}

function slugifyProjectId(input: string): string {
  const normalized = input.trim().toLowerCase();
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || normalized || "project";
}

async function updateRunOrWarn(
  prisma: PrismaClient,
  runId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const result = await prisma.metadataCollectionRun.updateMany({
    where: { id: runId },
    data,
  });
  if (result.count === 0 && process.env.NODE_ENV !== "test") {
    // eslint-disable-next-line no-console
    console.warn(`[metadata] collection run ${runId} not found while updating status; skipping`);
  }
}

async function loadRecords(records?: CatalogRecordInput[] | null, recordsPath?: string | null): Promise<CatalogRecordInput[]> {
  if (records && records.length > 0) {
    return records;
  }
  if (!recordsPath) {
    return [];
  }
  const absolutePath = path.resolve(recordsPath);
  try {
    const contents = await fs.readFile(absolutePath, "utf-8");
    const parsed = JSON.parse(contents);
    if (Array.isArray(parsed)) {
      return parsed as CatalogRecordInput[];
    }
    return [];
  } catch (error) {
    console.warn(`Failed to load catalog records from ${recordsPath}:`, error);
    return [];
  }
}

function normalizeRecordPayload(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

async function deleteTempFile(recordsPath?: string | null) {
  if (!recordsPath) {
    return;
  }
  try {
    await fs.unlink(path.resolve(recordsPath));
  } catch {
    // ignore cleanup failures
  }
}

function resolveSinkId(candidate?: string | null): string {
  if (candidate && candidate.trim().length > 0) {
    return candidate.trim();
  }
  return DEFAULT_SINK_ID;
}

function resolveStagingProvider(endpoint?: { config?: unknown } | null): string {
  const raw = endpoint && typeof endpoint === "object" ? (endpoint as Record<string, unknown>).config : null;
  if (raw && typeof raw === "object" && raw !== null) {
    const provider = (raw as Record<string, unknown>).stagingProvider;
    if (typeof provider === "string" && provider.trim().length > 0) {
      return provider.trim();
    }
  }
  return DEFAULT_STAGING_PROVIDER;
}

export function resolveIngestionPolicy(endpoint?: { config?: unknown } | null): Record<string, unknown> | null {
  const raw = endpoint && typeof endpoint === "object" ? (endpoint as Record<string, unknown>).config : null;
  if (raw && typeof raw === "object" && raw !== null) {
    const policy = (raw as Record<string, unknown>).ingestionPolicy;
    if (policy && typeof policy === "object") {
      return policy as Record<string, unknown>;
    }
    return raw as Record<string, unknown>;
  }
  return null;
}

function mergeIngestionPolicies(
  base: Record<string, unknown> | null,
  overrides: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (base && overrides) {
    return { ...base, ...overrides };
  }
  return overrides ?? base;
}

function buildCheckpointKey({
  endpointId,
  unitId,
  sinkId,
  vendorKey,
}: {
  endpointId: string;
  unitId: string;
  sinkId: string;
  vendorKey: string;
}): IngestionCheckpointKey {
  return {
    endpointId,
    unitId,
    sinkId,
    vendor: vendorKey,
  };
}

function sanitizeIngestionError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }
  if (typeof error === "string") {
    return error.slice(0, 500);
  }
  try {
    return JSON.stringify(error).slice(0, 500);
  } catch {
    return "Unknown ingestion error";
  }
}

async function syncRecordToGraph(
  record: MetadataRecord<unknown>,
  graphStore: GraphStore,
  context: TenantContext,
): Promise<void> {
  if (record.domain !== CATALOG_DATASET_DOMAIN) {
    return;
  }
  const payload = normalizeObject(record.payload);
  const dataset = normalizeObject(payload.dataset ?? payload);
  const displayName =
    (dataset.displayName as string | undefined) ??
    (dataset.name as string | undefined) ??
    (record.id ?? "dataset").toString();
  const datasetIdentity =
    deriveDatasetIdentity(payload, {
      tenantId: context.tenantId,
      projectId: record.projectId,
      fallbackSourceId: context.actorId ?? null,
      labels: record.labels,
    }) ?? null;
  const canonicalPath = datasetIdentity?.canonicalPath ?? (dataset.id as string | undefined) ?? record.id ?? displayName;
  await graphStore.upsertEntity(
    {
      id: datasetIdentity?.id ?? record.id,
      entityType: CATALOG_DATASET_DOMAIN,
      displayName,
      canonicalPath,
      sourceSystem: (dataset.source as string | undefined) ?? undefined,
      specRef: (dataset.specRef as string | undefined) ?? undefined,
      properties: payload,
      scope: {
        orgId: context.tenantId,
        projectId: record.projectId ?? context.projectId,
      },
      identity: {
        externalId: datasetIdentity
          ? {
              datasetId: datasetIdentity.id,
              sourceId: datasetIdentity.sourceId,
              schema: datasetIdentity.schema,
              table: datasetIdentity.table,
              database: datasetIdentity.database ?? null,
              canonicalPath: datasetIdentity.canonicalPath,
            }
          : { recordId: record.id },
        originEndpointId: datasetIdentity?.sourceId ?? (dataset.sourceEndpointId as string | undefined) ?? null,
        originVendor: (dataset.sourceVendor as string | undefined) ?? null,
      },
    },
    context,
  );
}

function normalizeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
