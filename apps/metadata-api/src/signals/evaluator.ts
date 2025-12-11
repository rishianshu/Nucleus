import { CdmDocStore, type CdmDocItemRow } from "../cdm/docStore.js";
import { CdmWorkStore, type CdmWorkItemRow } from "../cdm/workStore.js";
import {
  intervalToMs,
  parseSignalDefinitionSpec,
  type CdmDocOrphanConfig,
  type CdmGenericFilterCondition,
  type CdmGenericFilterConfig,
  type CdmGenericSeverityRule,
  type CdmWorkStaleItemConfig,
  type ParsedSignalDefinitionSpec,
} from "./dsl.js";
import type {
  SignalDefinition,
  SignalDefinitionFilter,
  SignalInstance,
  SignalSeverity,
  SignalStore,
} from "./types.js";

type WorkStore = Pick<CdmWorkStore, "listWorkItems">;
type DocStore = Pick<CdmDocStore, "listDocItems">;

export type EvaluateSignalsOptions = {
  now?: Date;
  definitionSlugs?: string[];
  dryRun?: boolean;
  sourceRunId?: string | null;
};

export type SignalEvaluationSummary = {
  evaluatedDefinitions: string[];
  skippedDefinitions: { slug: string; reason: string }[];
  instancesCreated: number;
  instancesUpdated: number;
  instancesResolved: number;
};

export interface SignalEvaluator {
  evaluateAll(options?: EvaluateSignalsOptions): Promise<SignalEvaluationSummary>;
}

type EvaluationCounts = {
  created: number;
  updated: number;
  resolved: number;
};

type EvaluatedInstance = {
  entityRef: string;
  entityKind: string;
  severity: SignalSeverity;
  summary: string;
  details?: Record<string, unknown> | null;
};

type ReconciliationContext = {
  existingByRef: Map<string, SignalInstance>;
  matchedRefs: Set<string>;
  created: number;
  updated: number;
  resolved: number;
};

type HandlerContext = {
  now: Date;
  entityKind: string;
  options?: EvaluateSignalsOptions;
};

type ParsedSpecFor<T extends ParsedSignalDefinitionSpec["type"]> = Extract<ParsedSignalDefinitionSpec, { type: T }>;

type SignalTypeEvaluator = (
  definition: SignalDefinition,
  spec: ParsedSignalDefinitionSpec,
  context: HandlerContext,
) => Promise<EvaluationCounts>;

type GenericFieldAccessor = (field: string) => unknown;
type ComparablePrimitive = string | number | boolean;

const MAX_PAGE_SIZE = 200;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const GENERIC_WORK_FIELDS = new Set<string>([
  "status",
  "priority",
  "assignee",
  "assignee_cdm_id",
  "reporter_cdm_id",
  "project_cdm_id",
  "source_issue_key",
  "source_system",
  "summary",
  "created_at",
  "updated_at",
  "closed_at",
  "ageMs",
  "ageDays",
]);

const GENERIC_DOC_FIELDS = new Set<string>([
  "title",
  "space_key",
  "space_cdm_id",
  "space_name",
  "doc_type",
  "mime_type",
  "source_system",
  "source_item_id",
  "created_at",
  "updated_at",
  "ageMs",
  "ageDays",
  "viewCount",
  "dataset_id",
  "endpoint_id",
]);

export class DefaultSignalEvaluator implements SignalEvaluator {
  private readonly signalStore: SignalStore;
  private readonly workStore: WorkStore;
  private readonly docStore: DocStore;
  private readonly registry: Record<string, SignalTypeEvaluator>;

  constructor(options: { signalStore: SignalStore; workStore?: WorkStore; docStore?: DocStore }) {
    this.signalStore = options.signalStore;
    this.workStore = options.workStore ?? new CdmWorkStore();
    this.docStore = options.docStore ?? new CdmDocStore();
    this.registry = {
      "cdm.work.stale_item": (definition, spec, context) =>
        this.evaluateWorkStale(definition, (spec as ParsedSpecFor<"cdm.work.stale_item">).config, context),
      "cdm.doc.orphan": (definition, spec, context) =>
        this.evaluateDocOrphan(definition, (spec as ParsedSpecFor<"cdm.doc.orphan">).config, context),
      "cdm.generic.filter": (definition, spec, context) =>
        this.evaluateGenericFilter(definition, (spec as ParsedSpecFor<"cdm.generic.filter">).config, context),
    };
  }

