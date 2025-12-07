import { buildDatasetCanonicalPath, buildDatasetId, type DatasetIdentity } from "../metadata/datasetIdentity.js";
import type { GraphStore, TenantContext } from "@metadata/core";

type UnknownRecord = Record<string, any>;

type ColumnDef = {
  name: string;
  ordinal?: number | null;
  dataType?: string | null;
  nullable?: boolean | null;
  description?: string | null;
};

type ConstraintDef = {
  name: string;
  type: string;
  fields: Array<{ name: string; position?: number | null }>;
  referencedTable?: string | null;
  referencedFields?: string[];
  deleteRule?: string | null;
  updateRule?: string | null;
};

function normalizeObject(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as UnknownRecord;
}

function pickFirstArray(...candidates: Array<unknown>): unknown[] {
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate as unknown[];
    }
  }
  return [];
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

function extractColumns(payload: UnknownRecord): ColumnDef[] {
  const datasetPayload = normalizeObject(payload.dataset);
  const fields = pickFirstArray(payload.schema_fields, payload.columns, payload.fields, datasetPayload?.fields);
  return (fields as UnknownRecord[])
    .map((field) => {
      const name = normalizeString(field?.name ?? field?.column_name);
      if (!name) {
        return null;
      }
      const ordinal = field?.ordinal ?? field?.ordinal_position ?? field?.position;
      const dataType = normalizeString(field?.data_type ?? field?.type ?? field?.udt_name);
      const nullableRaw = field?.nullable ?? field?.is_nullable;
      const nullable =
        typeof nullableRaw === "boolean"
          ? nullableRaw
          : typeof nullableRaw === "string"
            ? nullableRaw.trim().toLowerCase() === "yes"
            : null;
      const description = normalizeString(field?.description ?? field?.comment);
      return {
        name,
        ordinal: typeof ordinal === "number" ? ordinal : Number.isFinite(Number(ordinal)) ? Number(ordinal) : null,
        dataType,
        nullable,
        description,
      } satisfies ColumnDef;
    })
    .filter(Boolean) as ColumnDef[];
}

function normalizeConstraintType(value: unknown): string | null {
  const raw = normalizeString(value);
  if (!raw) {
    return null;
  }
  return raw.trim().toUpperCase();
}

function extractConstraints(payload: UnknownRecord): ConstraintDef[] {
  const constraints = Array.isArray(payload.constraints) ? (payload.constraints as UnknownRecord[]) : [];
  return constraints
    .map((constraint) => {
      const type = normalizeConstraintType(constraint.type ?? constraint.constraint_type);
      if (!type) {
        return null;
      }
      const name = normalizeString(constraint.name ?? constraint.constraint_name) ?? type;
      const fields = Array.isArray(constraint.fields)
        ? (constraint.fields as UnknownRecord[])
        : Array.isArray(constraint.columns)
          ? (constraint.columns as UnknownRecord[])
          : [];
      const parsedFields = fields
        .map((field) => {
          const fname = normalizeString(field?.name ?? field?.field ?? field?.column_name);
          if (!fname) {
            return null;
          }
          const pos = field?.position ?? field?.ordinal_position;
          return { name: fname, position: typeof pos === "number" ? pos : Number(pos) || null };
        })
        .filter(Boolean) as Array<{ name: string; position?: number | null }>;

      const referencedFields = Array.isArray(constraint.referenced_fields)
        ? (constraint.referenced_fields as unknown[])
            .map((entry) => normalizeString(entry))
            .filter(Boolean) as string[]
        : [];
      if (referencedFields.length === 0 && Array.isArray(constraint.columns)) {
        const inferred = (constraint.columns as UnknownRecord[])
          .map((field) => normalizeString(field?.referenced_column))
          .filter(Boolean) as string[];
        if (inferred.length > 0) {
          referencedFields.push(...inferred);
        }
      }

      return {
        name,
        type,
        fields: parsedFields,
        referencedTable:
          normalizeString(constraint.referenced_table) ??
          normalizeString(constraint.referencedTable) ??
          normalizeString(constraint.referenced_table_name),
        referencedFields,
        deleteRule: normalizeString(constraint.delete_rule ?? constraint.deleteRule),
        updateRule: normalizeString(constraint.update_rule ?? constraint.updateRule),
      } satisfies ConstraintDef;
    })
    .filter(Boolean) as ConstraintDef[];
}

function buildTableId(sourceId: string, schema: string, table: string): string {
  return `table:${sourceId}:${schema}.${table}`.toLowerCase();
}

function buildColumnId(sourceId: string, schema: string, table: string, column: string): string {
  return `column:${sourceId}:${schema}.${table}.${column}`.toLowerCase();
}

