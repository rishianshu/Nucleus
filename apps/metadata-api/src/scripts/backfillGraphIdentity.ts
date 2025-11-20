import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMetadataStore, getGraphStore } from "../context.js";
import type { GraphStore, GraphScopeInput, MetadataRecord, TenantContext } from "@metadata/core";

const LEGACY_ENTITY_DOMAIN = "graph.entity";
const LEGACY_EDGE_DOMAIN = "graph.edge";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ARTIFACTS_DIR = path.join(REPO_ROOT, ".artifacts");
const DEFAULT_PROJECT_ID = process.env.METADATA_DEFAULT_PROJECT ?? "global";
const DEFAULT_TENANT_ID = process.env.TENANT_ID ?? "dev";

type LegacyGraphEntityPayload = {
  tenantId?: string | null;
  entityType: string;
  displayName?: string | null;
  canonicalPath?: string | null;
  sourceSystem?: string | null;
  specRef?: string | null;
  properties?: Record<string, unknown>;
};

type LegacyGraphEdgePayload = {
  tenantId?: string | null;
  edgeType: string;
  sourceEntityId: string;
  targetEntityId: string;
  confidence?: number | null;
  specRef?: string | null;
  metadata?: Record<string, unknown>;
};

type BackfillReport = {
  startedAt: string;
  finishedAt?: string;
  nodesProcessed: number;
  nodesMigrated: number;
  nodeErrors: Array<{ id: string; error: string }>;
  edgesProcessed: number;
  edgesMigrated: number;
  edgeErrors: Array<{ id: string; error: string }>;
  edgeMissingNode: Array<{ id: string; sourceId: string; targetId: string }>;
};

async function main(): Promise<void> {
  const startedAt = new Date();
  const [store, graphStore] = await Promise.all([getMetadataStore(), getGraphStore()]);
  const report: BackfillReport = {
    startedAt: startedAt.toISOString(),
    nodesProcessed: 0,
    nodesMigrated: 0,
    nodeErrors: [],
    edgesProcessed: 0,
    edgesMigrated: 0,
    edgeErrors: [],
    edgeMissingNode: [],
  };
  const entityRecords = await store.listRecords<LegacyGraphEntityPayload>(LEGACY_ENTITY_DOMAIN);
  for (const record of entityRecords) {
    report.nodesProcessed += 1;
    try {
      await migrateEntityRecord(record, graphStore);
      report.nodesMigrated += 1;
    } catch (error) {
      report.nodeErrors.push({
        id: record.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const edgeRecords = await store.listRecords<LegacyGraphEdgePayload>(LEGACY_EDGE_DOMAIN);
  for (const record of edgeRecords) {
    report.edgesProcessed += 1;
    try {
      await migrateEdgeRecord(record, graphStore);
      report.edgesMigrated += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/graph node .* not accessible/i.test(message)) {
        report.edgeMissingNode.push({
          id: record.id,
          sourceId: record.payload.sourceEntityId,
          targetId: record.payload.targetEntityId,
        });
      } else {
        report.edgeErrors.push({
          id: record.id,
          error: message,
        });
      }
    }
  }
  report.finishedAt = new Date().toISOString();
  await persistReport(report);
  // eslint-disable-next-line no-console
  console.log(
    `[graph-backfill] migrated ${report.nodesMigrated}/${report.nodesProcessed} nodes and ${report.edgesMigrated}/${report.edgesProcessed} edges. Report: ${await buildReportPath(
      startedAt,
    )}`,
  );
}

async function migrateEntityRecord(record: MetadataRecord<LegacyGraphEntityPayload>, graphStore: GraphStore) {
  const scope = buildScope(record);
  const context = buildTenantContext(scope);
  const displayName =
    record.payload.displayName?.trim() ||
    record.payload.canonicalPath?.trim() ||
    record.id ||
    "graph-entity";
  await graphStore.upsertEntity(
    {
      id: record.id,
      entityType: record.payload.entityType,
      displayName,
      canonicalPath: record.payload.canonicalPath ?? undefined,
      sourceSystem: record.payload.sourceSystem ?? undefined,
      specRef: record.payload.specRef ?? undefined,
      properties: record.payload.properties ?? {},
      scope,
      identity: {
        externalId: {
          legacyId: record.id,
          canonicalPath: record.payload.canonicalPath ?? null,
        },
      },
    },
    context,
  );
}

async function migrateEdgeRecord(record: MetadataRecord<LegacyGraphEdgePayload>, graphStore: GraphStore) {
  const scope = buildScope(record);
  const context = buildTenantContext(scope);
  await graphStore.upsertEdge(
    {
      id: record.id,
      edgeType: record.payload.edgeType,
      sourceEntityId: record.payload.sourceEntityId,
      targetEntityId: record.payload.targetEntityId,
      confidence: record.payload.confidence ?? undefined,
      specRef: record.payload.specRef ?? undefined,
      metadata: record.payload.metadata ?? {},
      scope,
      identity: {
        externalId: {
          legacyId: record.id,
        },
      },
    },
    context,
  );
}

function buildScope(record: MetadataRecord<{ tenantId?: string | null }>): GraphScopeInput {
  const resolvedTenant = record.payload.tenantId?.trim() || DEFAULT_TENANT_ID;
  return {
    orgId: resolvedTenant,
    projectId: record.projectId ?? DEFAULT_PROJECT_ID,
  };
}

function buildTenantContext(scope: GraphScopeInput): TenantContext {
  return {
    tenantId: scope.orgId,
    projectId: scope.projectId ?? DEFAULT_PROJECT_ID,
  };
}

async function persistReport(report: BackfillReport): Promise<void> {
  await mkdir(ARTIFACTS_DIR, { recursive: true });
  const filePath = await buildReportPath(new Date(report.startedAt));
  await writeFile(filePath, JSON.stringify(report, null, 2), "utf-8");
}

async function buildReportPath(startedAt: Date): Promise<string> {
  const timestamp = startedAt.toISOString().replace(/[:.]/g, "-");
  return path.join(ARTIFACTS_DIR, `${timestamp}-graph-backfill.json`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[graph-backfill] failed:", error);
    process.exit(1);
  });
}
