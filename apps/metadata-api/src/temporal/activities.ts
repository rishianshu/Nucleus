import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  getIngestionDriver,
  getIngestionSink,
  type GraphStore,
  type MetadataRecord,
  type MetadataEndpointDescriptor,
  type MetadataEndpointTemplateFamily,
  type TenantContext,
  type IngestionSinkContext,
  type NormalizedRecord,
  type MetadataEndpointFieldValueType,
} from "@metadata/core";
import { resolveEndpointDriverId } from "../ingestion/helpers.js";
import { getPrismaClient } from "../prismaClient.js";
import { getMetadataStore, getGraphStore } from "../context.js";
import { deriveDatasetIdentity, imprintDatasetIdentity } from "../metadata/datasetIdentity.js";
import { readCheckpoint, updateCheckpoint, writeCheckpoint, type IngestionCheckpointRecord, type IngestionCheckpointKey } from "../ingestion/checkpoints.js";
import { readTransientState, writeTransientState } from "../ingestion/transientState.js";
import { markUnitState, upsertUnitState } from "../ingestion/stateStore.js";
import { EndpointTemplate, EndpointBuildResult, EndpointTestResult } from "../types.js";
import { getOneDriveDelegatedToken } from "../onedriveAuth.js";
import { upsertJdbcRelations } from "../graph/jdbcRelations.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_SINK_ID = process.env.INGESTION_DEFAULT_SINK ?? "cdm";
const DEFAULT_STAGING_PROVIDER = process.env.INGESTION_DEFAULT_STAGING_PROVIDER ?? "object.minio";
const DEFAULT_INGESTION_DRIVER = process.env.INGESTION_DEFAULT_DRIVER ?? "static";

const ALLOWED_TEMPLATE_FAMILIES = new Set<MetadataEndpointTemplateFamily>(["JDBC", "HTTP", "STREAM"]);

function firstRepoSlug(params: Record<string, unknown> | null | undefined): string | null {
  if (!params) return null;
  const raw = params.repos ?? params.repositories ?? null;
  if (typeof raw === "string") {
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    return parts[0]?.toLowerCase() ?? null;
  }
  if (Array.isArray(raw)) {
    const first = raw.find((v) => typeof v === "string" && v.trim().length > 0);
    return first ? first.toLowerCase() : null;
  }
  return null;
}

function sanitizeDatasetSlug(id: string | null): string | null {
  if (!id) return null;
  return id.replace(/^cdm\./i, "").replace(/[.:/]/g, "_").trim();
}

function normalizeTemplateFamily(family: string | undefined | null): MetadataEndpointTemplateFamily {
  if (!family) {
    return "HTTP";
  }
  const upper = family.toUpperCase() as MetadataEndpointTemplateFamily;
  return ALLOWED_TEMPLATE_FAMILIES.has(upper) ? upper : "HTTP";
}

const FIELD_VALUE_TYPE_MAP: Record<string, MetadataEndpointFieldValueType> = {
  string: "TEXT",
  text: "TEXT",
  password: "PASSWORD",
  secret: "PASSWORD",
  number: "NUMBER",
  numeric: "NUMBER",
  float: "NUMBER",
  double: "NUMBER",
  integer: "INTEGER",
  int: "INTEGER",
  boolean: "BOOLEAN",
  bool: "BOOLEAN",
  url: "URL",
  uri: "URL",
  host: "HOSTNAME",
  hostname: "HOSTNAME",
  port: "PORT",
  json: "JSON",
  enum: "ENUM",
  list: "LIST",
  array: "LIST",
};

const ALLOWED_FIELD_VALUE_TYPES = new Set<MetadataEndpointFieldValueType>([
  "STRING",
  "PASSWORD",
  "NUMBER",
  "INTEGER",
  "BOOLEAN",
  "URL",
  "HOSTNAME",
  "PORT",
  "JSON",
  "ENUM",
  "LIST",
  "TEXT",
]);

