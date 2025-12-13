import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileMetadataStore, type MetadataEndpointTemplateDescriptor } from "@metadata/core";
import { createResolvers } from "./schema.js";
import type { CapabilityProbeResult, OperationState, StartOperationResult } from "./temporal/ucl-client.js";

const TEST_TEMPLATE: MetadataEndpointTemplateDescriptor = {
  id: "test.hardening",
  family: "HTTP",
  title: "Hardening Template",
  vendor: "Test",
  description: "Template for negative case mapping",
  domain: "hardening",
  categories: ["test"],
  protocols: ["https"],
  versions: [],
  fields: [],
  capabilities: [],
};

function buildCtx() {
  return {
    auth: { tenantId: "tenant-hard", projectId: "project-hard", roles: ["admin"], subject: "tester" },
    userId: "user-hard",
    bypassWrites: false,
  };
}

function buildStubTemporal(): () => Promise<{ client: any; taskQueue: string }> {
  return async () => ({
    client: {
      workflow: {
        execute: async () => ({ success: true }),
        start: async () => ({ workflowId: "wf-hard", firstExecutionRunId: "run-hard" }),
      },
    } as any,
    taskQueue: "hard-queue",
  });
}

test("negative cases map to failed run states with errors", async (t) => {
  const previousRefreshFlag = process.env.METADATA_ENDPOINT_TEMPLATE_REFRESH_DISABLED;
  process.env.METADATA_ENDPOINT_TEMPLATE_REFRESH_DISABLED = "1";

  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hardening-"));
  t.after(async () => {
    process.env.METADATA_ENDPOINT_TEMPLATE_REFRESH_DISABLED = previousRefreshFlag;
    await rm(rootDir, { recursive: true, force: true });
  });

  const store = new FileMetadataStore({ rootDir });
  await store.saveEndpointTemplates([TEST_TEMPLATE]);
  const ctx = buildCtx();

  const stubUcl = {
    probeEndpointCapabilities: async (): Promise<CapabilityProbeResult> => ({
      capabilities: ["endpoint.test_connection", "metadata.run"],
      supportedOperations: ["endpoint.test_connection", "metadata.run"],
      constraints: undefined,
      auth: undefined,
      error: null,
    }),
    startOperation: async (input: any): Promise<StartOperationResult> => {
      const failCode = input.parameters?.failCode as string | undefined;
      if (failCode) {
        const retryable = failCode === "E_ENDPOINT_UNREACHABLE" || failCode === "E_TIMEOUT";
        return {
          operationId: `op-${failCode.toLowerCase()}`,
          state: {
            operationId: `op-${failCode.toLowerCase()}`,
            kind: input.kind,
            status: "FAILED",
            retryable,
            error: {
              code: failCode,
              message: "forced error",
              retryable,
              requiredScopes: failCode === "E_SCOPE_MISSING" ? ["Files.Read.All"] : undefined,
            },
          },
        };
      }
      return {
        operationId: "op-hard-default",
        state: { operationId: "op-hard-default", kind: input.kind, status: "SUCCEEDED" },
      };
    },
    getOperation: async (operationId: string): Promise<OperationState> => ({ operationId, status: "SUCCEEDED" }),
  };

  const resolvers = createResolvers(store, { temporalClientFactory: buildStubTemporal(), uclClient: stubUcl });

  const cases = [
    { code: "E_AUTH_INVALID", retryable: false },
    { code: "E_ENDPOINT_UNREACHABLE", retryable: true },
    { code: "E_SCOPE_MISSING", retryable: false, requiredScopes: ["Files.Read.All"] },
  ];

  for (const scenario of cases) {
    const result = await (resolvers.Mutation.startEndpointOperation as any)(
      null,
      {
        input: {
          templateId: TEST_TEMPLATE.id,
          kind: "METADATA_RUN",
          parameters: { failCode: scenario.code },
        },
      },
      ctx as any,
    );
    assert.equal(result.status, "FAILED");
    assert.equal(result.error?.code, scenario.code);
    assert.equal(result.error?.retryable ?? false, scenario.retryable);
    if (scenario.requiredScopes) {
      assert.deepEqual(result.error?.requiredScopes, scenario.requiredScopes);
    }
  }
});
