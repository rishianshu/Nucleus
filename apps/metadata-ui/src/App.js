import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { LuCloudUpload, LuDatabase, LuGauge, LuLogOut, LuMoon, LuNetwork, LuSun } from "react-icons/lu";
import { MetadataWorkspace } from "./metadata/MetadataWorkspace";
import { MetadataAuthBoundary } from "./metadata/MetadataAuthBoundary";
import { useAuth } from "./auth/AuthProvider";
import { KnowledgeBaseConsole } from "./knowledge-base/KnowledgeBaseConsole";
import { IngestionConsole } from "./ingestion/IngestionConsole";
const METADATA_ENDPOINT = import.meta.env.VITE_METADATA_GRAPHQL_ENDPOINT ?? "/metadata/graphql";
function App() {
    const auth = useAuth();
    const userRole = auth.user?.role ?? "USER";
    const projectSlug = auth.user?.projectId ?? null;
    return (_jsx(MetadataAuthBoundary, { children: _jsx(BrowserRouter, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(MetadataWorkspaceShell, { metadataEndpoint: METADATA_ENDPOINT, authToken: auth.token, projectSlug: projectSlug, userRole: userRole }) }), _jsx(Route, { path: "/kb/*", element: _jsx(MetadataWorkspaceShell, { metadataEndpoint: METADATA_ENDPOINT, authToken: auth.token, projectSlug: projectSlug, userRole: userRole }) }), _jsx(Route, { path: "/ingestion/*", element: _jsx(MetadataWorkspaceShell, { metadataEndpoint: METADATA_ENDPOINT, authToken: auth.token, projectSlug: projectSlug, userRole: userRole }) }), _jsx(Route, { path: "/catalog/datasets/:datasetId", element: _jsx(MetadataWorkspaceShell, { metadataEndpoint: METADATA_ENDPOINT, authToken: auth.token, projectSlug: projectSlug, userRole: userRole }) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] }) }) }));
}
function MetadataWorkspaceShell({ metadataEndpoint, authToken, projectSlug, userRole }) {
    const auth = useAuth();
    const { datasetId } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const [shellCollapsed, setShellCollapsed] = useState(false);
    const [isDarkMode, setIsDarkMode] = useState(true);
    useEffect(() => {
        document.documentElement.classList.toggle("dark", isDarkMode);
    }, [isDarkMode]);
    const handleDatasetRouteChange = useCallback((nextId) => {
        if (nextId) {
            if (nextId !== datasetId) {
                navigate(`/catalog/datasets/${nextId}`);
            }
            return;
        }
        if (datasetId) {
            navigate("/");
        }
    }, [datasetId, navigate]);
    const brand = "Nucleus";
    const brandMark = brand.charAt(0).toUpperCase();
    const canAccessIngestion = userRole === "ADMIN";
    const shellMenu = useMemo(() => [
        { id: "metadata", label: "Metadata", icon: LuDatabase, href: "/", disabled: false },
        { id: "kb", label: "Knowledge Base", icon: LuNetwork, href: "/kb", disabled: false },
        { id: "ingestion", label: "Ingestion", icon: LuCloudUpload, href: "/ingestion", disabled: !canAccessIngestion },
        { id: "recon", label: "Reconciliation", icon: LuGauge, disabled: true },
    ], [canAccessIngestion]);
    const isKnowledgeBaseRoute = location.pathname.startsWith("/kb");
    const isIngestionRoute = location.pathname.startsWith("/ingestion");
    const activeMenuId = isKnowledgeBaseRoute ? "kb" : isIngestionRoute ? "ingestion" : "metadata";
    return (_jsxs("div", { className: `flex h-screen min-h-0 overflow-hidden ${isDarkMode ? "bg-slate-900 text-slate-100" : "bg-slate-100 text-slate-900"}`, children: [_jsxs("aside", { className: `flex h-full flex-none flex-col border-r border-slate-200/70 bg-white/80 px-4 py-6 transition-[width] dark:border-slate-800/80 dark:bg-slate-900/70 ${shellCollapsed ? "w-20" : "w-64"}`, children: [_jsx("div", { className: "flex flex-col gap-6", children: _jsxs("div", { className: `${shellCollapsed
                                ? "flex flex-col items-center gap-3"
                                : "flex flex-row items-start justify-between gap-3"}`, children: [_jsxs("div", { className: `flex items-center gap-3 ${shellCollapsed ? "justify-center" : ""}`, children: [_jsx("div", { className: "flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-300 text-sm font-semibold text-slate-600 dark:border-slate-600 dark:text-slate-200", children: brandMark }), !shellCollapsed && (_jsxs("div", { children: [_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-400", children: "Workspace" }), _jsx("p", { className: "text-lg font-semibold text-slate-900 dark:text-white", children: brand })] }))] }), _jsxs("div", { className: `flex flex-col items-center gap-2 ${shellCollapsed ? "w-full" : ""}`, "aria-label": "Workspace controls", children: [_jsx("button", { type: "button", onClick: () => setIsDarkMode((prev) => !prev), className: "inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", "aria-label": "Toggle color mode", title: "Toggle color mode", children: isDarkMode ? _jsx(LuSun, { className: "h-4 w-4" }) : _jsx(LuMoon, { className: "h-4 w-4" }) }), _jsx("button", { type: "button", onClick: () => setShellCollapsed((prev) => !prev), className: "inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", "aria-label": "Toggle sidebar", title: shellCollapsed ? "Expand workspace sidebar" : "Collapse workspace sidebar", children: shellCollapsed ? "›" : "‹" })] })] }) }), _jsxs("div", { className: "mt-8 flex min-h-0 flex-1 flex-col gap-6", children: [_jsx("nav", { className: "space-y-2 overflow-y-auto pr-1 scrollbar-thin", children: shellMenu.map((item) => {
                                    const Icon = item.icon ?? LuDatabase;
                                    const isActive = item.id === activeMenuId;
                                    const disabled = item.disabled ?? false;
                                    return (_jsxs("button", { type: "button", title: item.label, onClick: () => {
                                            if (disabled) {
                                                return;
                                            }
                                            navigate(item.href ?? "/");
                                        }, disabled: disabled, className: `flex w-full items-center gap-3 rounded-2xl border text-sm transition ${shellCollapsed ? "justify-center px-2 py-2" : "px-3 py-2"} ${isActive
                                            ? "border-slate-900 bg-slate-900 text-white shadow-sm dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                                            : "border-transparent text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:text-slate-200"} ${disabled ? "opacity-60" : ""}`, children: [_jsx(Icon, { className: "h-4 w-4" }), !shellCollapsed && (_jsxs("span", { className: "text-left", children: [item.label, disabled ? _jsx("span", { className: "ml-1 text-xs text-slate-400", children: "(soon)" }) : null] }))] }, item.id));
                                }) }), !shellCollapsed && (_jsxs("div", { className: "space-y-2 border-t border-slate-200 pt-4 text-sm dark:border-slate-800", children: [_jsx("p", { className: "font-semibold text-slate-700 dark:text-slate-200", children: auth.user?.displayName ?? "Unknown user" }), _jsx("p", { className: "text-xs text-slate-500 dark:text-slate-400", children: auth.user?.email ?? "—" }), _jsxs("button", { type: "button", onClick: () => auth.logout(), className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: [_jsx(LuLogOut, { className: "h-3 w-3" }), " Logout"] })] }))] })] }), _jsx("div", { className: "flex min-h-0 flex-1 flex-col overflow-hidden", children: isKnowledgeBaseRoute ? (_jsx(KnowledgeBaseConsole, { metadataEndpoint: metadataEndpoint, authToken: authToken, projectSlug: projectSlug, userRole: userRole })) : isIngestionRoute ? (_jsx(IngestionConsole, { metadataEndpoint: metadataEndpoint, authToken: authToken, projectSlug: projectSlug, userRole: userRole })) : (_jsx(MetadataWorkspace, { metadataEndpoint: metadataEndpoint, authToken: authToken, projectSlug: projectSlug, userRole: userRole, datasetDetailRouteId: datasetId ?? null, onDatasetDetailRouteChange: handleDatasetRouteChange })) })] }));
}
export default App;
