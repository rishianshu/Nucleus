import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileMetadataStore, type MetadataEndpointDescriptor } from "@metadata/core";
import { provisionCdmSinkTables } from "./cdmProvisioner.js";

test("provisionCdmSinkTables creates schema/table and catalog record", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "cdm-provision-test-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  const store = new FileMetadataStore({ rootDir });
  const sinkEndpoint: MetadataEndpointDescriptor = {
    id: "sink-endpoint-123",
    name: "CDM Sink",
    verb: "POST",
    url: "postgres://localhost",
    projectId: "project-cdm",
    config: {
      templateId: "cdm.jdbc",
      parameters: {
        connection_url: "postgres://postgres:postgres@localhost:5432/test",
        schema: "cdm_work",
        table_prefix: "cdm_",
      },
    },
  } as MetadataEndpointDescriptor;
  await store.registerEndpoint(sinkEndpoint);
  const queries: string[] = [];
  const executorFactory = async () => ({
    async query(sql: string) {
      queries.push(sql.trim());
    },
    async close() {
      // no-op
    },
  });
  const result = await provisionCdmSinkTables({
    store,
    sinkEndpoint,
    cdmModelId: "cdm.work.item",
    projectId: "project-cdm",
    executorFactory,
  });
  assert.equal(result.datasetId, "cdm_work.cdm_work_item");
  assert.match(queries[0], /CREATE SCHEMA IF NOT EXISTS/);
  assert.match(queries[1], /CREATE TABLE IF NOT EXISTS/);
  const record = await store.getRecord("catalog.dataset", "cdm_work.cdm_work_item");
  assert.ok(record, "dataset should be registered");
  assert.equal(record?.payload?.schema, "cdm_work");
  assert.equal(record?.payload?.cdmModelId, "cdm.work.item");
});
