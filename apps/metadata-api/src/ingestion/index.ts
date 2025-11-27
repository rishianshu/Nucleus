import { registerIngestionDriver, registerIngestionSink } from "@metadata/core";
import { KnowledgeBaseSink } from "./kbSink.js";
import { CdmJdbcSink } from "./cdmSink.js";
import { StaticIngestionDriver } from "./staticDriver.js";

export function registerDefaultIngestionSinks() {
  registerIngestionSink("kb", () => new KnowledgeBaseSink());
  registerIngestionSink("cdm", () => new CdmJdbcSink(), {
    supportedCdmModels: ["cdm.work.project", "cdm.work.user", "cdm.work.item", "cdm.work.comment", "cdm.work.worklog"],
  });
  registerIngestionDriver("static", () => new StaticIngestionDriver());
}
