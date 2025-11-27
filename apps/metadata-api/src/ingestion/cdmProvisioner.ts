import { Pool, type PoolClient } from "pg";
import type { MetadataEndpointDescriptor, MetadataStore } from "@metadata/core";
import {
  CDM_MODEL_TABLES,
  parseSinkEndpointConfig,
  quoteIdent,
  type SinkConnectionConfig,
  type TableDefinition,
} from "./cdmSink.js";

const CATALOG_DATASET_DOMAIN = process.env.METADATA_CATALOG_DOMAIN ?? "catalog.dataset";

export type ProvisionCdmSinkArgs = {
  store: MetadataStore;
  sinkEndpoint: MetadataEndpointDescriptor;
  cdmModelId: string;
  projectId: string;
  executorFactory?: SqlExecutorFactory;
};

export type ProvisionCdmSinkResult = {
  datasetId: string;
  schema: string;
  tableName: string;
};

type SqlExecutor = {
  query(sql: string, params?: unknown[]): Promise<void>;
  close(): Promise<void>;
};

type SqlExecutorFactory = (config: SinkConnectionConfig) => Promise<SqlExecutor>;

const defaultExecutorFactory: SqlExecutorFactory = async (config) => {
  const pool = new Pool({
    connectionString: config.connectionUrl,
    ssl: config.ssl,
    max: 1,
  });
  const client = await pool.connect();
  return {
    async query(sql: string, params?: unknown[]) {
      await client.query(sql, params);
    },
    async close() {
      client.release();
      await pool.end();
    },
  };
};

export async function provisionCdmSinkTables({
  store,
  sinkEndpoint,
  cdmModelId,
  projectId,
  executorFactory = defaultExecutorFactory,
}: ProvisionCdmSinkArgs): Promise<ProvisionCdmSinkResult> {
  const definition = CDM_MODEL_TABLES[cdmModelId as keyof typeof CDM_MODEL_TABLES];
  if (!definition) {
    throw new Error(`Unsupported CDM model: ${cdmModelId}`);
  }
  const config = parseSinkEndpointConfig(sinkEndpoint);
  const executor = await executorFactory(config);
  try {
    await executor.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(config.schema)};`);
    await executor.query(buildCreateTableSql(config, definition));
  } finally {
    await executor.close();
  }
  const tableName = `${config.tablePrefix}${definition.suffix}`;
  const datasetId = `${config.schema}.${tableName}`;
  await store.upsertRecord({
    id: datasetId,
    projectId,
    domain: CATALOG_DATASET_DOMAIN,
    labels: buildDatasetLabels(sinkEndpoint, cdmModelId),
    payload: buildDatasetPayload(config.schema, tableName, sinkEndpoint, cdmModelId),
  });
  return { datasetId, schema: config.schema, tableName };
}

function buildCreateTableSql(config: SinkConnectionConfig, definition: TableDefinition): string {
  const columns = definition.columns
    .map((column) => `  ${quoteIdent(column.name)} ${column.type}`)
    .join(",\n");
  return `CREATE TABLE IF NOT EXISTS ${qualifiedTable(config, definition)} (\n${columns},\n  PRIMARY KEY (cdm_id)\n);`;
}

function qualifiedTable(config: SinkConnectionConfig, definition: TableDefinition): string {
  const schema = quoteIdent(config.schema);
  const table = quoteIdent(`${config.tablePrefix}${definition.suffix}`);
  return `${schema}.${table}`;
}

function buildDatasetLabels(endpoint: MetadataEndpointDescriptor, cdmModelId: string): string[] {
  const labels = new Set<string>();
  const endpointId = endpoint.id ?? endpoint.sourceId;
  if (endpointId) {
    labels.add(`endpoint:${endpointId}`);
    labels.add(`sink-endpoint:${endpointId}`);
  }
  labels.add(`cdm_model:${cdmModelId}`);
  return Array.from(labels);
}

function buildDatasetPayload(
  schema: string,
  tableName: string,
  endpoint: MetadataEndpointDescriptor,
  cdmModelId: string,
) {
  return {
    schema,
    entity: tableName,
    sinkEndpointId: endpoint.id ?? endpoint.sourceId,
    cdmModelId,
    autoprovisioned: true,
  };
}
