import { Pool } from "pg";
import type { MetadataEndpointDescriptor } from "@metadata/core";
import { getMetadataStore } from "../context.js";
import { parseSinkEndpointConfig, type SinkConnectionConfig } from "../ingestion/cdmSink.js";

const CDM_SINK_LABEL = "sink:cdm";
const CDM_SINK_TEMPLATE_ID = "cdm.jdbc";
const FALLBACK_POOL_KEY = "cdm-fallback";

export type CdmWorkProjectRow = {
  cdm_id: string;
  source_system: string;
  source_project_key: string;
  name: string;
  description: string | null;
};

export type CdmWorkUserRow = {
  cdm_id: string;
  display_name: string | null;
  email: string | null;
};

export type CdmWorkItemRow = {
  cdm_id: string;
  source_system: string;
  source_issue_key: string;
  project_cdm_id: string;
  summary: string;
  status: string | null;
  priority: string | null;
  assignee_cdm_id: string | null;
  reporter_cdm_id: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  closed_at: Date | null;
  reporter_display_name: string | null;
  reporter_email: string | null;
  assignee_display_name: string | null;
  assignee_email: string | null;
};

export type CdmWorkCommentRow = {
  cdm_id: string;
  item_cdm_id: string;
  author_cdm_id: string | null;
  body: string;
  created_at: Date | null;
  author_display_name: string | null;
  author_email: string | null;
};

export type CdmWorkLogRow = {
  cdm_id: string;
  item_cdm_id: string;
  author_cdm_id: string | null;
  started_at: Date | null;
  time_spent_seconds: number | null;
  comment: string | null;
  author_display_name: string | null;
  author_email: string | null;
};

export type WorkItemFilter = {
  projectCdmId?: string | null;
  statusIn?: string[] | null;
  search?: string | null;
};

