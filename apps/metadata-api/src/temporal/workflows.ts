import { proxyActivities, workflowInfo, log, ApplicationFailure, startChild } from "@temporalio/workflow";
import type { CatalogRecordInput, CollectionJobRequest, MetadataActivities } from "./activities.js";

export const WORKFLOW_NAMES = {
  collectionRun: "collectionRunWorkflow",
  listEndpointTemplates: "listEndpointTemplatesWorkflow",
  buildEndpointConfig: "buildEndpointConfigWorkflow",
  testEndpointConnection: "testEndpointConnectionWorkflow",
  previewDataset: "previewDatasetWorkflow",
  ingestionRun: "ingestionRunWorkflow",
  postIngestion: "postIngestionWorkflow",
} as const;

const {
  createCollectionRun,
  markRunStarted,
  markRunCompleted,
  markRunSkipped,
  markRunFailed,
  prepareCollectionJob,
  persistCatalogRecords,
  listEndpointTemplates: listEndpointTemplatesActivity,
  buildEndpointConfig: buildEndpointConfigActivity,
  testEndpointConnection: testEndpointConnectionActivity,
  startIngestionRun: startIngestionRunActivity,
  completeIngestionRun: completeIngestionRunActivity,
  failIngestionRun: failIngestionRunActivity,
  persistIngestionBatches: persistIngestionBatchesActivity,
  loadStagedRecords: loadStagedRecordsActivity,
  listVectorProfilesByFamily: listVectorProfilesByFamilyActivity,
  registerMaterializedArtifact: registerMaterializedArtifactActivity,
  startVectorIndexing: startVectorIndexingActivity,
} = proxyActivities<MetadataActivities>({
  startToCloseTimeout: "1 hour",
  retry: { maximumAttempts: 3 },
});

type CollectionJobResult = {
  records?: CatalogRecordInput[];
  recordsPath?: string;
  recordCount?: number;
  logs?: Array<Record<string, unknown>>;
};

type PythonMetadataActivities = {
  collectCatalogSnapshots(request: CollectionJobRequest): Promise<CollectionJobResult>;
  previewDataset(input: {
    datasetId: string;
    schema: string;
    table: string;
    limit?: number;
    connectionUrl: string;
    templateId: string;
    parameters: Record<string, unknown>;
    endpointId: string;
    unitId: string;
  }): Promise<{ rows: unknown[]; sampledAt: string; recordsPath?: string | null; stagingProviderId?: string | null }>;
  planIngestionUnit(input: PythonIngestionRequest): Promise<{
    slices?: Array<Record<string, unknown>>;
    plan_metadata?: Record<string, unknown>;
    strategy?: string | null;
  }>;
  runIngestionUnit(input: PythonIngestionRequest): Promise<PythonIngestionResult>;
};

const PYTHON_ACTIVITY_TASK_QUEUE = "metadata-python";
// Workflow sandbox does not expose process.env; use constants wired by worker env vars via activities if needed.
const GO_INGESTION_TASK_QUEUE = "metadata-go";
const GO_BRAIN_TASK_QUEUE = "brain-go";
const DEFAULT_STAGING_PROVIDER = "object.minio";

const pythonActivities = proxyActivities<PythonMetadataActivities>({
  taskQueue: PYTHON_ACTIVITY_TASK_QUEUE,
  scheduleToCloseTimeout: "2 hours",
  retry: { maximumAttempts: 3 },
});

