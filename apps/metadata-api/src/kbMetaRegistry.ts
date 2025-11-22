import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULTS_PATH =
  process.env.KB_META_DEFAULTS_PATH ?? path.resolve(moduleDir, "../../../docs/meta/kb-meta.defaults.json");
const CACHE_TTL_MS = Number(process.env.KB_META_CACHE_TTL_MS ?? 15 * 60 * 1000);

export type MetaScopeVector = {
  orgId: string;
  domainId?: string | null;
  projectId?: string | null;
  teamId?: string | null;
};

export type KbNodeTypeRecord = {
  value: string;
  label: string;
  description: string | null;
  synonyms: string[];
  icon: string | null;
  fieldsDisplay: string[];
  actions: string[];
};

export type KbEdgeTypeRecord = {
  value: string;
  label: string;
  description: string | null;
  synonyms: string[];
  icon: string | null;
  actions: string[];
};

export type KbMetaRecord = {
  version: string;
  nodeTypes: KbNodeTypeRecord[];
  edgeTypes: KbEdgeTypeRecord[];
};

type RawNode = Partial<KbNodeTypeRecord> & { value: string };
type RawEdge = Partial<KbEdgeTypeRecord> & { value: string };
type RawMeta = {
  version?: string;
  nodeTypes?: RawNode[];
  edgeTypes?: RawEdge[];
};

type CachedMeta = {
  payload: KbMetaRecord;
  expiresAt: number;
};

const REQUIRED_NODE_TYPES = ["catalog.dataset", "metadata.endpoint", "doc.page"];
const REQUIRED_EDGE_TYPES = ["DOCUMENTED_BY", "DEPENDENCY_OF"];

let cache: CachedMeta | null = null;

export async function resolveKbMeta(scope: MetaScopeVector | null): Promise<KbMetaRecord> {
  const defaults = await loadDefaultsMeta();
  const overlays = await loadScopeOverrides(scope);
  if (!overlays) {
    return cloneMeta(defaults);
  }
  return applyOverrides(defaults, overlays);
}

async function loadDefaultsMeta(): Promise<KbMetaRecord> {
  const now = Date.now();
  if (cache && now < cache.expiresAt) {
    return cache.payload;
  }
  let parsed: RawMeta | null = null;
  try {
    const buffer = await readFile(DEFAULTS_PATH, "utf-8");
    parsed = JSON.parse(buffer) as RawMeta;
  } catch (error) {
    console.warn(`[kb-meta] failed to read defaults (${DEFAULTS_PATH}): ${error}`);
  }
  const normalized = normalizeMeta(parsed);
  cache = {
    payload: normalized,
    expiresAt: now + CACHE_TTL_MS,
  };
  return normalized;
}

async function loadScopeOverrides(_scope: MetaScopeVector | null): Promise<RawMeta | null> {
  // v1 ships read-only defaults. Hook for future persistence/overrides.
  return null;
}

function normalizeMeta(raw: RawMeta | null): KbMetaRecord {
  if (!raw) {
    return buildFallbackMeta();
  }
  const normalizedNodes = normalizeNodeList(raw.nodeTypes ?? []);
  const normalizedEdges = normalizeEdgeList(raw.edgeTypes ?? []);
  ensureRequiredEntries(normalizedNodes, normalizedEdges);
  const version = raw.version ?? computeVersion(normalizedNodes, normalizedEdges);
  return {
    version,
    nodeTypes: normalizedNodes,
    edgeTypes: normalizedEdges,
  };
}

function normalizeNodeList(entries: RawNode[]): KbNodeTypeRecord[] {
  return entries
    .map((entry) => normalizeNode(entry))
    .filter((entry, index, list) => list.findIndex((node) => node.value === entry.value) === index);
}

function normalizeEdgeList(entries: RawEdge[]): KbEdgeTypeRecord[] {
  return entries
    .map((entry) => normalizeEdge(entry))
    .filter((entry, index, list) => list.findIndex((edge) => edge.value === entry.value) === index);
}

