import type { SignalSeverity } from "./types.js";

export type SignalDefinitionType = "cdm.work.stale_item" | "cdm.doc.orphan" | "cdm.generic.filter";

export type IntervalUnit = "days" | "hours";

export type IntervalConfig = {
  unit: IntervalUnit;
  value: number;
};

export type SignalDefinitionSpecV1 = {
  version: 1;
  type: SignalDefinitionType;
  config: Record<string, unknown>;
};

export type CdmWorkStaleItemConfig = {
  cdmModelId: "cdm.work.item";
  maxAge: IntervalConfig;
  statusInclude?: string[];
  statusExclude?: string[];
  projectInclude?: string[];
  projectExclude?: string[];
  severityMapping?: {
    warnAfter?: IntervalConfig;
    errorAfter?: IntervalConfig;
  };
};

export type CdmDocOrphanConfig = {
  cdmModelId: "cdm.doc.item";
  minAge: IntervalConfig;
  minViewCount?: number;
  requireProjectLink?: boolean;
  spaceInclude?: string[];
  spaceExclude?: string[];
};

export type GenericFilterOp =
  | "LT"
  | "LTE"
  | "GT"
  | "GTE"
  | "EQ"
  | "NEQ"
  | "IN"
  | "NOT_IN"
  | "IS_NULL"
  | "IS_NOT_NULL";

export type CdmGenericFilterCondition = {
  field: string;
  op: GenericFilterOp;
  value?: unknown;
};

export type CdmGenericSeverityRule = {
  when: CdmGenericFilterCondition[];
  severity: SignalSeverity;
};

export type CdmGenericFilterConfig = {
  cdmModelId: "cdm.work.item" | "cdm.doc.item";
  where: CdmGenericFilterCondition[];
  severityRules?: CdmGenericSeverityRule[];
  summaryTemplate: string;
};

export type ParsedSignalDefinitionSpec =
  | { version: 1; type: "cdm.work.stale_item"; config: CdmWorkStaleItemConfig }
  | { version: 1; type: "cdm.doc.orphan"; config: CdmDocOrphanConfig }
  | { version: 1; type: "cdm.generic.filter"; config: CdmGenericFilterConfig };

export type ParseResult =
  | { ok: true; spec: ParsedSignalDefinitionSpec }
  | { ok: false; reason: string };

type ConfigParseResult<T> = { ok: true; config: T } | { ok: false; reason: string };

export function parseSignalDefinitionSpec(input: unknown): ParseResult {
  if (!isRecord(input)) {
    return { ok: false, reason: "definitionSpec must be an object" };
  }
  const version = input.version;
  if (version !== 1) {
    return { ok: false, reason: `unsupported definitionSpec version: ${String(version)}` };
  }
  const type = typeof input.type === "string" ? (input.type as SignalDefinitionType) : null;
  if (!type) {
    return { ok: false, reason: "definitionSpec.type is required" };
  }
  const config = isRecord(input.config) ? (input.config as Record<string, unknown>) : null;
  if (!config) {
    return { ok: false, reason: "definitionSpec.config must be an object" };
  }

  if (type === "cdm.work.stale_item") {
    const parsed = parseWorkStaleConfig(config);
    if (!parsed.ok) {
      return parsed;
    }
    return { ok: true, spec: { version: 1, type, config: parsed.config } };
  }

  if (type === "cdm.doc.orphan") {
    const parsed = parseDocOrphanConfig(config);
    if (!parsed.ok) {
      return parsed;
    }
    return { ok: true, spec: { version: 1, type, config: parsed.config } };
  }

  if (type === "cdm.generic.filter") {
    const parsed = parseGenericFilterConfig(config);
    if (!parsed.ok) {
      return parsed;
    }
    return { ok: true, spec: { version: 1, type, config: parsed.config } };
  }

  return { ok: false, reason: `unsupported spec type ${type}` };
}

const GENERIC_FILTER_OPS: GenericFilterOp[] = [
  "LT",
  "LTE",
  "GT",
  "GTE",
  "EQ",
  "NEQ",
  "IN",
  "NOT_IN",
  "IS_NULL",
  "IS_NOT_NULL",
];

