import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DefaultSignalEvaluator } from "./evaluator.js";
import type {
  SignalDefinition,
  SignalDefinitionFilter,
  SignalInstance,
  SignalInstanceFilter,
  SignalInstanceStatus,
  SignalSeverity,
  SignalStatus,
  SignalStore,
  UpsertSignalInstanceInput,
} from "./types.js";
import type { CdmWorkItemRow } from "../cdm/workStore.js";
import type { CdmDocItemRow } from "../cdm/docStore.js";

class FakeSignalStore implements SignalStore {
  definitions: SignalDefinition[];
  instances: SignalInstance[];

  constructor(definitions: SignalDefinition[], instances?: SignalInstance[]) {
    this.definitions = definitions;
    this.instances = instances ?? [];
  }

  async getDefinition(id: string) {
    return this.definitions.find((def) => def.id === id) ?? null;
  }

  async getDefinitionBySlug(slug: string) {
    return this.definitions.find((def) => def.slug === slug) ?? null;
  }

  async listDefinitions(filter?: SignalDefinitionFilter) {
    return this.definitions.filter((def) => {
      if (filter?.status && filter.status.length > 0 && !filter.status.includes(def.status)) {
        return false;
      }
      if (filter?.entityKind && filter.entityKind.length > 0 && !filter.entityKind.includes(def.entityKind)) {
        return false;
      }
      if (filter?.tags && filter.tags.length > 0) {
        const tagSet = new Set(def.tags ?? []);
        if (!filter.tags.some((tag) => tagSet.has(tag))) {
          return false;
        }
      }
      return true;
    });
  }

  async createDefinition(input: Omit<SignalDefinition, "id" | "createdAt" | "updatedAt" | "definitionSpec"> & { definitionSpec: Record<string, unknown> }) {
    const now = new Date();
    const definition: SignalDefinition = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      definitionSpec: input.definitionSpec,
    };
    this.definitions.push(definition);
    return definition;
  }

  async updateDefinition(id: string, patch: Partial<SignalDefinition>) {
    const idx = this.definitions.findIndex((def) => def.id === id);
    if (idx === -1) {
      throw new Error("definition not found");
    }
    const next = { ...this.definitions[idx], ...patch, updatedAt: new Date() } as SignalDefinition;
    this.definitions[idx] = next;
    return next;
  }

  async getInstance(id: string) {
    return this.instances.find((inst) => inst.id === id) ?? null;
  }

  async listInstances(filter?: SignalInstanceFilter) {
    let results = this.instances.slice();
    if (filter?.definitionIds && filter.definitionIds.length > 0) {
      const allowed = new Set(filter.definitionIds);
      results = results.filter((inst) => allowed.has(inst.definitionId));
    }
    if (filter?.definitionSlugs && filter.definitionSlugs.length > 0) {
      const allowedSlugs = new Set(filter.definitionSlugs);
      results = results.filter((inst) => {
        const def = this.definitions.find((defn) => defn.id === inst.definitionId);
        return def ? allowedSlugs.has(def.slug) : false;
      });
    }
    if (filter?.entityRefs && filter.entityRefs.length > 0) {
      const allowedRefs = new Set(filter.entityRefs);
      results = results.filter((inst) => allowedRefs.has(inst.entityRef));
    }
    if (filter?.entityKind) {
      results = results.filter((inst) => inst.entityKind === filter.entityKind);
    }
    if (filter?.status && filter.status.length > 0) {
      const allowedStatus = new Set(filter.status);
      results = results.filter((inst) => allowedStatus.has(inst.status));
    }
    if (filter?.severity && filter.severity.length > 0) {
      const allowedSeverity = new Set(filter.severity);
      results = results.filter((inst) => allowedSeverity.has(inst.severity));
    }
    const limit = Math.min(Math.max(filter?.limit ?? results.length, 1), 200);
    return results.slice(0, limit);
  }

  async upsertInstance(input: UpsertSignalInstanceInput) {
    const now = input.timestamp instanceof Date ? input.timestamp : input.timestamp ? new Date(input.timestamp) : new Date();
    const nextStatus: SignalInstanceStatus = input.status ?? "OPEN";
    const existing = this.instances.find(
      (inst) => inst.definitionId === input.definitionId && inst.entityRef === input.entityRef,
    );
    if (existing) {
      existing.status = nextStatus;
      existing.severity = input.severity ?? existing.severity;
      existing.summary = input.summary ?? existing.summary;
      existing.details = input.details ?? existing.details ?? null;
      existing.lastSeenAt = now;
      existing.resolvedAt =
        nextStatus === "RESOLVED"
          ? input.resolvedAt
            ? new Date(input.resolvedAt)
            : existing.resolvedAt ?? now
          : null;
      existing.sourceRunId = input.sourceRunId ?? existing.sourceRunId ?? null;
      existing.updatedAt = now;
      return existing;
    }
    const definition = await this.getDefinition(input.definitionId);
    const instance: SignalInstance = {
      id: randomUUID(),
      definitionId: input.definitionId,
      definition: definition ?? undefined,
      status: nextStatus,
      entityRef: input.entityRef,
      entityKind: input.entityKind,
      severity: input.severity,
      summary: input.summary,
      details: input.details ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
      resolvedAt:
        nextStatus === "RESOLVED"
          ? input.resolvedAt
            ? new Date(input.resolvedAt)
            : now
          : null,
      sourceRunId: input.sourceRunId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.instances.push(instance);
    return instance;
  }

  async updateInstanceStatus(id: string, status: SignalInstanceStatus, resolvedAt?: Date | string | null) {
    const instance = await this.getInstance(id);
    if (!instance) {
      throw new Error("instance not found");
    }
    const now = new Date();
    instance.status = status;
    instance.resolvedAt = status === "RESOLVED" ? (resolvedAt ? new Date(resolvedAt) : now) : null;
    instance.lastSeenAt = now;
    instance.updatedAt = now;
    return instance;
  }
}

