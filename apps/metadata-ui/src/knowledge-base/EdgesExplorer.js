import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuCheck, LuClipboard, LuExternalLink, LuMap, LuRefreshCcw } from "react-icons/lu";
import { useNavigate } from "react-router-dom";
import { usePagedQuery, useToastQueue } from "../metadata/hooks";
import { KB_EDGES_QUERY } from "./queries";
import { useKbFacets } from "./useKbFacets";
import { KnowledgeBaseGraphView } from "./KnowledgeBaseGraphView";
import { ViewToggle } from "./ViewToggle";
import { copyTextToClipboard } from "./clipboard";
import { useKbMetaRegistry } from "./useKbMeta";
export function EdgesExplorer({ metadataEndpoint, authToken }) {
    const [edgeType, setEdgeType] = useState("");
    const [scopeFilters, setScopeFilters] = useState({});
    const [sourceId, setSourceId] = useState("");
    const [targetId, setTargetId] = useState("");
    const toastQueue = useToastQueue();
    const navigate = useNavigate();
    const [selectedEdge, setSelectedEdge] = useState(null);
    const [copiedEdgeId, setCopiedEdgeId] = useState(null);
    const [copyAnnouncement, setCopyAnnouncement] = useState("");
    const copyResetRef = useRef(null);
    const [viewMode, setViewMode] = useState("list");
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
    const edgeQueryVariables = useMemo(() => {
        const sourceValue = sourceId.trim();
        const targetValue = targetId.trim();
        return {
            edgeType: edgeType || null,
            scope: scopeArgument,
            sourceId: sourceValue.length ? sourceValue : null,
            targetId: targetValue.length ? targetValue : null,
        };
    }, [edgeType, scopeArgument, sourceId, targetId]);
    const { facets, loading: facetsLoading, error: facetsError, refresh: refreshFacets } = useKbFacets(metadataEndpoint, authToken ?? undefined, normalizedScope);
    const { getEdgeLabel, error: metaError, isFallback: metaFallback, refresh: refreshMeta } = useKbMetaRegistry(metadataEndpoint, authToken ?? undefined, normalizedScope);
    const selectEdgesConnection = useCallback((payload) => {
        if (!payload?.kbEdges) {
            return null;
        }
        return {
            nodes: (payload.kbEdges.edges ?? []).map((edge) => edge.node),
            pageInfo: payload.kbEdges.pageInfo ?? {},
        };
    }, []);
    const pagedQuery = usePagedQuery({
        metadataEndpoint,
        token: authToken ?? undefined,
        query: KB_EDGES_QUERY,
        pageSize: 25,
        variables: edgeQueryVariables,
        selectConnection: selectEdgesConnection,
        deps: [metadataEndpoint, authToken, edgeQueryVariables],
    });
    useEffect(() => {
        if (!selectedEdge && pagedQuery.items.length > 0) {
            setSelectedEdge(pagedQuery.items[0]);
        }
    }, [pagedQuery.items, selectedEdge]);
    const handleCopy = useCallback(async (event, logicalKey, edgeId) => {
        event?.stopPropagation();
        if (!logicalKey) {
            toastQueue.pushToast({ title: "Logical key unavailable", intent: "error" });
            return;
        }
        const copied = await copyTextToClipboard(logicalKey);
        if (!copied) {
            toastQueue.pushToast({ title: "Copy failed. Try again.", intent: "error" });
        }
        setCopiedEdgeId(edgeId);
        setCopyAnnouncement(copied ? "Edge logical key copied" : "");
        if (copyResetRef.current) {
            window.clearTimeout(copyResetRef.current);
        }
        copyResetRef.current = window.setTimeout(() => {
            setCopiedEdgeId(null);
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
    const graphNodes = useMemo(() => {
        const map = new Map();
        pagedQuery.items.forEach((edge) => {
            if (!map.has(edge.sourceEntityId)) {
                map.set(edge.sourceEntityId, { id: edge.sourceEntityId, label: edge.sourceEntityId });
            }
            if (!map.has(edge.targetEntityId)) {
                map.set(edge.targetEntityId, { id: edge.targetEntityId, label: edge.targetEntityId });
            }
        });
        return Array.from(map.values());
    }, [pagedQuery.items]);
    const graphEdges = useMemo(() => pagedQuery.items.map((edge) => ({
        id: edge.id,
        sourceId: edge.sourceEntityId,
        targetId: edge.targetEntityId,
    })), [pagedQuery.items]);
    if (!metadataEndpoint) {
        return _jsx("p", { className: "text-sm text-slate-500", children: "Metadata endpoint not configured." });
    }
    return (_jsxs("div", { className: "flex h-full min-h-0 gap-6", children: [_jsx("div", { role: "status", "aria-live": "polite", className: "sr-only", children: copyAnnouncement }), _jsxs("div", { className: "flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: [_jsxs("div", { className: "mb-3 flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500", children: "View" }), _jsx("p", { className: "text-lg font-semibold text-slate-900 dark:text-white", children: "Edges explorer" })] }), _jsx(ViewToggle, { value: viewMode, onChange: setViewMode, disableGraph: !graphNodes.length || !graphEdges.length })] }), _jsxs("div", { className: "flex flex-wrap items-end gap-4", children: [_jsxs("div", { className: "flex flex-col", children: [_jsx("label", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Edge type" }), _jsxs("select", { value: edgeType, onChange: (event) => setEdgeType(event.target.value), className: "mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100", "data-testid": "kb-edge-type-filter", children: [_jsx("option", { value: "", children: "All" }), (facets?.edgeTypes ?? []).map((facet) => (_jsxs("option", { value: facet.value, children: [getEdgeLabel(facet.value), " (", facet.count, ")"] }, facet.value)))] })] }), _jsx(ScopeInput, { label: "Project", value: scopeFilters.projectId ?? "", onChange: (value) => setScopeFilters((prev) => ({ ...prev, projectId: value })), options: facets?.projects }), _jsx(ScopeInput, { label: "Domain", value: scopeFilters.domainId ?? "", onChange: (value) => setScopeFilters((prev) => ({ ...prev, domainId: value })), options: facets?.domains }), _jsx(ScopeInput, { label: "Team", value: scopeFilters.teamId ?? "", onChange: (value) => setScopeFilters((prev) => ({ ...prev, teamId: value })), options: facets?.teams }), _jsx(TextInput, { label: "Source node", value: sourceId, onChange: setSourceId, placeholder: "Node ID" }), _jsx(TextInput, { label: "Target node", value: targetId, onChange: setTargetId, placeholder: "Node ID" }), _jsxs("button", { type: "button", onClick: () => pagedQuery.refresh(), className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: [_jsx(LuRefreshCcw, { className: "h-4 w-4" }), " Refresh"] })] }), metaError && metaFallback ? (_jsxs("p", { className: "mt-2 text-xs text-amber-600 dark:text-amber-400", "data-testid": "kb-meta-warning", children: [metaError, " \u2014 showing canonical values.", " ", _jsx("button", { type: "button", onClick: () => refreshMeta(), className: "underline", children: "Retry" })] })) : null, facetsError ? (_jsxs("p", { className: "mt-2 text-xs text-rose-500", children: ["Failed to load edge filters: ", facetsError, " ", _jsx("button", { type: "button", onClick: () => refreshFacets(), className: "underline", children: "Retry" })] })) : null, _jsx("div", { className: "mt-4 flex-1 overflow-auto", children: viewMode === "graph" ? (_jsx(KnowledgeBaseGraphView, { nodes: graphNodes, edges: graphEdges, selectedNodeId: selectedEdge?.sourceEntityId, selectedEdgeId: selectedEdge?.id ?? null, onSelectNode: (nodeId) => {
                                navigate(`/kb/explorer/nodes?node=${nodeId}`);
                            }, onSelectEdge: (edgeId) => {
                                const match = pagedQuery.items.find((edge) => edge.id === edgeId);
                                if (match) {
                                    setSelectedEdge(match);
                                }
                            }, isRefreshing: pagedQuery.isRefetching })) : (_jsxs(_Fragment, { children: [pagedQuery.error ? (_jsx("p", { className: "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100", children: pagedQuery.error })) : null, pagedQuery.loading && pagedQuery.items.length === 0 ? _jsx("p", { className: "text-sm text-slate-500", children: "Loading edges\u2026" }) : null, !pagedQuery.loading && pagedQuery.items.length === 0 ? (_jsx("p", { className: "text-sm text-slate-500", children: "No edges match the current filters." })) : null, pagedQuery.items.length > 0 ? (_jsxs("table", { className: "mt-2 w-full table-auto text-sm", "data-testid": "kb-edges-table", children: [_jsx("thead", { children: _jsxs("tr", { className: "text-left text-xs uppercase tracking-[0.3em] text-slate-500", children: [_jsx("th", { className: "px-2 py-2", children: "Type" }), _jsx("th", { className: "px-2 py-2", children: "Source" }), _jsx("th", { className: "px-2 py-2", children: "Target" }), _jsx("th", { className: "px-2 py-2", children: "Updated" }), _jsx("th", { className: "px-2 py-2", children: "Identity" })] }) }), _jsxs("tbody", { children: [pagedQuery.items.map((edge, index) => {
                                                    const rowCopyKey = `edge-row-${index}`;
                                                    const isSelected = selectedEdge?.id === edge.id;
                                                    const isCopied = copiedEdgeId === rowCopyKey;
                                                    const typeLabel = getEdgeLabel(edge.edgeType);
                                                    return (_jsxs("tr", { className: `border-t border-slate-100 text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/40 ${isSelected ? "bg-slate-100 dark:bg-slate-800/60" : ""}`, onClick: () => setSelectedEdge(edge), children: [_jsx("td", { className: "px-2 py-2", children: _jsxs("div", { className: "flex flex-col", children: [_jsx("span", { className: "font-semibold text-slate-900 dark:text-white", children: typeLabel }), _jsx("span", { className: "text-[10px] uppercase tracking-[0.3em] text-slate-400", children: edge.edgeType })] }) }), _jsx("td", { className: "px-2 py-2 text-xs text-slate-500", children: _jsx("button", { type: "button", onClick: (event) => {
                                                                        event.stopPropagation();
                                                                        navigate(`/kb/explorer/nodes?node=${edge.sourceEntityId}`);
                                                                    }, className: "rounded-full border border-slate-300 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: edge.sourceEntityId }) }), _jsx("td", { className: "px-2 py-2 text-xs text-slate-500", children: _jsx("button", { type: "button", onClick: (event) => {
                                                                        event.stopPropagation();
                                                                        navigate(`/kb/explorer/nodes?node=${edge.targetEntityId}`);
                                                                    }, className: "rounded-full border border-slate-300 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: edge.targetEntityId }) }), _jsx("td", { className: "px-2 py-2 text-xs text-slate-500", children: new Date(edge.updatedAt).toLocaleString() }), _jsx("td", { className: "px-2 py-2 text-xs text-slate-500", children: _jsxs("button", { type: "button", className: `inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.4em] transition ${isCopied
                                                                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:border-emerald-400 dark:text-emerald-200"
                                                                        : "border-slate-300 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"}`, onClick: (event) => handleCopy(event, edge.identity.logicalKey ?? edge.id, rowCopyKey), "data-testid": "kb-edge-copy-button", children: [isCopied ? _jsx(LuCheck, { className: "h-3 w-3" }) : _jsx(LuClipboard, { className: "h-3 w-3" }), " ", isCopied ? "Copied" : "Copy"] }) })] }, edge.id));
                                                }), pagedQuery.loading ? _jsx(SkeletonRows, { columns: 5, count: Math.max(3, pagedQuery.items.length ? 2 : 4) }) : null] })] })) : null] })) }), pagedQuery.pageInfo.hasNextPage ? (_jsx("button", { type: "button", onClick: () => pagedQuery.fetchNext(), className: "mt-4 inline-flex items-center gap-2 self-start rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: "Load more" })) : null] }), _jsx("aside", { className: "w-96 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", "data-testid": "kb-edge-detail-panel", children: selectedEdge ? (_jsx(EdgeDetail, { edge: selectedEdge, edgeLabel: getEdgeLabel(selectedEdge.edgeType), onOpenSource: () => navigate(`/kb/explorer/nodes?node=${selectedEdge.sourceEntityId}`), onOpenTarget: () => navigate(`/kb/explorer/nodes?node=${selectedEdge.targetEntityId}`), onSourceScene: () => navigate(`/kb/scenes?node=${selectedEdge.sourceEntityId}`), onTargetScene: () => navigate(`/kb/scenes?node=${selectedEdge.targetEntityId}`), onCopyLogicalKey: () => handleCopy(null, selectedEdge.identity.logicalKey ?? selectedEdge.id, `detail-${selectedEdge.id}`), isCopied: copiedEdgeId === `detail-${selectedEdge.id}` })) : (_jsx("p", { className: "text-sm text-slate-500", children: "Select an edge to view details." })) })] }));
}
function ScopeInput({ label, value, onChange, options, }) {
    const hasOptions = Boolean(options?.length);
    return (_jsxs("div", { className: "flex flex-col", children: [_jsx("label", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: label }), hasOptions ? (_jsxs("select", { value: value, onChange: (event) => onChange(event.target.value), className: "mt-1 w-36 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100", children: [_jsx("option", { value: "", children: `All ${label.toLowerCase()}` }), (options ?? []).map((option) => (_jsxs("option", { value: option.value, children: [option.label, " ", typeof option.count === "number" ? `(${option.count})` : ""] }, option.value)))] })) : (_jsx("input", { type: "text", value: value, onChange: (event) => onChange(event.target.value), className: "mt-1 w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" }))] }));
}
function TextInput({ label, value, onChange, placeholder }) {
    return (_jsxs("div", { className: "flex flex-col", children: [_jsx("label", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: label }), _jsx("input", { type: "text", value: value, onChange: (event) => onChange(event.target.value), placeholder: placeholder, className: "mt-1 w-36 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" })] }));
}
function EdgeDetail({ edge, edgeLabel, onOpenSource, onOpenTarget, onSourceScene, onTargetScene, onCopyLogicalKey, isCopied = false, }) {
    return (_jsxs("div", { className: "space-y-3 text-sm text-slate-700 dark:text-slate-200", children: [_jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Edge type" }), _jsx("p", { className: "text-lg font-semibold text-slate-900 dark:text-white", children: edgeLabel }), _jsx("p", { className: "text-[10px] uppercase tracking-[0.3em] text-slate-400", children: edge.edgeType })] }), _jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Source" }), _jsx("p", { className: "break-all text-slate-900 dark:text-white", children: edge.sourceEntityId })] }), _jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Target" }), _jsx("p", { className: "break-all text-slate-900 dark:text-white", children: edge.targetEntityId })] }), _jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Scope" }), _jsx(ScopeChips, { scope: edge.scope })] }), _jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Logical key" }), _jsxs("button", { type: "button", onClick: onCopyLogicalKey, className: `inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.4em] transition ${isCopied
                                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:border-emerald-400 dark:text-emerald-200"
                                    : "border-slate-300 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"}`, "data-testid": "kb-edge-detail-copy", children: [isCopied ? _jsx(LuCheck, { className: "h-3 w-3" }) : _jsx(LuClipboard, { className: "h-3 w-3" }), " ", isCopied ? "Copied" : "Copy"] })] }), _jsx("p", { className: "break-all text-slate-900 dark:text-white", children: edge.identity.logicalKey ?? edge.id })] }), _jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Actions" }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsxs("button", { type: "button", onClick: onOpenSource, className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: [_jsx(LuExternalLink, { className: "h-4 w-4" }), " Source node"] }), _jsxs("button", { type: "button", onClick: onOpenTarget, className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: [_jsx(LuExternalLink, { className: "h-4 w-4" }), " Target node"] }), _jsxs("button", { type: "button", onClick: onSourceScene, className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: [_jsx(LuMap, { className: "h-4 w-4" }), " Source scene"] }), _jsxs("button", { type: "button", onClick: onTargetScene, className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: [_jsx(LuMap, { className: "h-4 w-4" }), " Target scene"] })] })] }), _jsxs("div", { className: "text-xs text-slate-500", children: ["Updated ", new Date(edge.updatedAt).toLocaleString()] })] }));
}
function SkeletonRows({ columns, count }) {
    return (_jsx(_Fragment, { children: Array.from({ length: count }).map((_, rowIndex) => (_jsx("tr", { className: "animate-pulse border-t border-slate-100 dark:border-slate-800", children: Array.from({ length: columns }).map((__, colIndex) => (_jsx("td", { className: "px-2 py-3", children: _jsx("div", { className: "h-4 w-full rounded bg-slate-200/70 dark:bg-slate-700/50" }) }, colIndex))) }, `kb-edge-skeleton-${rowIndex}`))) }));
}
function ScopeChips({ scope }) {
    const chips = [scope.projectId, scope.domainId, scope.teamId].filter(Boolean);
    if (chips.length === 0) {
        return _jsxs("span", { children: ["org:", scope.orgId] });
    }
    return (_jsx("div", { className: "flex flex-wrap gap-1", children: chips.map((chip) => (_jsx("span", { className: "rounded-full border border-slate-200 px-2 py-0.5 text-[10px] uppercase tracking-[0.4em] text-slate-500 dark:border-slate-700", children: chip }, chip))) }));
}
