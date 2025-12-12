import type { TenantContext } from "@metadata/core";
import type { GraphWrite } from "../graph/graphWrite.js";
import { createGraphWrite } from "../graph/graphWrite.js";
import type { SignalStore } from "../signals/types.js";
import type { CdmDocStore } from "../cdm/docStore.js";
import type { CdmWorkStore } from "../cdm/workStore.js";
import { DefaultCdmToKgBridge } from "./cdmToKgBridge.js";
import { DefaultSignalsToKgBridge } from "./signalsToKgBridge.js";

export type BridgeSyncResult = { workItems: number; docItems: number; signals: number };

export async function syncCdmAndSignalsToKg(options: {
  tenant?: TenantContext;
  graphWrite?: GraphWrite;
  batchSize?: number;
  workStore?: Pick<CdmWorkStore, "listWorkItems">;
  docStore?: Pick<CdmDocStore, "listDocItems">;
  signalStore?: Pick<SignalStore, "listInstances" | "listInstancesPaged">;
}): Promise<BridgeSyncResult> {
  if (!options.graphWrite && !options.tenant) {
    throw new Error("tenant is required when graphWrite is not provided");
  }

  const graphWrite = options.graphWrite ?? (await createGraphWrite(options.tenant!));
  const cdmBridge = new DefaultCdmToKgBridge({
    graphWrite,
    workStore: options.workStore,
    docStore: options.docStore,
    batchSize: options.batchSize,
  });
  const signalsBridge = new DefaultSignalsToKgBridge({
    graphWrite,
    signalStore: options.signalStore,
    batchSize: options.batchSize,
  });

  const cdmResult = await cdmBridge.syncAllToKg({ batchSize: options.batchSize });
  const signalsResult = await signalsBridge.syncSignalsToKg({ limit: options.batchSize });

  return { workItems: cdmResult.workItems, docItems: cdmResult.docItems, signals: signalsResult.processed };
}
