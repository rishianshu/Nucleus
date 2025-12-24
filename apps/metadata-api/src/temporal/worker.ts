import path from "node:path";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import { activities } from "./activities.js";
import { WORKFLOW_NAMES } from "./workflows.js";
import { registerDefaultIngestionDrivers } from "../ingestion/register.js";

// Default TS worker queue hosts workflows plus TS-only activities; Go activities stay on metadata-go.
const DEFAULT_TASK_QUEUE = process.env.METADATA_TEMPORAL_TASK_QUEUE ?? "metadata";

async function main() {
  registerDefaultIngestionDrivers();
  const workflowsPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./workflows.ts");
  const temporalAddress = process.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233";
  const temporalNamespace = process.env.TEMPORAL_NAMESPACE ?? "default";
  const connection = await NativeConnection.connect({ address: temporalAddress });
  const worker = await Worker.create({
    connection,
    namespace: temporalNamespace,
    taskQueue: DEFAULT_TASK_QUEUE,
    workflowsPath,
    activities,
    // Allow TS workflow + metadata bookkeeping activities; Go ingestion activities stay on a separate queue.
  });
  // eslint-disable-next-line no-console
  console.log(
    `Metadata Temporal worker listening on queue ${DEFAULT_TASK_QUEUE} (workflows: ${Object.values(WORKFLOW_NAMES).join(", ")})`,
  );
  await worker.run();
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Metadata Temporal worker failed", error);
  process.exit(1);
});
