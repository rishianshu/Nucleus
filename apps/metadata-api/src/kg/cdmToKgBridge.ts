import type { GraphWrite } from "../graph/graphWrite.js";
import { CdmDocStore, type CdmDocItemRow } from "../cdm/docStore.js";
import { CdmWorkStore, encodeCursor as encodeWorkCursor, type CdmWorkItemRow } from "../cdm/workStore.js";
import {
  cleanProperties,
  clampBatchSize,
  deriveProjectKey,
  encodeOffsetCursor,
  normalizeCdmEntityId,
  toIsoString,
} from "./utils.js";

const WORK_NODE_TYPE = "cdm.work.item";
const DOC_NODE_TYPE = "cdm.doc.item";

type WorkStore = Pick<CdmWorkStore, "listWorkItems">;
type DocStore = Pick<CdmDocStore, "listDocItems">;

type PagedResult<T> = {
  rows: T[];
  cursorOffset: number;
  hasNextPage: boolean;
};

export interface CdmToKgBridge {
  syncWorkItemsToKg(options?: { limit?: number; offset?: number; projectId?: string | null }): Promise<{ processed: number }>;
  syncDocItemsToKg(options?: { limit?: number; offset?: number; projectId?: string | null }): Promise<{ processed: number }>;
  syncAllToKg(options?: { batchSize?: number; projectId?: string | null }): Promise<{ workItems: number; docItems: number }>;
}

export class DefaultCdmToKgBridge implements CdmToKgBridge {
  private readonly graphWrite: GraphWrite;
  private readonly workStore: WorkStore;
  private readonly docStore: DocStore;
  private readonly defaultBatchSize: number;

  constructor(options: { graphWrite: GraphWrite; workStore?: WorkStore; docStore?: DocStore; batchSize?: number }) {
    this.graphWrite = options.graphWrite;
    this.workStore = options.workStore ?? new CdmWorkStore();
    this.docStore = options.docStore ?? new CdmDocStore();
    this.defaultBatchSize = clampBatchSize(options.batchSize);
  }

  async syncWorkItemsToKg(options?: { limit?: number; offset?: number; projectId?: string | null }): Promise<{ processed: number }> {
    const batchSize = clampBatchSize(options?.limit, this.defaultBatchSize, 200);
    const processed = await this.syncPaged<CdmWorkItemRow>({
      batchSize,
      initialOffset: options?.offset,
      fetch: (after) =>
        this.workStore.listWorkItems({
          projectId: options?.projectId ?? null,
          first: batchSize,
          after: after ?? undefined,
        }),
      handler: (row) => this.upsertWorkItem(row),
    });
    return { processed };
  }

  async syncDocItemsToKg(options?: { limit?: number; offset?: number; projectId?: string | null }): Promise<{ processed: number }> {
    const batchSize = clampBatchSize(options?.limit, this.defaultBatchSize, 200);
    const processed = await this.syncPaged<CdmDocItemRow>({
      batchSize,
      initialOffset: options?.offset,
      fetch: (after) =>
        this.docStore.listDocItems({
          projectId: options?.projectId ?? null,
          first: batchSize,
          after: after ?? undefined,
        }),
      handler: (row) => this.upsertDocItem(row),
    });
    return { processed };
  }

  async syncAllToKg(options?: { batchSize?: number; projectId?: string | null }): Promise<{ workItems: number; docItems: number }> {
    const batchSize = clampBatchSize(options?.batchSize, this.defaultBatchSize, 200);
    const workItems = await this.syncWorkItemsToKg({ limit: batchSize, projectId: options?.projectId ?? null });
    const docItems = await this.syncDocItemsToKg({ limit: batchSize, projectId: options?.projectId ?? null });
    return { workItems: workItems.processed, docItems: docItems.processed };
  }

  private async syncPaged<T>(args: {
    batchSize: number;
    initialOffset?: number;
    fetch: (after?: string | null) => Promise<PagedResult<T>>;
    handler: (row: T) => Promise<void>;
  }): Promise<number> {
    let after: string | null | undefined = encodeOffsetCursor(args.initialOffset) ?? null;
    let processed = 0;
    while (true) {
      const page = await args.fetch(after ?? undefined);
      if (!page.rows.length) {
        break;
      }
      for (const row of page.rows) {
        await args.handler(row);
      }
      processed += page.rows.length;
      if (!page.hasNextPage) {
        break;
      }
      after = encodeOffsetCursor(page.cursorOffset + page.rows.length) ?? encodeWorkCursor(page.cursorOffset + page.rows.length);
    }
    return processed;
  }

  private async upsertWorkItem(row: CdmWorkItemRow): Promise<void> {
    const nodeId = normalizeCdmEntityId(WORK_NODE_TYPE, row.cdm_id);
    const projectKey = deriveProjectKey(row.source_issue_key, row.project_cdm_id);
    const properties = cleanProperties({
      displayName: row.summary ?? row.source_issue_key ?? row.cdm_id,
      canonicalPath: row.source_issue_key ?? undefined,
      projectKey,
      projectCdmId: row.project_cdm_id ?? undefined,
      sourceSystem: row.source_system,
      sourceIssueKey: row.source_issue_key,
      sourceUrl: row.source_url ?? undefined,
      summary: row.summary,
      status: row.status ?? undefined,
      priority: row.priority ?? undefined,
      assignee: row.assignee_cdm_id ?? undefined,
      reporter: row.reporter_cdm_id ?? undefined,
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at ?? row.closed_at ?? row.created_at),
      closedAt: toIsoString(row.closed_at),
    });

    await this.graphWrite.upsertNode({
      nodeType: WORK_NODE_TYPE,
      nodeId,
      properties,
    });
  }

  private async upsertDocItem(row: CdmDocItemRow): Promise<void> {
    const nodeId = normalizeCdmEntityId(DOC_NODE_TYPE, row.cdm_id);
    const properties = cleanProperties({
      displayName: row.title ?? row.source_item_id ?? row.cdm_id,
      canonicalPath: row.space_key && row.source_item_id ? `${row.space_key}/${row.source_item_id}` : undefined,
      spaceKey: row.space_key ?? undefined,
      spaceName: row.space_name ?? undefined,
      sourceSystem: row.source_system,
      sourceItemId: row.source_item_id ?? undefined,
      sourceUrl: row.source_url ?? row.url ?? undefined,
      title: row.title ?? undefined,
      docType: row.doc_type ?? undefined,
      mimeType: row.mime_type ?? undefined,
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
    });

    await this.graphWrite.upsertNode({
      nodeType: DOC_NODE_TYPE,
      nodeId,
      properties,
    });
  }
}
