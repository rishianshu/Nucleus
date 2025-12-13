import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileMetadataStore, type MetadataEndpointTemplateDescriptor } from "@metadata/core";
import { createResolvers } from "./schema.js";
import type { CapabilityProbeResult, OperationState, StartOperationResult } from "./temporal/ucl-client.js";

const TEST_TEMPLATE: MetadataEndpointTemplateDescriptor = {
  id: "test.probe",
  family: "HTTP",
  title: "Probe Template",
  vendor: "Test",
  description: "Template for capability probe gating",
  domain: "test",
  categories: ["test"],
  protocols: ["https"],
  versions: [],
  fields: [],
  capabilities: [],
};

function buildCtx() {
  return {
    auth: { tenantId: "tenant-a", projectId: "project-a", roles: ["admin"], subject: "tester" },
    userId: "user-1",
    bypassWrites: false,
  };
}

function buildStubTemporal(): () => Promise<{ client: any; taskQueue: string }> {
  return async () => ({
    client: {
      workflow: {
        execute: async () => ({ success: true, capabilities: ["endpoint.test_connection"] }),
        start: async () => ({ workflowId: "wf-test", firstExecutionRunId: "run-test" }),
      },
    } as any,
    taskQueue: "test-queue",
  });
}

test("capability probe gates metadata runs and connection tests", async (t) => {
  const previousRefreshFlag = process.env.METADATA_ENDPOINT_TEMPLATE_REFRESH_DISABLED;
  const previousSkipTests = process.env.METADATA_SKIP_ENDPOINT_TESTS;
  process.env.METADATA_ENDPOINT_TEMPLATE_REFRESH_DISABLED = "1";
  process.env.METADATA_SKIP_ENDPOINT_TESTS = "1";

  const rootDir = await mkdtemp(path.join(os.tmpdir(), "cap-probe-"));
  t.after(async () => {
    process.env.METADATA_ENDPOINT_TEMPLATE_REFRESH_DISABLED = previousRefreshFlag;
    process.env.METADATA_SKIP_ENDPOINT_TESTS = previousSkipTests;
    await rm(rootDir, { recursive: true, force: true });
  });

  const store = new FileMetadataStore({ rootDir });
  await store.saveEndpointTemplates([TEST_TEMPLATE]);
  const ctx = buildCtx();

  let probeResponse: CapabilityProbeResult = {
    capabilities: ["endpoint.test_connection"],
    supportedOperations: ["endpoint.test_connection"],
    constraints: undefined,
    auth: undefined,
    error: null,
  };
  const stubUcl = {
    probeEndpointCapabilities: async (): Promise<CapabilityProbeResult> => probeResponse,
    startOperation: async (input: any): Promise<StartOperationResult> => ({
      operationId: "op-1",
      state: {
        operationId: "op-1",
        kind: input.kind,
        status: "QUEUED",
      },
    }),
    getOperation: async (operationId: string): Promise<OperationState> => ({
      operationId,
      status: "RUNNING",
    }),
  };

  const resolvers = createResolvers(store, { temporalClientFactory: buildStubTemporal(), uclClient: stubUcl });

  await assert.rejects(
    () =>
      (resolvers.Mutation.startEndpointOperation as any)(
        null,
        { input: { templateId: TEST_TEMPLATE.id, kind: "METADATA_RUN", parameters: { base_url: "https://example" } } },
        ctx as any,
      ),
    /capability/i,
  );

  probeResponse = {
    capabilities: ["endpoint.test_connection", "metadata.run"],
    supportedOperations: ["endpoint.test_connection", "metadata.run"],
  };
  const started = await (resolvers.Mutation.startEndpointOperation as any)(
    null,
    { input: { templateId: TEST_TEMPLATE.id, kind: "METADATA_RUN", parameters: { base_url: "https://example" } } },
    ctx as any,
  );
  assert.equal(started.status, "QUEUED");

  probeResponse = { capabilities: [], supportedOperations: [] };
  await assert.rejects(
    () =>
      (resolvers.Mutation.testMetadataEndpoint as any)(
        null,
        {
          input: {
            name: "ProbeTest",
            url: "https://example",
            verb: "GET",
            config: { templateId: TEST_TEMPLATE.id, parameters: { base_url: "https://example" } },
          },
        },
        ctx as any,
      ),
    /capability/i,
  );

  probeResponse = { capabilities: ["endpoint.test_connection"], supportedOperations: ["endpoint.test_connection"] };
  const testResult = await (resolvers.Mutation.testMetadataEndpoint as any)(
    null,
    {
      input: {
        name: "ProbeTest",
        url: "https://example",
        verb: "GET",
        config: { templateId: TEST_TEMPLATE.id, parameters: { base_url: "https://example" } },
      },
    },
    ctx as any,
  );
  assert.ok(testResult.success);
});
