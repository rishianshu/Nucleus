export type SignalDefinitionType = "cdm.work.stale_item" | "cdm.doc.orphan";

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

export type ParsedSignalDefinitionSpec =
  | { version: 1; type: "cdm.work.stale_item"; config: CdmWorkStaleItemConfig }
  | { version: 1; type: "cdm.doc.orphan"; config: CdmDocOrphanConfig };

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

  return { ok: false, reason: `unsupported spec type ${type}` };
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
