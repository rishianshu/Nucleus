import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { LuRefreshCcw } from "react-icons/lu";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchMetadataGraphQL } from "../metadata/api";
import { KB_SCENE_QUERY } from "./queries";
import { useKbMetaRegistry } from "./useKbMeta";
const SCENE_NODE_CAP = 300;
const SCENE_EDGE_CAP = 600;
export function ScenesView({ metadataEndpoint, authToken }) {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [nodeId, setNodeId] = useState("");
    const [edgeTypes, setEdgeTypes] = useState("DEPENDENCY_OF");
    const [depth, setDepth] = useState(2);
    const [limit, setLimit] = useState(150);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [scene, setScene] = useState(null);
    const autoFetchNodeRef = useRef(null);
    const [sceneVersion, setSceneVersion] = useState(0);
    const { getNodeLabel, getEdgeLabel, error: metaError, isFallback: metaFallback, refresh: refreshMeta } = useKbMetaRegistry(metadataEndpoint, authToken ?? undefined, null);
    useEffect(() => {
        const paramNode = searchParams.get("node");
        if (paramNode) {
            if (!nodeId) {
                setNodeId(paramNode);
            }
            autoFetchNodeRef.current = paramNode;
            void runScenePreview(paramNode, false);
        }
    }, [searchParams]);
    const handlePreview = async () => {
        await runScenePreview(nodeId, true);
    };
    const runScenePreview = async (rawNodeId, persistParam) => {
        const trimmedNode = rawNodeId.trim();
        if (!metadataEndpoint || !trimmedNode) {
            if (persistParam) {
                setError("Enter a node id to preview a scene.");
            }
            return;
        }
        if (persistParam) {
            const nextParams = new URLSearchParams(searchParams);
            nextParams.set("node", trimmedNode);
            setSearchParams(nextParams, { replace: true });
        }
        setLoading(true);
        setError(null);
        try {
            const payload = await fetchMetadataGraphQL(metadataEndpoint, KB_SCENE_QUERY, {
                id: trimmedNode,
                edgeTypes: edgeTypes
                    .split(",")
                    .map((value) => value.trim())
                    .filter((value) => value.length > 0),
                depth,
                limit,
            }, undefined, { token: authToken ?? undefined });
            setScene(payload.kbScene);
        }
        catch (err) {
            setScene(null);
            setError(err instanceof Error ? err.message : String(err));
        }
        finally {
            setLoading(false);
            if (autoFetchNodeRef.current === trimmedNode) {
                autoFetchNodeRef.current = null;
            }
        }
    };
    useEffect(() => {
        if (scene) {
            setSceneVersion((prev) => prev + 1);
        }
    }, [scene?.summary.nodeCount, scene?.summary.edgeCount, scene?.summary.truncated]);
    return (_jsxs("div", { className: "flex h-full min-h-0 flex-col gap-4", children: [_jsxs("div", { className: "flex flex-wrap items-end gap-4 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: [_jsx(TextField, { label: "Node id", value: nodeId, onChange: setNodeId, placeholder: "e.g., dataset-123" }), _jsx(TextField, { label: "Edge types", value: edgeTypes, onChange: setEdgeTypes, placeholder: "Comma-separated" }), _jsx(NumberField, { label: "Depth", value: depth, min: 1, max: 3, onChange: setDepth }), _jsx(NumberField, { label: "Max nodes", value: limit, min: 50, max: 300, onChange: setLimit }), _jsxs("button", { type: "button", onClick: handlePreview, className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: [_jsx(LuRefreshCcw, { className: "h-4 w-4" }), " Preview scene"] })] }), metaError && metaFallback ? (_jsxs("div", { className: "rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-100", "data-testid": "kb-meta-warning", children: [metaError, " \u2014 using canonical labels.", " ", _jsx("button", { type: "button", onClick: () => refreshMeta(), className: "underline", children: "Retry" })] })) : null, loading ? _jsx("p", { className: "text-sm text-slate-500", children: "Loading scene\u2026" }) : null, error ? (_jsx("div", { className: "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100", children: error })) : null, scene ? (_jsxs("div", { className: "flex flex-col gap-4 transition-all duration-500 ease-out", children: [scene.summary.truncated ? (_jsxs("div", { className: "rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-100", "data-testid": "kb-scenes-truncated", children: ["Graph capped at ", SCENE_NODE_CAP, " nodes / ", SCENE_EDGE_CAP, " edges. Narrow filters to explore the full scene."] })) : null, _jsxs("div", { className: "grid gap-4 lg:grid-cols-3", children: [_jsxs("div", { className: "rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 lg:col-span-1", children: [_jsx("h2", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Graph preview" }), _jsx("div", { className: "mt-3 flex flex-wrap gap-2", children: scene.nodes.map((node) => (_jsx("button", { type: "button", className: "rounded-full border border-slate-300 px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", onClick: () => navigate(`/kb/explorer/nodes?node=${node.id}`), children: node.displayName || node.id }, node.id))) }), _jsxs("div", { className: "mt-4 space-y-2 text-xs text-slate-500", children: [_jsxs("p", { children: [scene.summary.nodeCount, " nodes \u00B7 ", scene.summary.edgeCount, " edges"] }), scene.summary.truncated ? (_jsx("p", { className: "rounded-xl border border-amber-300 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-700 dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200", children: "Scene truncated \u2014 refine filters to load more." })) : null] })] }), _jsxs("div", { className: "rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 lg:col-span-2", children: [_jsx("h2", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Nodes" }), scene.nodes.length === 0 ? (_jsx("p", { className: "mt-3 text-sm text-slate-500", children: "No nodes found for this scene." })) : (_jsx("div", { className: "mt-3 max-h-64 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800", children: _jsxs("table", { className: "w-full table-auto text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "text-left text-xs uppercase tracking-[0.3em] text-slate-500", children: [_jsx("th", { className: "px-3 py-2", children: "Display" }), _jsx("th", { className: "px-3 py-2", children: "Type" }), _jsx("th", { className: "px-3 py-2", children: "Canonical path" })] }) }), _jsx("tbody", { children: scene.nodes.map((node) => (_jsxs("tr", { className: "border-t border-slate-100 text-slate-700 dark:border-slate-800 dark:text-slate-200", children: [_jsxs("td", { className: "px-3 py-2", children: [_jsx("div", { className: "font-semibold", children: node.displayName || node.id }), _jsx("div", { className: "text-xs text-slate-500", children: node.id })] }), _jsxs("td", { className: "px-3 py-2", children: [_jsx("div", { className: "text-xs font-semibold text-slate-700 dark:text-slate-200", children: getNodeLabel(node.entityType) }), _jsx("div", { className: "text-[10px] uppercase tracking-[0.3em] text-slate-400", children: node.entityType })] }), _jsx("td", { className: "px-3 py-2 text-xs text-slate-500", children: node.canonicalPath ?? "—" })] }, node.id))) })] }) }))] })] }), _jsxs("div", { className: "rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: [_jsx("h2", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Edges" }), scene.edges.length === 0 ? (_jsx("p", { className: "mt-3 text-sm text-slate-500", children: "No edges found for this scene." })) : (_jsx("div", { className: "mt-3 max-h-64 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800", children: _jsxs("table", { className: "w-full table-auto text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "text-left text-xs uppercase tracking-[0.3em] text-slate-500", children: [_jsx("th", { className: "px-3 py-2", children: "Type" }), _jsx("th", { className: "px-3 py-2", children: "Source" }), _jsx("th", { className: "px-3 py-2", children: "Target" })] }) }), _jsx("tbody", { children: scene.edges.map((edge) => (_jsxs("tr", { className: "border-t border-slate-100 text-slate-700 dark:border-slate-800 dark:text-slate-200", children: [_jsxs("td", { className: "px-3 py-2", children: [_jsx("div", { className: "text-xs font-semibold text-slate-700 dark:text-slate-200", children: getEdgeLabel(edge.edgeType) }), _jsx("div", { className: "text-[10px] uppercase tracking-[0.3em] text-slate-400", children: edge.edgeType })] }), _jsx("td", { className: "px-3 py-2 text-xs text-slate-500", children: _jsx("button", { type: "button", className: "rounded-full border border-slate-300 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", onClick: () => navigate(`/kb/explorer/nodes?node=${edge.sourceEntityId}`), children: edge.sourceEntityId }) }), _jsx("td", { className: "px-3 py-2 text-xs text-slate-500", children: _jsx("button", { type: "button", className: "rounded-full border border-slate-300 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", onClick: () => navigate(`/kb/explorer/nodes?node=${edge.targetEntityId}`), children: edge.targetEntityId }) })] }, edge.id))) })] }) }))] })] }, sceneVersion)) : (_jsx("p", { className: "text-sm text-slate-500", children: "Run a preview to visualize neighbor scenes." }))] }));
}
function TextField({ label, value, onChange, placeholder }) {
    return (_jsxs("div", { className: "flex flex-col", children: [_jsx("label", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: label }), _jsx("input", { type: "text", value: value, placeholder: placeholder, onChange: (event) => onChange(event.target.value), className: "mt-1 w-48 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" })] }));
}
function NumberField({ label, value, min, max, onChange }) {
    return (_jsxs("div", { className: "flex flex-col", children: [_jsx("label", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: label }), _jsx("input", { type: "number", value: value, min: min, max: max, onChange: (event) => onChange(Number(event.target.value)), className: "mt-1 w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" })] }));
}
