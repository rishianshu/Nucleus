import { strict as assert } from "node:assert";
import test from "node:test";
import {
  buildDatasetCanonicalPath,
  buildDatasetId,
  deriveDatasetIdentity,
  imprintDatasetIdentity,
  type DatasetIdentityKey,
} from "./datasetIdentity.js";

const baseContext = {
  tenantId: "Dev",
  projectId: "Global",
};

test("deriveDatasetIdentity builds deterministic IDs for schema/table/source", () => {
  const payload = {
    schema: "Public",
    entity: "USERS",
    _metadata: {
      source_endpoint_id: "endpoint-123",
    },
  };
  const identity = deriveDatasetIdentity(payload, {
    ...baseContext,
    labels: ["endpoint:endpoint-abc"],
    fallbackSourceId: "endpoint-fallback",
  });
  assert.ok(identity, "identity should resolve with schema/table/source");
  assert.equal(identity?.id, "dataset::dev::global::endpoint-123::public::users");
  assert.equal(identity?.canonicalPath, "endpoint-123/public/users");
});

test("deriveDatasetIdentity falls back to labels when payload source is missing", () => {
  const payload = {
    namespace: "analytics",
    name: "events",
  };
  const identity = deriveDatasetIdentity(payload, {
    ...baseContext,
    labels: ["source:warehouse-001"],
  });
  assert.ok(identity, "identity should resolve using source label");
  assert.equal(identity?.id, "dataset::dev::global::warehouse-001::analytics::events");
});

test("deriveDatasetIdentity includes database when provided", () => {
  const payload = {
    schema: "dbo",
    table: "DimCustomer",
    database: "SalesDW",
    _metadata: {
      source_id: "mssql-east",
    },
  };
  const identity = deriveDatasetIdentity(payload, {
    tenantId: "Prod",
    projectId: "Northwind",
  });
  assert.ok(identity);
  assert.equal(identity?.id, "dataset::prod::northwind::mssql-east::salesdw::dbo::dimcustomer");
  assert.equal(identity?.canonicalPath, "mssql-east/salesdw/dbo/dimcustomer");
});

test("deriveDatasetIdentity returns null when schema/table missing", () => {
  const payload = {
    _metadata: { source_endpoint_id: "endpoint-1" },
  };
  const identity = deriveDatasetIdentity(payload, baseContext);
  assert.equal(identity, null);
});

test("buildDatasetId + canonicalPath maintain shared sanitization", () => {
  const key: DatasetIdentityKey = {
    tenantId: "dev",
    projectId: "proj-main",
    sourceId: "src-1",
    schema: "foo",
    table: "bar",
  };
  assert.equal(buildDatasetId(key), "dataset::dev::proj-main::src-1::foo::bar");
  assert.equal(buildDatasetCanonicalPath(key), "src-1/foo/bar");
});

test("imprintDatasetIdentity annotates dataset payload", () => {
  const payload: Record<string, unknown> = {
    dataset: { displayName: "Sample dataset" },
    _metadata: {},
  };
  const identity = {
    tenantId: "dev",
    projectId: "global",
    sourceId: "endpoint-1",
    schema: "public",
    table: "users",
    id: "dataset::dev::global::endpoint-1::public::users",
    canonicalPath: "endpoint-1/public/users",
  };
  imprintDatasetIdentity(payload, identity);
  const dataset = payload.dataset as Record<string, unknown>;
  assert.equal(dataset.id, identity.id);
  assert.equal(dataset.schema, identity.schema);
  assert.equal(dataset.name, identity.table);
  const metadata = payload._metadata as Record<string, unknown>;
  assert.equal(metadata.source_endpoint_id, identity.sourceId);
  assert.equal(metadata.dataset_identity, identity.id);
});

