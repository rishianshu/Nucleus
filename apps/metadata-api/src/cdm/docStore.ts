import type { SinkConnectionConfig } from "../ingestion/cdmSink.js";
import { getCdmSinkPool, resolveFallbackConfigFromEnv, type PoolEntry } from "./cdmPool.js";

export type DocItemFilter = {
  sourceSystems?: string[] | null;
  spaceCdmIds?: string[] | null;
  search?: string | null;
};

export type CdmDocItemRow = {
  cdm_id: string;
  source_system: string;
  source_item_id: string;
  space_cdm_id: string | null;
  parent_item_cdm_id: string | null;
  title: string | null;
  doc_type: string | null;
  mime_type: string | null;
  created_by_cdm_id: string | null;
  updated_by_cdm_id: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  url: string | null;
  tags: unknown;
  properties: unknown;
};

export type CdmDocSpaceRow = {
  cdm_id: string;
  source_system: string;
  source_space_id: string;
  key: string | null;
  name: string | null;
  description: string | null;
  url: string | null;
};

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export class CdmDocStore {
  async listDocItems(args: {
    projectId?: string | null;
    filter?: DocItemFilter | null;
    first?: number | null;
    after?: string | null;
  }): Promise<{ rows: CdmDocItemRow[]; cursorOffset: number; hasNextPage: boolean }> {
    const { pool, config } = await this.ensurePool(args.projectId);
    const limit = Math.min(Math.max(args.first ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = args.after ? decodeCursor(args.after) : 0;
    const { whereClause, params } = buildDocItemWhereClause(args.filter);
    const query = `SELECT cdm_id, source_system, source_item_id, space_cdm_id, parent_item_cdm_id, title, doc_type, mime_type, created_by_cdm_id, updated_by_cdm_id, created_at, updated_at, url, tags, properties
      FROM ${docItemTable(config)}
      ${whereClause}
      ORDER BY updated_at DESC NULLS LAST, cdm_id ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const queryParams = [...params, limit + 1, offset];
    const result = await pool.query(query, queryParams);
    const rows = result.rows.slice(0, limit) as CdmDocItemRow[];
    const hasNextPage = result.rows.length > limit;
    return { rows, cursorOffset: offset, hasNextPage };
  }

  async getDocItem(args: { projectId?: string | null; cdmId: string }): Promise<CdmDocItemRow | null> {
    const { pool, config } = await this.ensurePool(args.projectId);
    const sql = `SELECT cdm_id, source_system, source_item_id, space_cdm_id, parent_item_cdm_id, title, doc_type, mime_type, created_by_cdm_id, updated_by_cdm_id, created_at, updated_at, url, tags, properties
      FROM ${docItemTable(config)}
      WHERE cdm_id = $1`;
    const result = await pool.query(sql, [args.cdmId]);
    if (result.rowCount === 0) {
      return null;
    }
    return result.rows[0] as CdmDocItemRow;
  }

  async listSpaces(args?: { projectId?: string | null }): Promise<CdmDocSpaceRow[]> {
    const { pool, config } = await this.ensurePool(args?.projectId);
    const sql = `SELECT cdm_id, source_system, source_space_id, key, name, description, url FROM ${docSpaceTable(config)} ORDER BY name ASC NULLS LAST, cdm_id ASC`;
    const result = await pool.query(sql);
    return result.rows as CdmDocSpaceRow[];
  }

  private async ensurePool(projectId?: string | null): Promise<PoolEntry> {
    const fallbackConfig = resolveFallbackConfigFromEnv("CDM_DOC", { schema: "cdm_docs", tablePrefix: "cdm_" });
    return getCdmSinkPool(projectId, fallbackConfig);
  }
}

function buildDocItemWhereClause(filter?: DocItemFilter | null) {
  if (!filter) {
    return { whereClause: "", params: [] as unknown[] };
  }
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.sourceSystems && filter.sourceSystems.length > 0) {
    params.push(filter.sourceSystems);
    conditions.push(`source_system = ANY($${params.length})`);
  }
  if (filter.spaceCdmIds && filter.spaceCdmIds.length > 0) {
    params.push(filter.spaceCdmIds);
    conditions.push(`space_cdm_id = ANY($${params.length})`);
  }
  if (filter.search && filter.search.trim().length > 0) {
    params.push(`%${filter.search.trim()}%`);
    conditions.push(`title ILIKE $${params.length}`);
  }
  if (conditions.length === 0) {
    return { whereClause: "", params };
  }
  return { whereClause: `WHERE ${conditions.join(" AND ")}`, params };
}

function docItemTable(config: SinkConnectionConfig) {
  return `${quoteIdent(config.schema)}.${quoteIdent(`${config.tablePrefix}doc_item`)}`;
}

function docSpaceTable(config: SinkConnectionConfig) {
  return `${quoteIdent(config.schema)}.${quoteIdent(`${config.tablePrefix}doc_space`)}`;
}

function quoteIdent(input: string) {
  return `"${input.replace(/"/g, '""')}"`;
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
