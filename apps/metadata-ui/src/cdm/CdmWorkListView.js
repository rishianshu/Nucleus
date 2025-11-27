import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMetadataGraphQL } from "../metadata/api";
import { CDM_WORK_ITEMS_QUERY, CDM_WORK_PROJECTS_QUERY, } from "../metadata/queries";
import { useDebouncedValue } from "../metadata/hooks";
const DEFAULT_PAGE_SIZE = 25;
export function CdmWorkListView({ metadataEndpoint, authToken }) {
    const navigate = useNavigate();
    const [projects, setProjects] = useState([]);
    const [items, setItems] = useState([]);
    const [pageInfo, setPageInfo] = useState({ endCursor: null, hasNextPage: false });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [projectFilter, setProjectFilter] = useState("");
    const [selectedStatuses, setSelectedStatuses] = useState([]);
    const [searchInput, setSearchInput] = useState("");
    const debouncedSearch = useDebouncedValue(searchInput, 350);
    const headers = useMemo(() => ({ token: authToken ?? undefined }), [authToken]);
    const loadProjects = useCallback(async () => {
        if (!metadataEndpoint) {
            return;
        }
        try {
            const data = await fetchMetadataGraphQL(metadataEndpoint, CDM_WORK_PROJECTS_QUERY, undefined, undefined, headers);
            setProjects(data.cdmWorkProjects);
        }
        catch (err) {
            console.error(err);
            setError(err.message);
        }
    }, [metadataEndpoint, headers]);
    const loadItems = useCallback(async (cursor, reset) => {
        if (!metadataEndpoint) {
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const variables = {
                filter: buildFilter(projectFilter, selectedStatuses, debouncedSearch),
                first: DEFAULT_PAGE_SIZE,
                after: cursor,
            };
            const data = await fetchMetadataGraphQL(metadataEndpoint, CDM_WORK_ITEMS_QUERY, variables, undefined, headers);
            const nextEdges = data.cdmWorkItems.edges.map((edge) => edge.node);
            setItems((prev) => (reset ? nextEdges : [...prev, ...nextEdges]));
            setPageInfo({
                endCursor: data.cdmWorkItems.pageInfo.endCursor ?? null,
                hasNextPage: data.cdmWorkItems.pageInfo.hasNextPage,
            });
        }
        catch (err) {
            console.error(err);
            setError(err.message);
        }
        finally {
            setLoading(false);
        }
    }, [metadataEndpoint, headers, projectFilter, selectedStatuses, debouncedSearch]);
    useEffect(() => {
        loadProjects();
    }, [loadProjects]);
    useEffect(() => {
        loadItems(null, true);
    }, [loadItems]);
    const uniqueStatuses = useMemo(() => {
        const statusSet = new Set();
        items.forEach((item) => {
            if (item.status) {
                statusSet.add(item.status);
            }
        });
        selectedStatuses.forEach((status) => statusSet.add(status));
        return Array.from(statusSet).sort();
    }, [items, selectedStatuses]);
    if (!metadataEndpoint) {
        return _jsx(EmptyState, { title: "Metadata endpoint not configured", description: "Cannot load CDM work data." });
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsx("div", { className: "rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: _jsx(Filters, { projects: projects, projectFilter: projectFilter, onProjectFilterChange: setProjectFilter, statuses: uniqueStatuses, selectedStatuses: selectedStatuses, onStatusToggle: (status) => toggleStatusFilter(status, selectedStatuses, setSelectedStatuses), searchInput: searchInput, onSearchInputChange: setSearchInput }) }), _jsx("div", { className: "rounded-3xl border border-slate-200 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: error ? (_jsx("div", { className: "p-6 text-sm text-rose-500", children: error })) : (_jsxs("div", { className: "overflow-x-auto", children: [_jsxs("table", { "data-testid": "cdm-work-table", className: "min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800", children: [_jsx("thead", { className: "bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:bg-slate-900/60", children: _jsxs("tr", { children: [_jsx("th", { className: "px-4 py-3", children: "Project" }), _jsx("th", { className: "px-4 py-3", children: "Summary" }), _jsx("th", { className: "px-4 py-3", children: "Status" }), _jsx("th", { className: "px-4 py-3", children: "Priority" }), _jsx("th", { className: "px-4 py-3", children: "Assignee" }), _jsx("th", { className: "px-4 py-3", children: "Updated" })] }) }), _jsx("tbody", { className: "divide-y divide-slate-100 dark:divide-slate-800", children: items.length === 0 && !loading ? (_jsx("tr", { children: _jsx("td", { colSpan: 6, className: "px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400", children: "No CDM work items found. Adjust filters or run CDM ingestion." }) })) : (items.map((item) => (_jsxs("tr", { "data-testid": "cdm-work-row", className: "cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/40", onClick: () => navigate(`/cdm/work/items/${encodeURIComponent(item.cdmId)}`), children: [_jsx("td", { className: "px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-500", children: resolveProjectName(item.projectCdmId, projects) }), _jsxs("td", { className: "px-4 py-3 font-medium text-slate-900 dark:text-slate-100", children: [item.summary, _jsx("div", { className: "text-xs text-slate-500", children: item.sourceIssueKey })] }), _jsx("td", { className: "px-4 py-3 text-slate-700 dark:text-slate-200", children: item.status ?? "—" }), _jsx("td", { className: "px-4 py-3 text-slate-700 dark:text-slate-200", children: item.priority ?? "—" }), _jsx("td", { className: "px-4 py-3 text-slate-700 dark:text-slate-200", children: item.assignee?.displayName ?? "—" }), _jsx("td", { className: "px-4 py-3 text-xs text-slate-500 dark:text-slate-400", children: item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "—" })] }, item.cdmId)))) })] }), loading && (_jsx("div", { className: "border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-500 dark:border-slate-800", children: "Loading\u2026" })), !loading && pageInfo.hasNextPage && (_jsx("div", { className: "border-t border-slate-100 px-4 py-3 text-center dark:border-slate-800", children: _jsx("button", { type: "button", onClick: () => loadItems(pageInfo.endCursor, false), className: "rounded-full border border-slate-300 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: "Load more" }) }))] })) })] }));
}
function buildFilter(projectId, statuses, search) {
    const filter = {};
    if (projectId) {
        filter.projectCdmId = projectId;
    }
    if (statuses.length > 0) {
        filter.statusIn = statuses;
    }
    if (search.trim().length > 0) {
        filter.search = search.trim();
    }
    return Object.keys(filter).length ? filter : undefined;
}
function toggleStatusFilter(status, selected, update) {
    if (!status) {
        return;
    }
    if (selected.includes(status)) {
        update(selected.filter((entry) => entry !== status));
    }
    else {
        update([...selected, status]);
    }
}
function resolveProjectName(projectCdmId, projects) {
    const match = projects.find((project) => project.cdmId === projectCdmId);
    if (!match) {
        return projectCdmId;
    }
    return match.name;
}
function EmptyState({ title, description }) {
    return (_jsxs("div", { className: "rounded-3xl border border-dashed border-slate-300 px-6 py-10 text-center dark:border-slate-700", children: [_jsx("h2", { className: "text-lg font-semibold text-slate-900 dark:text-white", children: title }), description ? _jsx("p", { className: "mt-2 text-sm text-slate-500 dark:text-slate-400", children: description }) : null] }));
}
function Filters({ projects, projectFilter, onProjectFilterChange, statuses, selectedStatuses, onStatusToggle, searchInput, onSearchInputChange, }) {
    return (_jsxs("div", { className: "flex flex-col gap-4 lg:flex-row lg:items-end", children: [_jsxs("label", { className: "flex flex-1 flex-col gap-2 text-sm", children: [_jsx("span", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Project" }), _jsxs("select", { value: projectFilter, onChange: (event) => onProjectFilterChange(event.target.value), className: "rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100", children: [_jsx("option", { value: "", children: "All projects" }), projects.map((project) => (_jsx("option", { value: project.cdmId, children: project.name }, project.cdmId)))] })] }), _jsxs("label", { className: "flex flex-1 flex-col gap-2 text-sm", children: [_jsx("span", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Search" }), _jsx("input", { type: "text", value: searchInput, onChange: (event) => onSearchInputChange(event.target.value), placeholder: "Summary or key", className: "rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" })] }), _jsxs("div", { className: "flex flex-1 flex-col gap-2 text-sm", children: [_jsx("span", { className: "text-xs font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Status" }), _jsx("div", { className: "flex flex-wrap gap-2", children: statuses.length === 0 ? (_jsx("span", { className: "text-xs text-slate-500", children: "No statuses yet" })) : (statuses.map((status) => (_jsxs("label", { className: "inline-flex items-center gap-2 text-xs", children: [_jsx("input", { type: "checkbox", checked: selectedStatuses.includes(status), onChange: () => onStatusToggle(status), className: "h-3.5 w-3.5 rounded border border-slate-300 text-slate-900 focus:ring-slate-900 dark:border-slate-600" }), _jsx("span", { children: status })] }, status)))) })] })] }));
}