class FakeWorkStore {
  rows: CdmWorkItemRow[];

  constructor(rows: CdmWorkItemRow[]) {
    this.rows = rows;
  }

  async listWorkItems(args: {
    projectId?: string | null;
    filter?: { statusIn?: string[] | null } | null;
    first?: number | null;
    after?: string | null;
  }) {
    const offset = args.after ? decodeCursor(args.after) : 0;
    const limit = Math.min(Math.max(args.first ?? this.rows.length, 1), this.rows.length);
    let filtered = this.rows.slice();
    if (args.filter?.statusIn && args.filter.statusIn.length > 0) {
      const allowed = new Set(args.filter.statusIn.map((value) => value.toLowerCase()));
      filtered = filtered.filter((row) => (row.status ? allowed.has(row.status.toLowerCase()) : false));
    }
    const slice = filtered.slice(offset, offset + limit);
    const hasNextPage = offset + slice.length < filtered.length;
    return { rows: slice, cursorOffset: offset, hasNextPage };
  }
}

class FakeDocStore {
  rows: CdmDocItemRow[];

  constructor(rows: CdmDocItemRow[]) {
    this.rows = rows;
  }

  async listDocItems(args: {
    projectId?: string | null;
    filter?: Record<string, unknown> | null;
    first?: number | null;
    after?: string | null;
    secured?: boolean | null;
    accessPrincipalIds?: string[] | null;
  }) {
    const offset = args.after ? decodeCursor(args.after) : 0;
    const limit = Math.min(Math.max(args.first ?? this.rows.length, 1), this.rows.length);
    const slice = this.rows.slice(offset, offset + limit);
    const hasNextPage = offset + slice.length < this.rows.length;
    return { rows: slice, cursorOffset: offset, hasNextPage };
  }
}