  async evaluateAll(options?: EvaluateSignalsOptions): Promise<SignalEvaluationSummary> {
    const now = options?.now ?? new Date();
    const summary: SignalEvaluationSummary = {
      evaluatedDefinitions: [],
      skippedDefinitions: [],
      instancesCreated: 0,
      instancesUpdated: 0,
      instancesResolved: 0,
    };

    const definitions = await this.loadDefinitions(options?.definitionSlugs);
    const requestedSlugs = new Set(
      (options?.definitionSlugs ?? []).map((slug) => slug.trim()).filter((slug) => slug.length > 0),
    );
    const missingSlugs = Array.from(requestedSlugs).filter(
      (slug) => !definitions.some((definition) => definition.slug === slug),
    );
    missingSlugs.forEach((slug) => summary.skippedDefinitions.push({ slug, reason: "definition not found" }));

    for (const definition of definitions) {
      try {
        const parsed = parseSignalDefinitionSpec(definition.definitionSpec);
        if (!parsed.ok) {
          summary.skippedDefinitions.push({ slug: definition.slug, reason: parsed.reason });
          continue;
        }
        const spec = parsed.spec;
        const handler = this.registry[spec.type];
        if (!handler) {
          summary.skippedDefinitions.push({ slug: definition.slug, reason: `unsupported spec type ${spec.type}` });
          continue;
        }
        if (spec.type === "cdm.generic.filter") {
          const validationError = validateGenericFilterFields(spec.config);
          if (validationError) {
            summary.skippedDefinitions.push({ slug: definition.slug, reason: validationError });
            continue;
          }
        }
        if (!matchesCdmModel(definition, spec)) {
          summary.skippedDefinitions.push({
            slug: definition.slug,
            reason: "cdmModelId mismatch between definition and spec",
          });
          continue;
        }
        const entityKind = resolveEntityKind(definition, spec);
        if (!entityKind) {
          summary.skippedDefinitions.push({ slug: definition.slug, reason: "entityKind missing" });
          continue;
        }

        const counts = await handler(definition, spec, { now, entityKind, options });
        summary.evaluatedDefinitions.push(definition.slug);
        summary.instancesCreated += counts.created;
        summary.instancesUpdated += counts.updated;
        summary.instancesResolved += counts.resolved;
      } catch (error) {
        summary.skippedDefinitions.push({ slug: definition.slug, reason: formatErrorReason(error) });
      }
    }

    return summary;
  }

  private async loadDefinitions(definitionSlugs?: string[]): Promise<SignalDefinition[]> {
    const filter: SignalDefinitionFilter = { status: ["ACTIVE"] };
    const definitions = await this.signalStore.listDefinitions(filter);
    const requested = (definitionSlugs ?? []).map((slug) => slug.trim()).filter((slug) => slug.length > 0);
    const allowedSlugs = requested.length ? new Set(requested) : null;
    const filtered = allowedSlugs ? definitions.filter((definition) => allowedSlugs.has(definition.slug)) : definitions;
    filtered.sort((a, b) => a.slug.localeCompare(b.slug));
    return filtered;
  }

