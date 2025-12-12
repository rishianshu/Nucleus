import assert from "node:assert/strict";
import test from "node:test";
import type { CdmWorkItemRow } from "../cdm/workStore.js";
import { createGraphWriteFixture } from "../graph/graphWriteTestUtils.js";
import type { SignalInstance } from "../signals/types.js";
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

test("SignalsToKgBridge projects signals and HAS_SIGNAL edges", async (t) => {
  const { graphWrite, graphStore, tenant, cleanup } = await createGraphWriteFixture();
  t.after(cleanup);

  const workRow: CdmWorkItemRow = {
    cdm_id: "cdm:work:item:test:ENG-2",
    source_system: "jira",
    source_issue_key: "ENG-2",
    source_url: "https://example.atlassian.net/browse/ENG-2",
    source_id: "ENG-2",
    project_cdm_id: "cdm:work:project:test:ENG",
    summary: "Signal target work",
    status: "Open",
    priority: "Medium",
    assignee_cdm_id: null,
    reporter_cdm_id: null,
    created_at: new Date("2024-02-01T00:00:00Z"),
    updated_at: new Date("2024-02-02T00:00:00Z"),
    closed_at: null,
    reporter_display_name: null,
    reporter_email: null,
    assignee_display_name: null,
    assignee_email: null,
    raw_source: {},
    properties: {},
  };

  const cdmBridge = new DefaultCdmToKgBridge({ graphWrite, workStore: new FakeWorkStore([workRow]) });
  await cdmBridge.syncWorkItemsToKg();

  const instance: SignalInstance = {
    id: "signal-1",
    definitionId: "def-1",
    status: "OPEN",
    entityRef: "cdm.work.item:test:ENG-2",
    entityKind: "WORK_ITEM",
    severity: "WARNING",
    summary: "Example signal",
    details: { score: 0.8 },
    firstSeenAt: new Date("2024-02-03T00:00:00Z"),
    lastSeenAt: new Date("2024-02-03T01:00:00Z"),
    resolvedAt: null,
    sourceRunId: "run-1",
    createdAt: new Date("2024-02-03T00:00:00Z"),
    updatedAt: new Date("2024-02-03T01:00:00Z"),
  };

  const signalsBridge = new DefaultSignalsToKgBridge({
    graphWrite,
    signalStore: new FakeSignalStore([instance]),
  });
  const result = await signalsBridge.syncSignalsToKg();
  assert.equal(result.processed, 1);

  const signalNodes = await graphStore.listEntities({ entityTypes: ["signal.instance"] }, tenant);
  assert.equal(signalNodes.length, 1);
  const signalProps = signalNodes[0].properties as Record<string, unknown>;
  assert.equal(signalProps.summary, instance.summary);
  assert.equal(signalProps.severity, instance.severity);

  const edges = await graphStore.listEdges({ edgeTypes: ["HAS_SIGNAL"] }, tenant);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].targetEntityId, signalNodes[0].id);
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
