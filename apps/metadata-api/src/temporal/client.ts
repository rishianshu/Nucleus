import { Client, Connection } from "@temporalio/client";

let clientPromise: Promise<{ client: Client; taskQueue: string }> | null = null;

export async function getTemporalClient() {
  if (!clientPromise) {
    clientPromise = createClient();
  }
  return clientPromise;
}

async function createClient() {
  const address = process.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233";
  const namespace = process.env.TEMPORAL_NAMESPACE ?? "default";
  const taskQueue = process.env.METADATA_TEMPORAL_TASK_QUEUE ?? "metadata";
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });
  return { client, taskQueue };
}
