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
    let edges = 0;
    const logicalKeyToId = new Map<string, string>();
    const logicalKeyToScope = new Map<string, { scope: ReturnType<typeof buildScope>; tenant: TenantContext }>();

    for (const record of batch.records) {
      if (record.entityType === "cdm.doc.link") {
        continue;
      }
      const scope = buildScope(record);
      const tenant = buildTenantContext(record, context);
      const logicalKey = buildLogicalKey(record);
      const entity = await graphStore.upsertEntity(
        {
          entityType: record.entityType,
          displayName: resolveDisplayName(record),
          canonicalPath: extractCanonicalPath(record),
          sourceSystem: record.provenance.vendor ?? undefined,
          properties: buildProperties(record),
          scope,
          identity: {
            logicalKey,
            originEndpointId: record.provenance.endpointId,
            originVendor: record.provenance.vendor ?? undefined,
            externalId: record.provenance.sourceEventId ? { sourceEventId: record.provenance.sourceEventId } : undefined,
            phase: record.phase ?? undefined,
            provenance: record.payload && typeof record.payload === "object" ? (record.payload as Record<string, unknown>) : undefined,
          },
        },
        tenant,
      );
      logicalKeyToId.set(entity.identity.logicalKey, entity.id);
      logicalKeyToScope.set(entity.identity.logicalKey, { scope, tenant });
      upserts += 1;
    }

    // Handle doc attachments (doc → attachment relations)
    for (const record of batch.records) {
      const logicalKey = buildLogicalKey(record);
      const sourceEntityId = logicalKeyToId.get(logicalKey);
      if (!sourceEntityId) {
        continue;
      }
      // Drive/file hierarchy: parent (drive or folder) contains item
      const parentTarget = resolveDocParent(record.payload);
      if (parentTarget) {
        const { parentLogicalId, parentEntityType } = parentTarget;
        const scope = logicalKeyToScope.get(logicalKey)?.scope ?? buildScope(record);
        const tenant = logicalKeyToScope.get(logicalKey)?.tenant ?? buildTenantContext(record, context);
        const sourceSystem = normalizeString(record.provenance.vendor) ?? "docs";
        if (parentEntityType === "doc.space") {
          await ensureDocSpaceEntity(graphStore, parentLogicalId, scope, tenant, sourceSystem);
        } else {
          await ensureDocEntity(graphStore, parentLogicalId, sourceSystem, scope, tenant);
        }
        await graphStore.upsertEdge(
          {
            edgeType: "rel.drive_contains_item",
            sourceEntityId: parentLogicalId,
            targetEntityId: sourceEntityId,
            metadata: {
              source_system: sourceSystem,
            },
            scope,
            identity: {
              originEndpointId: record.provenance.endpointId,
              originVendor: record.provenance.vendor ?? undefined,
              sourceLogicalKey: parentLogicalId,
              targetLogicalKey: logicalKey,
            },
          },
          tenant,
        );
        edges += 1;
      }

      const attachments = extractAttachments(record.payload);
      if (!attachments.length) {
        continue;
      }
      const scope = logicalKeyToScope.get(logicalKey)?.scope ?? buildScope(record);
      const tenant = logicalKeyToScope.get(logicalKey)?.tenant ?? buildTenantContext(record, context);
      const sourceSystem = normalizeString(record.provenance.vendor) ?? "docs";

      for (const [idx, attachment] of attachments.entries()) {
        const attachmentId = buildAttachmentId(record.logicalId ?? logicalKey, attachment, idx);
        await ensureDocAttachmentEntity(graphStore, attachmentId, attachment, scope, tenant, sourceSystem);
        await graphStore.upsertEdge(
          {
            edgeType: "rel.doc_contains_attachment",
            sourceEntityId,
            targetEntityId: attachmentId,
            metadata: {
              source_system: sourceSystem,
              attachment_id: attachment.id ?? attachment.name ?? attachment.filename,
              synced_at: attachment.syncedAt ?? attachment.synced_at ?? new Date().toISOString(),
            },
            scope,
            identity: {
              originEndpointId: record.provenance.endpointId,
              originVendor: record.provenance.vendor ?? undefined,
            },
          },
          tenant,
        );
        edges += 1;
      }
    }

    // Handle doc link relations (doc↔doc) directly
    for (const record of batch.records) {
      if (record.entityType !== "cdm.doc.link" || !record.payload || typeof record.payload !== "object") {
        continue;
      }
      const payload = record.payload as Record<string, unknown>;
      const fromId = normalizeString(payload.from_item_cdm_id) ?? normalizeString(payload.fromItemCdmId);
      const toId = normalizeString(payload.to_item_cdm_id) ?? normalizeString(payload.toItemCdmId);
      if (!fromId || !toId) {
        continue;
      }
      const sourceSystem = normalizeString(payload.source_system) ?? normalizeString(record.provenance.vendor) ?? "docs";
      const scope = buildScope(record);
      const tenant = buildTenantContext(record, context);

      await ensureDocEntity(graphStore, fromId, sourceSystem, scope, tenant);
      await ensureDocEntity(graphStore, toId, sourceSystem, scope, tenant);
      await graphStore.upsertEdge(
        {
          edgeType: "rel.doc_links_doc",
          sourceEntityId: fromId,
          targetEntityId: toId,
          metadata: {
            source_system: sourceSystem,
            link_type: payload.link_type ?? payload.linkType,
            synced_at: payload.synced_at ?? payload.syncedAt ?? new Date().toISOString(),
          },
          scope,
          identity: {
            originEndpointId: record.provenance.endpointId,
            originVendor: record.provenance.vendor ?? undefined,
          },
        },
        tenant,
      );
      edges += 1;
    }

    // Handle work item relations (issue links) when both sides exist in the batch
    for (const record of batch.records) {
      if (!record.payload || typeof record.payload !== "object") {
        continue;
      }
      if (!String(record.entityType || "").startsWith("work.")) {
        continue;
      }
      const relations = extractRelations(record.payload);
      if (!relations.length) {
        continue;
      }
      const sourceLogical = buildLogicalKey(record);
      const sourceEntityId = logicalKeyToId.get(sourceLogical);
      if (!sourceEntityId) {
        continue;
      }
      const scope = logicalKeyToScope.get(sourceLogical)?.scope ?? buildScope(record);
      const tenant = logicalKeyToScope.get(sourceLogical)?.tenant ?? buildTenantContext(record, context);
      const sourceSystem = normalizeString(record.provenance.vendor) ?? "work";

      for (const rel of relations) {
        const targetLogical =
          rel.targetLogicalId ?? rel.target_logical_id ?? rel.target_id ?? rel.targetId ?? rel.targetKey ?? null;
        if (!targetLogical || typeof targetLogical !== "string") {
          continue;
        }
        const targetEntityId = logicalKeyToId.get(targetLogical);
        if (!targetEntityId) {
          continue;
        }
        await graphStore.upsertEdge(
          {
            edgeType: "rel.work_links_work",
            sourceEntityId,
            targetEntityId,
            metadata: {
              source_system: sourceSystem,
              link_type: rel.type ?? rel.link_type ?? rel.relationship,
              direction: rel.direction,
            },
            scope,
            identity: {
              originEndpointId: record.provenance.endpointId,
              originVendor: record.provenance.vendor ?? undefined,
              sourceLogicalKey: sourceLogical,
              targetLogicalKey: targetLogical,
            },
          },
          tenant,
        );
        edges += 1;
      }
    }

    for (const record of batch.records) {
      if (!Array.isArray(record.edges) || record.edges.length === 0) {
        continue;
      }
      const defaultScope = buildScope(record);
      const defaultTenant = buildTenantContext(record, context);
      for (const edge of record.edges) {
        const sourceId = logicalKeyToId.get(edge.sourceLogicalId);
        const targetId = logicalKeyToId.get(edge.targetLogicalId);
        if (!sourceId || !targetId) {
          continue;
        }
        const sourceScope = logicalKeyToScope.get(edge.sourceLogicalId)?.scope ?? defaultScope;
        const tenant = logicalKeyToScope.get(edge.sourceLogicalId)?.tenant ?? defaultTenant;
        await graphStore.upsertEdge(
          {
            edgeType: edge.type,
            sourceEntityId: sourceId,
            targetEntityId: targetId,
            metadata: edge.properties ?? undefined,
            scope: sourceScope,
            identity: {
              sourceLogicalKey: edge.sourceLogicalId,
              targetLogicalKey: edge.targetLogicalId,
              originEndpointId: record.provenance.endpointId,
              originVendor: record.provenance.vendor ?? undefined,
            },
          },
          tenant,
        );
        edges += 1;
      }
    }

    return { upserts, edges };
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