function parseSchemaTable(value: string | null | undefined, fallbackSchema: string, fallbackTable: string) {
  const raw = normalizeString(value);
  if (!raw) {
    return { schema: fallbackSchema, table: fallbackTable };
  }
  if (raw.includes(".")) {
    const [schema, table] = raw.split(".", 2);
    return { schema: schema || fallbackSchema, table: table || fallbackTable };
  }
  return { schema: fallbackSchema, table: raw };
}

function resolveSourceSystem(payload: UnknownRecord): string {
  const candidates = [
    payload.source,
    payload.endpoint?.dialect,
    payload.endpoint?.type,
    payload.dataset?.source,
    payload.data_source?.type,
  ];
  const resolved = candidates.map(normalizeString).find(Boolean);
  return (resolved ?? "jdbc").toLowerCase();
}

function resolveSyncedAt(payload: UnknownRecord): string {
  const candidates = [payload.produced_at, payload.producedAt, payload.collected_at, payload.collectedAt, new Date()];
  for (const candidate of candidates) {
    const raw = normalizeString(candidate);
    if (raw) {
      return raw;
    }
    if (candidate instanceof Date) {
      return candidate.toISOString();
    }
  }
  return new Date().toISOString();
}

/**
 * Emit KB nodes/edges for JDBC dataset/table/column containment + PK/FK.
 * Keeps IDs deterministic so repeated runs are idempotent.
 */
