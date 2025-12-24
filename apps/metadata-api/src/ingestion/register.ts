import { registerIngestionDriver, registerIngestionSink, type IngestionSink, type IngestionSinkContext, type NormalizedBatch } from "@metadata/core";
import { StaticIngestionDriver } from "./staticDriver.js";

export function registerDefaultIngestionDrivers() {
  registerIngestionDriver("static", () => new StaticIngestionDriver());
  // Minimal sink registrations to satisfy schema lookups; actual writes are handled by Go sink runner.
  const sink: IngestionSink = {
    async begin(_ctx: IngestionSinkContext) {},
    async writeBatch(_batch: NormalizedBatch, _ctx: IngestionSinkContext) {
      return { upserts: 0 };
    },
    async commit() {},
  };
  registerIngestionSink("kb", () => sink);
  registerIngestionSink("cdm", () => sink);
  registerIngestionSink("minio", () => sink);
}