  private async evaluateWorkStale(
    definition: SignalDefinition,
    config: CdmWorkStaleItemConfig,
    context: HandlerContext,
  ): Promise<EvaluationCounts> {
    const now = context.now;
    const options = context.options;
    const entityKind = context.entityKind;
    const statusInclude = toLowerSet(config.statusInclude);
    const statusIncludeRaw = cleanStringArray(config.statusInclude);
    const statusExclude = toLowerSet(config.statusExclude);
    const projectInclude = toLowerSet(config.projectInclude);
    const projectExclude = toLowerSet(config.projectExclude);
    const maxAgeMs = intervalToMs(config.maxAge);
    const warnAfterMs = config.severityMapping?.warnAfter ? intervalToMs(config.severityMapping.warnAfter) : null;
    const errorAfterMs = config.severityMapping?.errorAfter ? intervalToMs(config.severityMapping.errorAfter) : null;
    const reconciliation = await this.createReconciliationContext(definition.id);
    const nowMs = now.getTime();
    for await (const rows of this.iterateWorkItems({
      filter: statusIncludeRaw ? { statusIn: statusIncludeRaw } : undefined,
    })) {
      const matches: EvaluatedInstance[] = [];
      for (const row of rows) {
        const status = normalizeString(row.status);
        if (statusInclude && (!status || !statusInclude.has(status))) {
          continue;
        }
        if (statusExclude && status && statusExclude.has(status)) {
          continue;
        }

        if (projectInclude || projectExclude) {
          const projectKey = normalizeString(row.project_cdm_id);
          if (projectInclude && (!projectKey || !projectInclude.has(projectKey))) {
            continue;
          }
          if (projectExclude && projectKey && projectExclude.has(projectKey)) {
            continue;
          }
        }

        const lastActivityAt = row.updated_at ?? row.closed_at ?? row.created_at;
        if (!lastActivityAt) {
          continue;
        }
        const ageMs = nowMs - lastActivityAt.getTime();
        if (ageMs < maxAgeMs) {
          continue;
        }

        const severity = pickSeverity(definition.severity, warnAfterMs, errorAfterMs, ageMs);
        const summary = buildWorkSummary(row, ageMs);
        matches.push({
          entityRef: buildEntityRef("cdm.work.item", row.cdm_id),
          entityKind,
          severity,
          summary,
          details: {
            cdmId: row.cdm_id,
            projectCdmId: row.project_cdm_id,
            sourceIssueKey: row.source_issue_key,
            status: row.status,
            ageMs,
            lastActivityAt: lastActivityAt.toISOString(),
          },
        });
      }
      await this.applyMatchesForPage(definition, matches, reconciliation, now, options);
    }

    await this.resolveUnmatchedInstances(definition, reconciliation, now, options);
    return { created: reconciliation.created, updated: reconciliation.updated, resolved: reconciliation.resolved };
  }

  private async evaluateDocOrphan(
    definition: SignalDefinition,
    config: CdmDocOrphanConfig,
    context: HandlerContext,
  ): Promise<EvaluationCounts> {
    const now = context.now;
    const options = context.options;
    const entityKind = context.entityKind;
    const spaceInclude = toLowerSet(config.spaceInclude);
    const spaceExclude = toLowerSet(config.spaceExclude);
    const minAgeMs = intervalToMs(config.minAge);
    const reconciliation = await this.createReconciliationContext(definition.id);
    const nowMs = now.getTime();
    for await (const rows of this.iterateDocItems()) {
      const matches: EvaluatedInstance[] = [];
      for (const row of rows) {
        const spaceKey = normalizeString(row.space_cdm_id) ?? normalizeString(row.space_key);
        if (spaceInclude && (!spaceKey || !spaceInclude.has(spaceKey))) {
          continue;
        }
        if (spaceExclude && spaceKey && spaceExclude.has(spaceKey)) {
          continue;
        }

        const updatedAt = row.updated_at ?? row.created_at;
        if (!updatedAt) {
          continue;
        }
        const ageMs = nowMs - updatedAt.getTime();
        if (ageMs < minAgeMs) {
          continue;
        }

        const properties = normalizeRecord(row.properties);
        const viewCount = extractViewCount(properties);
        if (typeof config.minViewCount === "number" && viewCount >= config.minViewCount) {
          continue;
        }
        if (config.requireProjectLink && hasProjectLink(row, properties)) {
          continue;
        }

        const summary = buildDocSummary(row, ageMs, viewCount, config.requireProjectLink === true);
        matches.push({
          entityRef: buildEntityRef("cdm.doc.item", row.cdm_id),
          entityKind,
          severity: definition.severity,
          summary,
          details: {
            cdmId: row.cdm_id,
            spaceCdmId: row.space_cdm_id,
            spaceKey: row.space_key,
            viewCount,
            ageMs,
            updatedAt: updatedAt.toISOString(),
          },
        });
      }
      await this.applyMatchesForPage(definition, matches, reconciliation, now, options);
    }

    await this.resolveUnmatchedInstances(definition, reconciliation, now, options);
    return { created: reconciliation.created, updated: reconciliation.updated, resolved: reconciliation.resolved };
  }