const GENERIC_SEVERITY_VALUES: SignalSeverity[] = ["INFO", "WARNING", "ERROR", "CRITICAL"];

function parseGenericFilterConfig(config: Record<string, unknown>): ConfigParseResult<CdmGenericFilterConfig> {
  const cdmModelId = config.cdmModelId;
  if (cdmModelId !== "cdm.work.item" && cdmModelId !== "cdm.doc.item") {
    return { ok: false, reason: "cdmModelId must be cdm.work.item or cdm.doc.item" };
  }

  const where = parseGenericConditions(config.where, "where");
  if (!where.ok) {
    return where;
  }

  const severityRules = parseSeverityRules(config.severityRules);
  if (!severityRules.ok) {
    return severityRules;
  }

  const summaryTemplate = typeof config.summaryTemplate === "string" ? config.summaryTemplate.trim() : "";
  if (!summaryTemplate) {
    return { ok: false, reason: "summaryTemplate is required" };
  }

  return {
    ok: true,
    config: {
      cdmModelId,
      where: where.config,
      severityRules: severityRules.config ?? undefined,
      summaryTemplate,
    },
  };
}

function parseGenericConditions(input: unknown, label: string): ConfigParseResult<CdmGenericFilterCondition[]> {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, reason: `${label} must be a non-empty array` };
  }
  const parsed: CdmGenericFilterCondition[] = [];
  for (const entry of input) {
    const condition = parseGenericCondition(entry);
    if (!condition.ok) {
      return { ok: false, reason: `${label}: ${condition.reason}` };
    }
    parsed.push(condition.config);
  }
  return { ok: true, config: parsed };
}

function parseGenericCondition(input: unknown): ConfigParseResult<CdmGenericFilterCondition> {
  if (!isRecord(input)) {
    return { ok: false, reason: "condition must be an object" };
  }
  const field = typeof input.field === "string" ? input.field.trim() : "";
  if (!field) {
    return { ok: false, reason: "condition.field is required" };
  }
  const opRaw = typeof input.op === "string" ? input.op.toUpperCase() : null;
  const op = opRaw && GENERIC_FILTER_OPS.includes(opRaw as GenericFilterOp) ? (opRaw as GenericFilterOp) : null;
  if (!op) {
    return { ok: false, reason: `unsupported op ${String(input.op)}` };
  }

  if (op === "IS_NULL" || op === "IS_NOT_NULL") {
    return { ok: true, config: { field, op } };
  }

  if (!Object.prototype.hasOwnProperty.call(input, "value")) {
    return { ok: false, reason: `value is required for op ${op}` };
  }
  const value = (input as Record<string, unknown>).value;
  if (op === "IN" || op === "NOT_IN") {
    if (!Array.isArray(value) || value.length === 0) {
      return { ok: false, reason: `value for ${op} must be a non-empty array` };
    }
    const normalized = value
      .map((entry) => normalizePrimitive(entry))
      .filter((entry): entry is string | number | boolean => entry !== null);
    if (!normalized.length) {
      return { ok: false, reason: `value for ${op} must contain primitives` };
    }
    return { ok: true, config: { field, op, value: normalized } };
  }

  const normalized = normalizePrimitive(value);
  if (normalized === null) {
    return { ok: false, reason: `value for ${op} must be a string, number, or boolean` };
  }
  return { ok: true, config: { field, op, value: normalized } };
}

function parseSeverityRules(input: unknown): ConfigParseResult<CdmGenericSeverityRule[] | undefined> {
  if (input === undefined || input === null) {
    return { ok: true, config: undefined };
  }
  if (!Array.isArray(input)) {
    return { ok: false, reason: "severityRules must be an array" };
  }
  const rules: CdmGenericSeverityRule[] = [];
  for (const entry of input) {
    if (!isRecord(entry)) {
      return { ok: false, reason: "severityRules entries must be objects" };
    }
    const when = parseGenericConditions(entry.when, "severityRules.when");
    if (!when.ok) {
      return when;
    }
    const severity = parseSeverityValue(entry.severity);
    if (!severity) {
      return { ok: false, reason: "severityRules.severity must be one of INFO|WARNING|ERROR|CRITICAL" };
    }
    rules.push({ when: when.config, severity });
  }
  return { ok: true, config: rules.length ? rules : undefined };
}