type GoIngestionActivities = {
  CollectCatalogSnapshots(request: CollectionJobRequest): Promise<CollectionJobResult>;
  PreviewDataset(input: {
    datasetId: string;
    schema: string;
    table: string;
    limit?: number;
    connectionUrl: string;
    templateId: string;
    parameters: Record<string, unknown>;
    endpointId: string;
    unitId: string;
    stagingProviderId?: string | null;
  }): Promise<{ rows: unknown[]; sampledAt: string; recordsPath?: string | null; stagingProviderId?: string | null }>;
  PlanIngestionUnit(input: PythonIngestionRequest): Promise<{
    slices?: Array<Record<string, unknown>>;
    plan_metadata?: Record<string, unknown>;
    strategy?: string | null;
  }>;
  RunIngestionUnit(input: PythonIngestionRequest): Promise<PythonIngestionResult>;
  SinkRunner(input: {
    sinkEndpointId: string;
    endpointConfig?: Record<string, unknown> | null;
    datasetId: string;
    records?: Array<Record<string, unknown>>;
    stageRef?: string | null;
    batchRefs?: string[];
    stagingProviderId?: string | null;
    schema?: Record<string, unknown> | null;
    loadDate?: string | null;
    mode?: string | null;
  }): Promise<{ rowsWritten: number | null; path?: string | null }>;
};

type GoBrainActivities = {
  IndexArtifact(input: {
    artifactId: string;
    datasetSlug: string;
    sinkEndpointId: string;
    endpointConfig?: Record<string, unknown> | null;
    runId?: string | null;
    tenantId?: string | null;
    projectId?: string | null;
    bucket?: string | null;
    basePrefix?: string | null;
    cdmModelId?: string | null;
    sourceFamily?: string | null;
    checkpoint?: Record<string, unknown> | null;
    stageRef?: string | null;
    batchRefs?: string[];
    stagingProviderId?: string | null;
  }): Promise<{ status: string; recordsIndexed: number; checkpoint?: Record<string, unknown> | null }>;
  ExtractSignals(input: {
    artifactId: string;
    sinkEndpointId: string;
    datasetSlug: string;
    sourceFamily?: string | null;
    tenantId?: string | null;
    stageRef?: string | null;
    batchRefs?: string[];
    stagingProviderId?: string | null;
    checkpoint?: Record<string, unknown> | null;
  }): Promise<void>;
  BuildClusters(input: {
    artifactId: string;
    sinkEndpointId: string;
    datasetSlug: string;
    sourceFamily?: string | null;
    tenantId?: string | null;
    stageRef?: string | null;
    batchRefs?: string[];
    stagingProviderId?: string | null;
  }): Promise<void>;
  ExtractInsights(input: {
    artifactId: string;
    sinkEndpointId: string;
    datasetSlug: string;
    sourceFamily?: string | null;
    tenantId?: string | null;
    endpointConfig?: Record<string, unknown> | null;
    stageRef?: string | null;
    batchRefs?: string[];
    stagingProviderId?: string | null;
    checkpoint?: Record<string, unknown> | null;
  }): Promise<void>;
};

const goIngestionActivities = proxyActivities<GoIngestionActivities>({
  taskQueue: GO_INGESTION_TASK_QUEUE,
  scheduleToCloseTimeout: "2 hours",
  retry: { maximumAttempts: 3 },
});

const goBrainActivities = proxyActivities<GoBrainActivities>({
  taskQueue: GO_BRAIN_TASK_QUEUE,
  scheduleToCloseTimeout: "2 hours",
  retry: { maximumAttempts: 3 },
});

// Shadow/feature flags (process.env is not available in workflow sandbox)
const GO_SHADOW_MODE = false;
const USE_GO_WORKER = true;

