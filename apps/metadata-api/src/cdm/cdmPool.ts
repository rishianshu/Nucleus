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
    buildConnectionUrlFromMetadataPgEnv() ??
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
  const connectionString = normalizeConnectionUrl(config.connectionUrl);
  const pool = new Pool({
    connectionString,
    ssl: config.ssl,
    max: 5,
  });
  return { pool, config };
}

function buildConnectionUrlFromMetadataPgEnv(): string | null {
  const host = process.env.POSTGRES_HOST ?? process.env.POSTGRES_HOSTNAME ?? process.env.METADATA_PG_HOST;
  const port = process.env.POSTGRES_PORT ?? process.env.METADATA_PG_PORT;
  const database = process.env.POSTGRES_DB ?? process.env.METADATA_PG_DATABASE;
  const username = process.env.POSTGRES_USER ?? process.env.METADATA_PG_USERNAME;
  const password = process.env.POSTGRES_PASSWORD ?? process.env.METADATA_PG_PASSWORD;
  if (!host || !port || !database || !username || !password) {
    return null;
  }
  return `postgresql://${username}:${password}@${host}:${port}/${database}`;
}

function normalizeConnectionUrl(raw: string): string {
  try {
    const url = raw.includes("://") ? new URL(raw) : new URL(`postgresql://${raw}`);
    const envPort = process.env.POSTGRES_PORT ?? process.env.METADATA_PG_PORT;
    const host = url.hostname.toLowerCase();
    const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "postgres";
    if (envPort && isLocalHost && url.port && url.port !== envPort) {
      url.port = envPort;
    } else if (envPort && isLocalHost && !url.port) {
      url.port = envPort;
    }
    return url.toString();
  } catch {
    return raw;
  }
}