async function ensureDocEntity(
  graphStore: GraphStore,
  id: string,
  sourceSystem: string,
  scope: ReturnType<typeof buildScope>,
  tenant: TenantContext,
) {
  await graphStore.upsertEntity(
    {
      id,
      entityType: "doc.item",
      displayName: id.split(":").pop() ?? id,
      canonicalPath: id,
      sourceSystem,
      properties: { source_system: sourceSystem },
      scope,
      identity: {
        logicalKey: id,
        originEndpointId: tenant.actorId ?? undefined,
      },
    },
    tenant,
  );
}

async function ensureDocSpaceEntity(
  graphStore: GraphStore,
  id: string,
  scope: ReturnType<typeof buildScope>,
  tenant: TenantContext,
  sourceSystem: string,
) {
  await graphStore.upsertEntity(
    {
      id,
      entityType: "doc.space",
      displayName: id.split(":").pop() ?? id,
      canonicalPath: id,
      sourceSystem,
      properties: { source_system: sourceSystem },
      scope,
      identity: {
        logicalKey: id,
        originVendor: sourceSystem,
      },
    },
    tenant,
  );
}

function normalizeString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

function extractAttachments(payload: unknown): Array<Record<string, any>> {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const obj = payload as Record<string, unknown>;
  const attachmentsRaw = obj.attachments ?? obj.attachment;
  if (Array.isArray(attachmentsRaw)) {
    return attachmentsRaw.filter((entry) => entry && typeof entry === "object") as Array<Record<string, any>>;
  }
  if (attachmentsRaw && typeof attachmentsRaw === "object") {
    return Object.values(attachmentsRaw as Record<string, any>).filter((entry) => entry && typeof entry === "object");
  }
  return [];
}