type PoolEntry = {
  pool: Pool;
  config: SinkConnectionConfig;
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export class CdmWorkStore {
  private readonly pools = new Map<string, PoolEntry>();

  async listProjects(projectId?: string | null): Promise<CdmWorkProjectRow[]> {
    const { pool, config } = await this.ensurePool(projectId);
    const sql = `SELECT cdm_id, source_system, source_project_key, name, description FROM ${projectTable(config)} ORDER BY name ASC`;
    const result = await pool.query(sql);
    return result.rows as CdmWorkProjectRow[];
  }

  async listWorkItems(args: {
    projectId?: string | null;
    filter?: WorkItemFilter | null;
    first?: number | null;
    after?: string | null;
  }): Promise<{ rows: CdmWorkItemRow[]; cursorOffset: number; hasNextPage: boolean }> {
    const { pool, config } = await this.ensurePool(args.projectId);
    const limit = Math.min(Math.max(args.first ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = args.after ? decodeCursor(args.after) : 0;
    const { whereClause, params } = buildWorkItemWhereClause(args.filter);
    const select = `SELECT item.cdm_id, item.source_system, item.source_issue_key, item.project_cdm_id, item.summary, item.status, item.priority, item.assignee_cdm_id, item.reporter_cdm_id, item.created_at, item.updated_at, item.closed_at,
      reporter.display_name AS reporter_display_name,
      reporter.email AS reporter_email,
      assignee.display_name AS assignee_display_name,
      assignee.email AS assignee_email
      FROM ${workItemTable(config)} AS item
      LEFT JOIN ${userTable(config)} AS reporter ON reporter.cdm_id = item.reporter_cdm_id
      LEFT JOIN ${userTable(config)} AS assignee ON assignee.cdm_id = item.assignee_cdm_id
      ${whereClause}
      ORDER BY item.created_at DESC NULLS LAST, item.cdm_id ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const queryParams = [...params, limit + 1, offset];
    const result = await pool.query(select, queryParams);
    const rows = result.rows.slice(0, limit) as CdmWorkItemRow[];
    const hasNextPage = result.rows.length > limit;
    return { rows, cursorOffset: offset, hasNextPage };
  }

  async getWorkItemDetail(args: { projectId?: string | null; cdmId: string }) {
    const { pool, config } = await this.ensurePool(args.projectId);
    const itemSql = `SELECT item.cdm_id, item.source_system, item.source_issue_key, item.project_cdm_id, item.summary, item.status, item.priority, item.assignee_cdm_id, item.reporter_cdm_id, item.created_at, item.updated_at, item.closed_at,
      reporter.display_name AS reporter_display_name,
      reporter.email AS reporter_email,
      assignee.display_name AS assignee_display_name,
      assignee.email AS assignee_email
      FROM ${workItemTable(config)} AS item
      LEFT JOIN ${userTable(config)} AS reporter ON reporter.cdm_id = item.reporter_cdm_id
      LEFT JOIN ${userTable(config)} AS assignee ON assignee.cdm_id = item.assignee_cdm_id
      WHERE item.cdm_id = $1`;
    const itemResult = await pool.query(itemSql, [args.cdmId]);
    if (itemResult.rowCount === 0) {
      return null;
    }
    const commentsSql = `SELECT comment.cdm_id, comment.item_cdm_id, comment.author_cdm_id, comment.body, comment.created_at,
      author.display_name AS author_display_name,
      author.email AS author_email
      FROM ${commentTable(config)} AS comment
      LEFT JOIN ${userTable(config)} AS author ON author.cdm_id = comment.author_cdm_id
      WHERE comment.item_cdm_id = $1
      ORDER BY comment.created_at ASC NULLS LAST, comment.cdm_id ASC`;
    const worklogsSql = `SELECT log.cdm_id, log.item_cdm_id, log.author_cdm_id, log.started_at, log.time_spent_seconds, log.comment,
      author.display_name AS author_display_name,
      author.email AS author_email
      FROM ${worklogTable(config)} AS log
      LEFT JOIN ${userTable(config)} AS author ON author.cdm_id = log.author_cdm_id
      WHERE log.item_cdm_id = $1
      ORDER BY log.started_at ASC NULLS LAST, log.cdm_id ASC`;
    const [commentsResult, worklogsResult] = await Promise.all([
      pool.query(commentsSql, [args.cdmId]),
      pool.query(worklogsSql, [args.cdmId]),
    ]);
    return {
      item: itemResult.rows[0] as CdmWorkItemRow,
      comments: commentsResult.rows as CdmWorkCommentRow[],
      worklogs: worklogsResult.rows as CdmWorkLogRow[],
    };
  }

  private async ensurePool(projectId?: string | null): Promise<PoolEntry> {
    const store = await getMetadataStore();
    const endpoints = await store.listEndpoints(projectId ?? undefined);
    let sinkEndpoint = endpoints.find((endpoint) => isCdmSinkEndpoint(endpoint));
    if (!sinkEndpoint) {
      const allEndpoints = projectId ? await store.listEndpoints() : endpoints;
      sinkEndpoint = allEndpoints.find((endpoint) => isCdmSinkEndpoint(endpoint));
    }
    if (sinkEndpoint?.id) {
      const existing = this.pools.get(sinkEndpoint.id);
      if (existing) {
        return existing;
      }
      const config = parseSinkEndpointConfig(sinkEndpoint);
      const pool = new Pool({
        connectionString: config.connectionUrl,
        ssl: config.ssl,
        max: 5,
      });
      const entry = { pool, config };
      this.pools.set(sinkEndpoint.id, entry);
      return entry;
    }
    const fallbackConfig = resolveFallbackConfig();
    if (!fallbackConfig) {
      throw new Error("CDM sink endpoint is not registered and no fallback connection configured");
    }
    const existingFallback = this.pools.get(FALLBACK_POOL_KEY);
    if (existingFallback) {
      return existingFallback;
    }
    const fallbackPool = new Pool({
      connectionString: fallbackConfig.connectionUrl,
      ssl: fallbackConfig.ssl,
      max: 5,
    });
    const fallbackEntry = { pool: fallbackPool, config: fallbackConfig };
    this.pools.set(FALLBACK_POOL_KEY, fallbackEntry);
    return fallbackEntry;
  }
}

function isCdmSinkEndpoint(endpoint: MetadataEndpointDescriptor) {
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

function buildWorkItemWhereClause(filter?: WorkItemFilter | null) {
  if (!filter) {
    return { whereClause: "", params: [] as unknown[] };
  }
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.projectCdmId) {
    params.push(filter.projectCdmId);
    conditions.push(`item.project_cdm_id = $${params.length}`);
  }
  if (filter.statusIn && filter.statusIn.length > 0) {
    params.push(filter.statusIn);
    conditions.push(`item.status = ANY($${params.length})`);
  }
  if (filter.search && filter.search.trim().length > 0) {
    params.push(`%${filter.search.trim()}%`);
    conditions.push(`item.summary ILIKE $${params.length}`);
  }
  if (conditions.length === 0) {
    return { whereClause: "", params };
  }
  return { whereClause: `WHERE ${conditions.join(" AND ")}`, params };
}

function projectTable(config: SinkConnectionConfig) {
  return `${quoteIdent(config.schema)}.${quoteIdent(`${config.tablePrefix}work_project`)}`;
}

function workItemTable(config: SinkConnectionConfig) {
  return `${quoteIdent(config.schema)}.${quoteIdent(`${config.tablePrefix}work_item`)}`;
}

function userTable(config: SinkConnectionConfig) {
  return `${quoteIdent(config.schema)}.${quoteIdent(`${config.tablePrefix}work_user`)}`;
}

function commentTable(config: SinkConnectionConfig) {
  return `${quoteIdent(config.schema)}.${quoteIdent(`${config.tablePrefix}work_comment`)}`;
}

function worklogTable(config: SinkConnectionConfig) {
  return `${quoteIdent(config.schema)}.${quoteIdent(`${config.tablePrefix}work_worklog`)}`;
}

function quoteIdent(input: string) {
  return `"${input.replace(/"/g, '""')}"`;
}

export function encodeCursor(offset: number) {
  return Buffer.from(String(offset)).toString("base64");
}

function decodeCursor(cursor: string): number {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf-8");
    const value = Number.parseInt(decoded, 10);
    if (Number.isNaN(value) || value < 0) {
      return 0;
    }
    return value;
  } catch {
    return 0;
  }
}

function resolveFallbackConfig(): SinkConnectionConfig | null {
  const connectionUrl = process.env.CDM_WORK_DATABASE_URL ?? process.env.METADATA_DATABASE_URL;
  if (!connectionUrl) {
    return null;
  }
  const schema = process.env.CDM_WORK_DATABASE_SCHEMA ?? "cdm_work";
  const tablePrefix = process.env.CDM_WORK_DATABASE_TABLE_PREFIX ?? "cdm_";
  const sslEnabled = process.env.CDM_WORK_DATABASE_SSL === "1";
  return {
    connectionUrl,
    schema,
    tablePrefix,
    ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
  };
}
