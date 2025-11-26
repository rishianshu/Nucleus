import type {
  IngestionDriver,
  IngestionDriverSyncArgs,
  IngestionDriverSyncResult,
  IngestionUnitDescriptor,
  MetadataEndpointDescriptor,
  MetadataEndpointTemplateDescriptor,
} from "@metadata/core";
import { getMetadataStore } from "../context.js";

type RawUnit = {
  unitId: string;
  datasetId?: string;
  kind?: string;
  displayName?: string;
  supportedModes?: string[];
  defaultMode?: string;
  defaultSinkId?: string;
  defaultScheduleKind?: string;
  defaultScheduleIntervalMinutes?: number;
  stats?: Record<string, unknown> | null;
  description?: string;
  supportsIncremental?: boolean;
  defaultPolicy?: unknown;
  scope?: unknown;
};

export class StaticIngestionDriver implements IngestionDriver {
  async listUnits(endpointId: string): Promise<IngestionUnitDescriptor[]> {
    const endpoint = await resolveEndpoint(endpointId);
    if (!endpoint) {
      return [];
    }
    const configUnits = normalizeUnits(endpoint.config?.ingestionUnits);
    if (configUnits.length > 0) {
      return configUnits;
    }
    const templateUnits = await resolveTemplateUnits(endpoint);
    if (templateUnits.length > 0) {
      return templateUnits;
    }
    return [];
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

async function resolveEndpoint(endpointId: string): Promise<MetadataEndpointDescriptor | null> {
  const store = await getMetadataStore();
  const endpoints = await store.listEndpoints();
  return endpoints.find((endpoint) => endpoint.id === endpointId) ?? null;
}

async function resolveTemplate(templateId: string): Promise<MetadataEndpointTemplateDescriptor | undefined> {
  const store = await getMetadataStore();
  const templates = await store.listEndpointTemplates();
  return templates.find((template) => template.id === templateId);
}

function normalizeUnits(units: unknown): IngestionUnitDescriptor[] {
  if (!Array.isArray(units)) {
    return [];
  }
  return units
    .filter((entry: unknown): entry is RawUnit => Boolean(entry && typeof entry === "object" && typeof (entry as any).unitId === "string"))
    .map((entry) => ({
      unitId: entry.unitId,
      datasetId: normalizeDatasetId(entry.datasetId, entry.unitId),
      kind: entry.kind ?? "dataset",
      displayName: entry.displayName ?? entry.unitId,
      defaultMode: resolveDefaultMode(entry),
      supportedModes: resolveSupportedModes(entry),
      defaultSinkId: entry.defaultSinkId,
      defaultScheduleKind: entry.defaultScheduleKind,
      defaultScheduleIntervalMinutes: entry.defaultScheduleIntervalMinutes ?? null,
      defaultPolicy: normalizePolicy(entry.defaultPolicy),
      stats: buildUnitStats(entry),
    }));
}

function normalizeDatasetId(raw: unknown, fallback: string) {
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  return fallback;
}

function resolveDefaultMode(entry: RawUnit) {
  if (entry.defaultMode && typeof entry.defaultMode === "string") {
    return entry.defaultMode;
  }
  if (entry.supportsIncremental) {
    return "INCREMENTAL";
  }
  return "FULL";
}

function resolveSupportedModes(entry: RawUnit) {
  if (Array.isArray(entry.supportedModes) && entry.supportedModes.length > 0) {
    return entry.supportedModes;
  }
  if (entry.supportsIncremental) {
    return ["FULL", "INCREMENTAL"];
  }
  return ["FULL"];
}

function normalizePolicy(policy: unknown): Record<string, unknown> | null {
  if (policy && typeof policy === "object") {
    return policy as Record<string, unknown>;
  }
  return null;
}

function buildUnitStats(entry: RawUnit): Record<string, unknown> | null {
  const stats: Record<string, unknown> = {};
  if (entry.description) {
    stats.description = entry.description;
  }
  if (typeof entry.supportsIncremental === "boolean") {
    stats.supportsIncremental = entry.supportsIncremental;
  }
  if (entry.defaultPolicy !== undefined) {
    stats.defaultPolicy = entry.defaultPolicy;
  }
  if (entry.scope !== undefined) {
    stats.scope = entry.scope;
  }
  if (Object.keys(stats).length > 0) {
    return stats;
  }
  return entry.stats ?? null;
}

async function resolveTemplateUnits(endpoint: MetadataEndpointDescriptor): Promise<IngestionUnitDescriptor[]> {
  const config = endpoint.config;
  if (!config || typeof config !== "object") {
    return [];
  }
  const templateId = extractTemplateId(config);
  if (!templateId) {
    return [];
  }
  const template = await resolveTemplate(templateId);
  if (!template?.extras || typeof template.extras !== "object") {
    return [];
  }
  const extrasUnits = (template.extras as Record<string, unknown>).ingestionUnits;
  return normalizeUnits(extrasUnits);
}

function extractTemplateId(config: Record<string, unknown>): string | null {
  const rawTemplateId = config.templateId;
  if (typeof rawTemplateId === "string" && rawTemplateId.trim().length > 0) {
    return rawTemplateId.trim();
  }
  return null;
}