// Map a dataset/model id into a sink-friendly identifier (table/prefix).
function deriveSinkDatasetId(options: {
  cdmModelId?: string | null;
  datasetId?: string | null;
  datasetSlug?: string | null;
  unitId: string;
}): string {
  const candidates = [
    options.cdmModelId,
    options.datasetId,
    options.datasetSlug,
    options.unitId,
  ].filter((v): v is string => Boolean(v && v.trim().length > 0));
  const raw = candidates[0] ?? options.unitId;
  return raw
    .replace(/^cdm\./i, "")
    .replace(/\./g, "_")
    .replace(/:/g, "_")
    .replace(/\//g, "_")
    .trim();
}

// Unified ingestion activities - switches based on feature flag
const ingestionActivities = USE_GO_WORKER
  ? {
      collectCatalogSnapshots: goIngestionActivities.CollectCatalogSnapshots,
      previewDataset: goIngestionActivities.PreviewDataset,
      planIngestionUnit: goIngestionActivities.PlanIngestionUnit,
      runIngestionUnit: goIngestionActivities.RunIngestionUnit,
    }
  : {
      collectCatalogSnapshots: pythonActivities.collectCatalogSnapshots,
      previewDataset: pythonActivities.previewDataset,
      planIngestionUnit: pythonActivities.planIngestionUnit,
      runIngestionUnit: pythonActivities.runIngestionUnit,
    };

// Helper to run shadow comparison without blocking main flow
async function runGoShadow<T>(
  activityName: string,
  goFn: () => Promise<T>,
  pyStats?: Record<string, unknown> | null
): Promise<void> {
  if (!GO_SHADOW_MODE) return;
  try {
    const goResult = await goFn();
    log.info("shadow-compare", {
      activity: activityName,
      pyStats: pyStats ?? null,
      goResult: goResult ?? null,
    });
  } catch (error) {
    log.warn("shadow-go-error", {
      activity: activityName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function triggerVectorIndexingIfConfigured(args: {
  runId: string;
  sinkId: string;
  tenantId: string | null;
  sourceFamily: string | null;
  sinkEndpointId?: string | null;
  sinkEndpointConfig?: Record<string, unknown> | null;
  datasetSlug: string | null;
  datasetPrefix: string | null;
  bucket: string | null;
  basePrefix: string | null;
  datasetId?: string | null;
  endpointId?: string | null;
  unitId?: string | null;
  artifactId?: string | null;
  stageRef?: string | null;
  batchRefs?: string[] | null;
  stagingProviderId?: string | null;
}) {
  const registryPrefix =
    args.datasetPrefix ??
    (args.bucket && args.basePrefix && args.datasetSlug && args.tenantId
      ? `minio://${args.bucket}/${trimSlashes([args.basePrefix, args.tenantId, args.datasetSlug].join("/"))}`
      : null);
  if (!registryPrefix) return;
  const profileFamily = args.sourceFamily?.split(".")[0] ?? args.sourceFamily;
  const profiles = await listVectorProfilesByFamilyActivity({ family: profileFamily });
  if (!profiles.length) {
    log.info("vector-indexing-skip", { reason: "no profiles for family", sourceFamily: args.sourceFamily });
    return;
  }
  const artifactKind = args.datasetSlug ?? args.sourceFamily ?? "unknown";
  try {
    const reg = await registerMaterializedArtifactActivity({
      runId: args.runId,
      artifactKind,
      datasetId: args.datasetId ?? null,
      datasetSlug: args.datasetSlug ?? null,
      datasetPrefix: registryPrefix,
      bucket: args.bucket ?? null,
      basePrefix: args.basePrefix ?? null,
      sinkId: args.sinkId,
      sinkEndpointId: args.sinkEndpointId ?? null,
      sourceFamily: args.sourceFamily ?? null,
      tenantId: args.tenantId,
      endpointId: args.endpointId ?? null,
      unitId: args.unitId ?? null,
    });
    log.info("materialized-artifact-registered", {
      id: reg.id,
      status: reg.status,
      datasetPrefix: registryPrefix,
      artifactKind,
    });
    // Run post-ingestion steps inline (index, insights) to avoid child task failures.
    const artifactId = reg.id;
    if (args.sinkEndpointId) {
      await postIngestionWorkflow({
        runId: args.runId,
        artifactId,
        datasetSlug: args.datasetSlug ?? artifactKind,
        sinkEndpointId: args.sinkEndpointId,
        sinkEndpointConfig: args.sinkEndpointConfig ?? null,
        tenantId: args.tenantId ?? null,
        sourceFamily: args.sourceFamily ?? null,
        bucket: args.bucket ?? null,
        basePrefix: args.basePrefix ?? null,
        stageRef: args.stageRef ?? null,
        batchRefs: args.batchRefs ?? null,
        stagingProviderId: args.stagingProviderId ?? null,
      });
    }
  } catch (error) {
    log.warn("vector-indexing-trigger-failed", {
      datasetPrefix: registryPrefix,
      artifactKind,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Child workflow to run post-ingestion steps (indexing, signals, clustering)
export async function postIngestionWorkflow(args: {
  runId: string;
  artifactId: string;
  datasetSlug: string;
  sinkEndpointId: string;
  sinkEndpointConfig?: Record<string, unknown> | null;
  tenantId?: string | null;
  sourceFamily?: string | null;
  bucket?: string | null;
  basePrefix?: string | null;
  stageRef?: string | null;
  batchRefs?: string[] | null;
  stagingProviderId?: string | null;
}) {
  log.info("post-ingestion-start", {
    artifactId: args.artifactId,
    sinkEndpointId: args.sinkEndpointId,
    datasetSlug: args.datasetSlug,
  });
  try {
    const indexResult = await goBrainActivities.IndexArtifact({
      artifactId: args.artifactId,
      datasetSlug: args.datasetSlug,
      sinkEndpointId: args.sinkEndpointId,
      endpointConfig: args.sinkEndpointConfig ?? undefined,
      runId: args.runId,
      tenantId: args.tenantId ?? undefined,
      bucket: args.bucket ?? null,
      basePrefix: args.basePrefix ?? null,
      sourceFamily: args.sourceFamily ?? null,
      stageRef: args.stageRef ?? null,
      batchRefs: args.batchRefs ?? undefined,
      stagingProviderId: args.stagingProviderId ?? null,
    });
    log.info("post-ingestion-indexed", {
      artifactId: args.artifactId,
      status: indexResult.status,
      recordsIndexed: indexResult.recordsIndexed,
    });
    await goBrainActivities.ExtractInsights({
      artifactId: args.artifactId,
      sinkEndpointId: args.sinkEndpointId,
      datasetSlug: args.datasetSlug,
      sourceFamily: args.sourceFamily ?? null,
      tenantId: args.tenantId ?? null,
      endpointConfig: args.sinkEndpointConfig ?? null,
      stageRef: args.stageRef ?? null,
      batchRefs: args.batchRefs ?? undefined,
      stagingProviderId: args.stagingProviderId ?? null,
    });
  } catch (error) {
    log.warn("post-ingestion-index-failed", {
      artifactId: args.artifactId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  try {
    await goBrainActivities.ExtractSignals({
      artifactId: args.artifactId,
      sinkEndpointId: args.sinkEndpointId,
      datasetSlug: args.datasetSlug,
      sourceFamily: args.sourceFamily ?? null,
      tenantId: args.tenantId ?? null,
      stageRef: args.stageRef ?? null,
      batchRefs: args.batchRefs ?? undefined,
      stagingProviderId: args.stagingProviderId ?? null,
    });
    log.info("post-ingestion-signals-finished", { artifactId: args.artifactId });
  } catch (error) {
    log.warn("post-ingestion-signals-failed", {
      artifactId: args.artifactId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  try {
    await goBrainActivities.BuildClusters({
      artifactId: args.artifactId,
      sinkEndpointId: args.sinkEndpointId,
      datasetSlug: args.datasetSlug,
      sourceFamily: args.sourceFamily ?? null,
      tenantId: args.tenantId ?? null,
      stageRef: args.stageRef ?? null,
      batchRefs: args.batchRefs ?? undefined,
      stagingProviderId: args.stagingProviderId ?? null,
    });
    log.info("post-ingestion-clusters-finished", { artifactId: args.artifactId });
  } catch (error) {
    log.warn("post-ingestion-clusters-failed", {
      artifactId: args.artifactId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

type PythonIngestionRequest = {
  endpointId: string;
  unitId: string;
  sinkId?: string | null;
  checkpoint?: unknown;
  stagingProviderId?: string | null;
  policy?: Record<string, unknown> | null;
  mode?: string | null;
  dataMode?: string | null;
  sinkEndpointId?: string | null;
  cdmModelId?: string | null;
  filter?: Record<string, unknown> | null;
  transientState?: Record<string, unknown> | null;
  transientStateVersion?: string | null;
  slice?: Record<string, unknown> | null;
  slice_index?: number | null;
  sourceFamily?: string | null;
  datasetSlug?: string | null;
  datasetPrefix?: string | null;
  bucket?: string | null;
  basePrefix?: string | null;
};

type PythonIngestionResult = {
  newCheckpoint: unknown;
  stats?: Record<string, unknown> | null;
  records?: NormalizedRecordInput[] | null;
  transientState?: Record<string, unknown> | null;
  stagingPath?: string | null;
  stagingProviderId?: string | null;
  staging?: Array<{ path: string; providerId?: string | null }>;
  stageRef?: string | null;
  batchRefs?: string[];
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
  payload: unknown;
  phase?: string | null;
  edges?: Array<{
    type: string;
    sourceLogicalId: string;
    targetLogicalId: string;
    properties?: Record<string, unknown> | null;
  }>;
};

type CollectionRunWorkflowInput = {
  runId?: string;
  endpointId?: string | null;
  collectionId?: string | null;
};

export async function collectionRunWorkflow(input: CollectionRunWorkflowInput) {
  const info = workflowInfo();
  let runId = input.runId;
  if (!runId) {
    if (!input.endpointId) {
      throw new Error("collectionRunWorkflow requires endpointId when runId is not provided");
    }
    const created = await createCollectionRun({
      endpointId: input.endpointId,
      collectionId: input.collectionId ?? null,
      reason: "schedule",
    });
    runId = created.runId;
  }
  await markRunStarted({
    runId,
    workflowId: info.workflowId,
    temporalRunId: info.runId,
  });

  try {
    const plan = await prepareCollectionJob({ runId });
    if (plan.kind === "skip") {
      log.info("metadata-collection-skip", {
        runId,
        reason: plan.reason,
        capability: plan.capability ?? null,
      });
      await markRunSkipped({ runId, reason: plan.reason });
      return;
    }
    const result = await ingestionActivities.collectCatalogSnapshots(plan.job);
    result?.logs?.forEach((entry: Record<string, unknown>) => {
      log.info("metadata-collection-log", entry);
    });
    await persistCatalogRecords({
      runId,
      records: result?.records,
      recordsPath: result?.recordsPath,
    });
    await markRunCompleted({ runId });
  } catch (error) {
    await markRunFailed({
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function listEndpointTemplatesWorkflow(input: { family?: "JDBC" | "HTTP" | "STREAM" }) {
  return listEndpointTemplatesActivity(input);
}

export async function buildEndpointConfigWorkflow(input: {
  templateId: string;
  parameters: Record<string, string>;
  extras?: { labels?: string[] };
}) {
  return buildEndpointConfigActivity(input);
}

export async function testEndpointConnectionWorkflow(input: { templateId: string; parameters: Record<string, string> }) {
  try {
    return await testEndpointConnectionActivity(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw ApplicationFailure.nonRetryable(message, "EndpointTestFailure");
  }
}

export async function previewDatasetWorkflow(input: {
  datasetId: string;
  endpointId: string;
  unitId: string;
  schema: string;
  table: string;
  limit?: number;
  templateId: string;
  parameters: Record<string, unknown>;
  connectionUrl?: string | null;
}) {
  const normalizedInput = {
    ...input,
    connectionUrl: input.connectionUrl ?? "",
  };
  
  // CODEX FIX: Use unified ingestionActivities interface instead of executeWithOptions
  // executeWithOptions is not a valid method on Temporal activity stubs
  const preview = await ingestionActivities.previewDataset(normalizedInput);
  if (preview.recordsPath) {
    const rows = await loadStagedRecordsActivity({
      path: preview.recordsPath,
      stagingProviderId: preview.stagingProviderId ?? null,
    });
    return { rows, sampledAt: preview.sampledAt };
  }
  return preview;
}

type IngestionWorkflowInput = {
  endpointId: string;
  unitId: string;
  sinkId?: string | null;
  sinkEndpointId?: string | null;
  stagingProviderId?: string | null;
  tenantId?: string | null;
  datasetId?: string | null;
};

export async function ingestionRunWorkflow(input: IngestionWorkflowInput) {
  if (!input.endpointId || !input.unitId) {
    throw new Error("ingestionRunWorkflow requires endpointId and unitId");
  }
  const context = await startIngestionRunActivity({
    endpointId: input.endpointId,
    unitId: input.unitId,
    sinkId: input.sinkId ?? null,
    sinkEndpointId: input.sinkEndpointId ?? null,
    stagingProviderId: input.stagingProviderId ?? null,
    tenantId: input.tenantId ?? null,
    datasetId: input.datasetId ?? null,
  });
  const tenantId = context.tenantId ?? input.tenantId ?? null;
  try {
    log.info("ingestion-policy", {
      endpointId: input.endpointId,
      unitId: input.unitId,
      policyKeys: context.policy ? Object.keys(context.policy) : [],
      hasParameters: Boolean(context.policy && (context.policy as Record<string, unknown>).parameters),
    });
    const unitIdForGo = context.datasetId ?? input.datasetId ?? input.unitId;
    const unitIdForActivities = USE_GO_WORKER ? unitIdForGo : input.unitId;
    log.info("ingestion-context", {
      endpointId: input.endpointId,
      unitId: input.unitId,
      datasetId: context.datasetId,
      unitIdForGo,
      unitIdForActivities,
      sinkEndpointTemplateId: context.sinkEndpointTemplateId,
      sinkEndpointId: context.sinkEndpointId,
      sinkId: context.sinkId,
    });
    const sinkEndpointIdForGo = context.sinkEndpointTemplateId ?? context.sinkEndpointId ?? "";
    const baseRequest: PythonIngestionRequest = {
      endpointId: input.endpointId,
      unitId: unitIdForActivities,
      sinkId: context.sinkId ?? null,
      checkpoint: context.policy?.reset || context.policy?.resetCheckpoint ? null : context.checkpoint,
      stagingProviderId: context.stagingProviderId ?? null,
      policy: context.policy ?? null,
      mode: context.mode ?? null,
      dataMode: context.dataMode ?? null,
      sinkEndpointId: context.sinkEndpointId ?? null,
      cdmModelId: context.cdmModelId ?? null,
      filter: context.filter ?? null,
      transientState: context.transientState ?? null,
      transientStateVersion: context.transientStateVersion ?? null,
      sourceFamily: context.sourceFamily ?? null,
      datasetSlug: context.datasetSlug ?? null,
      datasetPrefix: context.datasetPrefix ?? null,
      bucket: context.bucket ?? null,
      basePrefix: context.basePrefix ?? null,
    };

  const plan = await ingestionActivities.planIngestionUnit(baseRequest);
  const slices = Array.isArray(plan.slices) ? plan.slices : [];
  const planMetadata = (plan.plan_metadata as Record<string, unknown> | undefined) ?? {};
  const planSchema =
    (planMetadata as any)?.schema ?? (planMetadata as any)?.cdmSchema ?? (planMetadata as any)?.sourceSchema ?? null;
  const planStrategy = (plan.strategy as string | null | undefined) ?? (planMetadata as any)?.strategy ?? null;
  const sliceResults: PythonIngestionResult[] = [];

  if (slices.length > 0) {
    const maxParallel = Math.max(
      1,
      Number(
        (baseRequest.policy as Record<string, unknown> | null | undefined)?.maxParallelSlices ??
          (baseRequest.policy as Record<string, unknown> | null | undefined)?.max_parallel_slices ??
          1,
      ),
    );
    const requests = slices.map((slice, idx) => ({
      ...baseRequest,
      policy: { ...(baseRequest.policy ?? {}), slice, slice_index: idx },
    }));
    // Run slices in bounded parallel batches
    for (let i = 0; i < requests.length; i += maxParallel) {
      const batch = requests.slice(i, i + maxParallel);
      const results = await Promise.all(
        batch.map((req) =>
          ingestionActivities.runIngestionUnit(req).catch((err) => {
            throw ApplicationFailure.fromError(err as Error);
          }),
        ),
      );
      sliceResults.push(...results);
    }
  } else {
    sliceResults.push(await ingestionActivities.runIngestionUnit(baseRequest));
  }

  const stagingHandles: Array<{ path: string; providerId?: string | null }> = [];
  const stageContexts: Array<{ stageRef: string; batchRefs: string[]; providerId?: string | null }> = [];
  const sliceStats: Array<Record<string, unknown>> = [];
  let transientState: Record<string, unknown> | null = context.transientState ?? null;
  let collectedRecords: unknown[] = [];
  for (let idx = 0; idx < sliceResults.length; idx += 1) {
    const res = sliceResults[idx];
    if (res.stageRef && Array.isArray(res.batchRefs) && res.batchRefs.length > 0) {
      stageContexts.push({
        stageRef: res.stageRef,
        batchRefs: res.batchRefs,
        providerId: res.stagingProviderId ?? context.stagingProviderId ?? DEFAULT_STAGING_PROVIDER,
      });
    }
    if (Array.isArray(res.staging)) {
      for (const handle of res.staging) {
        if (handle?.path) {
          stagingHandles.push({
            path: handle.path,
            providerId: handle.providerId ?? res.stagingProviderId ?? context.stagingProviderId ?? DEFAULT_STAGING_PROVIDER,
          });
        }
      }
    } else if (res.stagingPath) {
      stagingHandles.push({
        path: res.stagingPath,
        providerId: res.stagingProviderId ?? context.stagingProviderId ?? DEFAULT_STAGING_PROVIDER,
      });
    }
    if (Array.isArray(res.records) && res.records.length > 0) {
      collectedRecords = collectedRecords.concat(res.records);
    }
    if (res.stats) {
      sliceStats.push({ ...res.stats, sliceIndex: idx });
    }
    if (res.transientState) {
      transientState = res.transientState;
    }
  }

  const newCheckpoint = sliceResults.find((r) => r?.newCheckpoint !== undefined)?.newCheckpoint ?? null;
  log.info("checkpoint-extraction", {
    sliceResultsCount: sliceResults.length,
    hasNewCheckpoint: newCheckpoint != null,
    newCheckpointType: typeof newCheckpoint,
    watermark: newCheckpoint && typeof newCheckpoint === "object" ? (newCheckpoint as Record<string, unknown>).watermark : null,
  });
  let aggregatedStats: Record<string, unknown> | null = null;
  if (sliceStats.length > 0) {
    aggregatedStats = { planMetadata, slices: sliceStats };
  } else if (sliceResults[0]?.stats) {
    aggregatedStats = { ...sliceResults[0].stats, planMetadata };
  } else if (Object.keys(planMetadata).length > 0) {
    aggregatedStats = { planMetadata };
  }
  if (planStrategy) {
    aggregatedStats = aggregatedStats ?? {};
    aggregatedStats.strategy = planStrategy;
  }

  // Sprint 8: Shadow mode - run Go activity in parallel for comparison
  if (GO_SHADOW_MODE) {
    void runGoShadow(
      "RunIngestionUnit",
      () => goIngestionActivities.RunIngestionUnit(baseRequest),
      aggregatedStats
    );
  }

  const fallbackRecords = sliceResults[0]?.records ?? null;
  // datasetIdForSink is the sink destination identifier (table/prefix). Prefer CDM-aligned naming,
  // then datasetId/slug/unitId, normalized for sink compatibility.
  const datasetIdForSink = deriveSinkDatasetId({
    cdmModelId: context.cdmModelId ?? (planMetadata as any)?.cdmModelId ?? null,
    datasetId: context.datasetId ?? input.datasetId ?? null,
    datasetSlug: context.datasetSlug ?? null,
    unitId: unitIdForGo,
  });
  if (context.sinkId) {
    log.info("ingestion-sink-context", {
      sinkId: context.sinkId,
      sinkEndpointId: sinkEndpointIdForGo,
      stageContexts,
      stagingHandles,
      datasetIdForSink,
    });
    if (stageContexts.length > 0) {
      for (const stageCtx of stageContexts) {
        if (!stageCtx.providerId) {
          throw new Error("stagingProviderId is required for staged batches");
        }
        await goIngestionActivities.SinkRunner({
          sinkEndpointId: sinkEndpointIdForGo,
          endpointConfig: context.sinkEndpointConfig ?? undefined,
          datasetId: datasetIdForSink,
          stageRef: stageCtx.stageRef,
          batchRefs: stageCtx.batchRefs,
          stagingProviderId: stageCtx.providerId ?? undefined,
          schema: planSchema as Record<string, unknown> | undefined,
          loadDate: null,
          mode: null,
        });
      }
    } else if (collectedRecords.length > 0 || (fallbackRecords && fallbackRecords.length > 0)) {
      // Records path is only for preview/legacy runners; still routed through sink runner.
      const recordsToWrite = (collectedRecords.length > 0 ? collectedRecords : fallbackRecords) as Array<Record<string, unknown>>;
      await goIngestionActivities.SinkRunner({
        sinkEndpointId: sinkEndpointIdForGo,
        endpointConfig: context.sinkEndpointConfig ?? undefined,
        datasetId: datasetIdForSink,
        records: recordsToWrite,
        schema: planSchema as Record<string, unknown> | undefined,
        loadDate: null,
        mode: null,
      });
    } else {
      throw new Error("No staged batches or records available for sink write.");
    }
  } else if (!context.sinkId && (stageContexts.length > 0 || collectedRecords.length > 0 || (fallbackRecords?.length ?? 0) > 0)) {
    throw new Error("Ingestion sink is not defined for this run.");
  }
  await completeIngestionRunActivity({
    endpointId: input.endpointId,
    unitId: input.unitId,
    sinkId: context.sinkId,
    vendorKey: context.vendorKey,
    runId: context.runId,
    checkpointVersion: context.checkpointVersion,
    newCheckpoint: newCheckpoint,
    stats: aggregatedStats ?? null,
    transientStateVersion: context.transientStateVersion,
    newTransientState: transientState,
  });
  await triggerVectorIndexingIfConfigured({
    runId: context.runId,
    sinkId: context.sinkId,
    tenantId,
    sourceFamily: context.sourceFamily ?? null,
    sinkEndpointId: context.sinkEndpointId ?? null,
    sinkEndpointConfig: context.sinkEndpointConfig ?? null,
    datasetSlug: context.datasetSlug ?? null,
    datasetPrefix: context.datasetPrefix ?? null,
    bucket: context.bucket ?? null,
    basePrefix: context.basePrefix ?? null,
    datasetId: context.datasetId ?? input.datasetId ?? null,
    endpointId: input.endpointId,
    unitId: input.unitId,
    stageRef: stageContexts[0]?.stageRef ?? null,
    batchRefs: stageContexts[0]?.batchRefs ?? null,
    stagingProviderId: stageContexts[0]?.providerId ?? null,
  });
  } catch (error) {
    await failIngestionRunActivity({
      endpointId: input.endpointId,
      unitId: input.unitId,
      sinkId: context.sinkId,
      vendorKey: context.vendorKey,
      runId: context.runId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
