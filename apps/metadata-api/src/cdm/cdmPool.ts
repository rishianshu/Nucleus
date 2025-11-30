import { Pool } from "pg";
import type { MetadataEndpointDescriptor } from "@metadata/core";
import { getMetadataStore } from "../context.js";
import { parseSinkEndpointConfig, type SinkConnectionConfig } from "../ingestion/cdmSink.js";

type PoolEntry = {
  pool: Pool;
  config: SinkConnectionConfig;
};

const pools = new Map<string, PoolEntry>();
const CDM_SINK_LABEL = "sink:cdm";
const CDM_SINK_TEMPLATE_ID = "cdm.jdbc";

export async function getCdmSinkPool(projectId?: string | null, fallback?: SinkConnectionConfig | null): Promise<PoolEntry> {
  const store = await getMetadataStore();
  const endpoints = await store.listEndpoints(projectId ?? undefined);
  let sinkEndpoint = endpoints.find(isCdmSinkEndpoint);
  if (!sinkEndpoint && projectId) {
    const globalEndpoints = await store.listEndpoints();
    sinkEndpoint = globalEndpoints.find(isCdmSinkEndpoint);
  }
  if (sinkEndpoint?.id) {
    const existing = pools.get(sinkEndpoint.id);
    if (existing) {
      return existing;
    }
    const config = parseSinkEndpointConfig(sinkEndpoint);
    const entry = createPoolEntry(config);
    pools.set(sinkEndpoint.id, entry);
    return entry;
  }
  if (fallback) {
    const key = `fallback:${fallback.connectionUrl}:${fallback.schema}:${fallback.tablePrefix}`;
    const existing = pools.get(key);
    if (existing) {
      return existing;
    }
    const entry = createPoolEntry(fallback);
    pools.set(key, entry);
    return entry;
  }
  throw new Error("CDM sink endpoint is not registered and no fallback connection configured");
}

export function resolveFallbackConfigFromEnv(
  prefix: string,
  defaults: { schema: string; tablePrefix: string },
): SinkConnectionConfig | null {
  const upper = prefix.toUpperCase();
  const connectionUrl =
    process.env[`${upper}_DATABASE_URL`] ??
    process.env.METADATA_DATABASE_URL ??
    null;
  if (!connectionUrl) {
    return null;
  }
  const schema = process.env[`${upper}_DATABASE_SCHEMA`] ?? defaults.schema;
  const tablePrefix = process.env[`${upper}_DATABASE_TABLE_PREFIX`] ?? defaults.tablePrefix;
  const sslFlag = process.env[`${upper}_DATABASE_SSL`];
  const ssl = sslFlag === "1" ? { rejectUnauthorized: false } : undefined;
  return {
    connectionUrl,
    schema,
    tablePrefix,
    ssl,
  };
}

export function isCdmSinkEndpoint(endpoint: MetadataEndpointDescriptor) {
  const labels = endpoint.labels ?? [];
  if (labels.includes(CDM_SINK_LABEL)) {
    return true;
  }
  if (endpoint.config && typeof endpoint.config === "object") {
    const config = endpoint.config as Record<string, unknown>;
    const templateId = typeof config.templateId === "string" ? config.templateId : undefined;
    if (templateId === CDM_SINK_TEMPLATE_ID) {
      return true;
    }
  }
  if (endpoint.capabilities?.some((cap) => cap.toLowerCase().includes("sink.cdm"))) {
    return true;
  }
  return false;
}

export type { PoolEntry };

function createPoolEntry(config: SinkConnectionConfig): PoolEntry {
  const pool = new Pool({
    connectionString: config.connectionUrl,
    ssl: config.ssl,
    max: 5,
  });
  return { pool, config };
}
