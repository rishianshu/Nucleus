export type DatasetIdentityKey = {
  tenantId: string;
  projectId: string;
  sourceId: string;
  schema: string;
  table: string;
  database?: string | null;
};

export type DatasetIdentity = DatasetIdentityKey & {
  id: string;
  canonicalPath: string;
};

export type DatasetIdentityContext = {
  tenantId: string;
  projectId: string;
  fallbackSourceId?: string | null;
  labels?: string[] | null;
};

type UnknownRecord = Record<string, unknown>;

const ID_PREFIX = "dataset";

export function deriveDatasetIdentity(payload: unknown, context: DatasetIdentityContext): DatasetIdentity | null {
  const normalizedPayload = normalizeObject(payload);
  if (!normalizedPayload) {
    return null;
  }
  const datasetPayload = normalizeObject(normalizedPayload.dataset);
  const endpointPayload = normalizeObject(normalizedPayload.endpoint);
  const metadataPayload = normalizeObject(normalizedPayload._metadata);
  const metadataConfigPayload = normalizeObject(normalizedPayload.metadata_config);
  const artifactConfigPayload = normalizeObject(normalizedPayload.artifact_config);
  const environmentPayload = normalizeObject(normalizedPayload.environment);

  const sourceLabel = resolveLabelSourceId(context.labels);
  const sourceId =
    pickString(
      metadataPayload?.source_endpoint_id,
      metadataPayload?.source_id,
      datasetPayload?.sourceEndpointId,
      normalizedPayload.metadata_endpoint_id,
      metadataConfigPayload?.endpointId,
      artifactConfigPayload?.metadata_endpoint_id,
      endpointPayload?.id,
      endpointPayload?.sourceId,
      sourceLabel,
      context.fallbackSourceId,
    ) ?? null;
  if (!sourceId) {
    return null;
  }

  const database = pickString(
    datasetPayload?.database,
    datasetPayload?.catalog,
    normalizedPayload.database,
    normalizedPayload.catalog,
    endpointPayload?.database,
    endpointPayload?.config && (endpointPayload.config as UnknownRecord).database,
    metadataConfigPayload?.database,
    artifactConfigPayload?.database,
    metadataPayload?.database,
  );

  const schema =
    pickString(
      datasetPayload?.schema,
      datasetPayload?.namespace,
      normalizedPayload.schema,
      normalizedPayload.namespace,
      environmentPayload?.schema,
      endpointPayload?.schema,
      metadataConfigPayload?.schema,
      artifactConfigPayload?.schema,
    ) ?? null;
  const table =
    pickString(
      datasetPayload?.name,
      datasetPayload?.table,
      normalizedPayload.table,
      normalizedPayload.name,
      normalizedPayload.entity,
      artifactConfigPayload?.entity,
      endpointPayload?.table,
      endpointPayload?.config && (endpointPayload.config as UnknownRecord).table,
    ) ?? null;
  if (!schema || !table) {
    return null;
  }

  const sanitizedKey: DatasetIdentityKey = {
    tenantId: sanitizeSegment(context.tenantId ?? "dev", "dev"),
    projectId: sanitizeSegment(context.projectId ?? "global", "global"),
    sourceId: sanitizeSegment(sourceId, "source"),
    schema: sanitizeSegment(schema, "schema"),
    table: sanitizeSegment(table, "table"),
    database: database ? sanitizeSegment(database, null) || null : null,
  };
  const id = buildDatasetId(sanitizedKey);
  const canonicalPath = buildDatasetCanonicalPath(sanitizedKey);
  return {
    ...sanitizedKey,
    id,
    canonicalPath,
  };
}

export function imprintDatasetIdentity(payload: UnknownRecord, identity: DatasetIdentity): void {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const datasetPayload = normalizeObject(payload.dataset) ?? {};
  if (!datasetPayload.id) {
    datasetPayload.id = identity.id;
  }
  if (!datasetPayload.schema) {
    datasetPayload.schema = identity.schema;
  }
  if (!datasetPayload.name) {
    datasetPayload.name = identity.table;
  }
  payload.dataset = datasetPayload;
  const metadataPayload = normalizeObject(payload._metadata) ?? {};
  if (!metadataPayload.source_endpoint_id) {
    metadataPayload.source_endpoint_id = identity.sourceId;
  }
  if (!metadataPayload.source_id) {
    metadataPayload.source_id = identity.sourceId;
  }
  metadataPayload.dataset_identity = identity.id;
  payload._metadata = metadataPayload;
}

export function buildDatasetId(key: DatasetIdentityKey): string {
  const segments = [ID_PREFIX, key.tenantId, key.projectId, key.sourceId];
  if (key.database) {
    segments.push(key.database);
  }
  segments.push(key.schema, key.table);
  return segments.join("::");
}

export function buildDatasetCanonicalPath(key: DatasetIdentityKey): string {
  const pathSegments = [key.sourceId];
  if (key.database) {
    pathSegments.push(key.database);
  }
  pathSegments.push(key.schema, key.table);
  return pathSegments.join("/");
}

function normalizeObject(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as UnknownRecord;
}

function pickString(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    const str = toStringOrNull(candidate);
    if (str) {
      return str;
    }
  }
  return null;
}

function toStringOrNull(candidate: unknown): string | null {
  if (candidate === null || candidate === undefined) {
    return null;
  }
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof candidate === "number" || typeof candidate === "boolean") {
    return String(candidate);
  }
  return null;
}

function sanitizeSegment(value: string, fallback: string | null): string {
  const normalized = value?.toString().trim().toLowerCase() ?? "";
  const sanitized = normalized.replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (sanitized.length > 0) {
    return sanitized;
  }
  if (fallback !== undefined) {
    if (fallback === null) {
      return "";
    }
    if (fallback) {
      return fallback;
    }
  }
  return "unknown";
}

function resolveLabelSourceId(labels?: string[] | null): string | null {
  if (!labels || !Array.isArray(labels)) {
    return null;
  }
  for (const label of labels) {
    if (typeof label !== "string") {
      continue;
    }
    if (label.startsWith("source:")) {
      const maybeValue = label.slice("source:".length).trim();
      if (maybeValue.length > 0) {
        return maybeValue;
      }
    }
    if (label.startsWith("endpoint:")) {
      const maybeValue = label.slice("endpoint:".length).trim();
      if (maybeValue.length > 0) {
        return maybeValue;
      }
    }
  }
  return null;
}
