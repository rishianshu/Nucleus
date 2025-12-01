import { CdmWorkStore, type CdmWorkItemRow, type WorkItemFilter, encodeCursor as encodeWorkCursor } from "./workStore.js";
import { CdmDocStore, type CdmDocItemRow, type DocItemFilter } from "./docStore.js";
import { describeDocDataset } from "./docHelpers.js";

export type CdmEntityDomain = "WORK_ITEM" | "DOC_ITEM";

export type CdmEntityStoreFilter = {
  domain: CdmEntityDomain;
  sourceSystems?: string[] | null;
  search?: string | null;
  workProjectIds?: string[] | null;
  docSpaceIds?: string[] | null;
  docDatasetIds?: string[] | null;
  docSourceSystems?: string[] | null;
  docSearch?: string | null;
};

export type CdmEntityEnvelope = {
  domain: CdmEntityDomain;
  cdmId: string;
  sourceSystem: string;
  title: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  state: string | null;
  data: Record<string, unknown>;
  docTitle?: string | null;
  docType?: string | null;
  docProjectKey?: string | null;
  docProjectName?: string | null;
  docLocation?: string | null;
  docUpdatedAt?: string | null;
  docSourceSystem?: string | null;
  docDatasetId?: string | null;
  docDatasetName?: string | null;
  docSourceEndpointId?: string | null;
  docUrl?: string | null;
  docContentExcerpt?: string | null;
};

type ListResult = {
  rows: CdmEntityEnvelope[];
  cursorOffset: number;
  hasNextPage: boolean;
};

type GetResult = CdmEntityEnvelope | null;

type StoreDeps = {
  workStore?: CdmWorkStore;
  docStore?: CdmDocStore;
};

export class CdmEntityStore {
  private readonly workStore: CdmWorkStore;
  private readonly docStore: CdmDocStore;

  constructor(options?: StoreDeps) {
    this.workStore = options?.workStore ?? new CdmWorkStore();
    this.docStore = options?.docStore ?? new CdmDocStore();
  }

  async listEntities(args: {
    projectId?: string | null;
    filter: CdmEntityStoreFilter;
    first?: number | null;
    after?: string | null;
  }): Promise<ListResult> {
    if (args.filter.domain === "WORK_ITEM") {
      const { rows, cursorOffset, hasNextPage } = await this.workStore.listWorkItems({
        projectId: args.projectId,
        filter: mapWorkFilter(args.filter),
        first: args.first,
        after: args.after ?? null,
      });
      return {
        rows: rows.map(mapWorkRow),
        cursorOffset,
        hasNextPage,
      };
    }
    if (args.filter.domain === "DOC_ITEM") {
      const { rows, cursorOffset, hasNextPage } = await this.docStore.listDocItems({
        projectId: args.projectId,
        filter: mapDocFilter(args.filter),
        first: args.first,
        after: args.after ?? null,
      });
      return {
        rows: rows.map(mapDocRow),
        cursorOffset,
        hasNextPage,
      };
    }
    return { rows: [], cursorOffset: 0, hasNextPage: false };
  }

  async getEntity(args: { projectId?: string | null; domain: CdmEntityDomain; cdmId: string }): Promise<GetResult> {
    if (args.domain === "WORK_ITEM") {
      const result = await this.workStore.getWorkItemDetail({ projectId: args.projectId, cdmId: args.cdmId });
      if (!result) {
        return null;
      }
      return mapWorkRow(result.item);
    }
    if (args.domain === "DOC_ITEM") {
      const row = await this.docStore.getDocItem({ projectId: args.projectId, cdmId: args.cdmId });
      if (!row) {
        return null;
      }
      return mapDocRow(row);
    }
    return null;
  }
}

function mapWorkFilter(filter: CdmEntityStoreFilter): WorkItemFilter {
  return {
    projectCdmId: filter.workProjectIds?.[0] ?? null,
    sourceSystems: filter.sourceSystems ?? null,
    search: filter.search ?? null,
  };
}

function mapDocFilter(filter: CdmEntityStoreFilter): DocItemFilter {
  return {
    sourceSystems: filter.docSourceSystems ?? filter.sourceSystems ?? null,
    spaceCdmIds: filter.docSpaceIds ?? null,
    datasetIds: filter.docDatasetIds ?? null,
    search: filter.docSearch ?? filter.search ?? null,
  };
}

function mapWorkRow(row: CdmWorkItemRow): CdmEntityEnvelope {
  return {
    domain: "WORK_ITEM",
    cdmId: row.cdm_id,
    sourceSystem: row.source_system,
    title: row.summary ?? row.source_issue_key,
    createdAt: serializeTimestamp(row.created_at),
    updatedAt: serializeTimestamp(row.updated_at ?? row.closed_at ?? row.created_at),
    state: row.status ?? null,
    data: {
      sourceIssueKey: row.source_issue_key,
      projectCdmId: row.project_cdm_id,
      summary: row.summary,
      status: row.status,
      priority: row.priority,
      assignee: row.assignee_cdm_id
        ? {
            cdmId: row.assignee_cdm_id,
            displayName: row.assignee_display_name,
            email: row.assignee_email,
          }
        : null,
      reporter: row.reporter_cdm_id
        ? {
            cdmId: row.reporter_cdm_id,
            displayName: row.reporter_display_name,
            email: row.reporter_email,
          }
        : null,
      createdAt: serializeTimestamp(row.created_at),
      updatedAt: serializeTimestamp(row.updated_at),
      closedAt: serializeTimestamp(row.closed_at),
    },
  };
}

