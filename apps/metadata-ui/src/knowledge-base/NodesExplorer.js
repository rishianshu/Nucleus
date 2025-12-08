import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuCheck, LuClipboard, LuExternalLink, LuMap, LuRefreshCcw } from "react-icons/lu";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchMetadataGraphQL } from "../metadata/api";
import { usePagedQuery, useToastQueue, useDebouncedValue } from "../metadata/hooks";
import { KB_NODES_QUERY, KB_NODE_DETAIL_QUERY, KB_SCENE_QUERY } from "./queries";
import { useKbFacets } from "./useKbFacets";
import { KnowledgeBaseGraphView } from "./KnowledgeBaseGraphView";
import { ViewToggle } from "./ViewToggle";
import { copyTextToClipboard } from "./clipboard";
import { useKbMetaRegistry } from "./useKbMeta";
export function NodesExplorer({ metadataEndpoint, authToken }) {
    const navigate = useNavigate();
    const [typeFilter, setTypeFilter] = useState("");
    const [scopeFilters, setScopeFilters] = useState({});
    const [search, setSearch] = useState("");
    const debouncedSearch = useDebouncedValue(search, 400);
    const toastQueue = useToastQueue();
    const [selectedNodeId, setSelectedNodeId] = useState(null);
    const [selectedNode, setSelectedNode] = useState(null);
    const [searchParams, setSearchParams] = useSearchParams();
    const [copiedSourceId, setCopiedSourceId] = useState(null);
    const [copyAnnouncement, setCopyAnnouncement] = useState("");
    const copyResetRef = useRef(null);
    const [viewMode, setViewMode] = useState("list");
    const [sceneLoading, setSceneLoading] = useState(false);
    const [sceneError, setSceneError] = useState(null);
    const [neighborGroups, setNeighborGroups] = useState({
        schema: [],
        work: [],
        docs: [],
        drive: [],
        other: [],
    });
    const handleSelectNode = (nodeId) => {
        setSelectedNodeId(nodeId);
        const next = new URLSearchParams(searchParams);
        next.set("node", nodeId);
        setSearchParams(next, { replace: true });
    };
    const normalizedScope = useMemo(() => {
        const projectId = scopeFilters.projectId?.trim();
        const domainId = scopeFilters.domainId?.trim();
        const teamId = scopeFilters.teamId?.trim();
        return {
            projectId: projectId && projectId.length ? projectId : null,
            domainId: domainId && domainId.length ? domainId : null,
            teamId: teamId && teamId.length ? teamId : null,
        };
    }, [scopeFilters.projectId, scopeFilters.domainId, scopeFilters.teamId]);
    const hasScopeFilters = Boolean(normalizedScope.projectId || normalizedScope.domainId || normalizedScope.teamId);
    const scopeArgument = useMemo(() => (hasScopeFilters ? normalizedScope : null), [hasScopeFilters, normalizedScope]);
    const { getNodeLabel, getEdgeLabel, matchNodeSynonym, error: metaError, isFallback: metaFallback, refresh: refreshMeta, } = useKbMetaRegistry(metadataEndpoint, authToken ?? undefined, normalizedScope);
    const synonymMatch = useMemo(() => {
        if (typeFilter.trim().length > 0) {
            return null;
        }
        const trimmed = debouncedSearch.trim();
        if (!trimmed) {
            return null;
        }
        return matchNodeSynonym(trimmed);
    }, [debouncedSearch, matchNodeSynonym, typeFilter]);
    const activeTypeFilter = typeFilter || synonymMatch?.value || "";
    const synonymLabel = useMemo(() => (synonymMatch ? getNodeLabel(synonymMatch.value) : null), [getNodeLabel, synonymMatch]);
    const nodeQueryVariables = useMemo(() => {
        const searchValue = debouncedSearch.trim();
        return {
            type: activeTypeFilter || null,
            scope: scopeArgument,
            search: searchValue.length ? searchValue : null,
        };
    }, [activeTypeFilter, scopeArgument, debouncedSearch]);
    const { facets, loading: facetsLoading, error: facetsError, refresh: refreshFacets } = useKbFacets(metadataEndpoint, authToken ?? undefined, normalizedScope);
    const selectNodesConnection = useCallback((payload) => {
        if (!payload?.kbNodes) {
            return null;
        }
        return {
            nodes: (payload.kbNodes.edges ?? []).map((edge) => edge.node),
            pageInfo: payload.kbNodes.pageInfo ?? {},
        };
    }, []);
    const pagedQuery = usePagedQuery({
        metadataEndpoint,
        token: authToken ?? undefined,
        query: KB_NODES_QUERY,
        pageSize: 25,
        variables: nodeQueryVariables,
        selectConnection: selectNodesConnection,
        deps: [metadataEndpoint, authToken, nodeQueryVariables],
    });
    const handleCopy = useCallback(async (event, logicalKey, sourceId) => {
        event?.stopPropagation();
        if (!logicalKey) {
            toastQueue.pushToast({ title: "Logical key unavailable", intent: "error" });
            return;
        }
        const copied = await copyTextToClipboard(logicalKey);
        if (!copied) {
            toastQueue.pushToast({ title: "Copy failed. Try again.", intent: "error" });
        }
        setCopiedSourceId(sourceId);
        setCopyAnnouncement(copied ? "Logical key copied" : "");
        if (copyResetRef.current) {
            window.clearTimeout(copyResetRef.current);
        }
        copyResetRef.current = window.setTimeout(() => {
            setCopiedSourceId(null);
            setCopyAnnouncement("");
        }, 1200);
    }, [toastQueue]);
    useEffect(() => {
        return () => {
            if (copyResetRef.current) {
                window.clearTimeout(copyResetRef.current);
            }
        };
    }, []);
    const graphNodes = useMemo(() => pagedQuery.items.map((node) => ({
        id: node.id,
        label: node.displayName ?? getNodeLabel(node.entityType),
    })), [getNodeLabel, pagedQuery.items]);
    useEffect(() => {
        const preselected = searchParams.get("node");
        if (preselected && preselected !== selectedNodeId) {
            setSelectedNodeId(preselected);
        }
    }, [searchParams]);
    useEffect(() => {
        if (!selectedNodeId) {
            setSelectedNode(null);
            setNeighborGroups({ schema: [], work: [], docs: [], drive: [], other: [] });
            return;
        }
        let cancelled = false;
        if (!metadataEndpoint) {
            return () => {
                cancelled = true;
            };
        }
        fetchMetadataGraphQL(metadataEndpoint, KB_NODE_DETAIL_QUERY, { id: selectedNodeId }, undefined, { token: authToken ?? undefined })
            .then((payload) => {
            if (!cancelled) {
                setSelectedNode(payload.kbNode ?? null);
            }
        })
            .catch(() => {
            if (!cancelled) {
                setSelectedNode(null);
                setNeighborGroups({ schema: [], work: [], docs: [], drive: [], other: [] });
            }
        });
        return () => {
            cancelled = true;
        };
    }, [authToken, metadataEndpoint, selectedNodeId]);
    useEffect(() => {
        const fetchScene = async (nodeId) => {
            setSceneLoading(true);
            setSceneError(null);
            try {
                const payload = await fetchMetadataGraphQL(metadataEndpoint, KB_SCENE_QUERY, { id: nodeId, edgeTypes: null, depth: 1, limit: 200 }, undefined, { token: authToken ?? undefined });
                const scene = payload.kbScene;
                const nodeMap = new Map(scene.nodes.map((n) => [n.id, n]));
                const grouped = { schema: [], work: [], docs: [], drive: [], other: [] };
                scene.edges.forEach((edge) => {
                    const sourceIsSelected = edge.sourceEntityId === nodeId;
                    const targetIsSelected = edge.targetEntityId === nodeId;
                    if (!sourceIsSelected && !targetIsSelected) {
                        return;
                    }
                    const neighborId = sourceIsSelected ? edge.targetEntityId : edge.sourceEntityId;
                    const neighborNode = nodeMap.get(neighborId);
                    if (!neighborNode) {
                        return;
                    }
                    const direction = sourceIsSelected ? "out" : "in";
                    const bucket = pickRelationBucket(edge.edgeType);
                    grouped[bucket].push({ node: neighborNode, edgeType: edge.edgeType, direction, metadata: edge.metadata ?? null });
                });
                setNeighborGroups(grouped);
            }
            catch (err) {
                setSceneError(err instanceof Error ? err.message : String(err));
                setNeighborGroups({ schema: [], work: [], docs: [], drive: [], other: [] });
            }
            finally {
                setSceneLoading(false);
            }
        };
        if (metadataEndpoint && selectedNodeId) {
            void fetchScene(selectedNodeId);
        }
    }, [authToken, metadataEndpoint, selectedNodeId]);
    if (!metadataEndpoint) {
        return _jsx("p", { className: "text-sm text-slate-500", children: "Metadata endpoint not configured." });
    }
    return (_jsxs("div", { className: "flex h-full min-h-0 gap-6", children: [_jsx("div", { role: "status", "aria-live": "polite", className: "sr-only", children: copyAnnouncement }), _jsxs("div", { className: "flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: [_jsxs("div", { className: "mb-3 flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500", children: "View" }), _jsx("p", { className: "text-lg font-semibold text-slate-900 dark:text-white", children: "Nodes explorer" })] }), _jsx(ViewToggle, { value: viewMode, onChange: setViewMode, disableGraph: !graphNodes.length })] }), _jsxs("div", { className: "flex flex-wrap items-end gap-4", children: [_jsxs("div", { className: "flex flex-1 flex-col", children: [_jsx("label", { htmlFor: "kb-node-type", className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Type" }), _jsxs("select", { id: "kb-node-type", value: typeFilter, onChange: (event) => setTypeFilter(event.target.value), className: "mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100", "data-testid": "kb-node-type-filter", children: [_jsx("option", { value: "", children: "All types" }), (facets?.nodeTypes ?? []).map((facet) => (_jsxs("option", { value: facet.value, children: [facet.label, " (", facet.count, ")"] }, facet.value)))] })] }), _jsx(ScopeInput, { label: "Project", value: scopeFilters.projectId ?? "", onChange: (value) => setScopeFilters((prev) => ({ ...prev, projectId: value })), options: facets?.projects }), _jsx(ScopeInput, { label: "Domain", value: scopeFilters.domainId ?? "", onChange: (value) => setScopeFilters((prev) => ({ ...prev, domainId: value })), options: facets?.domains }), _jsx(ScopeInput, { label: "Team", value: scopeFilters.teamId ?? "", onChange: (value) => setScopeFilters((prev) => ({ ...prev, teamId: value })), options: facets?.teams }), _jsxs("div", { className: "flex flex-1 flex-col", children: [_jsx("label", { htmlFor: "kb-node-search", className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Search" }), _jsx("input", { id: "kb-node-search", type: "search", value: search, onChange: (event) => setSearch(event.target.value), placeholder: "Search by display name or path", className: "mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" }), synonymLabel && !typeFilter && debouncedSearch.trim().length > 0 ? (_jsxs("p", { className: "mt-1 text-xs text-slate-500", "data-testid": "kb-node-search-synonym", children: ["Synonym matched ", _jsx("span", { className: "font-semibold text-slate-900 dark:text-slate-100", children: synonymLabel }), ". Filtering by that type."] })) : null] }), _jsxs("button", { type: "button", onClick: () => pagedQuery.refresh(), className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: [_jsx(LuRefreshCcw, { className: "h-4 w-4" }), " Refresh"] })] }), metaError && metaFallback ? (_jsxs("p", { className: "mt-2 text-xs text-amber-600 dark:text-amber-400", "data-testid": "kb-meta-warning", children: [metaError, " \u2014 showing canonical values.", " ", _jsx("button", { type: "button", onClick: () => refreshMeta(), className: "underline", children: "Retry" })] })) : null, facetsError ? (_jsxs("p", { className: "mt-2 text-xs text-rose-500", children: ["Failed to load filters: ", facetsError, " ", _jsx("button", { type: "button", onClick: () => refreshFacets(), className: "underline", children: "Retry" })] })) : null, _jsx("div", { className: "mt-4 flex-1 overflow-auto", children: viewMode === "graph" ? (_jsx(KnowledgeBaseGraphView, { nodes: graphNodes, edges: [], selectedNodeId: selectedNodeId, onSelectNode: (id) => handleSelectNode(id), isRefreshing: pagedQuery.isRefetching })) : (_jsxs(_Fragment, { children: [pagedQuery.error ? (_jsx("p", { className: "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100", children: pagedQuery.error })) : null, pagedQuery.loading && pagedQuery.items.length === 0 ? (_jsx("p", { className: "text-sm text-slate-500", children: "Loading nodes\u2026" })) : null, !pagedQuery.loading && pagedQuery.items.length === 0 ? (_jsx("p", { className: "text-sm text-slate-500", children: "No nodes match the current filters." })) : null, pagedQuery.items.length > 0 ? (_jsxs("table", { className: "mt-2 w-full table-auto text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "text-left text-xs uppercase tracking-[0.3em] text-slate-500", children: [_jsx("th", { className: "px-2 py-2", children: "Type" }), _jsx("th", { className: "px-2 py-2", children: "Display" }), _jsx("th", { className: "px-2 py-2", children: "Scope" }), _jsx("th", { className: "px-2 py-2", children: "Updated" }), _jsx("th", { className: "px-2 py-2", children: "Identity" })] }) }), _jsxs("tbody", { children: [pagedQuery.items.map((node, index) => {
                                                    const rowCopyKey = `node-row-${index}`;
                                                    const isSelected = node.id === selectedNodeId;
                                                    const typeLabel = getNodeLabel(node.entityType);
                                                    const isCopied = copiedSourceId === rowCopyKey;
                                                    return (_jsxs("tr", { className: `cursor-pointer border-t border-slate-100 text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/40 ${isSelected ? "bg-slate-100 dark:bg-slate-800/60" : ""}`, onClick: () => handleSelectNode(node.id), children: [_jsx("td", { className: "px-2 py-2", children: _jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-semibold text-slate-900 dark:text-white", children: typeLabel }), _jsx("span", { className: "text-[10px] uppercase tracking-[0.3em] text-slate-400", children: node.entityType })] }) }), _jsx("td", { className: "px-2 py-2", children: _jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-semibold text-slate-900 dark:text-white", children: node.displayName }), _jsx("span", { className: "text-xs text-slate-500 dark:text-slate-400", children: node.canonicalPath ?? "—" })] }) }), _jsx("td", { className: "px-2 py-2 text-xs text-slate-500", children: _jsx(ScopeChips, { scope: node.scope }) }), _jsx("td", { className: "px-2 py-2 text-xs text-slate-500", children: new Date(node.updatedAt).toLocaleString() }), _jsx("td", { className: "px-2 py-2 text-xs text-slate-500", children: _jsxs("button", { type: "button", className: `inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.4em] transition ${isCopied
                                                                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:border-emerald-400 dark:text-emerald-300"
                                                                        : "border-slate-300 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"}`, onClick: (event) => handleCopy(event, node.identity.logicalKey ?? node.id, rowCopyKey), "data-testid": "kb-node-copy-button", children: [isCopied ? _jsx(LuCheck, { className: "h-3 w-3" }) : _jsx(LuClipboard, { className: "h-3 w-3" }), " ", isCopied ? "Copied" : "Copy"] }) })] }, node.id));
                                                }), pagedQuery.loading ? _jsx(SkeletonRows, { columns: 5, count: Math.max(3, pagedQuery.items.length ? 2 : 4) }) : null] })] })) : null] })) }), pagedQuery.pageInfo.hasNextPage ? (_jsx("button", { type: "button", onClick: () => pagedQuery.fetchNext(), className: "mt-4 inline-flex items-center gap-2 self-start rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: "Load more" })) : null] }), _jsx("aside", { className: "w-96 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", "data-testid": "kb-node-detail-panel", children: selectedNode ? (_jsx(NodeDetail, { node: selectedNode, neighbors: neighborGroups, sceneLoading: sceneLoading, sceneError: sceneError, getEdgeLabel: getEdgeLabel, onOpenScenes: () => navigate(`/kb/scenes?node=${selectedNode.id}`), onOpenProvenance: () => navigate(`/kb/provenance?node=${selectedNode.id}`), onOpenExplorer: () => navigate(`/kb/explorer/nodes?node=${selectedNode.id}`), onCopyLogicalKey: () => handleCopy(null, selectedNode.identity.logicalKey ?? selectedNode.id, `detail-${selectedNode.id}`), isCopied: copiedSourceId === `detail-${selectedNode.id}` })) : (_jsx("p", { className: "text-sm text-slate-500", children: "Select a node to view identity and provenance details." })) })] }));
}
function ScopeChips({ scope }) {
    const chips = [scope.projectId, scope.domainId, scope.teamId].filter(Boolean);
    if (chips.length === 0) {
        return _jsxs("span", { children: ["org:", scope.orgId] });
    }
    return (_jsx("div", { className: "flex flex-wrap gap-1", children: chips.map((chip) => (_jsx("span", { className: "rounded-full border border-slate-200 px-2 py-0.5 text-[10px] uppercase tracking-[0.4em] text-slate-500 dark:border-slate-700", children: chip }, chip))) }));
}
function pickRelationBucket(edgeType) {
    if (edgeType.startsWith("rel.contains") || edgeType === "rel.pk_of" || edgeType === "rel.fk_references") {
        return "schema";
    }
    if (edgeType === "rel.work_links_work") {
        return "work";
    }
    if (edgeType === "rel.doc_contains_attachment" || edgeType.startsWith("rel.doc_links")) {
        return "docs";
    }
    if (edgeType.startsWith("rel.drive_")) {
        return "drive";
    }
    return "other";
}
function ScopeInput({ label, value, onChange, options, }) {
    const hasOptions = Boolean(options?.length);
    return (_jsxs("div", { className: "flex flex-col", children: [_jsx("label", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: label }), hasOptions ? (_jsxs("select", { value: value, onChange: (event) => onChange(event.target.value), className: "mt-1 w-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100", "data-testid": `kb-scope-${label.toLowerCase()}`, children: [_jsx("option", { value: "", children: `All ${label.toLowerCase()}` }), (options ?? []).map((option) => (_jsxs("option", { value: option.value, children: [option.label, " ", typeof option.count === "number" ? `(${option.count})` : ""] }, option.value)))] })) : (_jsx("input", { type: "text", value: value, onChange: (event) => onChange(event.target.value), className: "mt-1 w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" }))] }));
}
function NodeDetail({ node, neighbors, sceneLoading, sceneError, getEdgeLabel, onOpenScenes, onOpenProvenance, onOpenExplorer, onCopyLogicalKey, isCopied = false, }) {
    return (_jsxs("div", { className: "flex h-full flex-col gap-4", children: [_jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Node" }), _jsx("p", { className: "text-lg font-semibold text-slate-900 dark:text-white", children: node.displayName }), _jsx("p", { className: "text-xs text-slate-500 dark:text-slate-400", children: node.entityType })] }), _jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Relations" }), sceneLoading ? _jsx("p", { className: "text-xs text-slate-500", children: "Loading relations\u2026" }) : null, sceneError ? _jsx("p", { className: "text-xs text-rose-500", children: sceneError }) : null, !sceneLoading && !sceneError ? (_jsxs("div", { className: "mt-2 space-y-3", children: [_jsx(NeighborSection, { title: "Schema", neighbors: neighbors.schema, getEdgeLabel: getEdgeLabel }), _jsx(NeighborSection, { title: "Work links", neighbors: neighbors.work, getEdgeLabel: getEdgeLabel }), _jsx(NeighborSection, { title: "Docs", neighbors: neighbors.docs, getEdgeLabel: getEdgeLabel }), _jsx(NeighborSection, { title: "Drive", neighbors: neighbors.drive, getEdgeLabel: getEdgeLabel }), _jsx(NeighborSection, { title: "Other", neighbors: neighbors.other, getEdgeLabel: getEdgeLabel })] })) : null] }), _jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Logical key" }), _jsxs("button", { type: "button", onClick: onCopyLogicalKey, className: `inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.4em] transition ${isCopied
                                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:border-emerald-400 dark:text-emerald-200"
                                    : "border-slate-300 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"}`, "data-testid": "kb-node-detail-copy", children: [isCopied ? _jsx(LuCheck, { className: "h-3 w-3" }) : _jsx(LuClipboard, { className: "h-3 w-3" }), " ", isCopied ? "Copied" : "Copy"] })] }), _jsx("p", { className: "break-all text-sm text-slate-900 dark:text-white", children: node.identity.logicalKey ?? node.id })] }), _jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Scope" }), _jsx(ScopeChips, { scope: node.scope })] }), _jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Provenance" }), _jsx("pre", { className: "mt-1 max-h-48 overflow-auto rounded-lg bg-slate-900/80 px-3 py-2 text-xs text-slate-100", children: JSON.stringify(node.provenance ?? node.identity.provenance ?? {}, null, 2) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Actions" }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsxs("button", { type: "button", onClick: onOpenScenes, className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: [_jsx(LuMap, { className: "h-4 w-4" }), " Scenes"] }), _jsx("button", { type: "button", onClick: onOpenProvenance, className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover-border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: "Provenance" }), _jsxs("button", { type: "button", onClick: onOpenExplorer, className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: [_jsx(LuExternalLink, { className: "h-4 w-4" }), " Open in explorer"] })] })] }), _jsx("div", { className: "mt-auto text-xs text-slate-500", children: _jsxs("span", { children: ["Last updated ", new Date(node.updatedAt).toLocaleString()] }) })] }));
}
function NeighborSection({ title, neighbors, getEdgeLabel, }) {
    if (!neighbors.length) {
        return (_jsxs("div", { children: [_jsx("p", { className: "text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-500", children: title }), _jsx("p", { className: "text-xs text-slate-500", children: "No relations yet." })] }));
    }
    return (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("p", { className: "text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-500", children: title }), _jsx("span", { className: "text-[10px] uppercase tracking-[0.3em] text-slate-400", children: neighbors.length })] }), _jsx("div", { className: "mt-2 space-y-2", children: neighbors.map((neighbor, index) => {
                    const metaBadges = buildNeighborMetadataTags(neighbor.edgeType, neighbor.metadata);
                    return (_jsx("div", { className: "rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800", children: _jsxs("div", { className: "flex items-start justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-sm font-semibold text-slate-900 dark:text-slate-100", children: neighbor.node.displayName ?? neighbor.node.id }), _jsx("p", { className: "text-[11px] uppercase tracking-[0.3em] text-slate-500", children: neighbor.node.entityType })] }), _jsxs("div", { className: "flex flex-wrap gap-1 text-[10px] uppercase tracking-[0.3em] text-slate-500", children: [_jsx("span", { className: "rounded-full border border-slate-300 px-2 py-0.5 dark:border-slate-700", children: neighbor.direction === "out" ? "Outbound" : "Inbound" }), _jsx("span", { className: "rounded-full border border-slate-300 px-2 py-0.5 dark:border-slate-700", children: getEdgeLabel(neighbor.edgeType) }), metaBadges.map((badge) => (_jsx("span", { className: "rounded-full border border-slate-300 px-2 py-0.5 dark:border-slate-700", children: badge }, badge)))] })] }) }, `${neighbor.node.id}-${neighbor.edgeType}-${neighbor.direction}-${index}`));
                }) })] }));
}
function buildNeighborMetadataTags(edgeType, metadata) {
    if (!metadata) {
        return [];
    }
    const tags = [];
    const linkType = (metadata.link_type ?? metadata.linkType);
    if (linkType && typeof linkType === "string") {
        tags.push(`link:${linkType}`);
    }
    const attachmentId = (metadata.attachment_id ?? metadata.attachmentId);
    if (attachmentId && typeof attachmentId === "string") {
        tags.push(`attachment:${attachmentId}`);
    }
    const role = metadata.role;
    if (role && typeof role === "string") {
        tags.push(`role:${role}`);
    }
    const inherited = metadata.inherited;
    if (typeof inherited === "boolean") {
        tags.push(inherited ? "inherited" : "direct");
    }
    const isFolder = (metadata.is_folder ?? metadata.isFolder);
    if (typeof isFolder === "boolean") {
        tags.push(isFolder ? "folder" : "file");
    }
    if (tags.length === 0 && metadata.source_system && typeof metadata.source_system === "string") {
        tags.push(metadata.source_system);
    }
    return tags;
}
function SkeletonRows({ columns, count }) {
    return (_jsx(_Fragment, { children: Array.from({ length: count }).map((_, rowIndex) => (_jsx("tr", { className: "animate-pulse border-t border-slate-100 dark:border-slate-800", children: Array.from({ length: columns }).map((__, colIndex) => (_jsx("td", { className: "px-2 py-3", children: _jsx("div", { className: "h-4 w-full rounded bg-slate-200/70 dark:bg-slate-700/50" }) }, colIndex))) }, `kb-node-skeleton-${rowIndex}`))) }));
}
