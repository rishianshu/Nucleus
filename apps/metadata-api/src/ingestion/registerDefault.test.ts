import { strict as assert } from "node:assert";
import test from "node:test";
import { getIngestionDriver, getIngestionSink } from "@metadata/core";
import { registerDefaultIngestionSinks } from "./index.js";

test("registerDefaultIngestionSinks registers kb sink and static driver", () => {
  registerDefaultIngestionSinks();
  const sink = getIngestionSink("kb");
  const driver = getIngestionDriver("static");
  assert.ok(sink, "kb sink should be registered");
  assert.ok(typeof sink?.begin === "function");
  assert.ok(driver, "static driver should be registered");
  assert.ok(typeof driver?.listUnits === "function");
});