function mapDocRow(row: CdmDocItemRow): CdmEntityEnvelope {
  const properties = normalizeJson(row.properties, {}) as Record<string, unknown>;
  const safeProperties = isPlainObject(properties) ? (properties as Record<string, unknown>) : {};
  const metadata = extractDocSourceMetadata(safeProperties);
  const datasetName = metadata.datasetId ? describeDocDataset(metadata.datasetId) : null;
  const projectKey = coerceString(row.space_key) ?? coerceString(safeProperties["spaceKey"]);
  const projectName = coerceString(row.space_name) ?? coerceString(safeProperties["spaceName"]);
  const location = buildDocLocation(row, safeProperties);
  const excerpt = extractDocContentExcerpt(safeProperties);
  const docType = row.doc_type ?? row.mime_type ?? null;
  return {
    domain: "DOC_ITEM",
    cdmId: row.cdm_id,
    sourceSystem: row.source_system,
    title: row.title ?? row.source_item_id,
    createdAt: serializeTimestamp(row.created_at),
    updatedAt: serializeTimestamp(row.updated_at),
    state: docType,
    data: {
      docType,
      mimeType: row.mime_type,
      spaceCdmId: row.space_cdm_id,
      spaceKey: projectKey,
      spaceName: projectName,
      spaceUrl: row.space_url,
      parentItemCdmId: row.parent_item_cdm_id,
      createdByCdmId: row.created_by_cdm_id,
      updatedByCdmId: row.updated_by_cdm_id,
      url: row.url,
      tags: normalizeJson(row.tags, []),
      properties: safeProperties,
      createdAt: serializeTimestamp(row.created_at),
      updatedAt: serializeTimestamp(row.updated_at),
      datasetId: metadata.datasetId,
      datasetName,
      sourceEndpointId: metadata.endpointId,
    },
    docTitle: row.title ?? row.source_item_id,
    docType,
    docProjectKey: projectKey,
    docProjectName: projectName,
    docLocation: location,
    docUpdatedAt: serializeTimestamp(row.updated_at),
    docSourceSystem: row.source_system,
    docDatasetId: metadata.datasetId,
    docDatasetName: datasetName,
    docSourceEndpointId: metadata.endpointId,
    docUrl: row.url,
    docContentExcerpt: excerpt,
  };
}

function serializeTimestamp(input: Date | null | undefined): string | null {
  if (!input) {
    return null;
  }
  return new Date(input).toISOString();
}

function normalizeJson(value: unknown, fallback: unknown) {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    if (typeof value === "string") {
      return JSON.parse(value);
    }
  } catch {
    // ignore parse errors
  }
  return fallback;
}

export { encodeWorkCursor as encodeCursor };

function extractDocSourceMetadata(properties: Record<string, unknown>) {
  const metadataBlock = isPlainObject(properties["_metadata"]) ? (properties["_metadata"] as Record<string, unknown>) : {};
  const datasetId = coerceString(metadataBlock["sourceDatasetId"]);
  const endpointId = coerceString(metadataBlock["sourceEndpointId"]);
  return { datasetId, endpointId };
}

function buildDocLocation(row: CdmDocItemRow, properties: Record<string, unknown>) {
  const segments: string[] = [];
  const path = coerceString(properties["path"]);
  const spaceName = coerceString(row.space_name) ?? coerceString(properties["spaceName"]);
  if (spaceName) {
    segments.push(spaceName);
  }
  if (path && path !== spaceName) {
    segments.push(path);
  }
  return segments.length ? segments.join(" • ") : null;
}

function extractDocContentExcerpt(properties: Record<string, unknown>) {
  const metadata = isPlainObject(properties["metadata"]) ? (properties["metadata"] as Record<string, unknown>) : {};
  const metadataExcerpt = coerceString(metadata["excerpt"] ?? metadata["summary"]);
  if (metadataExcerpt) {
    return clampExcerpt(metadataExcerpt);
  }
  const raw = isPlainObject(properties["raw"]) ? (properties["raw"] as Record<string, unknown>) : null;
  if (raw) {
    const storage = isPlainObject(raw["body"]) ? (raw["body"] as Record<string, unknown>) : null;
    if (storage && isPlainObject(storage["storage"])) {
      const html = coerceString((storage["storage"] as Record<string, unknown>)["value"]);
      if (html) {
        return clampExcerpt(stripHtml(html));
      }
    }
    if (storage && isPlainObject(storage["atlas_doc_format"])) {
      const html = coerceString((storage["atlas_doc_format"] as Record<string, unknown>)["value"]);
      if (html) {
        return clampExcerpt(stripHtml(html));
      }
    }
  }
  const path = coerceString(properties["path"]);
  return path ? clampExcerpt(path) : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return null;
}

function stripHtml(input: string) {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function clampExcerpt(input: string, limit = 280) {
  if (input.length <= limit) {
    return input.trim();
  }
  return `${input.slice(0, limit).trim()}…`;
}