function normalizeNode(record: RawNode): KbNodeTypeRecord {
  const value = record.value.trim();
  return {
    value,
    label: record.label?.trim() || humanizeValue(value),
    description: record.description ?? null,
    synonyms: dedupeStrings(record.synonyms ?? []),
    icon: record.icon ?? null,
    fieldsDisplay: dedupeStrings(record.fieldsDisplay ?? []),
    actions: dedupeStrings(record.actions ?? []),
  };
}

function normalizeEdge(record: RawEdge): KbEdgeTypeRecord {
  const value = record.value.trim();
  return {
    value,
    label: record.label?.trim() || humanizeValue(value),
    description: record.description ?? null,
    synonyms: dedupeStrings(record.synonyms ?? []),
    icon: record.icon ?? null,
    actions: dedupeStrings(record.actions ?? []),
  };
}

function ensureRequiredEntries(nodes: KbNodeTypeRecord[], edges: KbEdgeTypeRecord[]) {
  REQUIRED_NODE_TYPES.forEach((value) => {
    if (!nodes.some((node) => node.value === value)) {
      nodes.push(buildFallbackNode(value));
    }
  });
  REQUIRED_EDGE_TYPES.forEach((value) => {
    if (!edges.some((edge) => edge.value === value)) {
      edges.push(buildFallbackEdge(value));
    }
  });
}

function applyOverrides(base: KbMetaRecord, overrides: RawMeta): KbMetaRecord {
  const next = cloneMeta(base);
  if (overrides.nodeTypes?.length) {
    const map = new Map(next.nodeTypes.map((node) => [node.value, node]));
    overrides.nodeTypes.forEach((entry) => {
      const normalized = normalizeNode(entry);
      map.set(normalized.value, normalized);
    });
    next.nodeTypes = Array.from(map.values());
  }
  if (overrides.edgeTypes?.length) {
    const map = new Map(next.edgeTypes.map((edge) => [edge.value, edge]));
    overrides.edgeTypes.forEach((entry) => {
      const normalized = normalizeEdge(entry);
      map.set(normalized.value, normalized);
    });
    next.edgeTypes = Array.from(map.values());
  }
  if (overrides.version) {
    next.version = overrides.version;
  }
  return next;
}

function cloneMeta(meta: KbMetaRecord): KbMetaRecord {
  return {
    version: meta.version,
    nodeTypes: meta.nodeTypes.map((node) => ({
      ...node,
      synonyms: [...node.synonyms],
      fieldsDisplay: [...node.fieldsDisplay],
      actions: [...node.actions],
    })),
    edgeTypes: meta.edgeTypes.map((edge) => ({
      ...edge,
      synonyms: [...edge.synonyms],
      actions: [...edge.actions],
    })),
  };
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value && value.length > 0)),
    ),
  );
}

function humanizeValue(value: string): string {
  return value
    .replace(/[\._]/g, " ")
    .split(" ")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ")
    .trim();
}

function buildFallbackMeta(): KbMetaRecord {
  const nodes = REQUIRED_NODE_TYPES.map((value) => buildFallbackNode(value));
  const edges = REQUIRED_EDGE_TYPES.map((value) => buildFallbackEdge(value));
  return {
    version: `fallback-${Date.now()}`,
    nodeTypes: nodes,
    edgeTypes: edges,
  };
}

function buildFallbackNode(value: string): KbNodeTypeRecord {
  return {
    value,
    label: humanizeValue(value),
    description: null,
    synonyms: [],
    icon: null,
    fieldsDisplay: [],
    actions: [],
  };
}

function buildFallbackEdge(value: string): KbEdgeTypeRecord {
  return {
    value,
    label: humanizeValue(value),
    description: null,
    synonyms: [],
    icon: null,
    actions: [],
  };
}

function computeVersion(nodes: KbNodeTypeRecord[], edges: KbEdgeTypeRecord[]): string {
  const hash = createHash("sha1");
  hash.update(JSON.stringify({ nodes, edges }));
  return hash.digest("hex").slice(0, 12);
}
