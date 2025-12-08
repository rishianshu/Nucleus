import { proxyActivities, workflowInfo, log, ApplicationFailure } from "@temporalio/workflow";
import type { CatalogRecordInput, CollectionJobRequest, MetadataActivities } from "./activities.js";

export const WORKFLOW_NAMES = {
  collectionRun: "collectionRunWorkflow",
  listEndpointTemplates: "listEndpointTemplatesWorkflow",
  buildEndpointConfig: "buildEndpointConfigWorkflow",
  testEndpointConnection: "testEndpointConnectionWorkflow",
  previewDataset: "previewDatasetWorkflow",
  ingestionRun: "ingestionRunWorkflow",
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
} = proxyActivities<MetadataActivities>({
  startToCloseTimeout: "1 hour",
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
const GO_ACTIVITY_TASK_QUEUE = "metadata-go";

const pythonActivities = proxyActivities<PythonMetadataActivities>({
  taskQueue: PYTHON_ACTIVITY_TASK_QUEUE,
  scheduleToCloseTimeout: "2 hours",
});

// Go activities (Sprint 8: Shadow Mode)
// These mirror Python activities and run on the Go worker
type GoMetadataActivities = {
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
};

const goActivities = proxyActivities<GoMetadataActivities>({
  taskQueue: GO_ACTIVITY_TASK_QUEUE,
  scheduleToCloseTimeout: "2 hours",
});

// Shadow mode flag - when true, runs Go activities in parallel for comparison
const GO_SHADOW_MODE = process.env.GO_SHADOW_MODE === "true";

// Feature flag - when true, uses Go activities instead of Python (Sprint 9)
const USE_GO_WORKER = process.env.USE_GO_WORKER === "true";

// Unified ingestion activities - switches based on feature flag
const ingestionActivities = USE_GO_WORKER
  ? {
      collectCatalogSnapshots: goActivities.CollectCatalogSnapshots,
      previewDataset: goActivities.PreviewDataset,
      planIngestionUnit: goActivities.PlanIngestionUnit,
      runIngestionUnit: goActivities.RunIngestionUnit,
    }
  : {
      collectCatalogSnapshots: pythonActivities.collectCatalogSnapshots,
      previewDataset: pythonActivities.previewDataset,
      planIngestionUnit: pythonActivities.planIngestionUnit,
      runIngestionUnit: pythonActivities.runIngestionUnit,
    };

// Log which worker is being used
if (USE_GO_WORKER) {
  log.info("worker-mode", { mode: "go", taskQueue: GO_ACTIVITY_TASK_QUEUE });
} else {
  log.info("worker-mode", { mode: "python", taskQueue: PYTHON_ACTIVITY_TASK_QUEUE });
}

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
};

type PythonIngestionResult = {
  newCheckpoint: unknown;
  stats?: Record<string, unknown> | null;
  records?: NormalizedRecordInput[] | null;
  transientState?: Record<string, unknown> | null;
  stagingPath?: string | null;
  stagingProviderId?: string | null;
  staging?: Array<{ path: string; providerId?: string | null }>;
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
};

export async function ingestionRunWorkflow(input: IngestionWorkflowInput) {
  if (!input.endpointId || !input.unitId) {
    throw new Error("ingestionRunWorkflow requires endpointId and unitId");
  }
  const context = await startIngestionRunActivity({
    endpointId: input.endpointId,
    unitId: input.unitId,
    sinkId: input.sinkId ?? null,
  });
  try {
    log.info("ingestion-policy", {
      endpointId: input.endpointId,
      unitId: input.unitId,
      policyKeys: context.policy ? Object.keys(context.policy) : [],
      hasParameters: Boolean(context.policy && (context.policy as Record<string, unknown>).parameters),
    });
    const baseRequest: PythonIngestionRequest = {
      endpointId: input.endpointId,
      unitId: input.unitId,
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
    };

  const plan = await ingestionActivities.planIngestionUnit(baseRequest);
  const slices = Array.isArray(plan.slices) ? plan.slices : [];
  const planMetadata = (plan.plan_metadata as Record<string, unknown> | undefined) ?? {};
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
  const sliceStats: Array<Record<string, unknown>> = [];
  let transientState: Record<string, unknown> | null = context.transientState ?? null;
  for (let idx = 0; idx < sliceResults.length; idx += 1) {
    const res = sliceResults[idx];
    if (Array.isArray(res.staging)) {
      for (const handle of res.staging) {
        if (handle?.path) {
          stagingHandles.push({
            path: handle.path,
            providerId: handle.providerId ?? res.stagingProviderId ?? context.stagingProviderId ?? null,
          });
        }
      }
    } else if (res.stagingPath) {
      stagingHandles.push({
        path: res.stagingPath,
        providerId: res.stagingProviderId ?? context.stagingProviderId ?? null,
      });
    }
    if (res.stats) {
      sliceStats.push({ ...res.stats, sliceIndex: idx });
    }
    if (res.transientState) {
      transientState = res.transientState;
    }
  }

  const newCheckpoint = sliceResults.find((r) => r?.newCheckpoint !== undefined)?.newCheckpoint ?? null;
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
      () => goActivities.RunIngestionUnit(baseRequest),
      aggregatedStats
    );
  }

  const fallbackRecords = sliceResults[0]?.records ?? null;
  if (context.sinkId && (stagingHandles.length > 0 || (fallbackRecords && fallbackRecords.length > 0))) {
    await persistIngestionBatchesActivity({
      endpointId: input.endpointId,
      unitId: input.unitId,
      sinkId: context.sinkId,
      runId: context.runId,
      staging: stagingHandles,
      records: stagingHandles.length === 0 ? fallbackRecords ?? undefined : undefined,
      stats: aggregatedStats ?? null,
      sinkEndpointId: context.sinkEndpointId ?? null,
      dataMode: context.dataMode ?? null,
      cdmModelId: context.cdmModelId ?? null,
    });
  } else if (!context.sinkId && (stagingHandles.length > 0 || (fallbackRecords?.length ?? 0) > 0)) {
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
