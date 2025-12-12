import assert from "node:assert/strict";
import test from "node:test";
import type { CdmWorkItemRow } from "../cdm/workStore.js";
import { createGraphWriteFixture } from "../graph/graphWriteTestUtils.js";
import type { SignalInstance } from "../signals/types.js";
import { createResolvers } from "../schema.js";
import { DefaultCdmToKgBridge } from "./cdmToKgBridge.js";
import { DefaultSignalsToKgBridge } from "./signalsToKgBridge.js";

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

test("Graph and KB resolvers can read bridged CDM nodes and signals", async (t) => {
  const { graphWrite, graphStore, metadataStore, tenant, cleanup } = await createGraphWriteFixture();
  t.after(cleanup);

  const workRow: CdmWorkItemRow = {
    cdm_id: "cdm:work:item:test:ENG-visibility",
    source_system: "jira",
    source_issue_key: "ENG-4",
    source_url: "https://example.atlassian.net/browse/ENG-4",
    source_id: "ENG-4",
    project_cdm_id: "cdm:work:project:test:ENG",
    summary: "Visibility work",
    status: "Open",
    priority: "Medium",
    assignee_cdm_id: null,
    reporter_cdm_id: null,
    created_at: new Date("2024-04-01T00:00:00Z"),
    updated_at: new Date("2024-04-02T00:00:00Z"),
    closed_at: null,
    reporter_display_name: null,
    reporter_email: null,
    assignee_display_name: null,
    assignee_email: null,
    raw_source: {},
    properties: {},
  };

  const signalInstance: SignalInstance = {
    id: "signal-vis-1",
    definitionId: "def-vis",
    status: "OPEN",
    entityRef: "cdm.work.item:test:ENG-visibility",
    entityKind: "WORK_ITEM",
    severity: "INFO",
    summary: "Visibility signal",
    details: null,
    firstSeenAt: new Date("2024-04-03T00:00:00Z"),
    lastSeenAt: new Date("2024-04-03T00:00:00Z"),
    resolvedAt: null,
    sourceRunId: null,
    createdAt: new Date("2024-04-03T00:00:00Z"),
    updatedAt: new Date("2024-04-03T00:00:00Z"),
  };

  const cdmBridge = new DefaultCdmToKgBridge({ graphWrite, workStore: new FakeWorkStore([workRow]) });
  await cdmBridge.syncWorkItemsToKg();

  const signalsBridge = new DefaultSignalsToKgBridge({ graphWrite, signalStore: new FakeSignalStore([signalInstance]) });
  await signalsBridge.syncSignalsToKg();

  const resolvers = createResolvers(metadataStore, { graphStore });
  const ctx = {
    auth: { tenantId: tenant.tenantId, projectId: tenant.projectId, roles: ["viewer"], subject: "tester" },
    userId: "tester",
    bypassWrites: false,
  };

  const graphNodes = await (resolvers.Query.graphNodes as any)(
    null,
    { filter: { entityTypes: ["cdm.work.item"] } },
    ctx as any,
  );
  assert.equal(graphNodes.length, 1);
  assert.equal(graphNodes[0].id.startsWith("cdm.work.item:"), true);

  const graphEdges = await (resolvers.Query.graphEdges as any)(
    null,
    { filter: { edgeTypes: ["HAS_SIGNAL"] } },
    ctx as any,
  );
  assert.equal(graphEdges.length, 1);

  const kbNodes = await (resolvers.Query.kbNodes as any)(
    null,
    { type: "cdm.work.item", first: 10 },
    ctx as any,
  );
  assert.equal(kbNodes.totalCount >= 1, true);
  assert.equal(kbNodes.edges[0].node.id.startsWith("cdm.work.item:"), true);
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
