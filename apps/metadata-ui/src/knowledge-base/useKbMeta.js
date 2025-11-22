import { useCallback, useEffect, useMemo, useState } from "react";
import { humanizeKbIdentifier } from "@metadata/client";
import { fetchMetadataGraphQL } from "../metadata/api";
import { KB_META_QUERY } from "./queries";
const CACHE_TTL_MS = Number(import.meta.env.VITE_KB_META_CACHE_TTL_MS ?? 15 * 60 * 1000);
const metaCache = new Map();
const REQUIRED_NODE_TYPES = [
    {
        value: "catalog.dataset",
        label: "Datasets",
        synonyms: ["dataset", "datasets", "table", "tables"],
        icon: "LuDatabase",
        fieldsDisplay: [],
        actions: [],
    },
    {
        value: "metadata.endpoint",
        label: "Endpoints",
        synonyms: ["endpoint", "endpoints", "source", "connector"],
        icon: "LuShare2",
        fieldsDisplay: [],
        actions: [],
    },
    {
        value: "doc.page",
        label: "Documentation",
        synonyms: ["doc", "docs", "documentation", "runbook"],
        icon: "LuBookOpen",
        fieldsDisplay: [],
        actions: [],
    },
];
const REQUIRED_EDGE_TYPES = [
    {
        value: "DOCUMENTED_BY",
        label: "Documented by",
        synonyms: ["documented", "documentation"],
        icon: "LuFileText",
        actions: [],
    },
    {
        value: "DEPENDENCY_OF",
        label: "Feeds",
        synonyms: ["dependency", "lineage"],
        icon: "LuGitBranch",
        actions: [],
    },
];
const FALLBACK_META = {
    version: "fallback",
    nodeTypes: REQUIRED_NODE_TYPES,
    edgeTypes: REQUIRED_EDGE_TYPES,
};
export function useKbMetaRegistry(metadataEndpoint, token, scope) {
    const scopeKey = useMemo(() => serializeScope(scope), [scope?.projectId ?? null, scope?.domainId ?? null, scope?.teamId ?? null]);
    const cacheKey = useMemo(() => `${metadataEndpoint ?? "none"}::${scopeKey}`, [metadataEndpoint, scopeKey]);
    const [state, setState] = useState(() => ({
        meta: FALLBACK_META,
        loading: Boolean(metadataEndpoint),
        error: null,
        isFallback: true,
    }));
    const load = useCallback(async (force = false) => {
        if (!metadataEndpoint) {
            setState({
                meta: FALLBACK_META,
                loading: false,
                error: "Metadata endpoint unavailable.",
                isFallback: true,
            });
            return;
        }
        setState((prev) => ({ ...prev, loading: true, error: null }));
        try {
            const meta = await fetchMeta(metadataEndpoint, token, sanitizeScope(scope), cacheKey, force);
            setState({ meta, loading: false, error: null, isFallback: false });
        }
        catch (error) {
            setState({
                meta: FALLBACK_META,
                loading: false,
                error: error instanceof Error ? error.message : String(error),
                isFallback: true,
            });
        }
    }, [cacheKey, metadataEndpoint, scopeKey, token, scope]);
    useEffect(() => {
        void load(false);
    }, [load]);
    const refresh = useCallback(() => load(true), [load]);
    const helpers = useMemo(() => createHelpers(state.meta), [state.meta]);
    return {
        ...state,
        ...helpers,
        refresh,
    };
}
async function fetchMeta(metadataEndpoint, token, scope, cacheKey, force) {
    const now = Date.now();
    const cached = metaCache.get(cacheKey);
    if (!force && cached) {
        if (cached.expiresAt > now) {
            return cached.data;
        }
        if (cached.promise) {
            return cached.promise;
        }
    }
    const variables = scope ? { scope } : undefined;
    const promise = fetchMetadataGraphQL(metadataEndpoint, KB_META_QUERY, variables, undefined, { token: token ?? undefined })
        .then((payload) => normalizeMeta(payload.kbMeta))
        .then((meta) => {
        metaCache.set(cacheKey, { data: meta, expiresAt: Date.now() + CACHE_TTL_MS });
        return meta;
    })
        .catch((error) => {
        metaCache.delete(cacheKey);
        throw error;
    });
    metaCache.set(cacheKey, { data: cached?.data ?? FALLBACK_META, expiresAt: 0, promise });
    return promise;
}
function normalizeMeta(meta) {
    const normalizedNodes = ensureRequiredEntries(meta.nodeTypes ?? [], REQUIRED_NODE_TYPES);
    const normalizedEdges = ensureRequiredEntries(meta.edgeTypes ?? [], REQUIRED_EDGE_TYPES);
    return {
        version: meta.version ?? "1.0",
        nodeTypes: normalizedNodes,
        edgeTypes: normalizedEdges,
    };
}
function ensureRequiredEntries(entries, required) {
    const map = new Map(entries.map((entry) => [entry.value, normalizeEntry(entry)]));
    required.forEach((entry) => {
        if (!map.has(entry.value)) {
            map.set(entry.value, normalizeEntry(entry));
        }
    });
    return Array.from(map.values());
}
function normalizeEntry(entry) {
    const label = entry.label?.trim() || humanizeKbIdentifier(entry.value);
    return {
        ...entry,
        label,
        synonyms: dedupeStrings(entry.synonyms ?? []),
        actions: dedupeStrings(entry.actions ?? []),
        fieldsDisplay: dedupeStrings(entry.fieldsDisplay ?? []),
    };
}
function dedupeStrings(list) {
    return Array.from(new Set(list
        .map((value) => value?.trim())
        .filter((value) => Boolean(value && value.length > 0))
        .map((value) => value)));
}
function sanitizeScope(scope) {
    if (!scope) {
        return null;
    }
    const next = {};
    if (scope.projectId?.trim()) {
        next.projectId = scope.projectId.trim();
    }
    if (scope.domainId?.trim()) {
        next.domainId = scope.domainId.trim();
    }
    if (scope.teamId?.trim()) {
        next.teamId = scope.teamId.trim();
    }
    return Object.keys(next).length ? next : null;
}
function serializeScope(scope) {
    const sanitized = sanitizeScope(scope);
    if (!sanitized) {
        return "global";
    }
    return JSON.stringify(sanitized);
}
function createHelpers(meta) {
    const nodesByValue = new Map(meta.nodeTypes.map((node) => [node.value, node]));
    const edgesByValue = new Map(meta.edgeTypes.map((edge) => [edge.value, edge]));
    const nodeSynonyms = buildSynonymIndex(meta.nodeTypes);
    const edgeSynonyms = buildSynonymIndex(meta.edgeTypes);
    const getNodeLabel = (value) => nodesByValue.get(value)?.label ?? humanizeKbIdentifier(value);
    const getEdgeLabel = (value) => edgesByValue.get(value)?.label ?? humanizeKbIdentifier(value);
    const matchNodeSynonym = (term) => {
        const normalized = term.trim().toLowerCase();
        if (!normalized) {
            return null;
        }
        return nodeSynonyms.get(normalized) ?? null;
    };
    const matchEdgeSynonym = (term) => {
        const normalized = term.trim().toLowerCase();
        if (!normalized) {
            return null;
        }
        return edgeSynonyms.get(normalized) ?? null;
    };
    return {
        getNodeLabel,
        getEdgeLabel,
        getNodeMeta: (value) => nodesByValue.get(value) ?? null,
        getEdgeMeta: (value) => edgesByValue.get(value) ?? null,
        matchNodeSynonym,
        matchEdgeSynonym,
        nodeTypes: meta.nodeTypes,
        edgeTypes: meta.edgeTypes,
    };
}
function buildSynonymIndex(entries) {
    const index = new Map();
    entries.forEach((entry) => {
        index.set(entry.label.toLowerCase(), entry);
        entry.synonyms.forEach((synonym) => index.set(synonym.toLowerCase(), entry));
        index.set(entry.value.toLowerCase(), entry);
    });
    return index;
}