async function testWorkEvaluation() {
  const now = new Date("2024-01-10T00:00:00Z");
  const definitions = [
    buildDefinition({
      id: "def-work",
      slug: "work.stale_item",
      severity: "WARNING",
      cdmModelId: "cdm.work.item",
      definitionSpec: {
        version: 1,
        type: "cdm.work.stale_item",
        config: {
          cdmModelId: "cdm.work.item",
          maxAge: { unit: "days", value: 3 },
          severityMapping: {
            warnAfter: { unit: "days", value: 3 },
            errorAfter: { unit: "days", value: 5 },
          },
          statusExclude: ["Done"],
        },
      },
    }),
  ];

  const workRows: CdmWorkItemRow[] = [
    buildWorkRow({
      cdm_id: "work-err",
      source_issue_key: "ENG-1",
      status: "In Progress",
      updated_at: new Date("2023-12-31T00:00:00Z"),
      created_at: new Date("2023-12-01T00:00:00Z"),
    }),
    buildWorkRow({
      cdm_id: "work-warn",
      source_issue_key: "ENG-2",
      status: "In Progress",
      updated_at: new Date("2024-01-06T00:00:00Z"),
      created_at: new Date("2023-12-20T00:00:00Z"),
    }),
    buildWorkRow({
      cdm_id: "work-fresh",
      source_issue_key: "ENG-3",
      status: "In Progress",
      updated_at: new Date("2024-01-09T00:00:00Z"),
      created_at: new Date("2024-01-08T00:00:00Z"),
    }),
    buildWorkRow({
      cdm_id: "work-done",
      source_issue_key: "ENG-4",
      status: "Done",
      updated_at: new Date("2023-12-15T00:00:00Z"),
      created_at: new Date("2023-12-01T00:00:00Z"),
    }),
  ];

  const store = new FakeSignalStore(definitions, []);
  const workStore = new FakeWorkStore(workRows);
  const evaluator = new DefaultSignalEvaluator({
    signalStore: store,
    workStore,
    docStore: new FakeDocStore([]),
  });

  const firstSummary = await evaluator.evaluateAll({ now });
  assert.equal(firstSummary.instancesCreated, 2);
  assert.equal(firstSummary.instancesUpdated, 0);
  assert.equal(firstSummary.instancesResolved, 0);
  assert.deepEqual(firstSummary.evaluatedDefinitions, ["work.stale_item"]);
  assert.equal(store.instances.length, 2);
  const errorInstance = store.instances.find((inst) => inst.entityRef.includes("work-err"));
  assert.ok(errorInstance);
  assert.equal(errorInstance?.severity, "ERROR");

  const secondSummary = await evaluator.evaluateAll({ now });
  assert.equal(secondSummary.instancesCreated, 0);
  assert.equal(secondSummary.instancesUpdated, 2);
  assert.equal(secondSummary.instancesResolved, 0);

  workStore.rows = workRows.filter((row) => row.cdm_id !== "work-warn");
  const thirdSummary = await evaluator.evaluateAll({ now });
  assert.equal(thirdSummary.instancesCreated, 0);
  assert.equal(thirdSummary.instancesUpdated, 1);
  assert.equal(thirdSummary.instancesResolved, 1);
  const resolvedInstance = store.instances.find((inst) => inst.entityRef.includes("work-warn"));
  assert.equal(resolvedInstance?.status, "RESOLVED");
}

async function testDocEvaluationDryRun() {
  const now = new Date("2024-03-01T00:00:00Z");
  const definitions = [
    buildDefinition({
      id: "def-doc",
      slug: "doc.orphaned",
      entityKind: "DOC",
      severity: "WARNING",
      cdmModelId: "cdm.doc.item",
      definitionSpec: {
        version: 1,
        type: "cdm.doc.orphan",
        config: {
          cdmModelId: "cdm.doc.item",
          minAge: { unit: "days", value: 2 },
          minViewCount: 5,
          requireProjectLink: true,
        },
      },
    }),
  ];

  const docRows: CdmDocItemRow[] = [
    buildDocRow({
      cdm_id: "doc-orphan",
      title: "Old orphan",
      updated_at: new Date("2024-02-20T00:00:00Z"),
      created_at: new Date("2024-02-01T00:00:00Z"),
      properties: { viewCount: 1 },
    }),
    buildDocRow({
      cdm_id: "doc-viewed",
      title: "Popular doc",
      updated_at: new Date("2024-02-15T00:00:00Z"),
      created_at: new Date("2024-02-01T00:00:00Z"),
      properties: { viewCount: 12 },
    }),
    buildDocRow({
      cdm_id: "doc-linked",
      title: "Linked doc",
      updated_at: new Date("2024-02-10T00:00:00Z"),
      created_at: new Date("2024-02-01T00:00:00Z"),
      properties: { linkedWorkItems: ["work-1"] },
    }),
    buildDocRow({
      cdm_id: "doc-young",
      title: "New doc",
      updated_at: new Date("2024-02-29T00:00:00Z"),
      created_at: new Date("2024-02-29T00:00:00Z"),
      properties: { viewCount: 0 },
    }),
  ];

  const store = new FakeSignalStore(definitions, []);
  const evaluator = new DefaultSignalEvaluator({
    signalStore: store,
    workStore: new FakeWorkStore([]),
    docStore: new FakeDocStore(docRows),
  });

  const dryRunSummary = await evaluator.evaluateAll({ now, dryRun: true });
  assert.equal(dryRunSummary.instancesCreated, 1);
  assert.equal(store.instances.length, 0);

  const runSummary = await evaluator.evaluateAll({ now });
  assert.equal(runSummary.instancesCreated, 1);
  assert.deepEqual(runSummary.evaluatedDefinitions, ["doc.orphaned"]);
  assert.equal(store.instances.length, 1);
  const instance = store.instances[0];
  assert.equal(instance.status, "OPEN");
  assert.ok(instance.entityRef.startsWith("cdm.doc.item"));
}

