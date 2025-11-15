import { proxyActivities, workflowInfo, log } from "@temporalio/workflow";
import type { CatalogRecordInput, CollectionJobRequest, MetadataActivities } from "./activities.js";

export const WORKFLOW_NAMES = {
  metadataCollection: "metadataCollectionWorkflow",
  listEndpointTemplates: "listEndpointTemplatesWorkflow",
  buildEndpointConfig: "buildEndpointConfigWorkflow",
  testEndpointConnection: "testEndpointConnectionWorkflow",
  previewDataset: "previewDatasetWorkflow",
} as const;

const {
  markRunStarted,
  markRunCompleted,
  markRunSkipped,
  markRunFailed,
  prepareCollectionJob,
  persistCatalogRecords,
  listEndpointTemplates: listEndpointTemplatesActivity,
  buildEndpointConfig: buildEndpointConfigActivity,
  testEndpointConnection: testEndpointConnectionActivity,
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
};

const PYTHON_ACTIVITY_TASK_QUEUE = "metadata-python";

const pythonActivities = proxyActivities<PythonMetadataActivities>({
  taskQueue: PYTHON_ACTIVITY_TASK_QUEUE,
  scheduleToCloseTimeout: "2 hours",
});

export async function metadataCollectionWorkflow(input: { runId: string }) {
  const info = workflowInfo();
  await markRunStarted({
    runId: input.runId,
    workflowId: info.workflowId,
    temporalRunId: info.runId,
  });

  try {
    const plan = await prepareCollectionJob({ runId: input.runId });
    if (plan.kind === "skip") {
      log.info("metadata-collection-skip", {
        runId: input.runId,
        reason: plan.reason,
        capability: plan.capability ?? null,
      });
      await markRunSkipped({ runId: input.runId, reason: plan.reason });
      return;
    }
    const result = await pythonActivities.collectCatalogSnapshots(plan.job);
    result?.logs?.forEach((entry: Record<string, unknown>) => {
      log.info("metadata-collection-log", entry);
    });
    await persistCatalogRecords({
      runId: input.runId,
      records: result?.records,
      recordsPath: result?.recordsPath,
    });
    await markRunCompleted({ runId: input.runId });
  } catch (error) {
    await markRunFailed({
      runId: input.runId,
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
