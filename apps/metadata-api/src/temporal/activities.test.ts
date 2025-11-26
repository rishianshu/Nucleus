import test from "node:test";
import assert from "node:assert/strict";
import { resolveIngestionPolicy } from "./activities.js";

test("resolveIngestionPolicy returns explicit ingestionPolicy when present", () => {
  const endpoint = {
    config: {
      ingestionPolicy: {
        limit: 100,
      },
      templateId: "jira.http",
    },
  };
  const policy = resolveIngestionPolicy(endpoint);
  assert.deepEqual(policy, { limit: 100 });
});

test("resolveIngestionPolicy falls back to entire config when ingestionPolicy missing", () => {
  const endpoint = {
    config: {
      templateId: "jira.http",
      parameters: {
        base_url: "https://example.atlassian.net",
        auth_type: "basic",
      },
    },
  };
  const policy = resolveIngestionPolicy(endpoint);
  assert.deepEqual(policy, endpoint.config);
});