  private async evaluateGenericFilter(
    definition: SignalDefinition,
    config: CdmGenericFilterConfig,
    context: HandlerContext,
  ): Promise<EvaluationCounts> {
    const now = context.now;
    const options = context.options;
    const entityKind = context.entityKind;
    const entityPrefix = config.cdmModelId === "cdm.work.item" ? "cdm.work.item" : "cdm.doc.item";
    const reconciliation = await this.createReconciliationContext(definition.id);

    if (config.cdmModelId === "cdm.work.item") {
      for await (const rows of this.iterateWorkItems()) {
        const matches: EvaluatedInstance[] = [];
        for (const row of rows) {
          const accessor: GenericFieldAccessor = (field) => resolveGenericFieldValue("cdm.work.item", row, field, now);
          if (!config.where.every((condition) => evaluateGenericCondition(condition, accessor))) {
            continue;
          }
          const severity = resolveGenericSeverity(definition.severity, config.severityRules, accessor);
          const summary = renderGenericSummary(config.summaryTemplate, accessor);
          const details = buildGenericDetails(config, row, accessor);
          matches.push({
            entityRef: buildEntityRef(entityPrefix, row.cdm_id),
            entityKind,
            severity,
            summary,
            details,
          });
        }
        await this.applyMatchesForPage(definition, matches, reconciliation, now, options);
      }
    } else {
      for await (const rows of this.iterateDocItems()) {
        const matches: EvaluatedInstance[] = [];
        for (const row of rows) {
          const accessor: GenericFieldAccessor = (field) => resolveGenericFieldValue("cdm.doc.item", row, field, now);
          if (!config.where.every((condition) => evaluateGenericCondition(condition, accessor))) {
            continue;
          }
          const severity = resolveGenericSeverity(definition.severity, config.severityRules, accessor);
          const summary = renderGenericSummary(config.summaryTemplate, accessor);
          const details = buildGenericDetails(config, row, accessor);
          matches.push({
            entityRef: buildEntityRef(entityPrefix, row.cdm_id),
            entityKind,
            severity,
            summary,
            details,
          });
        }
        await this.applyMatchesForPage(definition, matches, reconciliation, now, options);
      }
    }

    await this.resolveUnmatchedInstances(definition, reconciliation, now, options);
    return { created: reconciliation.created, updated: reconciliation.updated, resolved: reconciliation.resolved };
  }

  private async *iterateWorkItems(args?: { filter?: { statusIn?: string[] | null } }) {
    let after: string | null = null;
    while (true) {
      const page = await this.workStore.listWorkItems({
        projectId: null,
        filter: args?.filter ?? undefined,
        first: MAX_PAGE_SIZE,
        after,
      });
      if (page.rows.length > 0) {
        yield page.rows;
      }
      if (!page.hasNextPage) {
        break;
      }
      const nextOffset = (page.cursorOffset ?? 0) + page.rows.length;
      if (nextOffset === page.cursorOffset) {
        break;
      }
      after = encodeOffsetCursor(nextOffset);
    }
  }

  private async *iterateDocItems() {
    let after: string | null = null;
    while (true) {
      const page = await this.docStore.listDocItems({
        projectId: null,
        filter: {},
        first: MAX_PAGE_SIZE,
        after,
        secured: false,
      });
      if (page.rows.length > 0) {
        yield page.rows;
      }
      if (!page.hasNextPage) {
        break;
      }
      const nextOffset = (page.cursorOffset ?? 0) + page.rows.length;
      if (nextOffset === page.cursorOffset) {
        break;
      }
      after = encodeOffsetCursor(nextOffset);
    }
  }

  private async createReconciliationContext(definitionId: string): Promise<ReconciliationContext> {
    const existing = await this.loadInstancesForDefinition(definitionId);
    const existingByRef = new Map<string, SignalInstance>();
    existing.forEach((instance) => existingByRef.set(instance.entityRef, instance));
    return {
      existingByRef,
      matchedRefs: new Set<string>(),
      created: 0,
      updated: 0,
      resolved: 0,
    };
  }

  private async loadInstancesForDefinition(definitionId: string): Promise<SignalInstance[]> {
    if (this.signalStore.listInstancesPaged) {
      const instances: SignalInstance[] = [];
      let after: string | null = null;
      while (true) {
        const page = await this.signalStore.listInstancesPaged({
          definitionIds: [definitionId],
          limit: MAX_PAGE_SIZE,
          after,
        });
        instances.push(...page.rows);
        if (!page.hasNextPage) {
          break;
        }
        const nextOffset = (page.cursorOffset ?? 0) + page.rows.length;
        if (nextOffset === page.cursorOffset) {
          break;
        }
        after = encodeOffsetCursor(nextOffset);
      }
      return instances;
    }
    return this.signalStore.listInstances({ definitionIds: [definitionId], limit: MAX_PAGE_SIZE });
  }