function buildAttachmentId(docLogicalKey: string, attachment: Record<string, any>, idx: number): string {
  const attId =
    normalizeString(attachment.id) ??
    normalizeString(attachment.attachment_id) ??
    normalizeString(attachment.attachmentId) ??
    normalizeString(attachment.name ?? attachment.filename) ??
    `attachment-${idx}`;
  return `doc.attachment:${docLogicalKey}:${attId}`;
}

async function ensureDocAttachmentEntity(
  graphStore: GraphStore,
  id: string,
  attachment: Record<string, any>,
  scope: ReturnType<typeof buildScope>,
  tenant: TenantContext,
  sourceSystem: string,
) {
  await graphStore.upsertEntity(
    {
      id,
      entityType: "doc.attachment",
      displayName: normalizeString(attachment.displayName ?? attachment.name ?? attachment.filename) ?? id,
      canonicalPath: attachment.canonicalPath ?? id,
      sourceSystem,
      properties: { ...attachment, source_system: sourceSystem },
      scope,
      identity: {
        logicalKey: id,
        originVendor: sourceSystem,
      },
    },
    tenant,
  );
}

function extractRelations(payload: unknown): Array<Record<string, any>> {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const obj = payload as Record<string, unknown>;
  const rels = obj.relations ?? obj.links ?? obj.issueLinks;
  if (Array.isArray(rels)) {
    return rels.filter((entry) => entry && typeof entry === "object") as Array<Record<string, any>>;
  }
  return [];
}

function resolveDocParent(
  payload: unknown,
): { parentLogicalId: string; parentEntityType: "doc.space" | "doc.item" } | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const obj = payload as Record<string, any>;
  const parentId =
    normalizeString(obj.parent_item_cdm_id) ??
    normalizeString(obj.parentItemCdmId) ??
    normalizeString(obj.parent_id) ??
    normalizeString(obj.parentId);
  const spaceId = normalizeString(obj.space_cdm_id) ?? normalizeString(obj.spaceCdmId);
  if (parentId) {
    return { parentLogicalId: parentId, parentEntityType: "doc.item" };
  }
  if (spaceId) {
    return { parentLogicalId: spaceId, parentEntityType: "doc.space" };
  }
  return null;
}
