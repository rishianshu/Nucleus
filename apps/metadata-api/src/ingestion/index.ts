import { registerIngestionDriver, registerIngestionSink } from "@metadata/core";
import { KnowledgeBaseSink } from "./kbSink.js";
import { StaticIngestionDriver } from "./staticDriver.js";

export function registerDefaultIngestionSinks() {
  registerIngestionSink("kb", () => new KnowledgeBaseSink());
  registerIngestionDriver("static", () => new StaticIngestionDriver());
}
