import { CdmWorkStore, type CdmWorkItemRow, type WorkItemFilter, encodeCursor as encodeWorkCursor } from "./workStore.js";
import { CdmDocStore, type CdmDocItemRow, type DocItemFilter } from "./docStore.js";

export type CdmEntityDomain = "WORK_ITEM" | "DOC_ITEM";

export type CdmEntityStoreFilter = {
  domain: CdmEntityDomain;
  sourceSystems?: string[] | null;
  search?: string | null;
  workProjectIds?: string[] | null;
  docSpaceIds?: string[] | null;
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
    sourceSystems: filter.sourceSystems ?? null,
    spaceCdmIds: filter.docSpaceIds ?? null,
    search: filter.search ?? null,
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
  return {
    domain: "DOC_ITEM",
    cdmId: row.cdm_id,
    sourceSystem: row.source_system,
    title: row.title ?? row.source_item_id,
    createdAt: serializeTimestamp(row.created_at),
    updatedAt: serializeTimestamp(row.updated_at),
    state: row.doc_type ?? null,
    data: {
      docType: row.doc_type,
      mimeType: row.mime_type,
      spaceCdmId: row.space_cdm_id,
      parentItemCdmId: row.parent_item_cdm_id,
      createdByCdmId: row.created_by_cdm_id,
      updatedByCdmId: row.updated_by_cdm_id,
      url: row.url,
      tags: normalizeJson(row.tags, []),
      properties: normalizeJson(row.properties, {}),
      createdAt: serializeTimestamp(row.created_at),
      updatedAt: serializeTimestamp(row.updated_at),
    },
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