  private async applyMatchesForPage(
    definition: SignalDefinition,
    matches: EvaluatedInstance[],
    context: ReconciliationContext,
    now: Date,
    options?: EvaluateSignalsOptions,
  ): Promise<void> {
    if (!matches.length) {
      return;
    }
    const uniqueMatches = new Map<string, EvaluatedInstance>();
    matches.forEach((match) => uniqueMatches.set(match.entityRef, match));

    for (const match of uniqueMatches.values()) {
      if (context.matchedRefs.has(match.entityRef)) {
        continue;
      }
      context.matchedRefs.add(match.entityRef);
      const prior = context.existingByRef.get(match.entityRef);
      if (options?.dryRun) {
        if (prior) {
          context.updated += 1;
        } else {
          context.created += 1;
        }
        continue;
      }
      await this.signalStore.upsertInstance({
        definitionId: definition.id,
        entityRef: match.entityRef,
        entityKind: match.entityKind,
        severity: match.severity,
        summary: match.summary,
        details: match.details ?? null,
        status: "OPEN",
        sourceRunId: options?.sourceRunId ?? null,
        timestamp: now,
      });
      if (prior) {
        context.updated += 1;
      } else {
        context.created += 1;
      }
    }
  }

  private async resolveUnmatchedInstances(
    definition: SignalDefinition,
    context: ReconciliationContext,
    now: Date,
    options?: EvaluateSignalsOptions,
  ): Promise<void> {
    for (const instance of context.existingByRef.values()) {
      if (instance.status !== "OPEN") {
        continue;
      }
      if (context.matchedRefs.has(instance.entityRef)) {
        continue;
      }
      if (options?.dryRun) {
        context.resolved += 1;
        continue;
      }
      await this.signalStore.upsertInstance({
        definitionId: definition.id,
        entityRef: instance.entityRef,
        entityKind: instance.entityKind,
        severity: instance.severity,
        summary: instance.summary,
        details: instance.details ?? null,
        status: "RESOLVED",
        resolvedAt: now,
        sourceRunId: options?.sourceRunId ?? null,
        timestamp: now,
      });
      context.resolved += 1;
    }
  }
}

function encodeOffsetCursor(offset: number): string {
  return Buffer.from(String(offset)).toString("base64");
}

function formatErrorReason(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `error: ${error.message}`;
  }
  return `error: ${String(error)}`;
}

function resolveEntityKind(definition: SignalDefinition, spec: ParsedSignalDefinitionSpec): string | null {
  const defined = typeof definition.entityKind === "string" ? definition.entityKind.trim() : "";
  if (defined) {
    return defined;
  }
  if (spec.type === "cdm.work.stale_item" || (spec.type === "cdm.generic.filter" && spec.config.cdmModelId === "cdm.work.item")) {
    return "WORK_ITEM";
  }
  if (spec.type === "cdm.doc.orphan" || (spec.type === "cdm.generic.filter" && spec.config.cdmModelId === "cdm.doc.item")) {
    return "DOC";
  }
  return null;
}

function matchesCdmModel(definition: SignalDefinition, spec: ParsedSignalDefinitionSpec): boolean {
  if (!definition.cdmModelId) {
    return true;
  }
  if (spec.type === "cdm.work.stale_item" && spec.config.cdmModelId !== definition.cdmModelId) {
    return false;
  }
  if (spec.type === "cdm.doc.orphan" && spec.config.cdmModelId !== definition.cdmModelId) {
    return false;
  }
  if (spec.type === "cdm.generic.filter" && spec.config.cdmModelId !== definition.cdmModelId) {
    return false;
  }
  return true;
}

function validateGenericFilterFields(config: CdmGenericFilterConfig): string | null {
  const conditions: CdmGenericFilterCondition[] = [...config.where];
  (config.severityRules ?? []).forEach((rule) => conditions.push(...rule.when));
  for (const condition of conditions) {
    if (!isSupportedGenericField(config.cdmModelId, condition.field)) {
      return `unsupported field ${condition.field} for ${config.cdmModelId}`;
    }
  }
  return null;
}

