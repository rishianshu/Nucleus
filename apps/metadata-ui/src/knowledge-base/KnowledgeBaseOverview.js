import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { LuArrowRight } from "react-icons/lu";
import { useNavigate } from "react-router-dom";
import { fetchMetadataGraphQL } from "../metadata/api";
import { KB_EDGES_QUERY, KB_NODES_QUERY } from "./queries";
import { useKbMetaRegistry } from "./useKbMeta";
export function KnowledgeBaseOverview({ metadataEndpoint, authToken }) {
    const navigate = useNavigate();
    const DATASET_TYPE = "catalog.dataset";
    const ENDPOINT_TYPE = "metadata.endpoint";
    const DOCPAGE_TYPE = "doc.page";
    const DEPENDENCY_EDGE = "DEPENDENCY_OF";
    const DOCUMENTED_BY_EDGE = "DOCUMENTED_BY";
    const [state, setState] = useState({
        nodes: [],
        edges: [],
        nodeCount: 0,
        edgeCount: 0,
        datasetCount: 0,
        endpointCount: 0,
        docPageCount: 0,
        dependencyEdgeCount: 0,
        documentedByCount: 0,
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const { getNodeLabel, getEdgeLabel, error: metaError, isFallback: metaFallback, refresh: refreshMeta } = useKbMetaRegistry(metadataEndpoint, authToken ?? undefined, null);
    useEffect(() => {
        let cancelled = false;
        if (!metadataEndpoint) {
            setError("Metadata endpoint is not configured.");
            return () => {
                cancelled = true;
            };
        }
        setLoading(true);
        setError(null);
        const recentVariables = { first: 10 };
        Promise.all([
            fetchMetadataGraphQL(metadataEndpoint, KB_NODES_QUERY, recentVariables, undefined, { token: authToken ?? undefined }),
            fetchMetadataGraphQL(metadataEndpoint, KB_EDGES_QUERY, recentVariables, undefined, { token: authToken ?? undefined }),
            fetchMetadataGraphQL(metadataEndpoint, KB_NODES_QUERY, { first: 1, type: DATASET_TYPE }, undefined, { token: authToken ?? undefined }),
            fetchMetadataGraphQL(metadataEndpoint, KB_NODES_QUERY, { first: 1, type: ENDPOINT_TYPE }, undefined, { token: authToken ?? undefined }),
            fetchMetadataGraphQL(metadataEndpoint, KB_NODES_QUERY, { first: 1, type: DOCPAGE_TYPE }, undefined, { token: authToken ?? undefined }),
            fetchMetadataGraphQL(metadataEndpoint, KB_EDGES_QUERY, { first: 1, edgeType: DEPENDENCY_EDGE }, undefined, { token: authToken ?? undefined }),
            fetchMetadataGraphQL(metadataEndpoint, KB_EDGES_QUERY, { first: 1, edgeType: DOCUMENTED_BY_EDGE }, undefined, { token: authToken ?? undefined }),
        ])
            .then(([nodesPayload, edgesPayload, datasetSummary, endpointSummary, docSummary, dependencySummary, documentedSummary]) => {
            if (cancelled) {
                return;
            }
            setState({
                nodes: nodesPayload.kbNodes.edges.map((edge) => edge.node),
                edges: edgesPayload.kbEdges.edges.map((edge) => edge.node),
                nodeCount: nodesPayload.kbNodes.totalCount,
                edgeCount: edgesPayload.kbEdges.totalCount,
                datasetCount: datasetSummary.kbNodes.totalCount,
                endpointCount: endpointSummary.kbNodes.totalCount,
                docPageCount: docSummary.kbNodes.totalCount,
                dependencyEdgeCount: dependencySummary.kbEdges.totalCount,
                documentedByCount: documentedSummary.kbEdges.totalCount,
            });
        })
            .catch((err) => {
            if (!cancelled) {
                setError(err instanceof Error ? err.message : String(err));
            }
        })
            .finally(() => {
            if (!cancelled) {
                setLoading(false);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [authToken, metadataEndpoint, DATASET_TYPE, ENDPOINT_TYPE, DOCPAGE_TYPE, DEPENDENCY_EDGE, DOCUMENTED_BY_EDGE]);
    const scopeSummary = useMemo(() => {
        const buckets = new Map();
        state.nodes.forEach((node) => {
            const key = node.scope.projectId || node.scope.domainId || node.scope.orgId;
            const label = key ?? "global";
            buckets.set(label, { label, count: (buckets.get(label)?.count ?? 0) + 1 });
        });
        return Array.from(buckets.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 4);
    }, [state.nodes]);
    if (loading) {
        return _jsx("p", { className: "text-sm text-slate-500", children: "Loading Knowledge Base overview\u2026" });
    }
    if (error) {
        return (_jsx("div", { className: "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100", children: error }));
    }
    return (_jsxs("div", { className: "space-y-6", children: [metaError && metaFallback ? (_jsxs("div", { className: "rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-100", "data-testid": "kb-meta-warning", children: [metaError, " \u2014 using canonical labels.", " ", _jsx("button", { type: "button", onClick: () => refreshMeta(), className: "underline", children: "Retry" })] })) : null, _jsxs("div", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-4", children: [_jsx(OverviewCard, { label: "Total nodes", value: state.nodeCount.toLocaleString(), helper: "Across all entity types" }), _jsx(OverviewCard, { label: getNodeLabel(DATASET_TYPE), value: state.datasetCount.toLocaleString(), helper: DATASET_TYPE }), _jsx(OverviewCard, { label: getNodeLabel(ENDPOINT_TYPE), value: state.endpointCount.toLocaleString(), helper: ENDPOINT_TYPE }), _jsx(OverviewCard, { label: "Total edges", value: state.edgeCount.toLocaleString(), helper: "All edge types" })] }), _jsxs("div", { className: "grid gap-4 md:grid-cols-2 xl:grid-cols-4", children: [_jsx(OverviewCard, { label: getNodeLabel(DOCPAGE_TYPE), value: state.docPageCount.toLocaleString(), helper: DOCPAGE_TYPE }), _jsx(OverviewCard, { label: getEdgeLabel(DEPENDENCY_EDGE), value: state.dependencyEdgeCount.toLocaleString(), helper: DEPENDENCY_EDGE }), _jsx(OverviewCard, { label: getEdgeLabel(DOCUMENTED_BY_EDGE), value: state.documentedByCount.toLocaleString(), helper: DOCUMENTED_BY_EDGE }), _jsx(OverviewCard, { label: "Top scopes", value: scopeSummary.length ? scopeSummary[0].label : "—", helper: scopeSummary.length ? `${scopeSummary[0].count} recent nodes` : "No data" })] }), scopeSummary.length ? (_jsxs("div", { className: "rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h2", { className: "text-sm font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Scope summary (last 10 nodes)" }), _jsxs("span", { className: "text-xs text-slate-500", children: [scopeSummary.length, " scopes"] })] }), _jsx("ul", { className: "mt-3 divide-y divide-slate-200 text-sm dark:divide-slate-800", children: scopeSummary.map((entry) => (_jsxs("li", { className: "flex items-center justify-between py-2", children: [_jsx("span", { className: "font-semibold text-slate-900 dark:text-white", children: entry.label }), _jsxs("span", { className: "text-xs text-slate-500", children: [entry.count, " node(s)"] })] }, entry.label))) })] })) : null, _jsxs("div", { className: "grid gap-6 xl:grid-cols-2", children: [_jsxs("div", { className: "rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h2", { className: "text-sm font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Recent nodes" }), _jsxs("button", { type: "button", onClick: () => navigate("/kb/explorer/nodes"), className: "inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 hover:text-slate-900 dark:text-slate-300", children: ["View explorer ", _jsx(LuArrowRight, { className: "h-3 w-3" })] })] }), state.nodes.length === 0 ? (_jsx("p", { className: "pt-4 text-sm text-slate-500", children: "No nodes available." })) : (_jsx("ul", { className: "divide-y divide-slate-200 pt-3 text-sm dark:divide-slate-800", children: state.nodes.map((node) => (_jsxs("li", { className: "py-2", children: [_jsx("p", { className: "font-semibold text-slate-900 dark:text-white", children: node.displayName }), _jsxs("p", { className: "text-xs text-slate-500 dark:text-slate-400", children: [getNodeLabel(node.entityType), " \u00B7 ", _jsx("span", { className: "uppercase tracking-[0.3em] text-slate-400", children: node.entityType }), " \u00B7", " ", node.identity.logicalKey] })] }, node.id))) }))] }), _jsxs("div", { className: "rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h2", { className: "text-sm font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Recent edges" }), _jsxs("button", { type: "button", onClick: () => navigate("/kb/explorer/edges"), className: "inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 hover:text-slate-900 dark:text-slate-300", children: ["View explorer ", _jsx(LuArrowRight, { className: "h-3 w-3" })] })] }), state.edges.length === 0 ? (_jsx("p", { className: "pt-4 text-sm text-slate-500", children: "No edges available." })) : (_jsx("ul", { className: "divide-y divide-slate-200 pt-3 text-sm dark:divide-slate-800", children: state.edges.map((edge) => (_jsxs("li", { className: "py-2", children: [_jsx("p", { className: "font-semibold text-slate-900 dark:text-white", children: getEdgeLabel(edge.edgeType) }), _jsxs("p", { className: "text-xs text-slate-500 dark:text-slate-400", children: [_jsx("span", { className: "uppercase tracking-[0.3em] text-slate-400", children: edge.edgeType }), " \u00B7 ", edge.sourceEntityId, " \u2192 ", edge.targetEntityId] })] }, edge.id))) }))] })] })] }));
}
function OverviewCard({ label, value, helper }) {
    return (_jsxs("div", { className: "rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: label }), _jsx("p", { className: "mt-2 text-3xl font-semibold text-slate-900 dark:text-white", children: value }), helper ? _jsx("p", { className: "text-xs text-slate-500 dark:text-slate-400", children: helper }) : null] }));
}
