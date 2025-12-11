import { CdmDocStore, type CdmDocItemRow } from "../cdm/docStore.js";
import { CdmWorkStore, encodeCursor as encodeWorkCursor, type CdmWorkItemRow } from "../cdm/workStore.js";
import {
  intervalToMs,
  parseSignalDefinitionSpec,
  type CdmDocOrphanConfig,
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

const MAX_PAGE_SIZE = 200;

export class DefaultSignalEvaluator implements SignalEvaluator {
  private readonly signalStore: SignalStore;
  private readonly workStore: WorkStore;
  private readonly docStore: DocStore;

  constructor(options: { signalStore: SignalStore; workStore?: WorkStore; docStore?: DocStore }) {
    this.signalStore = options.signalStore;
    this.workStore = options.workStore ?? new CdmWorkStore();
    this.docStore = options.docStore ?? new CdmDocStore();
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
      const parsed = parseSignalDefinitionSpec(definition.definitionSpec);
      if (!parsed.ok) {
        summary.skippedDefinitions.push({ slug: definition.slug, reason: parsed.reason });
        continue;
      }
      const spec = parsed.spec;
      if (!matchesCdmModel(definition, spec)) {
        summary.skippedDefinitions.push({
          slug: definition.slug,
          reason: "cdmModelId mismatch between definition and spec",
        });
        continue;
      }

      summary.evaluatedDefinitions.push(definition.slug);
      const counts = await this.evaluateDefinition(definition, spec, now, options);
      summary.instancesCreated += counts.created;
      summary.instancesUpdated += counts.updated;
      summary.instancesResolved += counts.resolved;
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

  private async evaluateDefinition(
    definition: SignalDefinition,
    spec: ParsedSignalDefinitionSpec,
    now: Date,
    options?: EvaluateSignalsOptions,
  ): Promise<EvaluationCounts> {
    if (spec.type === "cdm.work.stale_item") {
      return this.evaluateWorkStale(definition, spec.config, now, options);
    }
    if (spec.type === "cdm.doc.orphan") {
      return this.evaluateDocOrphan(definition, spec.config, now, options);
    }
    return { created: 0, updated: 0, resolved: 0 };
  }

  private async evaluateWorkStale(
    definition: SignalDefinition,
    config: CdmWorkStaleItemConfig,
    now: Date,
    options?: EvaluateSignalsOptions,
  ): Promise<EvaluationCounts> {
    const statusInclude = toLowerSet(config.statusInclude);
    const statusIncludeRaw = cleanStringArray(config.statusInclude);
    const statusExclude = toLowerSet(config.statusExclude);
    const projectInclude = toLowerSet(config.projectInclude);
    const projectExclude = toLowerSet(config.projectExclude);
    const maxAgeMs = intervalToMs(config.maxAge);
    const warnAfterMs = config.severityMapping?.warnAfter ? intervalToMs(config.severityMapping.warnAfter) : null;
    const errorAfterMs = config.severityMapping?.errorAfter ? intervalToMs(config.severityMapping.errorAfter) : null;

    const rows = await this.fetchAllWorkItems({
      filter: statusIncludeRaw ? { statusIn: statusIncludeRaw } : undefined,
    });

    const matches: EvaluatedInstance[] = [];
    const nowMs = now.getTime();
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
        entityKind: definition.entityKind,
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

    return this.applyMatches(definition, matches, now, options);
  }

  private async evaluateDocOrphan(
    definition: SignalDefinition,
    config: CdmDocOrphanConfig,
    now: Date,
    options?: EvaluateSignalsOptions,
  ): Promise<EvaluationCounts> {
    const spaceInclude = toLowerSet(config.spaceInclude);
    const spaceExclude = toLowerSet(config.spaceExclude);
    const minAgeMs = intervalToMs(config.minAge);
    const rows = await this.fetchAllDocItems();

    const matches: EvaluatedInstance[] = [];
    const nowMs = now.getTime();
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
        entityKind: definition.entityKind,
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

    return this.applyMatches(definition, matches, now, options);
  }

  private async fetchAllWorkItems(args?: { filter?: { statusIn?: string[] | null } }): Promise<CdmWorkItemRow[]> {
    const rows: CdmWorkItemRow[] = [];
    let after: string | null = null;
    while (true) {
      const page = await this.workStore.listWorkItems({
        projectId: null,
        filter: args?.filter ?? undefined,
        first: MAX_PAGE_SIZE,
        after,
      });
      rows.push(...page.rows);
      if (!page.hasNextPage) {
        break;
      }
      after = encodeWorkCursor((page.cursorOffset ?? 0) + page.rows.length);
    }
    return rows;
  }

  private async fetchAllDocItems(): Promise<CdmDocItemRow[]> {
    const rows: CdmDocItemRow[] = [];
    let after: string | null = null;
    while (true) {
      const page = await this.docStore.listDocItems({
        projectId: null,
        filter: {},
        first: MAX_PAGE_SIZE,
        after,
        secured: false,
      });
      rows.push(...page.rows);
      if (!page.hasNextPage) {
        break;
      }
      after = encodeWorkCursor((page.cursorOffset ?? 0) + page.rows.length);
    }
    return rows;
  }

  private async applyMatches(
    definition: SignalDefinition,
    matches: EvaluatedInstance[],
    now: Date,
    options?: EvaluateSignalsOptions,
  ): Promise<EvaluationCounts> {
    const existing = await this.signalStore.listInstances({ definitionIds: [definition.id], limit: MAX_PAGE_SIZE });
    const existingByRef = new Map<string, SignalInstance>();
    existing.forEach((instance) => existingByRef.set(instance.entityRef, instance));

    const matchedRefs = new Set<string>();
    const uniqueMatches = new Map<string, EvaluatedInstance>();
    matches.forEach((match) => uniqueMatches.set(match.entityRef, match));

    let created = 0;
    let updated = 0;
    let resolved = 0;

    for (const match of uniqueMatches.values()) {
      matchedRefs.add(match.entityRef);
      const prior = existingByRef.get(match.entityRef);
      if (options?.dryRun) {
        if (prior) {
          updated += 1;
        } else {
          created += 1;
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
        updated += 1;
      } else {
        created += 1;
      }
    }

    for (const instance of existingByRef.values()) {
      if (instance.status !== "OPEN") {
        continue;
      }
      if (matchedRefs.has(instance.entityRef)) {
        continue;
      }
      if (options?.dryRun) {
        resolved += 1;
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
      resolved += 1;
    }

    return { created, updated, resolved };
  }
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
  return true;
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