function isSupportedGenericField(modelId: CdmGenericFilterConfig["cdmModelId"], field: string): boolean {
  const normalized = typeof field === "string" ? field.trim() : "";
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("properties.")) {
    return true;
  }
  const allowed = modelId === "cdm.work.item" ? GENERIC_WORK_FIELDS : GENERIC_DOC_FIELDS;
  return allowed.has(normalized);
}

function resolveGenericFieldValue(
  modelId: CdmGenericFilterConfig["cdmModelId"],
  row: CdmWorkItemRow | CdmDocItemRow,
  field: string,
  now: Date,
): unknown {
  if (modelId === "cdm.work.item") {
    return resolveWorkFieldValue(row as CdmWorkItemRow, field, now);
  }
  return resolveDocFieldValue(row as CdmDocItemRow, field, now);
}

function resolveWorkFieldValue(row: CdmWorkItemRow, field: string, now: Date): unknown {
  const normalized = field.trim();
  if (normalized === "status") return row.status;
  if (normalized === "priority") return row.priority;
  if (normalized === "assignee" || normalized === "assignee_cdm_id") return row.assignee_cdm_id;
  if (normalized === "reporter_cdm_id") return row.reporter_cdm_id;
  if (normalized === "project_cdm_id") return row.project_cdm_id;
  if (normalized === "source_issue_key") return row.source_issue_key;
  if (normalized === "source_system") return row.source_system;
  if (normalized === "summary") return row.summary;
  if (normalized === "created_at") return row.created_at;
  if (normalized === "updated_at") return row.updated_at;
  if (normalized === "closed_at") return row.closed_at;
  if (normalized === "ageMs" || normalized === "ageDays") {
    const ageMs = computeAgeMs(row.updated_at ?? row.closed_at ?? row.created_at, now);
    if (ageMs === null) {
      return null;
    }
    return normalized === "ageDays" ? ageMs / MS_PER_DAY : ageMs;
  }
  if (normalized.startsWith("properties.")) {
    return getNestedValue(row.properties ?? null, normalized.slice("properties.".length));
  }
  return null;
}

function resolveDocFieldValue(row: CdmDocItemRow, field: string, now: Date): unknown {
  const normalized = field.trim();
  if (normalized === "title") return row.title;
  if (normalized === "space_key") return row.space_key;
  if (normalized === "space_cdm_id") return row.space_cdm_id;
  if (normalized === "space_name") return row.space_name;
  if (normalized === "doc_type") return row.doc_type;
  if (normalized === "mime_type") return row.mime_type;
  if (normalized === "source_system") return row.source_system;
  if (normalized === "source_item_id") return row.source_item_id;
  if (normalized === "created_at") return row.created_at;
  if (normalized === "updated_at") return row.updated_at;
  if (normalized === "dataset_id") return (row as any).dataset_id ?? null;
  if (normalized === "endpoint_id") return (row as any).endpoint_id ?? null;
  if (normalized === "viewCount") {
    const properties = normalizeRecord(row.properties ?? {});
    return extractViewCount(properties);
  }
  if (normalized === "ageMs" || normalized === "ageDays") {
    const ageMs = computeAgeMs(row.updated_at ?? row.created_at, now);
    if (ageMs === null) {
      return null;
    }
    return normalized === "ageDays" ? ageMs / MS_PER_DAY : ageMs;
  }
  if (normalized.startsWith("properties.")) {
    return getNestedValue(row.properties ?? null, normalized.slice("properties.".length));
  }
  return null;
}

function computeAgeMs(dateValue: Date | null | undefined, now: Date): number | null {
  if (!dateValue) {
    return null;
  }
  return now.getTime() - dateValue.getTime();
}

function getNestedValue(source: unknown, path: string): unknown {
  if (!isRecord(source)) {
    return null;
  }
  const segments = path.split(".").filter((segment) => segment.length > 0);
  let current: unknown = source;
  for (const segment of segments) {
    if (!isRecord(current)) {
      return null;
    }
    const next = (current as Record<string, unknown>)[segment];
    current = next as unknown;
  }
  return current as unknown;
}