function normalizeFieldValueType(raw: string | null | undefined): MetadataEndpointFieldValueType {
  if (!raw) {
    return "TEXT";
  }
  const normalized = raw.trim().toLowerCase();
  const mapped = FIELD_VALUE_TYPE_MAP[normalized];
  if (mapped) {
    return mapped;
  }
  const upper = normalized.toUpperCase() as MetadataEndpointFieldValueType;
  return ALLOWED_FIELD_VALUE_TYPES.has(upper) ? upper : "TEXT";
}

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
  loadStagedRecords(input: { path: string; stagingProviderId?: string | null }): Promise<unknown[]>;
  listVectorProfilesByFamily(input: { family: string | null }): Promise<Array<{ id: string; family: string }>>;
  registerMaterializedArtifact(input: {
    runId: string;
    artifactKind: string;
    datasetId?: string | null;
    datasetSlug?: string | null;
    datasetPrefix?: string | null;
    bucket?: string | null;
    basePrefix?: string | null;
    sinkId?: string | null;
    sinkEndpointId?: string | null;
    sourceFamily?: string | null;
    tenantId?: string | null;
    endpointId?: string | null;
    unitId?: string | null;
  }): Promise<{ id: string; status: string }>;
  startVectorIndexing(input: {
    materializedArtifactId: string;
  }): Promise<{ status: string; runId: string; counters: Record<string, unknown> }>;
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
  sinkEndpointId?: string | null;
  stagingProviderId?: string | null;
  tenantId?: string | null;
  datasetId?: string | null;
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
  dataMode: string | null;
  sinkEndpointId: string | null;
  sinkEndpointConfig: Record<string, unknown> | null;
  sinkEndpointTemplateId: string | null;
  cdmModelId: string | null;
  filter: Record<string, unknown> | null;
  transientState: Record<string, unknown> | null;
  transientStateVersion: string | null;
  sourceFamily: string | null;
  datasetSlug: string | null;
  datasetPrefix: string | null;
  bucket: string | null;
  basePrefix: string | null;
  datasetId: string | null;
  tenantId: string | null;
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
  transientStateVersion: string | null;
  newTransientState: Record<string, unknown> | null;
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
  records?: NormalizedRecordInput[] | null;
  staging?: Array<{ path: string; providerId?: string | null }>;
  stats?: Record<string, unknown> | null;
  sinkEndpointId?: string | null;
  dataMode?: string | null;
  cdmModelId?: string | null;
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
    const { listEndpointTemplates: grpcListTemplates } = await import("./ucl-client.js");
    const grpcTemplates = await grpcListTemplates(family);
    // Transform gRPC types to app types
    return grpcTemplates.map((t) => ({
      id: t.id,
      family: normalizeTemplateFamily(t.family),
      title: t.displayName,
      vendor: t.vendor,
      description: t.description ?? null,
      domain: null,
      categories: t.categories ?? [],
      protocols: [],
      versions: [],
      defaultPort: null,
      driver: null,
      docsUrl: null,
      agentPrompt: null,
      defaultLabels: Array.isArray(t.defaultLabels) ? t.defaultLabels : [],
      fields: t.fields.map((f) => ({
        key: f.name,
        label: f.label,
        valueType: normalizeFieldValueType(f.type),
        required: f.required,
        description: f.description ?? null,
        defaultValue: f.defaultValue ?? null,
        options: f.options?.map((o) => ({ label: o, value: o })),
      })),
      capabilities: [],
      probing: null,
    })) as EndpointTemplate[];
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
    // UCL gRPC service only
    const { buildEndpointConfig: grpcBuildConfig } = await import("./ucl-client.js");
    const result = await grpcBuildConfig(templateId, parameters ?? {}, extras?.labels);
    if (!result.success) {
      throw new Error(result.error ?? "Failed to build config");
    }
    // Transform gRPC types to app types
    const resolvedUrl =
      result.connectionUrl ||
      (parameters?.base_url as string | undefined) ||
      (parameters?.baseUrl as string | undefined) ||
      "";
    const payload: EndpointBuildResult = {
      url: resolvedUrl,
      config: result.config as Record<string, unknown>,
      labels: extras?.labels ?? [],
    };
    return payload;
  },
  async testEndpointConnection({ templateId, parameters }: { templateId: string; parameters: Record<string, string> }) {
    const startedAt = Date.now();
    emitProbeEvent("endpoint_probe_started", { templateId, parameterKeys: Object.keys(parameters ?? {}) });
    try {
      // UCL gRPC service only
      const { testEndpointConnection: grpcTestConnection } = await import("./ucl-client.js");
      const result = await grpcTestConnection(templateId, parameters ?? {});
      const latencyMs = Date.now() - startedAt;
      // Transform gRPC types to app types
      const testResult: EndpointTestResult = {
        success: result.success,
        message: result.message ?? null,
        detectedVersion: null,
        capabilities: [],
      };
      // CODEX FIX: Emit failure event when success=false
      if (result.success) {
        emitProbeEvent("endpoint_probe_success", {
          templateId,
          detectedVersion: null,
          capabilities: [],
          latencyMs,
        });
      } else {
        emitProbeEvent("endpoint_probe_failed", {
          templateId,
          error: result.error ?? result.message ?? "Connection test failed",
          latencyMs,
        }, "error");
      }
      emitProbeEvent("metadata.endpoint.test.latency_ms", { templateId, latencyMs });
      return testResult;
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
  async startIngestionRun({
    endpointId,
    unitId,
    sinkId,
    sinkEndpointId: sinkEndpointIdInput,
    stagingProviderId: stagingProviderIdInput,
    tenantId: tenantInput,
    datasetId: datasetInput,
  }: StartIngestionRunInput): Promise<StartIngestionRunResult> {
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
    const endpointConfig = normalizeRecordPayload(endpoint.config);
    const templateId = typeof endpointConfig.templateId === "string" ? endpointConfig.templateId : null;
    const resolvedSinkId = resolveSinkId(config?.sinkId ?? sinkId, templateId, unitId);
    const vendorKey = endpoint.domain ?? endpoint.sourceId ?? endpoint.id ?? endpointId;
    const stagingProviderId = stagingProviderIdInput ?? resolveStagingProvider(endpoint);
    const policyOverrides =
      config?.policy && typeof config.policy === "object" ? (config.policy as Record<string, unknown>) : null;
    let policy = mergeIngestionPolicies(resolveIngestionPolicy(endpoint), policyOverrides);
    const sinkEndpointId = sinkEndpointIdInput ?? config?.sinkEndpointId ?? null;
    const sinkEndpoint = sinkEndpointId ? endpoints.find((entry) => entry.id === sinkEndpointId) ?? null : null;
    const dataMode = typeof config?.mode === "string" ? config.mode : null;
    const sourceFamily = endpoint.domain ?? templateId ?? null;
    const tenantId = tenantInput ?? process.env.TENANT_ID ?? "default";
    const endpointParameters = isRecord(endpointConfig.parameters)
      ? (endpointConfig.parameters as Record<string, unknown>)
      : null;
    const flatEndpointConfig = isRecord(endpointConfig) ? (endpointConfig as Record<string, unknown>) : null;
    const policyParameters = isRecord((policy ?? {}).parameters)
      ? ((policy as Record<string, unknown>).parameters as Record<string, unknown>)
      : null;
    const mergedParams = {
      ...(flatEndpointConfig ?? {}),
      ...(endpointParameters ?? {}),
      ...(policyParameters ?? {}),
    };
    if (Object.keys(mergedParams).length > 0) {
      policy = {
        ...(policy ?? {}),
        parameters: mergedParams,
      };
      if (process.env.METADATA_AUTH_DEBUG === "1") {
        console.info("[ingestion.params.merge]", {
          endpointId,
          unitId,
          keys: Object.keys(mergedParams),
          tokenLength: typeof mergedParams.token === "string" ? mergedParams.token.length : null,
        });
      }
    }
    let datasetId = (config as any)?.datasetId ?? datasetInput ?? unitId ?? null;
    let datasetSlug = (config as any)?.datasetSlug ?? datasetInput ?? unitId ?? null;
    const sinkCfg = sinkEndpoint?.config && typeof sinkEndpoint.config === "object" ? (sinkEndpoint.config as Record<string, unknown>) : {};
    const bucket = (config as any)?.bucket ?? (sinkCfg as any)?.bucket ?? null;
    const basePrefix = (config as any)?.basePrefix ?? (sinkCfg as any)?.basePrefix ?? "sink";
    const rawRepo =
      endpoint && endpoint.config && typeof (endpoint as any).config.repos === "string"
        ? ((endpoint as any).config.repos as string)
        : null;
    const repoSlugFromConfig =
      firstRepoSlug(isRecord(endpointConfig.parameters) ? (endpointConfig.parameters as Record<string, unknown>) : null) ??
      firstRepoSlug(endpointConfig as Record<string, unknown>);
    const repoSlug =
      firstRepoSlug(
        normalizeRecordPayload((policy ?? {}).parameters ?? endpointConfig.parameters ?? {}) as Record<string, unknown>,
      ) ?? null;
    const repoCandidate =
      repoSlug ??
      repoSlugFromConfig ??
      firstRepoSlug(endpointParameters) ??
      firstRepoSlug(policyParameters) ??
      (rawRepo ? firstRepoSlug({ repos: rawRepo }) : null) ??
      null;
    if ((templateId === "http.github" || sourceFamily === "code.github") && repoCandidate && (datasetId === null || datasetId === unitId)) {
      datasetId = `${unitId}:${tenantId}:${repoCandidate}`;
    }
    if ((templateId === "http.github" || sourceFamily === "code.github") && repoCandidate && (!datasetSlug || datasetSlug === unitId)) {
      datasetSlug = sanitizeDatasetSlug(datasetId) ?? sanitizeDatasetSlug(datasetSlug) ?? datasetSlug;
    } else {
      datasetSlug = sanitizeDatasetSlug(datasetSlug) ?? datasetSlug;
    }
    if (process.env.METADATA_AUTH_DEBUG === "1") {
      console.info("[ingestion.start]", {
        endpointId,
        unitId,
        datasetId,
        datasetSlug,
        repoSlug,
      });
    }
    const datasetPrefix =
      bucket && datasetSlug ? `minio://${bucket}/${trimSlashes([basePrefix, tenantId, datasetSlug].join("/"))}` : (config as any)?.datasetPrefix ?? null;
    if (process.env.METADATA_AUTH_DEBUG === "1") {
      console.info("[ingestion.policy]", {
        endpointId,
        unitId,
        templateId,
        policy,
      });
    }
    if (templateId === "http.onedrive") {
      const policyParameters = normalizeRecordPayload((policy ?? {}).parameters ?? endpointConfig.parameters ?? {});
      const authMode = resolveOneDriveAuthMode(policyParameters);
      policyParameters.auth_mode = authMode;
      if (authMode === "delegated") {
        const delegatedToken = await getOneDriveDelegatedToken(endpointId);
        if (delegatedToken?.access_token) {
          policyParameters.access_token = delegatedToken.access_token;
          policyParameters.delegated_connected = true;
        }
      }
      policy = { ...(policy ?? {}), parameters: { ...policyParameters } };
    }
    const cdmModelId = await resolveCdmModelIdForUnit(endpoint, endpointId, unitId);
    const checkpointKey: IngestionCheckpointKey = {
      endpointId,
      unitId,
      sinkId: resolvedSinkId,
      vendor: vendorKey,
    };
    const checkpointState = await readCheckpoint(checkpointKey);
    console.log("[checkpoint-debug] readCheckpoint result:", {
      key: checkpointKey,
      hasCheckpoint: checkpointState.checkpoint != null,
      checkpointKeys: checkpointState.checkpoint ? Object.keys(checkpointState.checkpoint) : [],
      version: checkpointState.version,
    });
    const transientState = await readTransientState({ endpointId, unitId, sinkId: resolvedSinkId });
    const filterConfig =
      config?.filter && typeof config.filter === "object" ? (config.filter as Record<string, unknown>) : null;
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
      dataMode: dataMode ?? null,
      sinkEndpointId,
      sinkEndpointConfig: sinkEndpoint?.config && typeof sinkEndpoint.config === "object" ? (sinkEndpoint.config as Record<string, unknown>) : null,
      sinkEndpointTemplateId: sinkEndpoint?.domain ?? sinkEndpoint?.sourceId ?? null,
      cdmModelId,
      filter: filterConfig,
      transientState: transientState.state,
      transientStateVersion: transientState.version,
      sourceFamily,
      datasetSlug,
      datasetPrefix,
      bucket,
      basePrefix,
      datasetId,
      tenantId,
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
    transientStateVersion,
    newTransientState,
  }: CompleteIngestionRunInput): Promise<void> {
    const checkpointKey = buildCheckpointKey({ endpointId, unitId, sinkId, vendorKey });
    
    // CHECKPOINT ARCHITECTURE FIX (UAT):
    // Store checkpoint in flat structure with watermark at top level.
    // Go returns: { watermark: "ISO_TIMESTAMP", cursorField: "updatedAt", ... }
    // We store: { watermark: "ISO_TIMESTAMP", recordCount, dataMode, ... } - NO nested cursor objects.
    const cpData = newCheckpoint && typeof newCheckpoint === "object" ? (newCheckpoint as Record<string, unknown>) : {};
    
    // Extract watermark from multiple possible sources (in priority order):
    // 1. Top-level watermark (preferred - from Go)
    // 2. Top-level cursor if it's a string (legacy scalar format)  
    // 3. Nested cursor.watermark (legacy nested format - needs flattening)
    // 4. Nested cursor.cursor if string (deeply nested legacy)
    let watermark: string | null = null;
    if (typeof cpData.watermark === "string" && cpData.watermark) {
      watermark = cpData.watermark;
    } else if (typeof cpData.cursor === "string" && cpData.cursor) {
      watermark = cpData.cursor;
    } else if (cpData.cursor && typeof cpData.cursor === "object") {
      // Legacy nested cursor object - extract watermark from inside
      const nestedCursor = cpData.cursor as Record<string, unknown>;
      if (typeof nestedCursor.watermark === "string" && nestedCursor.watermark) {
        watermark = nestedCursor.watermark;
      } else if (typeof nestedCursor.cursor === "string" && nestedCursor.cursor) {
        watermark = nestedCursor.cursor;
      }
    }
    
    // Extract cursorField (tells us which field was used for incremental - e.g., "updatedAt")
    const cursorField = typeof cpData.cursorField === "string" ? cpData.cursorField : null;
    
    // CHECKPOINT HISTORY: Track version for future history archival
    const existingVersion = typeof checkpointVersion === "string" ? parseInt(checkpointVersion, 10) || 0 : 0;
    const newVersion = existingVersion + 1;

    // Build flat checkpoint record - NO nested cursor objects
    const record: IngestionCheckpointRecord = {
      // Primary fields for incremental ingestion
      watermark,  // High-water-mark timestamp for incremental
      cursor: watermark,  // Keep for backward compat - same as watermark (scalar only)
      
      // Metadata (flat, at top level)
      lastRunId: runId,
      lastUpdatedAt: new Date().toISOString(),
      stats,
      metadata: {
        cursorField,  // Which field was used (e.g., "updatedAt")
        recordCount: typeof cpData.recordCount === "number" ? cpData.recordCount : 0,
        dataMode: typeof cpData.dataMode === "string" ? cpData.dataMode : null,
        version: newVersion,
        lastRunAt: typeof cpData.lastRunAt === "string" ? cpData.lastRunAt : new Date().toISOString(),
      },
    };
    await writeCheckpoint(checkpointKey, record, {
      expectedVersion: checkpointVersion ?? undefined,
    });
    if (newTransientState !== undefined) {
      await writeTransientState(
        { endpointId, unitId, sinkId },
        newTransientState,
        { expectedVersion: transientStateVersion ?? undefined },
      ).catch((error) => {
        // transient state conflicts should surface as warnings but not fail the run
        console.warn(
          "[ingestion:transient-state] failed to persist transient state",
          error instanceof Error ? error.message : error,
        );
      });
    }
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
  staging,
  stats,
  sinkEndpointId,
  dataMode,
  cdmModelId,
  }: PersistIngestionBatchesInput): Promise<void> {
    const workingRecords: NormalizedRecordInput[] = Array.isArray(records) ? [...records] : [];
    if (workingRecords.length === 0 && Array.isArray(staging) && staging.length > 0) {
      for (const handle of staging) {
        const loaded = await loadRecordsFromHandle(handle, { endpointId, unitId });
        if (loaded.length > 0) {
          workingRecords.push(...loaded);
        }
      }
    }
    if (workingRecords.length === 0) {
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
      sinkEndpointId: sinkEndpointId ?? null,
      dataMode: dataMode ?? null,
      cdmModelId: cdmModelId ?? null,
    };
    await sink.begin(context);
    const grouped = groupRecordsByCdmModel(workingRecords, context.cdmModelId ?? null);
    for (const group of grouped) {
      const groupContext: IngestionSinkContext = {
        ...context,
        cdmModelId: group.modelId ?? context.cdmModelId ?? null,
      };
      await sink.writeBatch({ records: group.records }, groupContext);
    }
    if (sink.commit) {
      await sink.commit(context, stats ?? null);
    }
  },
  async loadStagedRecords({
    path: filePath,
    stagingProviderId,
  }: {
    path: string;
    stagingProviderId?: string | null;
  }): Promise<unknown[]> {
    if (!stagingProviderId) {
      throw new Error("stagingProviderId is required when loading staged records");
    }
    const loader = STAGING_LOADERS[stagingProviderId];
    if (!loader) {
      throw new Error(`Unsupported staging provider '${stagingProviderId}'`);
    }
    try {
      const content = await loader(filePath);
      return Array.isArray(content) ? content : [];
    } finally {
      await deleteTempFile(filePath).catch(() => {});
    }
  },
  async listVectorProfilesByFamily({ family }: { family: string | null }) {
    if (!family) {
      return [];
    }
    const prisma = await getPrismaClient();
    const rows = await prisma.vectorIndexProfile.findMany({
      where: { family: family.split(".")[0] },
      select: { id: true, family: true },
    });
    return rows;
  },
  async registerMaterializedArtifact(args) {
    const prisma = await getPrismaClient();
    const { PrismaMaterializedRegistry, buildMaterializedMetadata } = await import("../brain/materializedRegistry.js");
    const registry = new PrismaMaterializedRegistry(async () => prisma);
    const tenantId = args.tenantId ?? process.env.TENANT_ID ?? null;
    if (!tenantId) {
      throw new Error("tenantId is required to register materialized artifacts");
    }
    const artifactKind = args.artifactKind ?? args.datasetSlug ?? "unknown";
    const handleUri =
      args.datasetPrefix ??
      (args.bucket && args.basePrefix && args.datasetSlug
        ? `minio://${args.bucket}/${trimSlashes([args.basePrefix, tenantId, args.datasetSlug].join("/"))}`
        : null);
    if (!handleUri) {
      throw new Error("datasetPrefix or bucket/basePrefix/datasetSlug is required to build registry handle");
    }
    let datasetRecord: Record<string, unknown> | null = null;
    if (args.datasetId) {
      try {
        const store = await getMetadataStore();
        datasetRecord = await store.getRecord(CATALOG_DATASET_DOMAIN, args.datasetId);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[registry] failed to fetch dataset metadata", error);
      }
    }
    const { canonicalMeta, sourceMeta } = buildMaterializedMetadata({
      artifactKind,
      sourceFamily: args.sourceFamily ?? null,
      datasetId: args.datasetId ?? null,
      datasetSlug: args.datasetSlug ?? null,
      datasetRecord,
    });
    const result = await registry.upsertArtifact({
      tenantId,
      sourceRunId: args.runId,
      artifactKind,
      sourceFamily: args.sourceFamily ?? null,
      sinkEndpointId: args.sinkEndpointId ?? null,
      handle: {
        uri: handleUri,
        bucket: args.bucket ?? null,
        basePrefix: args.basePrefix ?? null,
        datasetSlug: args.datasetSlug ?? null,
        sinkId: args.sinkId ?? null,
        runId: args.runId,
        tenantId,
      },
      canonicalMeta,
      sourceMeta,
    });
    return { id: result.id, status: result.status };
  },
  async startVectorIndexing(args) {
    // TS indexer is deprecated; return a stub response so callers do not fail while Go indexer takes over.
    return {
      status: "SKIPPED",
      runId: args?.materializedArtifactId ?? null,
      counters: null,
    };
  },
};

