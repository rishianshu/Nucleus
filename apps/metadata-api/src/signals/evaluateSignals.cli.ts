import { CdmDocStore } from "../cdm/docStore.js";
import { CdmWorkStore } from "../cdm/workStore.js";
import { getPrismaClient } from "../prismaClient.js";
import { DefaultSignalEvaluator } from "./evaluator.js";
import { PrismaSignalStore } from "./signalStore.js";

function parseArgs(argv: string[]) {
  const args = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--defs" || token === "--definitions") {
      const value = argv[i + 1];
      if (value && !value.startsWith("--")) {
        args.set("defs", value);
        i += 1;
      }
    } else if (token === "--dry-run") {
      args.set("dryRun", true);
    }
  }
  return args;
}

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);
  const definitionSlugs = parsed.has("defs")
    ? String(parsed.get("defs"))
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : undefined;
  const dryRun = parsed.get("dryRun") === true;

  const signalStore = new PrismaSignalStore(getPrismaClient);
  const evaluator = new DefaultSignalEvaluator({
    signalStore,
    workStore: new CdmWorkStore(),
    docStore: new CdmDocStore(),
  });

  const summary = await evaluator.evaluateAll({ definitionSlugs, dryRun });
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("[evaluateSignals.cli] failed", error);
  process.exitCode = 1;
});
