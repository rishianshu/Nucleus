import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { KnowledgeBaseOverview } from "./KnowledgeBaseOverview";
import { NodesExplorer } from "./NodesExplorer";
import { EdgesExplorer } from "./EdgesExplorer";
import { ScenesView } from "./ScenesView";
import { ProvenanceView } from "./ProvenanceView";
export function KnowledgeBaseConsole({ metadataEndpoint, authToken, projectSlug, userRole }) {
    const navigate = useNavigate();
    const location = useLocation();
    const tabs = useMemo(() => [
        { id: "overview", label: "Overview", href: "overview" },
        { id: "nodes", label: "Nodes", href: "explorer/nodes" },
        { id: "edges", label: "Edges", href: "explorer/edges" },
        { id: "scenes", label: "Scenes", href: "scenes" },
        { id: "provenance", label: "Provenance", href: "provenance" },
    ], []);
    const activeTab = useMemo(() => {
        const match = tabs.find((tab) => location.pathname.includes(`/kb/${tab.href}`));
        return match?.id ?? "overview";
    }, [location.pathname, tabs]);
    return (_jsxs("div", { className: "flex h-full min-h-0 flex-col overflow-hidden bg-slate-50/60 dark:bg-slate-900/60", children: [_jsx("header", { className: "border-b border-slate-200 bg-white/80 px-6 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/70", children: _jsxs("div", { className: "flex flex-wrap items-center justify-between gap-4", children: [_jsxs("div", { children: [_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Knowledge Base" }), _jsx("h1", { className: "text-2xl font-semibold text-slate-900 dark:text-white", children: "Admin Console" })] }), _jsx("div", { className: "flex flex-wrap gap-2 text-sm", children: tabs.map((tab) => (_jsx("button", { type: "button", "data-testid": `kb-tab-${tab.id}`, onClick: () => {
                                    const targetPath = `/kb/${tab.href}${location.search || ""}`;
                                    navigate(targetPath);
                                }, className: `rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] transition ${activeTab === tab.id
                                    ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                                    : "border-slate-200 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200"}`, children: tab.label }, tab.id))) })] }) }), _jsx("main", { className: "flex-1 overflow-y-auto px-6 py-6", children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Navigate, { to: "overview", replace: true }) }), _jsx(Route, { path: "overview", element: _jsx(KnowledgeBaseOverview, { metadataEndpoint: metadataEndpoint, authToken: authToken }) }), _jsx(Route, { path: "explorer/nodes", element: _jsx(NodesExplorer, { metadataEndpoint: metadataEndpoint, authToken: authToken, projectSlug: projectSlug, userRole: userRole }) }), _jsx(Route, { path: "explorer/edges", element: _jsx(EdgesExplorer, { metadataEndpoint: metadataEndpoint, authToken: authToken }) }), _jsx(Route, { path: "scenes", element: _jsx(ScenesView, { metadataEndpoint: metadataEndpoint, authToken: authToken }) }), _jsx(Route, { path: "provenance", element: _jsx(ProvenanceView, { metadataEndpoint: metadataEndpoint, authToken: authToken }) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "overview", replace: true }) })] }) })] }));
}
