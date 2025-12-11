import type { SinkConnectionConfig } from "../ingestion/cdmSink.js";
import { getCdmSinkPool, resolveFallbackConfigFromEnv, type PoolEntry } from "./cdmPool.js";

export type CdmWorkProjectRow = {
  cdm_id: string;
  source_system: string;
  source_project_key: string;
  name: string;
  description: string | null;
  url?: string | null;
  properties: Record<string, unknown> | null;
};

export type CdmWorkUserRow = {
  cdm_id: string;
  source_system?: string | null;
  source_user_id?: string | null;
  display_name: string | null;
  email: string | null;
  active?: boolean | null;
  properties: Record<string, unknown> | null;
};

export type CdmWorkItemRow = {
  cdm_id: string;
  source_system: string;
  source_id: string | null;
  source_issue_key: string;
  source_url: string | null;
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
  raw_source: Record<string, unknown> | null;
  properties: Record<string, unknown> | null;
};

export type CdmWorkCommentRow = {
  cdm_id: string;
  source_system: string;
  item_cdm_id: string;
  author_cdm_id: string | null;
  body: string;
  created_at: Date | null;
  updated_at: Date | null;
  author_display_name: string | null;
  author_email: string | null;
  visibility: string | null;
  properties: Record<string, unknown> | null;
  item_project_cdm_id?: string | null;
  item_source_issue_key?: string | null;
};

export type CdmWorkLogRow = {
  cdm_id: string;
  source_system: string;
  item_cdm_id: string;
  author_cdm_id: string | null;
  started_at: Date | null;
  time_spent_seconds: number | null;
  comment: string | null;
  author_display_name: string | null;
  author_email: string | null;
  properties: Record<string, unknown> | null;
  item_project_cdm_id?: string | null;
  item_source_issue_key?: string | null;
};

export type WorkItemFilter = {
  projectCdmId?: string | null;
  statusIn?: string[] | null;
  sourceSystems?: string[] | null;
  search?: string | null;
  datasetIds?: string[] | null;
};

export type WorkProjectFilter = {
  sourceSystems?: string[] | null;
  search?: string | null;
  datasetIds?: string[] | null;
};

export type WorkCommentFilter = {
  projectCdmId?: string | null;
  sourceSystems?: string[] | null;
  datasetIds?: string[] | null;
  parentKeys?: string[] | null;
  authorIds?: string[] | null;
  search?: string | null;
};

export type WorkLogFilter = {
  projectCdmId?: string | null;
  sourceSystems?: string[] | null;
  datasetIds?: string[] | null;
  parentKeys?: string[] | null;
  authorIds?: string[] | null;
  startedFrom?: Date | string | null;
  startedTo?: Date | string | null;
  search?: string | null;
};

