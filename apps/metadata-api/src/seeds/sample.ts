import { type MetadataStore, type MetadataEndpointDescriptor, type HttpVerb } from "@metadata/core";
import sampleData from "../fixtures/sample-metadata.json";

const CATALOG_DATASET_DOMAIN = process.env.METADATA_CATALOG_DOMAIN ?? "catalog.dataset";
const DEFAULT_PROJECT_ID = process.env.METADATA_DEFAULT_PROJECT ?? "global";

type SampleEndpoint = Partial<Omit<MetadataEndpointDescriptor, "verb">> & { verb?: string };
type SampleDataset = {
  id: string;
  labels?: string[];
  sourceEndpointId?: string;
  projectId?: string;
  payload: Record<string, unknown>;
};

export async function seedMetadataStoreIfEmpty(store: MetadataStore): Promise<void> {
  if (process.env.METADATA_DISABLE_SEED === "1") {
    return;
  }
  const projectId = sampleData.projectId ?? DEFAULT_PROJECT_ID;
  const endpoints: SampleEndpoint[] = sampleData.endpoints ?? [];
  const datasets: SampleDataset[] = sampleData.datasets ?? [];
  const defaultEndpointId = endpoints[0]?.id;

  await ensureSampleEndpoints(store, endpoints, projectId);
  await ensureSampleDatasets(store, datasets, projectId, defaultEndpointId);
}

async function ensureSampleEndpoints(
  store: MetadataStore,
  endpoints: SampleEndpoint[],
  projectId: string,
) {
  const now = new Date().toISOString();
  for (const [index, endpoint] of endpoints.entries()) {
    const fallbackId = endpoint.id ?? `sample-endpoint-${index + 1}`;
    const descriptor: MetadataEndpointDescriptor = {
      id: fallbackId,
      sourceId: endpoint.sourceId ?? fallbackId,
      name: endpoint.name ?? `Sample Endpoint ${index + 1}`,
      description: endpoint.description ?? undefined,
      verb: (endpoint.verb ?? "POST") as HttpVerb,
      url: endpoint.url ?? "https://metadata-sample.example.com",
      authPolicy: endpoint.authPolicy ?? undefined,
      projectId: endpoint.projectId ?? projectId,
      domain: endpoint.domain ?? undefined,
      labels: endpoint.labels ?? undefined,
      config: endpoint.config ?? undefined,
      detectedVersion: endpoint.detectedVersion ?? undefined,
      versionHint: endpoint.versionHint ?? undefined,
      capabilities: endpoint.capabilities ?? [],
      createdAt: endpoint.createdAt ?? now,
      updatedAt: endpoint.updatedAt ?? now,
      deletedAt: endpoint.deletedAt ?? null,
      deletionReason: endpoint.deletionReason ?? null,
    };
    await store.registerEndpoint(descriptor);
  }
}

async function ensureSampleDatasets(
  store: MetadataStore,
  datasets: SampleDataset[],
  projectId: string,
  defaultEndpointId?: string,
) {
  const now = new Date().toISOString();
  for (const dataset of datasets) {
    const sourceEndpointId = dataset.sourceEndpointId ?? defaultEndpointId;
    const basePayload = { ...dataset.payload };
    const existingMetadata = (basePayload["_metadata"] as Record<string, unknown> | undefined) ?? {};
    const collectedAt = (existingMetadata["collected_at"] as string | undefined) ?? now;
    const labelSet = new Set(dataset.labels ?? sampleData.labels ?? []);
    if (sourceEndpointId) {
      labelSet.add(`endpoint:${sourceEndpointId}`);
    }
    const payload = {
      ...basePayload,
      metadata_endpoint_id: basePayload["metadata_endpoint_id"] ?? sourceEndpointId,
      _metadata: {
        ...existingMetadata,
        source_endpoint_id: sourceEndpointId,
        source_id: sourceEndpointId,
        collected_at: collectedAt,
      },
    };
    await store.upsertRecord({
      id: dataset.id,
      projectId: dataset.projectId ?? projectId,
      domain: CATALOG_DATASET_DOMAIN,
      labels: Array.from(labelSet),
      payload,
    });
  }
}
