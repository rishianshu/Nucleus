import { strict as assert } from "node:assert";
import test from "node:test";
import { __testCatalogFilters } from "./schema.js";

const { buildCatalogLabelFilter, buildEndpointFilter } = __testCatalogFilters;

test("buildCatalogLabelFilter trims and dedupes labels", () => {
  const filter = buildCatalogLabelFilter(["  foo  ", "bar", "foo"]);
  assert.ok(filter);
  assert.deepEqual(filter?.hasEvery, ["foo", "bar"]);
  assert.equal(buildCatalogLabelFilter([]), undefined);
  assert.equal(buildCatalogLabelFilter(undefined), undefined);
});

test("buildEndpointFilter returns json label + payload options", () => {
  const filter = buildEndpointFilter("endpoint-123");
  assert.ok(filter, "filter should be defined for valid endpoint id");
  const clauses = (filter!.OR ?? []) as Array<Record<string, unknown>>;
  assert.equal(clauses.length, 5);
  assert.deepEqual(clauses[0], { labels: { has: "endpoint:endpoint-123" } });
  assert.deepEqual(clauses[1], { payload: { path: ["metadata_endpoint_id"], equals: "endpoint-123" } });
});

test("buildEndpointFilter returns undefined for blank input", () => {
  assert.equal(buildEndpointFilter(undefined), undefined);
  assert.equal(buildEndpointFilter("   " as string), undefined);
});
