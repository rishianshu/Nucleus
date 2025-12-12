import assert from "node:assert/strict";
import test from "node:test";
import type { CdmDocItemRow } from "../cdm/docStore.js";
import type { CdmWorkItemRow } from "../cdm/workStore.js";
import { createGraphWriteFixture } from "../graph/graphWriteTestUtils.js";
import type { SignalInstance } from "../signals/types.js";
import { syncCdmAndSignalsToKg } from "./sync.js";

class FakeWorkStore {
  constructor(private readonly rows: CdmWorkItemRow[]) {}

  async listWorkItems(args: { first?: number | null; after?: string | null }) {
    const offset = decodeCursor(args.after);
    const limit = Math.min(args.first ?? this.rows.length, this.rows.length);
    const slice = this.rows.slice(offset, offset + limit);
    const hasNextPage = offset + slice.length < this.rows.length;
    return { rows: slice, cursorOffset: offset, hasNextPage };
  }
}

class FakeDocStore {
  constructor(private readonly rows: CdmDocItemRow[]) {}

  async listDocItems(args: { first?: number | null; after?: string | null }) {
    const offset = decodeCursor(args.after);
    const limit = Math.min(args.first ?? this.rows.length, this.rows.length);
    const slice = this.rows.slice(offset, offset + limit);
    const hasNextPage = offset + slice.length < this.rows.length;
    return { rows: slice, cursorOffset: offset, hasNextPage };
  }
}

class FakeSignalStore {
  constructor(private readonly rows: SignalInstance[]) {}

  async listInstancesPaged(filter?: { limit?: number | null; after?: string | null }) {
    const offset = decodeCursor(filter?.after);
    const limit = Math.min(filter?.limit ?? this.rows.length, this.rows.length);
    const slice = this.rows.slice(offset, offset + limit);
    const hasNextPage = offset + slice.length < this.rows.length;
    return { rows: slice, cursorOffset: offset, hasNextPage };
  }

  async listInstances(filter?: { limit?: number | null }) {
    const limit = Math.min(filter?.limit ?? this.rows.length, this.rows.length);
    return this.rows.slice(0, limit);
  }
}

test("Bridge sync is idempotent across runs", async (t) => {
  const { graphStore, graphWrite, tenant, cleanup } = await createGraphWriteFixture();
  t.after(cleanup);

  const workRow: CdmWorkItemRow = {
    cdm_id: "cdm:work:item:test:ENG-3",
    source_system: "jira",
    source_issue_key: "ENG-3",
    source_url: "https://example.atlassian.net/browse/ENG-3",
    source_id: "ENG-3",
    project_cdm_id: "cdm:work:project:test:ENG",
    summary: "Idempotent work",
    status: "In Progress",
    priority: "Low",
    assignee_cdm_id: null,
    reporter_cdm_id: null,
    created_at: new Date("2024-03-01T00:00:00Z"),
    updated_at: new Date("2024-03-02T00:00:00Z"),
    closed_at: null,
    reporter_display_name: null,
    reporter_email: null,
    assignee_display_name: null,
    assignee_email: null,
    raw_source: {},
    properties: {},
  };

  const docRow: CdmDocItemRow = {
    cdm_id: "cdm:doc:item:test:2",
    source_system: "confluence",
    source_item_id: "DOC-2",
    source_id: "DOC-2",
    space_cdm_id: "cdm:doc:space:test:SPACE",
    space_key: "SPACE",
    space_name: "Space",
    space_url: "https://example/wiki/SPACE",
    parent_item_cdm_id: null,
    title: "Idempotent doc",
    doc_type: "page",
    mime_type: "storage",
    source_url: "https://example/wiki/SPACE/pages/2",
    created_by_cdm_id: null,
    updated_by_cdm_id: null,
    created_at: new Date("2024-03-03T00:00:00Z"),
    updated_at: new Date("2024-03-04T00:00:00Z"),
    url: "https://example/wiki/SPACE/pages/2",
    tags: [],
    properties: {},
    raw_source: {},
    dataset_id: "confluence.page",
    endpoint_id: "endpoint-doc",
  };

  const signalInstance: SignalInstance = {
    id: "signal-idem-1",
    definitionId: "def-idem",
    status: "OPEN",
    entityRef: "cdm.work.item:test:ENG-3",
    entityKind: "WORK_ITEM",
    severity: "ERROR",
    summary: "Idempotent signal",
    details: null,
    firstSeenAt: new Date("2024-03-05T00:00:00Z"),
    lastSeenAt: new Date("2024-03-05T00:00:00Z"),
    resolvedAt: null,
    sourceRunId: null,
    createdAt: new Date("2024-03-05T00:00:00Z"),
    updatedAt: new Date("2024-03-05T00:00:00Z"),
  };

  const workStore = new FakeWorkStore([workRow]);
  const docStore = new FakeDocStore([docRow]);
  const signalStore = new FakeSignalStore([signalInstance]);

  await syncCdmAndSignalsToKg({ graphWrite, workStore, docStore, signalStore });
  await syncCdmAndSignalsToKg({ graphWrite, workStore, docStore, signalStore });

  const workNodes = await graphStore.listEntities({ entityTypes: ["cdm.work.item"] }, tenant);
  const docNodes = await graphStore.listEntities({ entityTypes: ["cdm.doc.item"] }, tenant);
  const signalNodes = await graphStore.listEntities({ entityTypes: ["signal.instance"] }, tenant);
  const edges = await graphStore.listEdges({ edgeTypes: ["HAS_SIGNAL"] }, tenant);

  assert.equal(workNodes.length, 1);
  assert.equal(docNodes.length, 1);
  assert.equal(signalNodes.length, 1);
  assert.equal(edges.length, 1);
});

function decodeCursor(cursor?: string | null): number {
  if (!cursor) {
    return 0;
  }
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf-8");
    const value = Number.parseInt(decoded, 10);
    return Number.isNaN(value) || value < 0 ? 0 : value;
  } catch {
    return 0;
  }
}
