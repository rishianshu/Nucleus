import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { getPrismaClient } from "../prismaClient.js";
import { getMetadataStore, getGraphStore } from "../context.js";
import { deriveDatasetIdentity, imprintDatasetIdentity } from "../metadata/datasetIdentity.js";
import type { GraphStore, TenantContext, MetadataRecord } from "@metadata/core";
import { EndpointTemplate, EndpointBuildResult, EndpointTestResult } from "../types.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execa } from "execa";

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
  const subprocess = await execa("python3", [REGISTRY_SCRIPT_PATH, ...args], {
    stdout: "pipe",
    stderr: "inherit",
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
