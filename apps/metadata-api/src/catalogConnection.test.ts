import test from "node:test";
import { strict as assert } from "node:assert";
import type { MetadataStore, MetadataRecord } from "@metadata/core";
import { __testCatalogConnection } from "./schema.js";

const { buildCatalogDatasetConnection } = __testCatalogConnection;

function buildRecord(overrides?: Partial<MetadataRecord<unknown>>): MetadataRecord<unknown> {
  return {
    id: overrides?.id ?? "dataset-1",
    projectId: overrides?.projectId ?? "global",
    domain: overrides?.domain ?? "catalog.dataset",
    labels: overrides?.labels ?? [],
    payload: overrides?.payload ?? {
      metadata_endpoint_id: "endpoint-1",
      dataset: {
        id: "dataset-1",
        displayName: "Dataset 1",
        fields: [],
      },
    },
    createdAt: overrides?.createdAt ?? new Date().toISOString(),
    updatedAt: overrides?.updatedAt ?? new Date().toISOString(),
  };
}

test("catalog connection adds endpoint filter across payload paths", async () => {
  let lastWhere: Record<string, unknown> | null = null;
  const prisma = {
    metadataRecord: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        lastWhere = args.where;
        return [buildRecord()];
      },
      count: async () => 1,
    },
    metadataProject: {
      findUnique: async () => null,
    },
  } as any;
  const store: Pick<MetadataStore, "listEndpoints"> = {
    listEndpoints: async () => [{ id: "endpoint-1", deletedAt: null } as any],
  };
  const ctx = { auth: { projectId: "global" } } as any;
  const connection = await buildCatalogDatasetConnection(store as MetadataStore, prisma, ctx, {
    projectId: "global",
    endpointId: "endpoint-1",
    first: 10,
  });
  assert.equal(connection.nodes.length, 1);
  assert.ok(lastWhere, "expected Prisma where clause");
  const andFilters = (lastWhere as any).AND as Array<Record<string, unknown>>;
  assert.ok(andFilters && andFilters.length > 0, "expected AND filters for endpointId");
  const endpointFilter = andFilters.find((entry) => Array.isArray((entry as any).OR));
  assert.ok(endpointFilter, "expected OR endpoint filter");
  const orClauses = (endpointFilter as any).OR as Array<Record<string, unknown>>;
  assert.deepEqual(orClauses[0], { labels: { has: "endpoint:endpoint-1" } });
  assert.deepEqual(orClauses[1], { payload: { path: ["metadata_endpoint_id"], equals: "endpoint-1" } });
});
