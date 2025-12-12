import assert from "node:assert/strict";
import test from "node:test";
import type { CdmDocItemRow } from "../cdm/docStore.js";
import type { CdmWorkItemRow } from "../cdm/workStore.js";
import { createGraphWriteFixture } from "../graph/graphWriteTestUtils.js";
import { DefaultCdmToKgBridge } from "./cdmToKgBridge.js";

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

test("CdmToKgBridge projects work and doc nodes", async (t) => {
  const { graphWrite, graphStore, tenant, cleanup } = await createGraphWriteFixture();
  t.after(cleanup);

  const workRow: CdmWorkItemRow = {
    cdm_id: "cdm:work:item:test:ENG-1",
    source_system: "jira",
    source_issue_key: "ENG-1",
    source_url: "https://example.atlassian.net/browse/ENG-1",
    source_id: "ENG-1",
    project_cdm_id: "cdm:work:project:test:ENG",
    summary: "Bridge work item",
    status: "In Progress",
    priority: "High",
    assignee_cdm_id: "cdm:work:user:test:assignee",
    reporter_cdm_id: "cdm:work:user:test:reporter",
    created_at: new Date("2024-01-01T00:00:00Z"),
    updated_at: new Date("2024-01-02T00:00:00Z"),
    closed_at: null,
    reporter_display_name: "Reporter",
    reporter_email: "reporter@example.com",
    assignee_display_name: "Assignee",
    assignee_email: "assignee@example.com",
    raw_source: {},
    properties: {},
  };

  const docRow: CdmDocItemRow = {
    cdm_id: "cdm:doc:item:test:1",
    source_system: "confluence",
    source_item_id: "DOC-1",
    source_id: "DOC-1",
    space_cdm_id: "cdm:doc:space:test:SPACE",
    space_key: "SPACE",
    space_name: "Space",
    space_url: "https://example/wiki/SPACE",
    parent_item_cdm_id: null,
    title: "Bridge doc",
    doc_type: "page",
    mime_type: "storage",
    source_url: "https://example/wiki/SPACE/pages/1",
    created_by_cdm_id: null,
    updated_by_cdm_id: null,
    created_at: new Date("2024-01-03T00:00:00Z"),
    updated_at: new Date("2024-01-04T00:00:00Z"),
    url: "https://example/wiki/SPACE/pages/1",
    tags: [],
    properties: {},
    raw_source: {},
    dataset_id: "confluence.page",
    endpoint_id: "endpoint-doc",
  };

  const bridge = new DefaultCdmToKgBridge({
    graphWrite,
    workStore: new FakeWorkStore([workRow]),
    docStore: new FakeDocStore([docRow]),
  });

  const result = await bridge.syncAllToKg();
  assert.equal(result.workItems, 1);
  assert.equal(result.docItems, 1);

  const workNodes = await graphStore.listEntities({ entityTypes: ["cdm.work.item"] }, tenant);
  assert.equal(workNodes.length, 1);
  const workProps = workNodes[0].properties as Record<string, unknown>;
  assert.equal(workNodes[0].id.startsWith("cdm.work.item:"), true);
  assert.equal(workProps.projectKey, "ENG");
  assert.equal(workProps.summary, workRow.summary);
  assert.equal(workProps.sourceIssueKey, workRow.source_issue_key);

  const docNodes = await graphStore.listEntities({ entityTypes: ["cdm.doc.item"] }, tenant);
  assert.equal(docNodes.length, 1);
  const docProps = docNodes[0].properties as Record<string, unknown>;
  assert.equal(docNodes[0].id.startsWith("cdm.doc.item:"), true);
  assert.equal(docProps.spaceKey, docRow.space_key);
  assert.equal(docProps.title, docRow.title);
  assert.equal(docProps.sourceSystem, "confluence");
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
