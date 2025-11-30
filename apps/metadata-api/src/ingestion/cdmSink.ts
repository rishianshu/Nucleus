import { Pool, type PoolClient } from "pg";
import type {
  IngestionSink,
  IngestionSinkContext,
  MetadataEndpointDescriptor,
  NormalizedBatch,
  NormalizedRecord,
} from "@metadata/core";
import type { MetadataStore } from "@metadata/core";
import { getMetadataStore } from "../context.js";

export const CDM_MODEL_TABLES = {
  "cdm.work.project": {
    suffix: "work_project",
    columns: [
      column("cdm_id", "TEXT"),
      column("source_system", "TEXT"),
      column("source_project_key", "TEXT"),
      column("name", "TEXT"),
      column("description", "TEXT"),
      column("url", "TEXT"),
      jsonColumn("properties", "JSONB", () => ({})),
    ],
  },
  "cdm.work.user": {
    suffix: "work_user",
    columns: [
      column("cdm_id", "TEXT"),
      column("source_system", "TEXT"),
      column("source_user_id", "TEXT"),
      column("display_name", "TEXT"),
      column("email", "TEXT"),
      boolColumn("active"),
      jsonColumn("properties", "JSONB", () => ({})),
    ],
  },
  "cdm.work.item": {
    suffix: "work_item",
    columns: [
      column("cdm_id", "TEXT"),
      column("source_system", "TEXT"),
      column("source_issue_key", "TEXT"),
      column("project_cdm_id", "TEXT"),
      column("reporter_cdm_id", "TEXT"),
      column("assignee_cdm_id", "TEXT"),
      column("issue_type", "TEXT"),
      column("status", "TEXT"),
      column("status_category", "TEXT"),
      column("priority", "TEXT"),
      column("summary", "TEXT"),
      column("description", "TEXT"),
      jsonColumn("labels", "JSONB", () => []),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      timestampColumn("closed_at"),
      jsonColumn("properties", "JSONB", () => ({})),
    ],
  },
  "cdm.work.comment": {
    suffix: "work_comment",
    columns: [
      column("cdm_id", "TEXT"),
      column("source_system", "TEXT"),
      column("source_comment_id", "TEXT"),
      column("item_cdm_id", "TEXT"),
      column("author_cdm_id", "TEXT"),
      column("body", "TEXT"),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      column("visibility", "TEXT"),
      jsonColumn("properties", "JSONB", () => ({})),
    ],
  },
  "cdm.work.worklog": {
    suffix: "work_worklog",
    columns: [
      column("cdm_id", "TEXT"),
      column("source_system", "TEXT"),
      column("source_worklog_id", "TEXT"),
      column("item_cdm_id", "TEXT"),
      column("author_cdm_id", "TEXT"),
      timestampColumn("started_at"),
      numberColumn("time_spent_seconds"),
      column("comment", "TEXT"),
      column("visibility", "TEXT"),
      jsonColumn("properties", "JSONB", () => ({})),
    ],
  },
  "cdm.doc.space": {
    suffix: "doc_space",
    columns: [
      column("cdm_id", "TEXT"),
      column("source_system", "TEXT"),
      column("source_space_id", "TEXT"),
      column("key", "TEXT"),
      column("name", "TEXT"),
      column("description", "TEXT"),
      column("url", "TEXT"),
      jsonColumn("properties", "JSONB", () => ({})),
    ],
  },
  "cdm.doc.item": {
    suffix: "doc_item",
    columns: [
      column("cdm_id", "TEXT"),
      column("source_system", "TEXT"),
      column("source_item_id", "TEXT"),
      column("space_cdm_id", "TEXT"),
      column("parent_item_cdm_id", "TEXT"),
      column("title", "TEXT"),
      column("doc_type", "TEXT"),
      column("mime_type", "TEXT"),
      column("created_by_cdm_id", "TEXT"),
      column("updated_by_cdm_id", "TEXT"),
      timestampColumn("created_at"),
      timestampColumn("updated_at"),
      column("url", "TEXT"),
      jsonColumn("tags", "JSONB", () => []),
      jsonColumn("properties", "JSONB", () => ({})),
    ],
  },
  "cdm.doc.revision": {
    suffix: "doc_revision",
    columns: [
      column("cdm_id", "TEXT"),
      column("source_system", "TEXT"),
      column("source_revision_id", "TEXT"),
      column("item_cdm_id", "TEXT"),
      numberColumn("revision_number"),
      column("revision_label", "TEXT"),
      column("author_cdm_id", "TEXT"),
      timestampColumn("created_at"),
      column("summary", "TEXT"),
      jsonColumn("properties", "JSONB", () => ({})),
    ],
  },
  "cdm.doc.link": {
    suffix: "doc_link",
    columns: [
      column("cdm_id", "TEXT"),
      column("source_system", "TEXT"),
      column("source_link_id", "TEXT"),
      column("from_item_cdm_id", "TEXT"),
      column("to_item_cdm_id", "TEXT"),
      column("url", "TEXT"),
      column("link_type", "TEXT"),
      timestampColumn("created_at"),
      jsonColumn("properties", "JSONB", () => ({})),
    ],
  },
} as const;

