import crypto from "node:crypto";
import type { GraphStore, IngestionSink, IngestionSinkContext, NormalizedBatch, NormalizedRecord, TenantContext } from "@metadata/core";
import { getGraphStore } from "../context.js";

const TENANT_ID = process.env.TENANT_ID ?? "dev";
const DEFAULT_PROJECT_ID = process.env.METADATA_DEFAULT_PROJECT ?? "global";

export class KnowledgeBaseSink implements IngestionSink {
  private graphStorePromise: Promise<GraphStore>;

  constructor(graphStore?: GraphStore) {
    this.graphStorePromise = graphStore ? Promise.resolve(graphStore) : getGraphStore();
  }

  async begin(_context: IngestionSinkContext): Promise<void> {
    // graph store fetched lazily so writes stay async-friendly
    await this.graphStorePromise;
  }

  async writeBatch(batch: NormalizedBatch, context: IngestionSinkContext): Promise<{ upserts?: number; edges?: number }> {
    const graphStore = await this.graphStorePromise;
    let upserts = 0;
    for (const record of batch.records) {
      await graphStore.upsertEntity(
        {
          entityType: record.entityType,
          displayName: resolveDisplayName(record),
          canonicalPath: extractCanonicalPath(record),
          sourceSystem: record.provenance.vendor ?? undefined,
          properties: buildProperties(record),
          scope: buildScope(record),
          identity: {
            logicalKey: buildLogicalKey(record),
            originEndpointId: record.provenance.endpointId,
            originVendor: record.provenance.vendor ?? undefined,
            externalId: record.provenance.sourceEventId ? { sourceEventId: record.provenance.sourceEventId } : undefined,
            phase: record.phase ?? undefined,
            provenance: record.payload && typeof record.payload === "object" ? (record.payload as Record<string, unknown>) : undefined,
          },
        },
        buildTenantContext(record, context),
      );
      upserts += 1;
    }
    return { upserts, edges: 0 };
  }

  async commit(_context: IngestionSinkContext): Promise<void> {
    // no transactional semantics required yet
  }

  async abort(_context: IngestionSinkContext): Promise<void> {
    // nothing to rollback yet; hook present for parity
  }
}

function resolveDisplayName(record: NormalizedRecord): string {
  if (record.displayName && record.displayName.trim().length > 0) {
    return record.displayName.trim();
  }
  if (typeof record.payload === "object" && record.payload && "displayName" in (record.payload as Record<string, unknown>)) {
    const candidate = (record.payload as Record<string, unknown>).displayName;
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return record.logicalId ?? `${record.entityType}-${crypto.randomUUID()}`;
}

function extractCanonicalPath(record: NormalizedRecord): string | undefined {
  if (typeof record.payload === "object" && record.payload && "canonicalPath" in (record.payload as Record<string, unknown>)) {
    const candidate = (record.payload as Record<string, unknown>).canonicalPath;
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return undefined;
}

function buildProperties(record: NormalizedRecord): Record<string, unknown> {
  if (record.payload && typeof record.payload === "object") {
    return { ...(record.payload as Record<string, unknown>) };
  }
  return { value: record.payload };
}

function buildScope(record: NormalizedRecord) {
  return {
    orgId: record.scope.orgId,
    projectId: record.scope.projectId ?? null,
    domainId: record.scope.domainId ?? null,
    teamId: record.scope.teamId ?? null,
  };
}

function buildTenantContext(record: NormalizedRecord, context: IngestionSinkContext): TenantContext {
  return {
    tenantId: TENANT_ID,
    projectId: record.scope.projectId ?? DEFAULT_PROJECT_ID,
    actorId: context.endpointId,
  };
}

function buildLogicalKey(record: NormalizedRecord): string {
  if (record.logicalId && record.logicalId.trim().length > 0) {
    return record.logicalId.trim();
  }
  const payloadBytes =
    record.payload && typeof record.payload === "object" ? JSON.stringify(record.payload) : String(record.payload ?? "");
  const hashed = crypto.createHash("sha1").update(payloadBytes).digest("hex");
  const scopeKey = [record.scope.orgId, record.scope.projectId ?? "", record.scope.domainId ?? "", record.scope.teamId ?? ""].join(":");
  return `${record.entityType}:${scopeKey}:${hashed}`;
}
