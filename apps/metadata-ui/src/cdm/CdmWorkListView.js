import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchMetadataGraphQL } from "../metadata/api";
import { CDM_WORK_COMMENTS_QUERY, CDM_WORK_DATASETS_QUERY, CDM_WORK_ITEM_DETAIL_QUERY, CDM_WORK_ITEMS_QUERY, CDM_WORK_LOGS_QUERY, CDM_WORK_PROJECTS_QUERY, CDM_WORK_PROJECT_CONNECTION_QUERY, CDM_WORK_USERS_QUERY, SIGNALS_FOR_ENTITY_QUERY, } from "../metadata/queries";
import { useDebouncedValue } from "../metadata/hooks";
const DEFAULT_PAGE_SIZE = 25;
const ENTITY_OPTIONS = [
    { id: "ITEM", label: "Issues" },
    { id: "COMMENT", label: "Comments" },
    { id: "WORKLOG", label: "Worklogs" },
    { id: "PROJECT", label: "Projects" },
    { id: "USER", label: "Users" },
];
const ENTITY_SEARCH_PLACEHOLDER = {
    ITEM: "Search summaries or keys…",
    COMMENT: "Search comment body…",
    WORKLOG: "Search worklog notes…",
    PROJECT: "Search project names or keys…",
    USER: "Search display names or emails…",
};
export function CdmWorkListView({ metadataEndpoint, authToken }) {
    const [searchParams, setSearchParams] = useSearchParams();
    const [projects, setProjects] = useState([]);
    const [datasets, setDatasets] = useState([]);
    const [records, setRecords] = useState([]);
    const [pageInfo, setPageInfo] = useState({ endCursor: null, hasNextPage: false });
    const [entityKind, setEntityKind] = useState("ITEM");
    const [projectFilter, setProjectFilter] = useState("");
    const [datasetFilter, setDatasetFilter] = useState("");
    const [selectedStatuses, setSelectedStatuses] = useState([]);
    const [searchInput, setSearchInput] = useState("");
    const debouncedSearch = useDebouncedValue(searchInput, 350);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [selectedRow, setSelectedRow] = useState(null);
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const headers = useMemo(() => ({ token: authToken ?? undefined }), [authToken]);
    const datasetLookup = useMemo(() => {
        const map = new Map();
        datasets.forEach((entry) => map.set(entry.datasetId, entry));
        return map;
    }, [datasets]);
    const entityDatasetOptions = useMemo(() => datasets.filter((entry) => entry.entityKind === entityKind), [datasets, entityKind]);
    const uniqueStatuses = useMemo(() => {
        if (entityKind !== "ITEM") {
            return [];
        }
        const statusSet = new Set();
        records.forEach((row) => {
            if (row.kind === "ITEM" && row.status) {
                statusSet.add(row.status);
            }
        });
        selectedStatuses.forEach((status) => statusSet.add(status));
        return Array.from(statusSet).sort();
    }, [entityKind, records, selectedStatuses]);
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
    const loadDatasets = useCallback(async () => {
        if (!metadataEndpoint) {
            return;
        }
        try {
            const data = await fetchMetadataGraphQL(metadataEndpoint, CDM_WORK_DATASETS_QUERY, undefined, undefined, headers);
            setDatasets(data.cdmWorkDatasets);
        }
        catch (err) {
            console.error(err);
            setError(err.message);
        }
    }, [metadataEndpoint, headers]);
    const loadRecords = useCallback(async (cursor, reset) => {
        if (!metadataEndpoint) {
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const variables = {
                filter: buildEntityFilter(entityKind, {
                    projectCdmId: projectFilter,
                    statuses: selectedStatuses,
                    datasetId: datasetFilter,
                    search: debouncedSearch,
                }),
                first: DEFAULT_PAGE_SIZE,
                after: cursor,
            };
            const { query, extractor } = resolveEntityQuery(entityKind);
            const data = await fetchMetadataGraphQL(metadataEndpoint, query, variables, undefined, headers);
            const connection = extractor(data);
            const nextRows = connection.edges.map((edge) => ({ ...edge.node, kind: entityKind }));
            setRecords((prev) => (reset ? nextRows : [...prev, ...nextRows]));
            setPageInfo({
                endCursor: connection.pageInfo.endCursor ?? null,
                hasNextPage: connection.pageInfo.hasNextPage,
            });
        }
        catch (err) {
            console.error(err);
            setError(err.message);
        }
        finally {
            setLoading(false);
        }
    }, [metadataEndpoint, headers, entityKind, projectFilter, selectedStatuses, datasetFilter, debouncedSearch]);
    const loadItemDetail = useCallback(async (row) => {
        if (!metadataEndpoint || !row) {
            setDetail(null);
            return;
        }
        setDetailLoading(true);
        try {
            const data = await fetchMetadataGraphQL(metadataEndpoint, CDM_WORK_ITEM_DETAIL_QUERY, { cdmId: row.cdmId }, undefined, headers);
            setDetail(data.cdmWorkItem);
        }
        catch (err) {
            console.error(err);
            setDetail(null);
        }
        finally {
            setDetailLoading(false);
        }
    }, [metadataEndpoint, headers]);
    useEffect(() => {
        loadProjects();
    }, [loadProjects]);
    useEffect(() => {
        loadDatasets();
    }, [loadDatasets]);
    useEffect(() => {
        loadRecords(null, true);
    }, [loadRecords]);
    useEffect(() => {
        if (entityKind !== "ITEM" && selectedStatuses.length) {
            setSelectedStatuses([]);
        }
        setSelectedRow(null);
        setDetail(null);
    }, [entityKind, selectedStatuses.length]);
    useEffect(() => {
        loadItemDetail(selectedRow && selectedRow.kind === "ITEM" ? selectedRow : null);
    }, [selectedRow, loadItemDetail]);
    useEffect(() => {
        const selectedId = searchParams.get("selected");
        if (!selectedId) {
            return;
        }
        const match = records.find((row) => row.cdmId === selectedId);
        if (match && (selectedRow?.cdmId !== match.cdmId || selectedRow.kind !== match.kind)) {
            setSelectedRow(match);
        }
    }, [records, searchParams, selectedRow]);
    useEffect(() => {
        const current = searchParams.get("selected");
        if (selectedRow?.kind === "ITEM" && selectedRow.cdmId) {
            if (current !== selectedRow.cdmId) {
                const next = new URLSearchParams(searchParams);
                next.set("selected", selectedRow.cdmId);
                setSearchParams(next, { replace: true });
            }
        }
        else if (current) {
            const next = new URLSearchParams(searchParams);
            next.delete("selected");
            setSearchParams(next, { replace: true });
        }
    }, [searchParams, selectedRow, setSearchParams]);
    if (!metadataEndpoint) {
        return _jsx(EmptyState, { title: "Metadata endpoint not configured", description: "Cannot load CDM Work data." });
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsx("div", { className: "rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: _jsx(Filters, { entityKind: entityKind, onEntityChange: setEntityKind, projects: projects, projectFilter: projectFilter, onProjectFilterChange: setProjectFilter, statuses: uniqueStatuses, selectedStatuses: selectedStatuses, onStatusToggle: (status) => toggleStatusFilter(status, selectedStatuses, setSelectedStatuses), datasetOptions: entityDatasetOptions, datasetFilter: datasetFilter, onDatasetFilterChange: setDatasetFilter, searchInput: searchInput, onSearchInputChange: setSearchInput, searchPlaceholder: ENTITY_SEARCH_PLACEHOLDER[entityKind] }) }), _jsxs("div", { className: "grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]", children: [_jsx("div", { className: "rounded-3xl border border-slate-200 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: error ? (_jsx("div", { className: "p-6 text-sm text-rose-500", children: error })) : (_jsxs("div", { className: "overflow-x-auto", children: [_jsxs("table", { "data-testid": "cdm-work-table", className: "min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800", children: [_jsx("thead", { className: "bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:bg-slate-900/60", children: _jsx("tr", { children: renderTableHeaders(entityKind) }) }), _jsx("tbody", { className: "divide-y divide-slate-100 dark:divide-slate-800", children: records.length === 0 && !loading ? (_jsx("tr", { children: _jsxs("td", { colSpan: 8, className: "px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400", children: ["No CDM ", entityKind === "ITEM" ? "issues" : entityKind === "COMMENT" ? "comments" : "worklogs", " found. Adjust filters or run CDM ingestion."] }) })) : (records.map((row) => (_jsx("tr", { "data-testid": "cdm-work-row", className: `cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/40 ${selectedRow?.cdmId === row.cdmId && selectedRow.kind === row.kind
                                                    ? "bg-slate-100/70 dark:bg-slate-800/60"
                                                    : ""}`, onClick: () => setSelectedRow(row), children: renderRowCells(row, projects, datasetLookup) }, `${row.kind}-${row.cdmId}`)))) })] }), loading && (_jsx("div", { className: "border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-500 dark:border-slate-800", children: "Loading\u2026" })), !loading && pageInfo.hasNextPage && (_jsx("div", { className: "border-t border-slate-100 px-4 py-3 text-center dark:border-slate-800", children: _jsx("button", { type: "button", onClick: () => loadRecords(pageInfo.endCursor, false), className: "rounded-full border border-slate-300 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: "Load more" }) }))] })) }), _jsx(WorkDetailPanel, { row: selectedRow, detail: selectedRow?.kind === "ITEM" ? detail : null, detailLoading: detailLoading, datasetLookup: datasetLookup, projects: projects, metadataEndpoint: metadataEndpoint, headers: headers })] })] }));
}
function renderTableHeaders(entityKind) {
    if (entityKind === "ITEM") {
        return (_jsxs(_Fragment, { children: [_jsx("th", { className: "px-4 py-3", children: "Project" }), _jsx("th", { className: "px-4 py-3", children: "Key" }), _jsx("th", { className: "px-4 py-3", children: "Summary" }), _jsx("th", { className: "px-4 py-3", children: "Status" }), _jsx("th", { className: "px-4 py-3", children: "Priority" }), _jsx("th", { className: "px-4 py-3", children: "Assignee" }), _jsx("th", { className: "px-4 py-3", children: "Updated" }), _jsx("th", { className: "px-4 py-3", children: "Dataset" })] }));
    }
    if (entityKind === "COMMENT") {
        return (_jsxs(_Fragment, { children: [_jsx("th", { className: "px-4 py-3", children: "Project" }), _jsx("th", { className: "px-4 py-3", children: "Parent key" }), _jsx("th", { className: "px-4 py-3", children: "Author" }), _jsx("th", { className: "px-4 py-3", children: "Created" }), _jsx("th", { className: "px-4 py-3", children: "Excerpt" }), _jsx("th", { className: "px-4 py-3", children: "Dataset" })] }));
    }
    if (entityKind === "WORKLOG") {
        return (_jsxs(_Fragment, { children: [_jsx("th", { className: "px-4 py-3", children: "Project" }), _jsx("th", { className: "px-4 py-3", children: "Parent key" }), _jsx("th", { className: "px-4 py-3", children: "Author" }), _jsx("th", { className: "px-4 py-3", children: "Time spent" }), _jsx("th", { className: "px-4 py-3", children: "Started" }), _jsx("th", { className: "px-4 py-3", children: "Updated" }), _jsx("th", { className: "px-4 py-3", children: "Dataset" })] }));
    }
    if (entityKind === "PROJECT") {
        return (_jsxs(_Fragment, { children: [_jsx("th", { className: "px-4 py-3", children: "System" }), _jsx("th", { className: "px-4 py-3", children: "Key" }), _jsx("th", { className: "px-4 py-3", children: "Name" }), _jsx("th", { className: "px-4 py-3", children: "Dataset" })] }));
    }
    return (_jsxs(_Fragment, { children: [_jsx("th", { className: "px-4 py-3", children: "Name" }), _jsx("th", { className: "px-4 py-3", children: "Email" }), _jsx("th", { className: "px-4 py-3", children: "Status" }), _jsx("th", { className: "px-4 py-3", children: "Dataset" })] }));
}
function renderRowCells(row, projects, datasetLookup) {
    const datasetLabel = formatDatasetLabel(row.datasetId, datasetLookup);
    if (row.kind === "ITEM") {
        return (_jsxs(_Fragment, { children: [_jsx("td", { className: "px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-500", children: resolveProjectName(row.projectCdmId, projects) }), _jsx("td", { className: "px-4 py-3 text-xs font-semibold text-slate-500", children: row.sourceIssueKey }), _jsxs("td", { className: "px-4 py-3 font-medium text-slate-900 dark:text-slate-100", children: [row.summary, _jsx("div", { className: "text-xs text-slate-500", children: row.sourceSystem })] }), _jsx("td", { className: "px-4 py-3 text-slate-700 dark:text-slate-200", children: row.status ?? "—" }), _jsx("td", { className: "px-4 py-3 text-slate-700 dark:text-slate-200", children: row.priority ?? "—" }), _jsx("td", { className: "px-4 py-3 text-slate-700 dark:text-slate-200", children: row.assignee?.displayName ?? "—" }), _jsx("td", { className: "px-4 py-3 text-xs text-slate-500 dark:text-slate-400", children: formatTimestamp(row.updatedAt) }), _jsx("td", { className: "px-4 py-3 text-xs text-slate-500 dark:text-slate-300", children: datasetLabel })] }));
    }
    if (row.kind === "COMMENT") {
        return (_jsxs(_Fragment, { children: [_jsx("td", { className: "px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-500", children: resolveProjectName(row.projectCdmId ?? "", projects) }), _jsx("td", { className: "px-4 py-3 text-xs font-semibold text-slate-500", children: row.parentIssueKey ?? "—" }), _jsx("td", { className: "px-4 py-3 text-slate-700 dark:text-slate-200", children: row.author?.displayName ?? "—" }), _jsx("td", { className: "px-4 py-3 text-xs text-slate-500", children: formatTimestamp(row.createdAt) }), _jsx("td", { className: "px-4 py-3 text-sm text-slate-900 dark:text-slate-100", children: truncateText(row.body, 140) }), _jsx("td", { className: "px-4 py-3 text-xs text-slate-500 dark:text-slate-300", children: datasetLabel })] }));
    }
    if (row.kind === "WORKLOG") {
        return (_jsxs(_Fragment, { children: [_jsx("td", { className: "px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-500", children: resolveProjectName(row.projectCdmId ?? "", projects) }), _jsx("td", { className: "px-4 py-3 text-xs font-semibold text-slate-500", children: row.parentIssueKey ?? "—" }), _jsx("td", { className: "px-4 py-3 text-slate-700 dark:text-slate-200", children: row.author?.displayName ?? "—" }), _jsx("td", { className: "px-4 py-3 text-slate-700 dark:text-slate-200", children: formatDuration(row.timeSpentSeconds) }), _jsx("td", { className: "px-4 py-3 text-xs text-slate-500", children: formatTimestamp(row.startedAt) }), _jsx("td", { className: "px-4 py-3 text-xs text-slate-500", children: formatTimestamp(extractRawTimestamp(row.raw, ["raw", "updated"])) }), _jsx("td", { className: "px-4 py-3 text-xs text-slate-500 dark:text-slate-300", children: datasetLabel })] }));
    }
    if (row.kind === "PROJECT") {
        return (_jsxs(_Fragment, { children: [_jsx("td", { className: "px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-500", children: row.sourceSystem }), _jsx("td", { className: "px-4 py-3 text-xs font-semibold text-slate-500", children: row.sourceProjectKey }), _jsx("td", { className: "px-4 py-3 text-slate-700 dark:text-slate-200", children: row.name }), _jsx("td", { className: "px-4 py-3 text-xs text-slate-500 dark:text-slate-300", children: datasetLabel })] }));
    }
    return (_jsxs(_Fragment, { children: [_jsx("td", { className: "px-4 py-3 text-slate-700 dark:text-slate-200", children: row.displayName ?? "Unknown user" }), _jsx("td", { className: "px-4 py-3 text-xs text-slate-500", children: row.email ?? "—" }), _jsx("td", { className: "px-4 py-3 text-xs text-slate-500", children: row.active ? "Active" : "Inactive" }), _jsx("td", { className: "px-4 py-3 text-xs text-slate-500 dark:text-slate-300", children: datasetLabel })] }));
}
function WorkDetailPanel({ row, detail, detailLoading, datasetLookup, projects, metadataEndpoint, headers, }) {
    const [signals, setSignals] = useState([]);
    const [signalsLoading, setSignalsLoading] = useState(false);
    useEffect(() => {
        let cancelled = false;
        const loadSignals = async () => {
            if (!metadataEndpoint || !row || row.kind !== "ITEM" || !row.cdmId) {
                setSignals([]);
                return;
            }
            setSignalsLoading(true);
            try {
                const entityRef = `cdm.work.item:${row.cdmId}`;
                const resp = await fetchMetadataGraphQL(metadataEndpoint, SIGNALS_FOR_ENTITY_QUERY, { entityRef, first: 5 }, undefined, headers);
                if (!cancelled) {
                    setSignals(resp.signalInstancesPage?.rows ?? []);
                }
            }
            catch (err) {
                if (!cancelled) {
                    setSignals([]);
                }
            }
            finally {
                if (!cancelled) {
                    setSignalsLoading(false);
                }
            }
        };
        loadSignals();
        return () => {
            cancelled = true;
        };
    }, [metadataEndpoint, headers, row]);
    if (!row) {
        return (_jsx("aside", { "data-testid": "cdm-work-detail-panel", className: "rounded-3xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400", children: "Select a row to inspect its CDM payload." }));
    }
    const dataset = row.datasetId ? datasetLookup.get(row.datasetId) : null;
    const datasetLabel = dataset?.label ?? row.datasetId ?? "—";
    const endpointLabel = dataset?.endpointName ?? "Source endpoint";
    const rawPayload = row.rawSource ??
        row.raw ??
        {};
    const projectLabel = row.kind === "ITEM"
        ? resolveProjectName(row.projectCdmId, projects)
        : row.kind === "COMMENT" || row.kind === "WORKLOG"
            ? resolveProjectName(row.projectCdmId ?? "", projects)
            : row.kind === "PROJECT"
                ? row.name
                : "";
    const sourceUrl = row.kind === "PROJECT" && row.url
        ? row.url
        : row.kind === "ITEM"
            ? row.sourceUrl ?? resolveSourceUrl(rawPayload)
            : resolveSourceUrl(rawPayload);
    return (_jsxs("aside", { "data-testid": "cdm-work-detail-panel", className: "flex h-fit flex-col rounded-3xl border border-slate-200 bg-white/95 p-4 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900/70", children: [_jsxs("div", { className: "mb-4", children: [_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500", children: row.kind === "ITEM" ? "Issue" : row.kind === "COMMENT" ? "Comment" : "Worklog" }), _jsx("h2", { className: "text-lg font-semibold text-slate-900 dark:text-white", children: projectLabel || "Unknown project" }), _jsxs("p", { className: "text-xs text-slate-500 dark:text-slate-400", children: ["Dataset: ", datasetLabel, " \u00B7 ", endpointLabel] })] }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [row.datasetId ? (_jsx(Link, { to: `/catalog/datasets/${encodeURIComponent(row.datasetId)}`, className: "rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200", children: "Open dataset" })) : null, _jsx("a", { href: sourceUrl ?? undefined, target: "_blank", rel: "noreferrer", className: `rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] transition dark:border-slate-700 ${sourceUrl
                            ? "text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:text-slate-200"
                            : "cursor-not-allowed text-slate-400 dark:text-slate-600"}`, children: "Open in source" })] }), _jsx("div", { className: "mt-4 space-y-3 text-slate-700 dark:text-slate-200", children: row.kind === "ITEM" ? (_jsxs(_Fragment, { children: [_jsx(DetailField, { label: "Key", value: row.sourceIssueKey }), _jsx(DetailField, { label: "Source id", value: row.sourceId ?? row.sourceIssueKey }), _jsx(DetailField, { label: "Summary", value: row.summary }), _jsx(DetailField, { label: "Status", value: row.status ?? "—" }), _jsx(DetailField, { label: "Priority", value: row.priority ?? "—" }), _jsx(DetailField, { label: "Assignee", value: row.assignee?.displayName ?? "Unassigned" }), _jsx(DetailField, { label: "Reporter", value: row.reporter?.displayName ?? "Unknown" }), _jsx(DetailField, { label: "Created", value: formatTimestamp(row.createdAt) }), _jsx(DetailField, { label: "Updated", value: formatTimestamp(row.updatedAt) }), _jsx(DetailField, { label: "Closed", value: formatTimestamp(row.closedAt) }), detailLoading ? (_jsx("p", { className: "text-xs text-slate-500", children: "Loading comments and worklogs\u2026" })) : (_jsxs(_Fragment, { children: [_jsx(SectionHeading, { label: "Comments" }), detail?.comments?.length ? (_jsx("ul", { className: "space-y-2", children: detail.comments.map((comment) => (_jsxs("li", { className: "rounded-xl border border-slate-200 p-2 dark:border-slate-800", children: [_jsxs("p", { className: "text-xs text-slate-500", children: [comment.author?.displayName ?? "Unknown", " \u00B7 ", formatTimestamp(comment.createdAt)] }), _jsx("p", { className: "text-sm text-slate-900 dark:text-slate-100", children: comment.body })] }, comment.cdmId))) })) : (_jsx("p", { className: "text-xs text-slate-500", children: "No comments ingested." })), _jsx(SectionHeading, { label: "Worklogs" }), detail?.worklogs?.length ? (_jsx("ul", { className: "space-y-2", children: detail.worklogs.map((log) => (_jsxs("li", { className: "rounded-xl border border-slate-200 p-2 dark:border-slate-800", children: [_jsxs("p", { className: "text-xs text-slate-500", children: [log.author?.displayName ?? "Unknown", " \u00B7 ", formatDuration(log.timeSpentSeconds)] }), _jsx("p", { className: "text-xs text-slate-500", children: formatTimestamp(log.startedAt) }), log.comment ? _jsx("p", { className: "text-sm text-slate-900 dark:text-slate-100", children: log.comment }) : null] }, log.cdmId))) })) : (_jsx("p", { className: "text-xs text-slate-500", children: "No worklogs ingested." }))] }))] })) : row.kind === "COMMENT" ? (_jsxs(_Fragment, { children: [_jsx(DetailField, { label: "Parent key", value: row.parentIssueKey ?? "—" }), _jsx(DetailField, { label: "Author", value: row.author?.displayName ?? "Unknown" }), _jsx(DetailField, { label: "Created", value: formatTimestamp(row.createdAt) }), _jsx(DetailField, { label: "Updated", value: formatTimestamp(row.updatedAt) }), _jsx(SectionHeading, { label: "Body" }), _jsx("p", { className: "text-sm text-slate-900 dark:text-slate-100", children: row.body || "—" })] })) : row.kind === "WORKLOG" ? (_jsxs(_Fragment, { children: [_jsx(DetailField, { label: "Parent key", value: row.parentIssueKey ?? "—" }), _jsx(DetailField, { label: "Author", value: row.author?.displayName ?? "Unknown" }), _jsx(DetailField, { label: "Time spent", value: formatDuration(row.timeSpentSeconds) }), _jsx(DetailField, { label: "Started", value: formatTimestamp(row.startedAt) }), _jsx(DetailField, { label: "Updated", value: formatTimestamp(extractRawTimestamp(row.raw, ["raw", "updated"])) }), _jsx(SectionHeading, { label: "Comment" }), _jsx("p", { className: "text-sm text-slate-900 dark:text-slate-100", children: row.comment || "—" })] })) : row.kind === "PROJECT" ? (_jsxs(_Fragment, { children: [_jsx(DetailField, { label: "Source system", value: row.sourceSystem }), _jsx(DetailField, { label: "Project key", value: row.sourceProjectKey }), _jsx(DetailField, { label: "Name", value: row.name }), _jsx(DetailField, { label: "Description", value: row.description ?? "—" }), row.url ? (_jsx(DetailField, { label: "URL", value: row.url })) : null, _jsx(SectionHeading, { label: "Raw payload" }), _jsx("pre", { className: "rounded-2xl bg-slate-900/90 p-3 text-xs text-emerald-100", children: JSON.stringify(rawPayload, null, 2) })] })) : row.kind === "USER" ? (_jsxs(_Fragment, { children: [_jsx(DetailField, { label: "Source system", value: row.sourceSystem ?? "—" }), _jsx(DetailField, { label: "User id", value: row.sourceUserId ?? "—" }), _jsx(DetailField, { label: "Name", value: row.displayName ?? "—" }), _jsx(DetailField, { label: "Email", value: row.email ?? "—" }), _jsx(DetailField, { label: "Status", value: row.active ? "Active" : "Inactive" }), _jsx(SectionHeading, { label: "Raw payload" }), _jsx("pre", { className: "rounded-2xl bg-slate-900/90 p-3 text-xs text-emerald-100", children: JSON.stringify(rawPayload, null, 2) })] })) : (_jsxs(_Fragment, { children: [_jsx(SectionHeading, { label: "Details" }), _jsx("pre", { className: "rounded-2xl bg-slate-900/90 p-3 text-xs text-emerald-100", children: JSON.stringify(rawPayload, null, 2) })] })) }), row.kind === "ITEM" || row.kind === "COMMENT" || row.kind === "WORKLOG" ? (_jsxs(_Fragment, { children: [row.kind === "ITEM" && row.cdmId ? (_jsx(SignalsSummaryCard, { entityRef: `cdm.work.item:${row.cdmId}`, signals: signals, loading: signalsLoading })) : null, _jsx(SectionHeading, { label: "Raw CDM record", className: "mt-6" }), _jsx("pre", { className: "mt-2 max-h-72 overflow-auto rounded-2xl bg-slate-900/90 p-3 text-xs text-emerald-100", children: JSON.stringify(rawPayload, null, 2) })] })) : null] }));
}
function DetailField({ label, value }) {
    return (_jsxs("p", { children: [_jsxs("span", { className: "font-semibold text-slate-600 dark:text-slate-300", children: [label, ": "] }), _jsx("span", { className: "text-slate-800 dark:text-slate-100", children: value ?? "—" })] }));
}
function SectionHeading({ label, className }) {
    return (_jsx("p", { className: `text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 ${className ?? ""}`, children: label }));
}
function SignalsSummaryCard({ entityRef, signals, loading, }) {
    return (_jsxs("div", { className: "mt-6 rounded-2xl border border-slate-200 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/40", "data-testid": "cdm-work-signals", children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Signals" }), _jsx("p", { className: "text-sm text-slate-600 dark:text-slate-200", children: "Recent signals for this work item" })] }), _jsx(Link, { to: `/signals?entityRef=${encodeURIComponent(entityRef)}`, className: "rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: "View all" })] }), loading ? (_jsx("p", { className: "mt-3 text-xs text-slate-500", children: "Loading signals\u2026" })) : signals.length === 0 ? (_jsx("p", { className: "mt-3 text-sm text-slate-600 dark:text-slate-300", children: "No signals found for this entity." })) : (_jsx("ul", { className: "mt-3 divide-y divide-slate-100 text-sm dark:divide-slate-800", children: signals.slice(0, 3).map((signal) => (_jsxs("li", { className: "flex items-center justify-between gap-3 py-2", "data-testid": "cdm-work-signal-row", children: [_jsxs("div", { children: [_jsx("p", { className: "font-semibold text-slate-900 dark:text-slate-100", children: signal.summary }), _jsx("p", { className: "text-xs text-slate-500", children: signal.definitionSlug })] }), _jsx("span", { className: "rounded-full border border-slate-300 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 dark:border-slate-600 dark:text-slate-200", children: signal.severity })] }, signal.id))) }))] }));
}
function resolveEntityQuery(entity) {
    switch (entity) {
        case "ITEM":
            return { query: CDM_WORK_ITEMS_QUERY, extractor: (data) => data.cdmWorkItems };
        case "COMMENT":
            return { query: CDM_WORK_COMMENTS_QUERY, extractor: (data) => data.cdmWorkComments };
        case "WORKLOG":
            return { query: CDM_WORK_LOGS_QUERY, extractor: (data) => data.cdmWorkLogs };
        case "PROJECT":
            return { query: CDM_WORK_PROJECT_CONNECTION_QUERY, extractor: (data) => data.cdmWorkProjectConnection };
        case "USER":
            return { query: CDM_WORK_USERS_QUERY, extractor: (data) => data.cdmWorkUsers };
        default:
            return { query: CDM_WORK_ITEMS_QUERY, extractor: (data) => data.cdmWorkItems };
    }
}
function buildEntityFilter(entity, args) {
    const filter = {};
    const trimmedSearch = args.search.trim();
    if (entity === "ITEM") {
        if (args.projectCdmId) {
            filter.projectCdmId = args.projectCdmId;
        }
        if (args.datasetId) {
            filter.datasetIds = [args.datasetId];
        }
        if (trimmedSearch.length > 0) {
            filter.search = trimmedSearch;
        }
        if (args.statuses.length > 0) {
            filter.statusIn = args.statuses;
        }
    }
    else if (entity === "COMMENT") {
        if (args.projectCdmId) {
            filter.projectCdmId = args.projectCdmId;
        }
        if (args.datasetId) {
            filter.datasetIds = [args.datasetId];
        }
        if (trimmedSearch.length > 0) {
            filter.search = trimmedSearch;
        }
    }
    else if (entity === "WORKLOG") {
        if (args.projectCdmId) {
            filter.projectCdmId = args.projectCdmId;
        }
        if (args.datasetId) {
            filter.datasetIds = [args.datasetId];
        }
    }
    else if (entity === "PROJECT") {
        if (args.datasetId) {
            filter.datasetIds = [args.datasetId];
        }
        if (trimmedSearch.length > 0) {
            filter.search = trimmedSearch;
        }
    }
    else if (entity === "USER") {
        if (args.datasetId) {
            filter.datasetIds = [args.datasetId];
        }
        if (trimmedSearch.length > 0) {
            filter.search = trimmedSearch;
        }
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
    if (!projectCdmId) {
        return "";
    }
    const match = projects.find((project) => project.cdmId === projectCdmId);
    return match?.name ?? projectCdmId;
}
function formatTimestamp(value) {
    if (!value) {
        return "—";
    }
    try {
        return new Date(value).toLocaleString();
    }
    catch {
        return value;
    }
}
function formatDuration(seconds) {
    if (!seconds || seconds <= 0) {
        return "—";
    }
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (!hours) {
        return `${minutes}m`;
    }
    return `${hours}h ${minutes}m`;
}
function truncateText(value, length) {
    if (!value) {
        return "—";
    }
    if (value.length <= length) {
        return value;
    }
    return `${value.slice(0, length)}…`;
}
function formatDatasetLabel(datasetId, lookup) {
    if (!datasetId) {
        return "—";
    }
    return lookup.get(datasetId)?.label ?? datasetId;
}
function resolveSourceUrl(raw) {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const rawRecord = raw;
    const candidateKeys = [
        rawRecord.source_url,
        rawRecord.sourceUrl,
        rawRecord.url,
        rawRecord.webUrl,
        rawRecord.self,
        getNestedString(rawRecord, ["raw", "self"]),
        getNestedString(rawRecord, ["raw", "url"]),
        getNestedString(rawRecord, ["rawFields", "self"]),
    ];
    return candidateKeys.find((entry) => typeof entry === "string" && entry.length > 0) ?? null;
}
function getNestedString(input, path) {
    if (!input || typeof input !== "object") {
        return null;
    }
    let current = input;
    for (const key of path) {
        if (!current || typeof current !== "object") {
            return null;
        }
        current = current[key];
    }
    return typeof current === "string" ? current : null;
}
function extractRawTimestamp(raw, path) {
    return getNestedString(raw, path);
}
function EmptyState({ title, description }) {
    return (_jsxs("div", { className: "rounded-3xl border border-dashed border-slate-300 px-6 py-10 text-center dark:border-slate-700", children: [_jsx("h2", { className: "text-lg font-semibold text-slate-900 dark:text-white", children: title }), description ? _jsx("p", { className: "mt-2 text-sm text-slate-500 dark:text-slate-400", children: description }) : null] }));
}
function Filters({ entityKind, onEntityChange, projects, projectFilter, onProjectFilterChange, statuses, selectedStatuses, onStatusToggle, datasetOptions, datasetFilter, onDatasetFilterChange, searchInput, onSearchInputChange, searchPlaceholder, }) {
    return (_jsxs("div", { className: "space-y-4 text-sm", children: [_jsx("div", { className: "flex flex-wrap gap-2", children: ENTITY_OPTIONS.map((option) => (_jsx("button", { type: "button", onClick: () => onEntityChange(option.id), className: `rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] transition ${entityKind === option.id
                        ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                        : "border-slate-200 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200"}`, children: option.label }, option.id))) }), _jsxs("div", { className: "grid gap-4 md:grid-cols-3", children: [_jsxs("div", { children: [_jsx("label", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Project" }), _jsxs("select", { className: "mt-1 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100", value: projectFilter, onChange: (event) => onProjectFilterChange(event.target.value), children: [_jsx("option", { value: "", children: "All projects" }), projects.map((project) => (_jsx("option", { value: project.cdmId, children: project.name }, project.cdmId)))] })] }), _jsxs("div", { children: [_jsx("label", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Dataset" }), _jsxs("select", { className: "mt-1 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100", value: datasetFilter, onChange: (event) => onDatasetFilterChange(event.target.value), children: [_jsx("option", { value: "", children: "All datasets" }), datasetOptions.map((dataset) => (_jsx("option", { value: dataset.datasetId, children: dataset.label }, dataset.datasetId)))] })] }), _jsxs("div", { children: [_jsx("label", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Search" }), _jsx("input", { value: searchInput, onChange: (event) => onSearchInputChange(event.target.value), placeholder: searchPlaceholder, className: "mt-1 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" })] })] }), entityKind === "ITEM" && (_jsxs("div", { className: "space-y-2", children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Status" }), _jsx("div", { className: "flex flex-wrap gap-2", children: statuses.length === 0 ? (_jsx("span", { className: "text-xs text-slate-500", children: "No statuses detected yet." })) : (statuses.map((status) => (_jsx("button", { type: "button", onClick: () => onStatusToggle(status), className: `rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] transition ${selectedStatuses.includes(status)
                                ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                                : "border-slate-200 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200"}`, children: status }, status)))) })] }))] }));
}
