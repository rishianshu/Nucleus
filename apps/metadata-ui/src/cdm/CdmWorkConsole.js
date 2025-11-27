import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { CdmWorkListView } from "./CdmWorkListView";
import { CdmWorkItemDetailView } from "./CdmWorkItemDetailView";
export function CdmWorkConsole({ metadataEndpoint, authToken, projectSlug: _projectSlug, userRole }) {
    const navigate = useNavigate();
    const location = useLocation();
    const tabs = useMemo(() => [
        { id: "items", label: "Work Items", href: "work/items" },
    ], []);
    const activeTab = useMemo(() => {
        const match = tabs.find((tab) => location.pathname.includes(`/cdm/${tab.href}`));
        return match?.id ?? "items";
    }, [location.pathname, tabs]);
    return (_jsxs("div", { className: "flex h-full min-h-0 flex-col overflow-hidden bg-slate-50/60 dark:bg-slate-900/60", children: [_jsx("header", { className: "border-b border-slate-200 bg-white/80 px-6 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/70", children: _jsxs("div", { className: "flex flex-wrap items-center justify-between gap-4", children: [_jsxs("div", { children: [_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500", children: "CDM" }), _jsx("h1", { className: "text-2xl font-semibold text-slate-900 dark:text-white", children: "Work Explorer" }), _jsx("p", { className: "text-xs text-slate-500 dark:text-slate-400", children: "Read-only view of CDM work projects, items, comments, and worklogs." })] }), _jsx("div", { className: "flex flex-wrap gap-2 text-sm", children: tabs.map((tab) => (_jsx("button", { type: "button", onClick: () => navigate(`/cdm/${tab.href}${location.search || ""}`), className: `rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] transition ${activeTab === tab.id
                                    ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                                    : "border-slate-200 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200"}`, children: tab.label }, tab.id))) })] }) }), _jsx("main", { className: "flex-1 overflow-y-auto px-6 py-6", children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Navigate, { to: "work/items", replace: true }) }), _jsx(Route, { path: "work/items", element: _jsx(CdmWorkListView, { metadataEndpoint: metadataEndpoint, authToken: authToken, userRole: userRole }) }), _jsx(Route, { path: "work/items/:cdmId", element: _jsx(CdmWorkItemDetailView, { metadataEndpoint: metadataEndpoint, authToken: authToken }) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "work/items", replace: true }) })] }) })] }));
}
