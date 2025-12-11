import test from "node:test";
import assert from "node:assert/strict";
import type { MetadataEndpointDescriptor, MetadataStore, NormalizedBatch, NormalizedRecord } from "@metadata/core";
import { CdmJdbcSink, CDM_MODEL_TABLES } from "./cdmSink.js";

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
  assert.equal((captured[0].params ?? []).length, CDM_MODEL_TABLES["cdm.work.item"].columns.length);
});

test("cdm sink generates upsert statements for cdm.doc.item", async () => {
  const sinkEndpoint: MetadataEndpointDescriptor = {
    id: "sink-endpoint-2",
    name: "CDM Sink",
    verb: "POST",
    url: "postgres://localhost",
    config: {
      templateId: "cdm.jdbc",
      parameters: {
        connection_url: "postgres://postgres:postgres@localhost:5432/test",
        schema: "cdm_docs",
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
  const record = buildCdmDocItemRecord();
  await sink.begin({
    endpointId: "confluence",
    unitId: "confluence.page",
    sinkId: "cdm",
    runId: "run-2",
    sinkEndpointId: sinkEndpoint.id,
    cdmModelId: "cdm.doc.item",
  });
  await sink.writeBatch({ records: [record] } satisfies NormalizedBatch, {
    endpointId: "confluence",
    unitId: "confluence.page",
    sinkId: "cdm",
    runId: "run-2",
    sinkEndpointId: sinkEndpoint.id,
    cdmModelId: "cdm.doc.item",
  });
  await sink.commit({ endpointId: "confluence", unitId: "confluence.page", sinkId: "cdm", runId: "run-2" });
  assert.equal(captured.length, 1);
  assert.match(captured[0].sql, /INSERT INTO "cdm_docs"\."cdm_doc_item"/);
  assert.ok(captured[0].params);
  assert.equal((captured[0].params ?? []).length, CDM_MODEL_TABLES["cdm.doc.item"].columns.length);
});

test("cdm sink generates upsert statements for cdm.doc.access", async () => {
  const sinkEndpoint: MetadataEndpointDescriptor = {
    id: "sink-endpoint-3",
    name: "CDM Sink",
    verb: "POST",
    url: "postgres://localhost",
    config: {
      templateId: "cdm.jdbc",
      parameters: {
        connection_url: "postgres://postgres:postgres@localhost:5432/test",
        schema: "cdm_docs",
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
  const record: NormalizedRecord = {
    entityType: "cdm.doc.access",
    logicalId: "cdm:doc:access:confluence:page:123::user@example.com",
    displayName: "user@example.com -> 123",
    scope: { orgId: "dev" },
    provenance: { endpointId: "confluence", vendor: "confluence" },
    payload: {
      principal_id: "user@example.com",
      principal_type: "user",
      doc_cdm_id: "cdm:doc:item:confluence:123",
      source_system: "confluence",
      dataset_id: "confluence.page",
      endpoint_id: "endpoint-doc",
      granted_at: new Date().toISOString(),
      synced_at: new Date().toISOString(),
      properties: {},
    },
  };
  await sink.begin({
    endpointId: "confluence",
    unitId: "confluence.acl",
    sinkId: "cdm",
    runId: "run-3",
    sinkEndpointId: sinkEndpoint.id,
    cdmModelId: "cdm.doc.access",
  });
  await sink.writeBatch({ records: [record] } satisfies NormalizedBatch, {
    endpointId: "confluence",
    unitId: "confluence.acl",
    sinkId: "cdm",
    runId: "run-3",
    sinkEndpointId: sinkEndpoint.id,
    cdmModelId: "cdm.doc.access",
  });
  await sink.commit({ endpointId: "confluence", unitId: "confluence.acl", sinkId: "cdm", runId: "run-3" });
  assert.equal(captured.length, 1);
  assert.match(captured[0].sql, /INSERT INTO "cdm_docs"\."cdm_doc_access"/);
  assert.ok(captured[0].params);
  assert.equal((captured[0].params ?? []).length, CDM_MODEL_TABLES["cdm.doc.access"].columns.length);
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
      source_id: "10000",
      source_issue_key: "PROJ-1",
      source_url: "https://jira.example.com/browse/PROJ-1",
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
      raw_source: { key: "PROJ-1" },
      properties: {},
    },
  };
}

function buildCdmDocItemRecord(): NormalizedRecord {
  return {
    entityType: "doc.page",
    logicalId: "confluence::example::page::123",
    scope: { orgId: "dev" },
    provenance: { endpointId: "confluence", vendor: "confluence" },
    payload: {
      cdm_id: "cdm:doc:item:confluence:123",
      source_system: "confluence",
      source_id: "123",
      source_item_id: "123",
      space_cdm_id: "cdm:doc:space:confluence:ENG",
      parent_item_cdm_id: null,
      title: "Incident Runbook",
      doc_type: "page",
      mime_type: "storage",
      source_url: "https://example.atlassian.net/wiki/spaces/ENG/pages/123",
      created_by_cdm_id: "cdm:work:user:confluence:author",
      updated_by_cdm_id: "cdm:work:user:confluence:editor",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      url: "https://example.atlassian.net/wiki/spaces/ENG/pages/123",
      tags: ["runbook"],
      raw_source: { id: "123" },
      properties: {},
    },
  };
}