async function resolveCdmModelIdForUnit(
  endpoint: MetadataEndpointDescriptor,
  endpointId: string,
  unitId: string,
): Promise<string | null> {
  const driverId = resolveEndpointDriverId(endpoint) ?? DEFAULT_INGESTION_DRIVER;
  const driver = getIngestionDriver(driverId);
  if (!driver || typeof driver.listUnits !== "function") {
    return null;
  }
  try {
    const units = await driver.listUnits(endpointId);
    const match = units.find((unit) => unit.unitId === unitId);
    return match?.cdmModelId ?? null;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("Failed to resolve cdmModelId for ingestion unit", { endpointId, unitId, error });
    return null;
  }
}

function resolveSchemas(run: any): string[] {
  const filterSchemas = run.filters?.schemas;
  if (Array.isArray(filterSchemas) && filterSchemas.length > 0) {
    return normalizeSchemas(filterSchemas);
  }
  const endpointSchemas =
    run.endpoint.config?.schemas || run.endpoint.config?.parameters?.schemas?.split(",");
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

const STAGING_LOADERS: Record<string, (path: string) => Promise<unknown>> = {
  file: readJsonMaybeJsonLines,
  in_memory: readJsonMaybeJsonLines,
  object: readJsonMaybeJsonLines, // object-store provider writes to local disk in dev
  "object.minio": readJsonMaybeJsonLines,
};

async function readJsonMaybeJsonLines(filePath: string): Promise<unknown> {
  const rawBuffer = Buffer.from(await fs.readFile(filePath)) as Buffer;
  let buf = rawBuffer;
  if (filePath.endsWith(".gz")) {
    const { gunzip } = await import("node:zlib");
    buf = await new Promise<Buffer>((resolve, reject) =>
      gunzip(rawBuffer as any, (err, output) => (err ? reject(err) : resolve(output as Buffer))),
    );
  }
  const text = buf.toString("utf-8").trim();
  if (!text) {
    return [];
  }
  // Try JSON array/object first
  try {
    return JSON.parse(text);
  } catch {
    // Fallback to JSONL
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    return lines.map((line) => JSON.parse(line));
  }
}

async function loadRecordsFromHandle(
  handle: { path: string; providerId?: string | null },
  context: { endpointId: string; unitId: string }
): Promise<NormalizedRecordInput[]> {
  if (!handle?.path) {
    return [];
  }
  if (!handle.providerId) {
    throw new Error("stagingProviderId is required when loading staged handle");
  }
  const loader = STAGING_LOADERS[handle.providerId];
  if (!loader) {
    throw new Error(`Unsupported staging provider '${handle.providerId}'`);
  }
  try {
    const content = await loader(handle.path);
    if (Array.isArray(content)) {
      return normalizeLoadedRecords(content, context);
    }
    return [];
  } finally {
    await deleteTempFile(handle.path).catch(() => {});
  }
}

function normalizeLoadedRecords(
  records: unknown[],
  context: { endpointId: string; unitId: string }
): NormalizedRecordInput[] {
  return records.map((rec, idx) => {
    if (rec && typeof rec === "object" && "entityType" in (rec as Record<string, unknown>)) {
      return rec as NormalizedRecordInput;
    }
    const raw = (rec as Record<string, unknown>) ?? {};
    const entityType =
      (typeof raw._entity === "string" && raw._entity) ||
      (typeof raw._datasetType === "string" && raw._datasetType) ||
      context.unitId;
    const logicalId =
      (typeof raw._externalId === "string" && raw._externalId) ||
      (typeof raw.sha === "string" && raw.sha) ||
      (typeof raw.issueId === "string" && raw.issueId) ||
      (typeof raw.number === "number" && String(raw.number)) ||
      `${context.unitId}:${idx}`;
    const displayName =
      (typeof raw.title === "string" && raw.title) ||
      (typeof raw.path === "string" && raw.path) ||
      logicalId;
    return {
      entityType,
      logicalId,
      displayName,
      scope: {
        orgId: "default",
      },
      provenance: {
        endpointId: context.endpointId,
        vendor: context.endpointId,
      },
      payload: raw,
    };
  });
}

function groupRecordsByCdmModel(
  records: NormalizedRecord[],
  defaultModelId: string | null,
): Array<{ modelId: string | null; records: NormalizedRecord[] }> {
  if (records.length === 0) {
    return [];
  }
  const groups = new Map<string, { modelId: string | null; records: NormalizedRecord[] }>();
  const pickKey = (modelId: string | null) => (modelId ?? "__default__");
  const normalizedDefault = defaultModelId ?? null;
  for (const record of records) {
    const candidate = (record as unknown as { cdmModelId?: string | null }).cdmModelId;
    const modelId = typeof candidate === "string" && candidate.length > 0 ? candidate : normalizedDefault;
    const key = pickKey(modelId);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.records.push(record);
    } else {
      groups.set(key, { modelId, records: [record] });
    }
  }
  if (groups.size === 0) {
    return [{ modelId: normalizedDefault, records }];
  }
  return Array.from(groups.values());
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

function trimSlashes(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
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

function resolveSinkId(candidate: string | null | undefined, templateId: string | null, unitId: string): string {
  if (candidate && candidate.trim().length > 0) {
    return candidate.trim();
  }
  // Default mapping: GitHub code units -> minio, semantic -> cdm
  const lowerTemplate = (templateId ?? "").toLowerCase();
  const lowerUnit = unitId.toLowerCase();
  if (lowerTemplate.startsWith("http.github")) {
    return "minio";
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

function resolveOneDriveAuthMode(parameters?: Record<string, unknown> | null): string {
  const authBlock =
    parameters && typeof parameters.auth === "object" && parameters.auth !== null
      ? (parameters.auth as Record<string, unknown>)
      : null;
  const raw =
    (parameters?.auth_mode as string | undefined) ??
    (parameters?.authMode as string | undefined) ??
    (authBlock?.mode as string | undefined);
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim().toLowerCase();
  }
  return "stub";
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
  if (!base && !overrides) {
    return null;
  }
  const merged: Record<string, unknown> = { ...(base ?? {}) };
  if (overrides) {
    Object.assign(merged, overrides);
  }
  const baseParams = isRecord(base?.parameters) ? (base?.parameters as Record<string, unknown>) : null;
  const overrideParams = isRecord(overrides?.parameters) ? (overrides?.parameters as Record<string, unknown>) : null;
  if (baseParams || overrideParams) {
    merged.parameters = { ...(baseParams ?? {}), ...(overrideParams ?? {}) };
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  if (datasetIdentity) {
    await upsertJdbcRelations(graphStore, datasetIdentity, payload, context);
  }
}

function normalizeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