function parseSeverityValue(input: unknown): SignalSeverity | null {
  if (typeof input !== "string") {
    return null;
  }
  const normalized = input.toUpperCase();
  return GENERIC_SEVERITY_VALUES.includes(normalized as SignalSeverity) ? (normalized as SignalSeverity) : null;
}

function normalizePrimitive(value: unknown): string | number | boolean | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return null;
}

export function intervalToMs(interval: IntervalConfig): number {
  const base = interval.value;
  const multiplier = interval.unit === "hours" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return base * multiplier;
}

function parseWorkStaleConfig(config: Record<string, unknown>): ConfigParseResult<CdmWorkStaleItemConfig> {
  if (config.cdmModelId !== "cdm.work.item") {
    return { ok: false, reason: "cdmModelId must be cdm.work.item" };
  }
  const maxAge = parseInterval(config.maxAge);
  if (!maxAge) {
    return { ok: false, reason: "maxAge is required (days|hours)" };
  }
  const severityMapping = parseSeverityMapping(config.severityMapping);
  return {
    ok: true,
    config: {
      cdmModelId: "cdm.work.item",
      maxAge,
      statusInclude: coerceStringArray(config.statusInclude),
      statusExclude: coerceStringArray(config.statusExclude),
      projectInclude: coerceStringArray(config.projectInclude),
      projectExclude: coerceStringArray(config.projectExclude),
      severityMapping: severityMapping ?? undefined,
    },
  };
}

function parseDocOrphanConfig(config: Record<string, unknown>): ConfigParseResult<CdmDocOrphanConfig> {
  if (config.cdmModelId !== "cdm.doc.item") {
    return { ok: false, reason: "cdmModelId must be cdm.doc.item" };
  }
  const minAge = parseInterval(config.minAge);
  if (!minAge) {
    return { ok: false, reason: "minAge is required (days|hours)" };
  }
  const minViewCountValue = parseNumber(config.minViewCount);
  const minViewCount = typeof minViewCountValue === "number" && minViewCountValue >= 0 ? minViewCountValue : null;
  const requireProjectLink = typeof config.requireProjectLink === "boolean" ? config.requireProjectLink : undefined;
  return {
    ok: true,
    config: {
      cdmModelId: "cdm.doc.item",
      minAge,
      minViewCount: minViewCount ?? undefined,
      requireProjectLink,
      spaceInclude: coerceStringArray(config.spaceInclude),
      spaceExclude: coerceStringArray(config.spaceExclude),
    },
  };
}

function parseSeverityMapping(input: unknown) {
  if (!isRecord(input)) {
    return null;
  }
  const warnAfter = parseInterval(input.warnAfter);
  const errorAfter = parseInterval(input.errorAfter);
  if (!warnAfter && !errorAfter) {
    return null;
  }
  return { warnAfter: warnAfter ?? undefined, errorAfter: errorAfter ?? undefined };
}

function parseInterval(input: unknown): IntervalConfig | null {
  if (!isRecord(input)) {
    return null;
  }
  const unit = input.unit;
  const value = parseNumber(input.value);
  if ((unit === "days" || unit === "hours") && typeof value === "number" && value > 0) {
    return { unit, value } as IntervalConfig;
  }
  return null;
}

function coerceStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }
  const values = input
    .map((value) => (typeof value === "string" ? value.trim() : null))
    .filter((value): value is string => !!value);
  return values.length ? values : undefined;
}

function parseNumber(input: unknown): number | null {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input;
  }
  if (typeof input === "string" && input.trim().length > 0) {
    const parsed = Number.parseFloat(input);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
