import { strict as assert } from "node:assert";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getIngestionDriver, getIngestionSink, type MetadataEndpointTemplateDescriptor } from "@metadata/core";
import { registerDefaultIngestionSinks } from "./index.js";
import { getMetadataStore } from "../context.js";

test("registerDefaultIngestionSinks registers kb sink and static driver", () => {
  registerDefaultIngestionSinks();
  const sink = getIngestionSink("kb");
  const driver = getIngestionDriver("static");
  assert.ok(sink, "kb sink should be registered");
  assert.ok(typeof sink?.begin === "function");
  assert.ok(driver, "static driver should be registered");
  assert.ok(typeof driver?.listUnits === "function");
});

test("static driver falls back to template extras for units", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "metadata-store-"));
  process.env.METADATA_STORE_DIR = tmpDir;
  registerDefaultIngestionSinks();
  const store = await getMetadataStore();
  const template: MetadataEndpointTemplateDescriptor = {
    id: "test.http",
    family: "HTTP",
    title: "Test",
    vendor: "Example",
    description: "Test template with unit extras",
    domain: "test",
    categories: ["semantic"],
    protocols: ["https"],
    versions: [],
    fields: [],
    capabilities: [],
    extras: {
      ingestionUnits: [
        {
          unitId: "test.projects",
          displayName: "Projects",
          kind: "dataset",
          description: "Projects dataset",
          supportsIncremental: false,
        },
      ],
    },
  };
  await store.saveEndpointTemplates([template]);
  const descriptor = await store.registerEndpoint({
    id: "endpoint-1",
    name: "Test Endpoint",
    verb: "GET",
    url: "https://example.com",
    projectId: "default",
    config: {
      templateId: template.id,
      parameters: {},
    },
    capabilities: ["metadata"],
  });
  const driver = getIngestionDriver("static");
  assert.ok(driver, "static driver should be registered");
  const units = await driver!.listUnits(descriptor.id!);
  assert.equal(units.length, 1);
  assert.deepEqual(units[0], {
    unitId: "test.projects",
    kind: "dataset",
    displayName: "Projects",
    stats: {
      description: "Projects dataset",
      supportsIncremental: false,
    },
  });
});
