import { proxyActivities, workflowInfo, log } from "@temporalio/workflow";
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
  }): Promise<{ rows: unknown[]; sampledAt: string }>;
  runIngestionUnit(input: PythonIngestionRequest): Promise<PythonIngestionResult>;
};

const PYTHON_ACTIVITY_TASK_QUEUE = "metadata-python";

const pythonActivities = proxyActivities<PythonMetadataActivities>({
  taskQueue: PYTHON_ACTIVITY_TASK_QUEUE,
  scheduleToCloseTimeout: "2 hours",
});

type PythonIngestionRequest = {
  endpointId: string;
  unitId: string;
  sinkId?: string | null;
  checkpoint?: unknown;
  stagingProviderId?: string | null;
  policy?: Record<string, unknown> | null;
};

type PythonIngestionResult = {
  newCheckpoint: unknown;
  stats?: Record<string, unknown> | null;
  records?: NormalizedRecordInput[] | null;
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
    const result = await pythonActivities.collectCatalogSnapshots(plan.job);
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
  return testEndpointConnectionActivity(input);
}

export async function previewDatasetWorkflow(input: {
  datasetId: string;
  schema: string;
  table: string;
  limit?: number;
  connectionUrl: string;
}) {
  return pythonActivities.previewDataset.executeWithOptions(
    { taskQueue: PYTHON_ACTIVITY_TASK_QUEUE, scheduleToCloseTimeout: "5 minutes" },
    [input],
  );
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
    const ingestionResult = await pythonActivities.runIngestionUnit({
      endpointId: input.endpointId,
      unitId: input.unitId,
      sinkId: context.sinkId ?? null,
      checkpoint: context.checkpoint,
      stagingProviderId: context.stagingProviderId ?? null,
      policy: context.policy ?? null,
    });
    if (ingestionResult.records && ingestionResult.records.length > 0) {
      if (!context.sinkId) {
        throw new Error("Ingestion sink is not defined for this run.");
      }
      await persistIngestionBatchesActivity({
        endpointId: input.endpointId,
        unitId: input.unitId,
        sinkId: context.sinkId,
        runId: context.runId,
        records: ingestionResult.records,
        stats: ingestionResult.stats ?? null,
      });
    }
    await completeIngestionRunActivity({
      endpointId: input.endpointId,
      unitId: input.unitId,
      sinkId: context.sinkId,
      vendorKey: context.vendorKey,
      runId: context.runId,
      checkpointVersion: context.checkpointVersion,
      newCheckpoint: ingestionResult.newCheckpoint,
      stats: ingestionResult.stats ?? null,
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