type CdmModelId = keyof typeof CDM_MODEL_TABLES;

export type ColumnDefinition = {
  name: string;
  type: string;
  extract: (payload: Record<string, unknown>, record: NormalizedRecord) => unknown;
};

function column(name: string, type = "TEXT"): ColumnDefinition {
  return {
    name,
    type,
    extract: (payload) => normalizePrimitive(payload[name]),
  };
}

function boolColumn(name: string): ColumnDefinition {
  return {
    name,
    type: "BOOLEAN",
    extract: (payload) => toBoolean(payload[name]),
  };
}

function numberColumn(name: string): ColumnDefinition {
  return {
    name,
    type: "INTEGER",
    extract: (payload) => toNumber(payload[name]),
  };
}

function timestampColumn(name: string): ColumnDefinition {
  return {
    name,
    type: "TIMESTAMPTZ",
    extract: (payload) => toDate(payload[name]),
  };
}

function jsonColumn(name: string, type: string, fallback: () => unknown): ColumnDefinition {
  return {
    name,
    type,
    extract: (payload) => normalizeJson(payload[name], fallback),
  };
}

export type TableDefinition = {
  suffix: string;
  columns: readonly ColumnDefinition[];
};

export type SinkConnectionConfig = {
  connectionUrl: string;
  schema: string;
  tablePrefix: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
};

type PoolHandle = {
  query(sql: string, params?: unknown[]): Promise<unknown>;
  close(): Promise<void>;
};

type PoolFactory = (config: SinkConnectionConfig) => Promise<PoolHandle>;

const defaultPoolFactory: PoolFactory = async (config) => {
  const pool = new Pool({
    connectionString: config.connectionUrl,
    max: 1,
    ssl: config.ssl,
  });
  const client = await pool.connect();
  return {
    query: (sql: string, params?: unknown[]) => client.query(sql, params),
    close: async () => {
      client.release();
      await pool.end();
    },
  };
};

type CdmJdbcSinkOptions = {
  metadataStore?: MetadataStore;
  poolFactory?: PoolFactory;
};

export class CdmJdbcSink implements IngestionSink {
  private connection: PoolHandle | null = null;
  private config: SinkConnectionConfig | null = null;
  private readonly metadataStorePromise: Promise<MetadataStore>;
  private readonly poolFactory: PoolFactory;

  constructor(options?: CdmJdbcSinkOptions) {
    this.metadataStorePromise = options?.metadataStore ? Promise.resolve(options.metadataStore) : getMetadataStore();
    this.poolFactory = options?.poolFactory ?? defaultPoolFactory;
  }

  async begin(context: IngestionSinkContext): Promise<void> {
    if (!context.sinkEndpointId) {
      throw new Error("CDM sink requires sinkEndpointId in context");
    }
    this.config = await this.resolveSinkConfig(context.sinkEndpointId);
    this.connection = await this.poolFactory(this.config);
  }

  async writeBatch(batch: NormalizedBatch, context: IngestionSinkContext): Promise<{ upserts?: number }> {
    if (!this.connection || !this.config) {
      throw new Error("CDM sink not initialized");
    }
    const modelId = (context.cdmModelId ?? inferModelId(batch)) as CdmModelId | null;
    if (!modelId || !(modelId in CDM_MODEL_TABLES)) {
      throw new Error(`Unsupported CDM model: ${context.cdmModelId ?? "unknown"}`);
    }
    const definition = CDM_MODEL_TABLES[modelId];
    const rows = batch.records.map((record) => buildRow(record, definition));
    if (rows.length === 0) {
      return { upserts: 0 };
    }
    await upsertRows(this.connection, this.config, definition, rows);
    return { upserts: rows.length };
  }

  async commit(_context?: IngestionSinkContext): Promise<void> {
    await this.teardown();
  }

  async abort(_context?: IngestionSinkContext): Promise<void> {
    await this.teardown();
  }

  private async teardown() {
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
  }

  private async resolveSinkConfig(endpointId: string): Promise<SinkConnectionConfig> {
    const store = await this.metadataStorePromise;
    const endpoints = await store.listEndpoints();
    const endpoint = endpoints.find((entry) => entry.id === endpointId || entry.sourceId === endpointId);
    if (!endpoint) {
      throw new Error(`Sink endpoint ${endpointId} not found`);
    }
    return parseSinkEndpointConfig(endpoint);
  }
}