async function testInvalidSpecIsSkipped() {
  const definitions = [
    buildDefinition({
      id: "def-invalid",
      slug: "invalid.spec",
      definitionSpec: { version: 2, type: "unknown", config: {} },
    }),
  ];
  const store = new FakeSignalStore(definitions, []);
  const evaluator = new DefaultSignalEvaluator({
    signalStore: store,
    workStore: new FakeWorkStore([]),
    docStore: new FakeDocStore([]),
  });

  const summary = await evaluator.evaluateAll();
  assert.equal(summary.evaluatedDefinitions.length, 0);
  assert.equal(summary.skippedDefinitions.length, 1);
  assert.equal(summary.instancesCreated, 0);
}

function buildDefinition(input: Partial<SignalDefinition> & { definitionSpec: Record<string, unknown> }) {
  const now = new Date();
  return {
    id: input.id ?? randomUUID(),
    slug: input.slug ?? `def-${now.getTime()}`,
    title: input.title ?? "Test definition",
    description: input.description ?? null,
    status: input.status ?? ("ACTIVE" as SignalStatus),
    entityKind: input.entityKind ?? "WORK_ITEM",
    processKind: input.processKind ?? null,
    policyKind: input.policyKind ?? null,
    severity: input.severity ?? ("WARNING" as SignalSeverity),
    tags: input.tags ?? [],
    cdmModelId: input.cdmModelId ?? "cdm.work.item",
    owner: input.owner ?? "tests",
    definitionSpec: input.definitionSpec,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  } satisfies SignalDefinition;
}

function buildWorkRow(input: Partial<CdmWorkItemRow> & { cdm_id: string; source_issue_key: string }) {
  return {
    cdm_id: input.cdm_id,
    source_system: input.source_system ?? "jira",
    source_issue_key: input.source_issue_key,
    project_cdm_id: input.project_cdm_id ?? "project-1",
    summary: input.summary ?? input.source_issue_key,
    status: input.status ?? "In Progress",
    priority: input.priority ?? null,
    assignee_cdm_id: input.assignee_cdm_id ?? null,
    reporter_cdm_id: input.reporter_cdm_id ?? null,
    created_at: input.created_at ?? new Date(),
    updated_at: input.updated_at ?? input.created_at ?? new Date(),
    closed_at: input.closed_at ?? null,
    reporter_display_name: input.reporter_display_name ?? null,
    reporter_email: input.reporter_email ?? null,
    assignee_display_name: input.assignee_display_name ?? null,
    assignee_email: input.assignee_email ?? null,
    properties: input.properties ?? {},
  } satisfies CdmWorkItemRow;
}

function buildDocRow(input: Partial<CdmDocItemRow> & { cdm_id: string }) {
  return {
    cdm_id: input.cdm_id,
    source_system: input.source_system ?? "confluence",
    source_item_id: input.source_item_id ?? input.cdm_id,
    space_cdm_id: input.space_cdm_id ?? "space-1",
    space_key: input.space_key ?? "SPACE",
    space_name: input.space_name ?? "Space",
    space_url: input.space_url ?? "https://example/wiki",
    parent_item_cdm_id: input.parent_item_cdm_id ?? null,
    title: input.title ?? input.cdm_id,
    doc_type: input.doc_type ?? "page",
    mime_type: input.mime_type ?? "storage",
    created_by_cdm_id: input.created_by_cdm_id ?? null,
    updated_by_cdm_id: input.updated_by_cdm_id ?? null,
    created_at: input.created_at ?? new Date(),
    updated_at: input.updated_at ?? input.created_at ?? new Date(),
    url: input.url ?? "https://example/wiki/page",
    tags: input.tags ?? [],
    properties: input.properties ?? {},
    dataset_id: input.dataset_id ?? "confluence.page",
    endpoint_id: input.endpoint_id ?? "endpoint-doc",
  } satisfies CdmDocItemRow;
}

function decodeCursor(cursor: string): number {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf-8");
    const value = Number.parseInt(decoded, 10);
    return Number.isNaN(value) || value < 0 ? 0 : value;
  } catch {
    return 0;
  }
}

async function main() {
  await testWorkEvaluation();
  await testDocEvaluationDryRun();
  await testInvalidSpecIsSkipped();
  console.log("[signalEvaluator.spec] all assertions passed");
}

main().catch((error) => {
  console.error("[signalEvaluator.spec] failure", error);
  process.exit(1);
});
