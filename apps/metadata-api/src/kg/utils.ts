const WORK_PREFIX = /^cdm[:\.\s]*work[:\.\s]*item[:\.]?/i;
const DOC_PREFIX = /^cdm[:\.\s]*doc[:\.\s]*item[:\.]?/i;

export const DEFAULT_BATCH_SIZE = 100;

export function clampBatchSize(limit?: number, fallback = DEFAULT_BATCH_SIZE, max = 200): number {
  if (typeof limit === "number" && Number.isFinite(limit)) {
    const normalized = Math.floor(limit);
    if (normalized < 1) {
      return 1;
    }
    return normalized > max ? max : normalized;
  }
  return fallback;
}

export function encodeOffsetCursor(offset?: number): string | undefined {
  if (typeof offset !== "number" || offset < 0 || Number.isNaN(offset)) {
    return undefined;
  }
  return Buffer.from(String(offset)).toString("base64");
}

export function normalizeCdmEntityId(prefix: "cdm.work.item" | "cdm.doc.item", cdmId: string): string {
  const raw = String(cdmId ?? "");
  const normalized = raw.replace(WORK_PREFIX, "cdm.work.item:").replace(DOC_PREFIX, "cdm.doc.item:");
  if (normalized.startsWith(`${prefix}:`)) {
    return normalized;
  }
  if (normalized.startsWith(prefix)) {
    return normalized;
  }
  return `${prefix}:${normalized}`;
}

export function normalizeGenericNodeId(prefix: string, raw: string): string {
  const value = String(raw ?? "");
  if (value.startsWith(`${prefix}:`) || value.startsWith(prefix)) {
    return value;
  }
  return `${prefix}:${value}`;
}

export function toIsoString(value?: Date | string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }
  return undefined;
}

export function cleanProperties(map: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(map).filter(([, value]) => value !== undefined));
}

export function deriveProjectKey(sourceIssueKey?: string | null, projectCdmId?: string | null): string | undefined {
  if (sourceIssueKey && sourceIssueKey.includes("-")) {
    return sourceIssueKey.split("-")[0] ?? undefined;
  }
  if (projectCdmId) {
    const parts = projectCdmId.split(":").filter((part) => part.length > 0);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }
  return undefined;
}
