import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileMetadataStore, type MetadataEndpointTemplateDescriptor } from "@metadata/core";
import { createResolvers } from "./schema.js";
import type { CapabilityProbeResult, OperationState, StartOperationResult } from "./temporal/ucl-client.js";

const TEST_TEMPLATE: MetadataEndpointTemplateDescriptor = {
  id: "test.ops",
  family: "HTTP",
  title: "Ops Template",
  vendor: "Test",
  description: "Template for operation mapping",
  domain: "ops",
  categories: ["test"],
  protocols: ["https"],
  versions: [],
  fields: [],
  capabilities: [],
};

function buildCtx() {
  return {
    auth: { tenantId: "tenant-ops", projectId: "project-ops", roles: ["admin"], subject: "tester" },
    userId: "user-ops",
    bypassWrites: false,
  };
}

function buildStubTemporal(): () => Promise<{ client: any; taskQueue: string }> {
  return async () => ({
    client: {
      workflow: {
        execute: async () => ({ success: true }),
        start: async () => ({ workflowId: "wf-ops", firstExecutionRunId: "run-ops" }),
      },
    } as any,
    taskQueue: "ops-queue",
  });
}

test("operations map gRPC states deterministically", async (t) => {
  const previousRefreshFlag = process.env.METADATA_ENDPOINT_TEMPLATE_REFRESH_DISABLED;
  process.env.METADATA_ENDPOINT_TEMPLATE_REFRESH_DISABLED = "1";

  const rootDir = await mkdtemp(path.join(os.tmpdir(), "ops-mapping-"));
  t.after(async () => {
    process.env.METADATA_ENDPOINT_TEMPLATE_REFRESH_DISABLED = previousRefreshFlag;
    await rm(rootDir, { recursive: true, force: true });
  });

  const store = new FileMetadataStore({ rootDir });
  await store.saveEndpointTemplates([TEST_TEMPLATE]);
  const ctx = buildCtx();

  let statusCursor = 0;
  const statusSequence: OperationState["status"][] = ["RUNNING", "SUCCEEDED"];
  const stubUcl = {
    probeEndpointCapabilities: async (): Promise<CapabilityProbeResult> => ({
      capabilities: ["endpoint.test_connection", "metadata.run"],
      supportedOperations: ["endpoint.test_connection", "metadata.run"],
      constraints: undefined,
      auth: undefined,
      error: null,
    }),
    startOperation: async (input: any): Promise<StartOperationResult> => ({
      operationId: "op-map",
      state: {
        operationId: "op-map",
        kind: input.kind,
        status: "QUEUED",
        startedAt: Date.now(),
      },
    }),
    getOperation: async (operationId: string): Promise<OperationState> => ({
      operationId,
      status: statusSequence[Math.min(statusCursor++, statusSequence.length - 1)],
      startedAt: Date.now(),
    }),
  };

  const resolvers = createResolvers(store, { temporalClientFactory: buildStubTemporal(), uclClient: stubUcl });

  const started = await (resolvers.Mutation.startEndpointOperation as any)(
    null,
    { input: { templateId: TEST_TEMPLATE.id, kind: "METADATA_RUN", parameters: { base_url: "https://example" } } },
    ctx as any,
  );
  assert.equal(started.status, "QUEUED");
  assert.equal(started.operationId, "op-map");

  const running = await (resolvers.Query.operationState as any)(null, { operationId: "op-map" }, ctx as any);
  assert.equal(running.status, "RUNNING");

  const succeeded = await (resolvers.Query.operationState as any)(null, { operationId: "op-map" }, ctx as any);
  assert.equal(succeeded.status, "SUCCEEDED");
});