export async function upsertJdbcRelations(
  graphStore: GraphStore,
  datasetIdentity: DatasetIdentity,
  payload: UnknownRecord,
  context: TenantContext,
): Promise<void> {
  const sourceSystem = resolveSourceSystem(payload);
  // Limit to JDBC-style metadata (current coverage: Postgres + other SQL dialects).
  const allowed = ["postgres", "jdbc", "oracle", "mysql", "mariadb", "sqlserver", "mssql"];
  if (!allowed.some((entry) => sourceSystem.includes(entry))) {
    return;
  }
  const columns = extractColumns(payload);
  if (columns.length === 0) {
    return;
  }
  const constraints = extractConstraints(payload);
  const syncedAt = resolveSyncedAt(payload);
  const schema = datasetIdentity.schema;
  const table = datasetIdentity.table;
  const datasetId = datasetIdentity.id;
  const sourceId = datasetIdentity.sourceId;
  const baseCanonicalPath = datasetIdentity.canonicalPath ?? `${sourceId}/${schema}/${table}`;
  const tableId = buildTableId(sourceId, schema, table);
  const tableDisplay = `${schema}.${table}`;

  const upsertedTables = new Set<string>();
  const upsertedColumns = new Set<string>();

  async function ensureDatasetNode(datasetKey: { schema: string; table: string }) {
    const refDatasetId = buildDatasetId({
      tenantId: datasetIdentity.tenantId,
      projectId: datasetIdentity.projectId,
      sourceId,
      schema: datasetKey.schema,
      table: datasetKey.table,
    });
    const refCanonicalPath = buildDatasetCanonicalPath({
      tenantId: datasetIdentity.tenantId,
      projectId: datasetIdentity.projectId,
      sourceId,
      schema: datasetKey.schema,
      table: datasetKey.table,
    });
    await graphStore.upsertEntity(
      {
        id: refDatasetId,
        entityType: "catalog.dataset",
        displayName: `${datasetKey.schema}.${datasetKey.table}`,
        canonicalPath: refCanonicalPath,
        sourceSystem,
        properties: {
          schema: datasetKey.schema,
          table: datasetKey.table,
          source_system: sourceSystem,
          synced_at: syncedAt,
        },
        scope: {
          orgId: context.tenantId,
          projectId: context.projectId,
        },
        identity: {
          originEndpointId: sourceId,
        },
      },
      context,
    );
    return refDatasetId;
  }

  async function ensureTable(tableKey: { schema: string; table: string }, parentDatasetId: string, canonicalPath: string) {
    const id = buildTableId(sourceId, tableKey.schema, tableKey.table);
    if (!upsertedTables.has(id)) {
      await graphStore.upsertEntity(
        {
          id,
          entityType: "catalog.table",
          displayName: `${tableKey.schema}.${tableKey.table}`,
          canonicalPath,
          sourceSystem,
          properties: {
            dataset_id: parentDatasetId,
            schema: tableKey.schema,
            table: tableKey.table,
            source_system: sourceSystem,
            synced_at: syncedAt,
          },
          scope: {
            orgId: context.tenantId,
            projectId: context.projectId,
          },
          identity: {
            originEndpointId: sourceId,
          },
        },
        context,
      );
      upsertedTables.add(id);
      await graphStore.upsertEdge(
        {
          edgeType: "rel.contains.table",
          sourceEntityId: parentDatasetId,
          targetEntityId: id,
          metadata: {
            source_system: sourceSystem,
            synced_at: syncedAt,
          },
          scope: {
            orgId: context.tenantId,
            projectId: context.projectId,
          },
          identity: {
            originEndpointId: sourceId,
          },
        },
        context,
      );
    }
    return id;
  }

  async function ensureColumn(
    tableKey: { schema: string; table: string },
    column: ColumnDef,
    parentTableId: string,
  ) {
    const id = buildColumnId(sourceId, tableKey.schema, tableKey.table, column.name);
    if (!upsertedColumns.has(id)) {
      const canonicalPath = `${tableKey.schema}.${tableKey.table}/${column.name}`;
      await graphStore.upsertEntity(
        {
          id,
          entityType: "catalog.column",
          displayName: column.name,
          canonicalPath,
          sourceSystem,
          properties: {
            table_id: parentTableId,
            name: column.name,
            ordinal: column.ordinal,
            data_type: column.dataType,
            nullable: column.nullable,
            description: column.description,
            source_system: sourceSystem,
            synced_at: syncedAt,
          },
          scope: {
            orgId: context.tenantId,
            projectId: context.projectId,
          },
          identity: {
            originEndpointId: sourceId,
          },
        },
        context,
      );
      upsertedColumns.add(id);
      await graphStore.upsertEdge(
        {
          edgeType: "rel.contains.column",
          sourceEntityId: parentTableId,
          targetEntityId: id,
          metadata: {
            source_system: sourceSystem,
            synced_at: syncedAt,
          },
          scope: {
            orgId: context.tenantId,
            projectId: context.projectId,
          },
          identity: {
            originEndpointId: sourceId,
          },
        },
        context,
      );
    }
    return id;
  }

  const primaryDatasetId = await ensureDatasetNode({ schema, table });
  const primaryTableId = await ensureTable({ schema, table }, primaryDatasetId, baseCanonicalPath);

  for (const column of columns) {
    await ensureColumn({ schema, table }, column, primaryTableId);
  }

  const pkConstraints = constraints.filter((constraint) => constraint.type.includes("PRIMARY"));
  for (const pk of pkConstraints) {
    for (const [idx, field] of pk.fields.entries()) {
      const colId = buildColumnId(sourceId, schema, table, field.name);
      if (!upsertedColumns.has(colId)) {
        await ensureColumn({ schema, table }, { name: field.name }, primaryTableId);
      }
      await graphStore.upsertEdge(
        {
          edgeType: "rel.pk_of",
          sourceEntityId: primaryTableId,
          targetEntityId: colId,
          metadata: {
            source_system: sourceSystem,
            synced_at: syncedAt,
            pk_name: pk.name,
            position: field.position ?? idx + 1,
          },
          scope: {
            orgId: context.tenantId,
            projectId: context.projectId,
          },
          identity: {
            originEndpointId: sourceId,
          },
        },
        context,
      );
    }
  }

  const fkConstraints = constraints.filter((constraint) => constraint.type.includes("FOREIGN"));
  for (const fk of fkConstraints) {
    const referencedTable = parseSchemaTable(fk.referencedTable, schema, table);
    const refDatasetId = await ensureDatasetNode(referencedTable);
    const refTableCanonical = buildDatasetCanonicalPath({
      tenantId: datasetIdentity.tenantId,
      projectId: datasetIdentity.projectId,
      sourceId,
      schema: referencedTable.schema,
      table: referencedTable.table,
    });
    const refTableId = await ensureTable(referencedTable, refDatasetId, refTableCanonical);

    const referencedFields = fk.referencedFields ?? [];
    for (const [idx, field] of fk.fields.entries()) {
      const sourceColumnId = buildColumnId(sourceId, schema, table, field.name);
      if (!upsertedColumns.has(sourceColumnId)) {
        await ensureColumn({ schema, table }, { name: field.name }, primaryTableId);
      }
      const targetColumnName = referencedFields[idx] ?? referencedFields[0] ?? null;
      if (!targetColumnName) {
        continue;
      }
      const targetColumnId = buildColumnId(
        sourceId,
        referencedTable.schema,
        referencedTable.table,
        targetColumnName,
      );
      if (!upsertedColumns.has(targetColumnId)) {
        await ensureColumn(
          { schema: referencedTable.schema, table: referencedTable.table },
          { name: targetColumnName },
          refTableId,
        );
      }
      await graphStore.upsertEdge(
        {
          edgeType: "rel.fk_references",
          sourceEntityId: sourceColumnId,
          targetEntityId: targetColumnId,
          metadata: {
            source_system: sourceSystem,
            synced_at: syncedAt,
            fk_name: fk.name,
            on_delete: fk.deleteRule,
            on_update: fk.updateRule,
            position: field.position ?? idx + 1,
          },
          scope: {
            orgId: context.tenantId,
            projectId: context.projectId,
          },
          identity: {
            originEndpointId: sourceId,
          },
        },
        context,
      );
    }
  }
}
