import test from "node:test";
import assert from "node:assert/strict";
import type { MetadataEndpointDescriptor, MetadataStore, NormalizedBatch, NormalizedRecord } from "@metadata/core";
import { CdmJdbcSink } from "./cdmSink.js";

class FakeMetadataStore implements MetadataStore {
  constructor(private readonly endpoints: MetadataEndpointDescriptor[]) {}
  async listEndpoints() {
    return this.endpoints;
  }
  // Unused MetadataStore methods
  async listRecords(): Promise<any[]> {
    return [];
  }
  async getRecord(): Promise<any | null> {
    return null;
  }
  async upsertRecord(record: any) {
    return record;
  }
  async deleteRecord(): Promise<void> {}
  async listDomains(): Promise<any[]> {
    return [];
  }
  async registerEndpoint(endpoint: MetadataEndpointDescriptor) {
    this.endpoints.push(endpoint);
    return endpoint;
  }
  async listEndpointTemplates(): Promise<any[]> {
    return [];
  }
  async saveEndpointTemplates(): Promise<void> {}
  async upsertGraphNode(): Promise<any> {
    return {};
  }
  async getGraphNodeById(): Promise<any | null> {
    return null;
  }
  async getGraphNodeByLogicalKey(): Promise<any | null> {
    return null;
  }
  async listGraphNodes(): Promise<any[]> {
    return [];
  }
  async upsertGraphEdge(): Promise<any> {
    return {};
  }
  async getGraphEdgeById(): Promise<any | null> {
    return null;
  }
  async getGraphEdgeByLogicalKey(): Promise<any | null> {
    return null;
  }
  async listGraphEdges(): Promise<any[]> {
    return [];
  }
}

test("cdm sink generates upsert statements for cdm.work.item", async () => {
  const sinkEndpoint: MetadataEndpointDescriptor = {
    id: "sink-endpoint-1",
    name: "CDM Sink",
    verb: "POST",
    url: "postgres://localhost",
    config: {
      templateId: "cdm.jdbc",
      parameters: {
        connection_url: "postgres://postgres:postgres@localhost:5432/test",
        schema: "cdm_work",
        table_prefix: "cdm_",
      },
    },
  } as MetadataEndpointDescriptor;
  const metadataStore = new FakeMetadataStore([sinkEndpoint]) as unknown as MetadataStore;
  const captured: { sql: string; params?: unknown[] }[] = [];
  const sink = new CdmJdbcSink({
    metadataStore,
    poolFactory: async () => ({
      query: async (sql: string, params?: unknown[]) => {
        captured.push({ sql, params });
      },
      close: async () => {},
    }),
  });
  const record = buildCdmWorkItemRecord();
  await sink.begin({ endpointId: "jira", unitId: "jira.issues", sinkId: "cdm", runId: "run-1", sinkEndpointId: sinkEndpoint.id, cdmModelId: "cdm.work.item" });
  await sink.writeBatch({ records: [record] } satisfies NormalizedBatch, {
    endpointId: "jira",
    unitId: "jira.issues",
    sinkId: "cdm",
    runId: "run-1",
    sinkEndpointId: sinkEndpoint.id,
    cdmModelId: "cdm.work.item",
  });
  await sink.commit({ endpointId: "jira", unitId: "jira.issues", sinkId: "cdm", runId: "run-1" });
  assert.equal(captured.length, 1);
  assert.match(captured[0].sql, /INSERT INTO "cdm_work"\."cdm_work_item"/);
  assert.ok(captured[0].params);
  assert.equal((captured[0].params ?? []).length, 16);
});

function buildCdmWorkItemRecord(): NormalizedRecord {
  return {
    entityType: "cdm.work.item",
    logicalId: "cdm:work:item:jira:PROJ-1",
    displayName: "Issue PROJ-1",
    scope: { orgId: "dev" },
    provenance: { endpointId: "jira", vendor: "jira" },
    payload: {
      cdm_id: "cdm:work:item:jira:PROJ-1",
      source_system: "jira",
      source_issue_key: "PROJ-1",
      project_cdm_id: "cdm:work:project:jira:PROJ",
      reporter_cdm_id: "cdm:work:user:jira:rep",
      assignee_cdm_id: "cdm:work:user:jira:assignee",
      issue_type: "Bug",
      status: "Open",
      status_category: "To Do",
      priority: "High",
      summary: "Example issue",
      description: "Example description",
      labels: ["example"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      closed_at: null,
      properties: {},
    },
  };
}