function inferModelId(batch: NormalizedBatch): string | null {
  for (const record of batch.records) {
    const payloadModel = (record as unknown as { cdmModelId?: string }).cdmModelId;
    if (payloadModel) {
      return payloadModel;
    }
  }
  return null;
}

function buildRow(record: NormalizedRecord, definition: TableDefinition): unknown[] {
  const payload = ensureRecordPayload(record.payload);
  return definition.columns.map((column) => column.extract(payload, record));
}

function ensureRecordPayload(payload: NormalizedRecord["payload"]): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  throw new Error("CDM payload must be an object");
}

async function upsertRows(
  connection: PoolHandle,
  config: SinkConnectionConfig,
  definition: TableDefinition,
  rows: unknown[][],
) {
  if (!rows.length) {
    return;
  }
  const columns = definition.columns.map((column) => column.name);
  const primaryIndex = columns.indexOf("cdm_id");
  if (primaryIndex === -1) {
    throw new Error("CDM tables must include a cdm_id column");
  }
  const dedupedRows = dedupeRowsByPrimaryKey(rows, primaryIndex);
  const qualifiedColumns = columns.map(quoteIdent).join(", ");
  const valueClause = buildValuesClause(dedupedRows);
  const updateClause = columns
    .filter((name) => name !== "cdm_id")
    .map((name) => `${quoteIdent(name)} = EXCLUDED.${quoteIdent(name)}`)
    .join(", ");
  const sql = `INSERT INTO ${qualifiedTable(config, definition)} (${qualifiedColumns}) VALUES ${valueClause} ON CONFLICT (cdm_id)
    DO UPDATE SET ${updateClause}`;
  const values = dedupedRows.flat();
  await connection.query(sql, values);
}

function dedupeRowsByPrimaryKey(rows: unknown[][], primaryIndex: number): unknown[][] {
  const unique = new Map<string, unknown[]>();
  for (const row of rows) {
    const key = row[primaryIndex];
    if (key === undefined || key === null) {
      continue;
    }
    unique.set(String(key), row);
  }
  return Array.from(unique.values());
}

function buildValuesClause(rows: unknown[][]): string {
  if (rows.length === 0) {
    return "";
  }
  const columnCount = rows[0].length;
  return rows
    .map((_, rowIndex) => {
      const start = rowIndex * columnCount;
      const placeholders = Array.from({ length: columnCount }, (_unused, colIndex) => `$${start + colIndex + 1}`);
      return `(${placeholders.join(", ")})`;
    })
    .join(", ");
}

function qualifiedTable(config: SinkConnectionConfig, definition: TableDefinition): string {
  const schema = quoteIdent(config.schema);
  const table = quoteIdent(`${config.tablePrefix}${definition.suffix}`);
  return `${schema}.${table}`;
}

export function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function parseSinkEndpointConfig(endpoint: MetadataEndpointDescriptor): SinkConnectionConfig {
  const parameters = extractEndpointParameters(endpoint);
  const connectionUrl = stringOrNull(parameters.connection_url) ?? stringOrNull(parameters.connectionUrl);
  if (!connectionUrl) {
    throw new Error("CDM sink endpoint is missing connection_url");
  }
  const schema = stringOrNull(parameters.schema) ?? "cdm_work";
  const tablePrefix = stringOrNull(parameters.table_prefix) ?? "cdm_";
  const sslMode = (stringOrNull(parameters.ssl_mode) ?? "prefer").toLowerCase();
  return {
    connectionUrl,
    schema,
    tablePrefix,
    ssl: buildSslConfig(sslMode),
  };
}

function extractEndpointParameters(endpoint: MetadataEndpointDescriptor): Record<string, unknown> {
  const config = endpoint.config && typeof endpoint.config === "object" ? (endpoint.config as Record<string, unknown>) : {};
  if (config.parameters && typeof config.parameters === "object") {
    return config.parameters as Record<string, unknown>;
  }
  return config;
}

function buildSslConfig(mode: string): boolean | { rejectUnauthorized: boolean } | undefined {
  if (mode === "disable") {
    return undefined;
  }
  if (mode === "verify-full") {
    return { rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

function normalizePrimitive(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === "string" ? value : String(value);
}

function normalizeJson(value: unknown, fallback: () => unknown) {
  if (value && typeof value === "object") {
    return value;
  }
  return fallback();
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    }
    if (value.toLowerCase() === "false") {
      return false;
    }
  }
  return value == null ? null : Boolean(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && !Number.isNaN(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function toDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  const parsed = new Date(value as string);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}
