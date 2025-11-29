import test from "node:test";
import assert from "node:assert/strict";
import { __testEndpointConfig } from "./schema.js";

const { mergeTemplateConfigPayload } = __testEndpointConfig;

test("mergeTemplateConfigPayload merges built config with template metadata", () => {
  const result = mergeTemplateConfigPayload(
    "http.confluence",
    {
      base_url: "https://example.atlassian.net/wiki",
      include_archived: "false",
    },
    {
      base_url: "https://example.atlassian.net/wiki",
      include_archived: false,
      space_keys: ["ENG"],
    },
    {
      ingestionPolicy: { limit: 100 },
    },
  );
  assert.deepEqual(result, {
    ingestionPolicy: { limit: 100 },
    base_url: "https://example.atlassian.net/wiki",
    include_archived: false,
    space_keys: ["ENG"],
    templateId: "http.confluence",
    parameters: {
      base_url: "https://example.atlassian.net/wiki",
      include_archived: "false",
    },
  });
});

test("mergeTemplateConfigPayload falls back to input config when build output missing", () => {
  const result = mergeTemplateConfigPayload(
    "http.confluence",
    { base_url: "https://sample/wiki" },
    null,
    { templateId: "legacy.template", parameters: { base_url: "https://legacy/wiki" }, extra: true },
  );
  assert.deepEqual(result, {
    templateId: "http.confluence",
    parameters: { base_url: "https://sample/wiki" },
    extra: true,
  });
});

test("mergeTemplateConfigPayload returns null when no template or config provided", () => {
  const result = mergeTemplateConfigPayload(null, {}, null, null);
  assert.equal(result, null);
});