function evaluateGenericCondition(condition: CdmGenericFilterCondition, accessor: GenericFieldAccessor): boolean {
  const value = accessor(condition.field);
  if (condition.op === "IS_NULL") {
    return value === null || value === undefined;
  }
  if (condition.op === "IS_NOT_NULL") {
    return value !== null && value !== undefined;
  }
  if (condition.op === "IN" || condition.op === "NOT_IN") {
    const candidates = Array.isArray(condition.value) ? (condition.value as ComparablePrimitive[]) : [];
    if (!candidates.length) {
      return false;
    }
    const matched = matchesAny(value, candidates);
    return condition.op === "IN" ? matched : !matched;
  }

  if (condition.value === undefined || condition.value === null) {
    return false;
  }

  const expected = condition.value as ComparablePrimitive;
  if (condition.op === "LT" || condition.op === "LTE" || condition.op === "GT" || condition.op === "GTE") {
    const left = toNumberValue(value);
    const right = toNumberValue(expected);
    if (left === null || right === null) {
      return false;
    }
    if (condition.op === "LT") return left < right;
    if (condition.op === "LTE") return left <= right;
    if (condition.op === "GT") return left > right;
    return left >= right;
  }

  if (condition.op === "EQ" || condition.op === "NEQ") {
    return comparePrimitive(value, expected, condition.op === "EQ");
  }

  return false;
}

function matchesAny(value: unknown, candidates: ComparablePrimitive[]): boolean {
  return candidates.some((candidate) => comparePrimitive(value, candidate, true));
}

function comparePrimitive(value: unknown, expected: ComparablePrimitive, expectEqual: boolean): boolean {
  if (typeof expected === "number") {
    const left = toNumberValue(value);
    if (left === null) {
      return false;
    }
    return expectEqual ? left === expected : left !== expected;
  }
  if (typeof expected === "boolean") {
    const left = toBooleanValue(value);
    if (left === null) {
      return false;
    }
    return expectEqual ? left === expected : left !== expected;
  }
  const left = normalizeString(value);
  const right = normalizeString(expected);
  if (left === null || right === null) {
    return false;
  }
  return expectEqual ? left === right : left !== right;
}

function resolveGenericSeverity(
  defaultSeverity: SignalSeverity,
  rules: CdmGenericSeverityRule[] | undefined,
  accessor: GenericFieldAccessor,
): SignalSeverity {
  if (!rules || rules.length === 0) {
    return defaultSeverity;
  }
  for (const rule of rules) {
    const matches = rule.when.every((condition) => evaluateGenericCondition(condition, accessor));
    if (matches) {
      return rule.severity;
    }
  }
  return defaultSeverity;
}

function renderGenericSummary(template: string, accessor: GenericFieldAccessor): string {
  return template.replace(/{{\s*([^}\s]+)\s*}}/g, (_match, key) => {
    const field = String(key).trim();
    return stringifyTemplateValue(accessor(field));
  });
}

function stringifyTemplateValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function buildGenericDetails(
  config: CdmGenericFilterConfig,
  row: CdmWorkItemRow | CdmDocItemRow,
  accessor: GenericFieldAccessor,
): Record<string, unknown> {
  const details: Record<string, unknown> = {
    cdmId: row.cdm_id,
    cdmModelId: config.cdmModelId,
  };
  const sourceSystem = (row as any).source_system ?? (row as any).sourceSystem;
  if (sourceSystem) {
    details.sourceSystem = sourceSystem;
  }
  const trackedFields = new Set<string>();
  config.where.forEach((condition) => trackedFields.add(condition.field));
  (config.severityRules ?? []).forEach((rule) => rule.when.forEach((condition) => trackedFields.add(condition.field)));
  const matched: Record<string, unknown> = {};
  trackedFields.forEach((field) => {
    const value = accessor(field);
    if (value !== undefined) {
      matched[field] = value as unknown;
    }
  });
  if (Object.keys(matched).length > 0) {
    details.matchedFields = matched;
  }
  return details;
}

function toNumberValue(value: unknown): number | null {
  if (value instanceof Date) {
    return value.getTime();
  }
  const parsed = parseNumeric(value);
  return parsed !== null ? parsed : null;
}

function toBooleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed.toLowerCase() : null;
  }
  return null;
}