export type WorkUserFilter = {
  sourceSystems?: string[] | null;
  datasetIds?: string[] | null;
  search?: string | null;
  active?: boolean | null;
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const DATASET_METADATA_KEY = "sourceDatasetId";

export class CdmWorkStore {
  async listProjects(projectId?: string | null): Promise<CdmWorkProjectRow[]> {
    const { pool, config } = await this.ensurePool(projectId);
    const sql = `SELECT cdm_id, source_system, source_project_key, name, description, url, properties FROM ${projectTable(config)} ORDER BY name ASC`;
    const result = await pool.query(sql);
    return result.rows as CdmWorkProjectRow[];
  }

  async listWorkProjects(args: {
    projectId?: string | null;
    filter?: WorkProjectFilter | null;
    first?: number | null;
    after?: string | null;
  }): Promise<{ rows: CdmWorkProjectRow[]; cursorOffset: number; hasNextPage: boolean }> {
    const { pool, config } = await this.ensurePool(args.projectId);
    const limit = Math.min(Math.max(args.first ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = args.after ? decodeCursor(args.after) : 0;
    const { whereClause, params } = buildWorkProjectWhereClause(args.filter);
    const sql = `SELECT project.cdm_id, project.source_system, project.source_project_key, project.name, project.description, project.url, project.properties
      FROM ${projectTable(config)} AS project
      ${whereClause}
      ORDER BY project.name ASC NULLS LAST, project.cdm_id ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const queryParams = [...params, limit + 1, offset];
    const result = await pool.query(sql, queryParams);
    const rows = result.rows.slice(0, limit) as CdmWorkProjectRow[];
    const hasNextPage = result.rows.length > limit;
    return { rows, cursorOffset: offset, hasNextPage };
  }

  async listWorkUsers(args: {
    projectId?: string | null;
    filter?: WorkUserFilter | null;
    first?: number | null;
    after?: string | null;
  }): Promise<{ rows: CdmWorkUserRow[]; cursorOffset: number; hasNextPage: boolean }> {
    const { pool, config } = await this.ensurePool(args.projectId);
    const limit = Math.min(Math.max(args.first ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = args.after ? decodeCursor(args.after) : 0;
    const { whereClause, params } = buildWorkUserWhereClause(args.filter);
    const sql = `SELECT user_table.cdm_id, user_table.source_system, user_table.source_user_id, user_table.display_name, user_table.email, user_table.active, user_table.properties
      FROM ${userTable(config)} AS user_table
      ${whereClause}
      ORDER BY user_table.display_name ASC NULLS LAST, user_table.cdm_id ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const queryParams = [...params, limit + 1, offset];
    const result = await pool.query(sql, queryParams);
    const rows = result.rows.slice(0, limit) as CdmWorkUserRow[];
    const hasNextPage = result.rows.length > limit;
    return { rows, cursorOffset: offset, hasNextPage };
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
    const select = `SELECT item.cdm_id, item.source_system, item.source_id, item.source_issue_key, item.source_url, item.project_cdm_id, item.summary, item.status, item.priority, item.assignee_cdm_id, item.reporter_cdm_id, item.created_at, item.updated_at, item.closed_at, item.raw_source, item.properties,
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

  async listWorkComments(args: {
    projectId?: string | null;
    filter?: WorkCommentFilter | null;
    first?: number | null;
    after?: string | null;
  }): Promise<{ rows: CdmWorkCommentRow[]; cursorOffset: number; hasNextPage: boolean }> {
    const { pool, config } = await this.ensurePool(args.projectId);
    const limit = Math.min(Math.max(args.first ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = args.after ? decodeCursor(args.after) : 0;
    const { whereClause, params } = buildWorkCommentWhereClause(args.filter);
    const sql = `SELECT comment.cdm_id, comment.source_system, comment.item_cdm_id, comment.author_cdm_id, comment.body, comment.created_at, comment.updated_at, comment.visibility, comment.properties,
      author.display_name AS author_display_name,
      author.email AS author_email,
      item.project_cdm_id AS item_project_cdm_id,
      item.source_issue_key AS item_source_issue_key
      FROM ${commentTable(config)} AS comment
      LEFT JOIN ${userTable(config)} AS author ON author.cdm_id = comment.author_cdm_id
      LEFT JOIN ${workItemTable(config)} AS item ON item.cdm_id = comment.item_cdm_id
      ${whereClause}
      ORDER BY comment.created_at DESC NULLS LAST, comment.cdm_id ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const queryParams = [...params, limit + 1, offset];
    const result = await pool.query(sql, queryParams);
    const rows = result.rows.slice(0, limit) as CdmWorkCommentRow[];
    const hasNextPage = result.rows.length > limit;
    return { rows, cursorOffset: offset, hasNextPage };
  }

  async listWorkLogs(args: {
    projectId?: string | null;
    filter?: WorkLogFilter | null;
    first?: number | null;
    after?: string | null;
  }): Promise<{ rows: CdmWorkLogRow[]; cursorOffset: number; hasNextPage: boolean }> {
    const { pool, config } = await this.ensurePool(args.projectId);
    const limit = Math.min(Math.max(args.first ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = args.after ? decodeCursor(args.after) : 0;
    const { whereClause, params } = buildWorkLogWhereClause(args.filter);
    const sql = `SELECT log.cdm_id, log.source_system, log.item_cdm_id, log.author_cdm_id, log.started_at, log.time_spent_seconds, log.comment, log.properties,
      author.display_name AS author_display_name,
      author.email AS author_email,
      item.project_cdm_id AS item_project_cdm_id,
      item.source_issue_key AS item_source_issue_key
      FROM ${worklogTable(config)} AS log
      LEFT JOIN ${userTable(config)} AS author ON author.cdm_id = log.author_cdm_id
      LEFT JOIN ${workItemTable(config)} AS item ON item.cdm_id = log.item_cdm_id
      ${whereClause}
      ORDER BY log.started_at DESC NULLS LAST, log.cdm_id ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const queryParams = [...params, limit + 1, offset];
    const result = await pool.query(sql, queryParams);
    const rows = result.rows.slice(0, limit) as CdmWorkLogRow[];
    const hasNextPage = result.rows.length > limit;
    return { rows, cursorOffset: offset, hasNextPage };
  }

  async getWorkItemDetail(args: { projectId?: string | null; cdmId: string }) {
    const { pool, config } = await this.ensurePool(args.projectId);
    const itemSql = `SELECT item.cdm_id, item.source_system, item.source_id, item.source_issue_key, item.source_url, item.project_cdm_id, item.summary, item.status, item.priority, item.assignee_cdm_id, item.reporter_cdm_id, item.created_at, item.updated_at, item.closed_at, item.raw_source, item.properties,
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
    const commentsSql = `SELECT comment.cdm_id, comment.source_system, comment.item_cdm_id, comment.author_cdm_id, comment.body, comment.created_at, comment.updated_at, comment.visibility, comment.properties,
      author.display_name AS author_display_name,
      author.email AS author_email
      FROM ${commentTable(config)} AS comment
      LEFT JOIN ${userTable(config)} AS author ON author.cdm_id = comment.author_cdm_id
      WHERE comment.item_cdm_id = $1
      ORDER BY comment.created_at ASC NULLS LAST, comment.cdm_id ASC`;
    const worklogsSql = `SELECT log.cdm_id, log.source_system, log.item_cdm_id, log.author_cdm_id, log.started_at, log.time_spent_seconds, log.comment, log.properties,
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
    const fallbackConfig = resolveFallbackConfigFromEnv("CDM_WORK", { schema: "cdm_work", tablePrefix: "cdm_" });
    return getCdmSinkPool(projectId, fallbackConfig);
  }
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
  if (filter.sourceSystems && filter.sourceSystems.length > 0) {
    params.push(filter.sourceSystems);
    conditions.push(`item.source_system = ANY($${params.length})`);
  }
  if (filter.search && filter.search.trim().length > 0) {
    params.push(`%${filter.search.trim()}%`);
    conditions.push(`item.summary ILIKE $${params.length}`);
  }
  if (filter.datasetIds && filter.datasetIds.length > 0) {
    params.push(filter.datasetIds);
    conditions.push(`(item.properties ->> '${DATASET_METADATA_KEY}') = ANY($${params.length})`);
  }
  if (conditions.length === 0) {
    return { whereClause: "", params };
  }
  return { whereClause: `WHERE ${conditions.join(" AND ")}`, params };
}

function buildWorkCommentWhereClause(filter?: WorkCommentFilter | null) {
  if (!filter) {
    return { whereClause: "", params: [] as unknown[] };
  }
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.projectCdmId) {
    params.push(filter.projectCdmId);
    conditions.push(`item.project_cdm_id = $${params.length}`);
  }
  if (filter.parentKeys && filter.parentKeys.length > 0) {
    params.push(filter.parentKeys);
    conditions.push(`item.source_issue_key = ANY($${params.length})`);
  }
  if (filter.authorIds && filter.authorIds.length > 0) {
    params.push(filter.authorIds);
    conditions.push(`comment.author_cdm_id = ANY($${params.length})`);
  }
  if (filter.sourceSystems && filter.sourceSystems.length > 0) {
    params.push(filter.sourceSystems);
    conditions.push(`comment.source_system = ANY($${params.length})`);
  }
  if (filter.datasetIds && filter.datasetIds.length > 0) {
    params.push(filter.datasetIds);
    conditions.push(`(comment.properties ->> '${DATASET_METADATA_KEY}') = ANY($${params.length})`);
  }
  if (filter.search && filter.search.trim().length > 0) {
    params.push(`%${filter.search.trim()}%`);
    conditions.push(`comment.body ILIKE $${params.length}`);
  }
  if (conditions.length === 0) {
    return { whereClause: "", params };
  }
  return { whereClause: `WHERE ${conditions.join(" AND ")}`, params };
}

function buildWorkLogWhereClause(filter?: WorkLogFilter | null) {
  if (!filter) {
    return { whereClause: "", params: [] as unknown[] };
  }
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.projectCdmId) {
    params.push(filter.projectCdmId);
    conditions.push(`item.project_cdm_id = $${params.length}`);
  }
  if (filter.parentKeys && filter.parentKeys.length > 0) {
    params.push(filter.parentKeys);
    conditions.push(`item.source_issue_key = ANY($${params.length})`);
  }
  if (filter.authorIds && filter.authorIds.length > 0) {
    params.push(filter.authorIds);
    conditions.push(`log.author_cdm_id = ANY($${params.length})`);
  }
  if (filter.sourceSystems && filter.sourceSystems.length > 0) {
    params.push(filter.sourceSystems);
    conditions.push(`log.source_system = ANY($${params.length})`);
  }
  if (filter.datasetIds && filter.datasetIds.length > 0) {
    params.push(filter.datasetIds);
    conditions.push(`(log.properties ->> '${DATASET_METADATA_KEY}') = ANY($${params.length})`);
  }
  if (filter.startedFrom) {
    params.push(filter.startedFrom);
    conditions.push(`log.started_at >= $${params.length}`);
  }
  if (filter.startedTo) {
    params.push(filter.startedTo);
    conditions.push(`log.started_at <= $${params.length}`);
  }
  if (filter.search && filter.search.trim().length > 0) {
    params.push(`%${filter.search.trim()}%`);
    conditions.push(`(log.comment ILIKE $${params.length})`);
  }
  if (conditions.length === 0) {
    return { whereClause: "", params };
  }
  return { whereClause: `WHERE ${conditions.join(" AND ")}`, params };
}

function buildWorkProjectWhereClause(filter?: WorkProjectFilter | null) {
  if (!filter) {
    return { whereClause: "", params: [] as unknown[] };
  }
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.sourceSystems && filter.sourceSystems.length > 0) {
    params.push(filter.sourceSystems);
    conditions.push(`project.source_system = ANY($${params.length})`);
  }
  if (filter.datasetIds && filter.datasetIds.length > 0) {
    params.push(filter.datasetIds);
    conditions.push(`(project.properties ->> '${DATASET_METADATA_KEY}') = ANY($${params.length})`);
  }
  if (filter.search && filter.search.trim().length > 0) {
    params.push(`%${filter.search.trim()}%`);
    conditions.push(
      `(project.name ILIKE $${params.length} OR project.source_project_key ILIKE $${params.length})`,
    );
  }
  if (conditions.length === 0) {
    return { whereClause: "", params };
  }
  return { whereClause: `WHERE ${conditions.join(" AND ")}`, params };
}

function buildWorkUserWhereClause(filter?: WorkUserFilter | null) {
  if (!filter) {
    return { whereClause: "", params: [] as unknown[] };
  }
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.sourceSystems && filter.sourceSystems.length > 0) {
    params.push(filter.sourceSystems);
    conditions.push(`user_table.source_system = ANY($${params.length})`);
  }
  if (filter.datasetIds && filter.datasetIds.length > 0) {
    params.push(filter.datasetIds);
    conditions.push(`(user_table.properties ->> '${DATASET_METADATA_KEY}') = ANY($${params.length})`);
  }
  if (typeof filter.active === "boolean") {
    params.push(filter.active);
    conditions.push(`COALESCE(user_table.active, false) = $${params.length}`);
  }
  if (filter.search && filter.search.trim().length > 0) {
    params.push(`%${filter.search.trim()}%`);
    conditions.push(
      `(user_table.display_name ILIKE $${params.length} OR user_table.email ILIKE $${params.length} OR user_table.source_user_id ILIKE $${params.length})`,
    );
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
