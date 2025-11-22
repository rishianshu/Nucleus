import type { IngestionDriver, IngestionDriverSyncArgs, IngestionDriverSyncResult, IngestionUnitDescriptor } from "@metadata/core";
import { getMetadataStore } from "../context.js";

export class StaticIngestionDriver implements IngestionDriver {
  async listUnits(endpointId: string): Promise<IngestionUnitDescriptor[]> {
    const endpoint = await resolveEndpoint(endpointId);
    if (!endpoint) {
      return [];
    }
    const units = Array.isArray(endpoint.config?.ingestionUnits) ? endpoint.config?.ingestionUnits : [];
    return units
      .filter((entry: unknown): entry is { unitId: string; kind?: string; displayName?: string; stats?: Record<string, unknown> } => {
        return Boolean(entry && typeof entry === "object" && typeof (entry as any).unitId === "string");
      })
      .map((entry) => ({
        unitId: entry.unitId,
        kind: entry.kind ?? "custom",
        displayName: entry.displayName ?? entry.unitId,
        stats: entry.stats ?? null,
      }));
  }

  async estimateLag(): Promise<number | null> {
    return null;
  }

  async syncUnit(args: IngestionDriverSyncArgs): Promise<IngestionDriverSyncResult> {
    return {
      newCheckpoint: args.checkpoint ?? { timestamp: new Date().toISOString() },
      stats: {
        processed: 0,
        message: "static driver emits no data",
      },
      batches: [],
      sourceEventIds: [],
      errors: [],
    };
  }
}

async function resolveEndpoint(endpointId: string) {
  const store = await getMetadataStore();
  const endpoints = await store.listEndpoints();
  return endpoints.find((endpoint) => endpoint.id === endpointId) ?? null;
}
