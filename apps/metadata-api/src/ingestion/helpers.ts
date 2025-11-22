import type { MetadataEndpointDescriptor } from "@metadata/core";

const DRIVER_LABEL_PREFIX = "ingest-driver:";

export function resolveEndpointDriverId(endpoint: MetadataEndpointDescriptor): string | null {
  const fromConfig = extractDriverFromConfig(endpoint);
  if (fromConfig) {
    return fromConfig;
  }
  const fromLabels = endpoint.labels?.find((label) => label.startsWith(DRIVER_LABEL_PREFIX));
  if (fromLabels) {
    return fromLabels.slice(DRIVER_LABEL_PREFIX.length).trim() || null;
  }
  return process.env.INGESTION_DEFAULT_DRIVER ?? null;
}

function extractDriverFromConfig(endpoint: MetadataEndpointDescriptor): string | null {
  const config = endpoint.config;
  if (config && typeof config === "object" && typeof (config as Record<string, unknown>).ingestionDriver === "string") {
    const driverId = (config as Record<string, unknown>).ingestionDriver as string;
    return driverId.trim().length ? driverId.trim() : null;
  }
  return null;
}