function toLowerSet(values?: string[] | null): Set<string> | null {
  if (!values || values.length === 0) {
    return null;
  }
  const normalized = values
    .map((value) => normalizeString(value))
    .filter((value): value is string => !!value);
  return normalized.length ? new Set(normalized) : null;
}

function cleanStringArray(values?: string[] | null): string[] | null {
  if (!values || values.length === 0) {
    return null;
  }
  const filtered = values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  return filtered.length ? filtered : null;
}

function pickSeverity(
  defaultSeverity: SignalSeverity,
  warnAfterMs: number | null,
  errorAfterMs: number | null,
  ageMs: number,
): SignalSeverity {
  if (errorAfterMs !== null && ageMs >= errorAfterMs) {
    return "ERROR";
  }
  if (warnAfterMs !== null && ageMs >= warnAfterMs) {
    return "WARNING";
  }
  return defaultSeverity;
}

function buildWorkSummary(row: CdmWorkItemRow, ageMs: number): string {
  const identifier = row.source_issue_key ?? row.cdm_id;
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  const ageText = ageDays >= 1 ? `${ageDays} day${ageDays === 1 ? "" : "s"}` : `${Math.ceil(ageMs / (60 * 60 * 1000))} hours`;
  return `Work item ${identifier} stale for ${ageText}`;
}

function buildDocSummary(row: CdmDocItemRow, ageMs: number, viewCount: number, requireProjectLink: boolean): string {
  const title = row.title ?? row.source_item_id ?? row.cdm_id;
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  const ageText = ageDays >= 1 ? `${ageDays} day${ageDays === 1 ? "" : "s"}` : `${Math.ceil(ageMs / (60 * 60 * 1000))} hours`;
  const viewText = `views=${viewCount}`;
  const linkText = requireProjectLink ? "no project/work link" : "low engagement";
  return `Doc "${title}" appears orphaned (${linkText}, ${ageText}, ${viewText})`;
}

function buildEntityRef(prefix: "cdm.work.item" | "cdm.doc.item", cdmId: string): string {
  const normalizedId = cdmId
    .replace(/^cdm[:\.\s]*work[:\.\s]*item[:\.]/i, "cdm.work.item:")
    .replace(/^cdm[:\.\s]*doc[:\.\s]*item[:\.]/i, "cdm.doc.item:");
  if (normalizedId.startsWith(`${prefix}:`)) {
    return normalizedId;
  }
  if (normalizedId.startsWith(prefix)) {
    return normalizedId;
  }
  return `${prefix}:${normalizedId}`;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
  }
  return {};
}

function extractViewCount(properties: Record<string, unknown>): number {
  const candidates: unknown[] = [properties["viewCount"], properties["views"]];
  if (isRecord(properties["metrics"])) {
    const metrics = properties["metrics"] as Record<string, unknown>;
    candidates.push(metrics["views"], metrics["viewCount"]);
  }
  const metadata = isRecord(properties["_metadata"]) ? (properties["_metadata"] as Record<string, unknown>) : null;
  if (metadata) {
    candidates.push(metadata["viewCount"], metadata["views"]);
  }

  for (const candidate of candidates) {
    const numeric = parseNumeric(candidate);
    if (numeric !== null && numeric >= 0) {
      return numeric;
    }
  }
  return 0;
}

function hasProjectLink(row: CdmDocItemRow, properties: Record<string, unknown>): boolean {
  const candidates: unknown[] = [
    properties["projectKey"],
    properties["projectId"],
    properties["project"],
    properties["workLinks"],
    properties["linkedWorkItems"],
    properties["linkedIssues"],
  ];
  const metadata = isRecord(properties["_metadata"]) ? (properties["_metadata"] as Record<string, unknown>) : null;
  if (metadata) {
    candidates.push(metadata["projectKey"], metadata["workItemRefs"], metadata["projectRefs"]);
  }
  const arrays = candidates.filter(Array.isArray) as unknown[][];
  if (arrays.some((arr) => arr.length > 0)) {
    return true;
  }
  if (candidates.some((value) => typeof value === "string" && value.trim().length > 0)) {
    return true;
  }
  if (isRecord(row.properties) && Object.keys(row.properties as Record<string, unknown>).includes("linkedWorkItems")) {
    const linked = (row.properties as Record<string, unknown>)["linkedWorkItems"];
    if (Array.isArray(linked) && linked.length > 0) {
      return true;
    }
  }
  return false;
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
