import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useMemo, useState, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fetchMetadataGraphQL } from "../metadata/api";
import { CDM_ENTITY_CONNECTION_QUERY, CDM_ENTITY_QUERY, CDM_DOCS_DATASETS_QUERY, SIGNALS_FOR_ENTITY_QUERY } from "../metadata/queries";
import { useDebouncedValue } from "../metadata/hooks";
const PAGE_SIZE = 25;
export function CdmDocsListView({ metadataEndpoint, authToken }) {
    const navigate = useNavigate();
    const { entityId } = useParams();
    const headers = useMemo(() => ({ token: authToken ?? undefined }), [authToken]);
    const [datasetOptions, setDatasetOptions] = useState([]);
    const datasetLookup = useMemo(() => new Map(datasetOptions.map((entry) => [entry.datasetId, entry])), [datasetOptions]);
    const [selectedDatasetId, setSelectedDatasetId] = useState("");
    const [sourceFilter, setSourceFilter] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const debouncedSearch = useDebouncedValue(searchInput, 300);
    const [entities, setEntities] = useState([]);
    const [pageInfo, setPageInfo] = useState({
        endCursor: null,
        hasNextPage: false,
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [selectedEntity, setSelectedEntity] = useState(null);
    const filterVariables = useMemo(() => {
        return {
            domain: "DOC_ITEM",
            docDatasetIds: selectedDatasetId ? [selectedDatasetId] : undefined,
            docSourceSystems: sourceFilter ? [sourceFilter] : undefined,
            docSearch: debouncedSearch || undefined,
        };
    }, [selectedDatasetId, sourceFilter, debouncedSearch]);
    const loadEntities = useCallback(async (cursor, reset) => {
        if (!metadataEndpoint) {
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const variables = {
                filter: filterVariables,
                first: PAGE_SIZE,
                after: cursor,
            };
            const data = await fetchMetadataGraphQL(metadataEndpoint, CDM_ENTITY_CONNECTION_QUERY, variables, undefined, headers);
            const nextRows = data.cdmEntities.edges.map((edge) => edge.node);
            setEntities((prev) => (reset ? nextRows : [...prev, ...nextRows]));
            setPageInfo({
                endCursor: data.cdmEntities.pageInfo.endCursor ?? null,
                hasNextPage: data.cdmEntities.pageInfo.hasNextPage,
            });
        }
        catch (err) {
            console.error(err);
            setError(err.message);
        }
        finally {
            setLoading(false);
        }
    }, [metadataEndpoint, filterVariables, headers]);
    useEffect(() => {
        loadEntities(null, true);
    }, [loadEntities]);
    const loadDetail = useCallback(async (cdmId) => {
        if (!metadataEndpoint) {
            return;
        }
        try {
            const data = await fetchMetadataGraphQL(metadataEndpoint, CDM_ENTITY_QUERY, { id: cdmId, domain: "DOC_ITEM" }, undefined, headers);
            if (data.cdmEntity) {
                setSelectedEntity(data.cdmEntity);
            }
        }
        catch (err) {
            console.error(err);
            setError(err.message);
        }
    }, [metadataEndpoint, headers]);
    useEffect(() => {
        if (entityId) {
            loadDetail(entityId);
        }
        else {
            setSelectedEntity(null);
        }
    }, [entityId, loadDetail]);
    useEffect(() => {
        if (!metadataEndpoint) {
            setDatasetOptions([]);
            return;
        }
        let cancelled = false;
        const loadDatasets = async () => {
            try {
                const resp = await fetchMetadataGraphQL(metadataEndpoint, CDM_DOCS_DATASETS_QUERY, undefined, undefined, headers);
                if (cancelled) {
                    return;
                }
                const records = Array.isArray(resp.cdmDocsDatasets) ? resp.cdmDocsDatasets : [];
                setDatasetOptions(records);
                if (selectedDatasetId && !records.some((entry) => entry.datasetId === selectedDatasetId)) {
                    setSelectedDatasetId("");
                }
            }
            catch (err) {
                console.error(err);
                if (!cancelled) {
                    setError(err.message);
                }
            }
        };
        loadDatasets();
        return () => {
            cancelled = true;
        };
    }, [metadataEndpoint, headers, selectedDatasetId]);
    const sourceOptions = useMemo(() => {
        const values = new Set();
        datasetOptions.forEach((entry) => {
            if (entry.sourceSystem) {
                values.add(entry.sourceSystem);
            }
        });
        entities.forEach((entity) => {
            if (entity.docSourceSystem ?? entity.sourceSystem) {
                values.add((entity.docSourceSystem ?? entity.sourceSystem));
            }
        });
        return Array.from(values).sort();
    }, [datasetOptions, entities]);
    if (!metadataEndpoint) {
        return _jsx(EmptyState, { title: "Metadata endpoint not configured", description: "Cannot load CDM docs data." });
    }
    return (_jsxs("div", { className: "grid gap-6 lg:grid-cols-[2fr,1fr]", children: [_jsxs("div", { className: "space-y-4", children: [_jsx("div", { className: "rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: _jsxs("div", { className: "grid gap-3 sm:grid-cols-3", children: [_jsx(FilterBlock, { label: "Dataset", children: _jsxs("select", { value: selectedDatasetId, onChange: (event) => setSelectedDatasetId(event.target.value), className: "w-full rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 text-sm outline-none transition focus:border-slate-900 dark:border-slate-600 dark:bg-slate-900/60", children: [_jsx("option", { value: "", children: "All datasets" }), datasetOptions.map((dataset) => (_jsxs("option", { value: dataset.datasetId, children: [dataset.name, " \u00B7 ", dataset.endpointName] }, dataset.id)))] }) }), _jsx(FilterBlock, { label: "Source", children: _jsxs("select", { value: sourceFilter, onChange: (event) => setSourceFilter(event.target.value), className: "w-full rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 text-sm outline-none transition focus:border-slate-900 dark:border-slate-600 dark:bg-slate-900/60", children: [_jsx("option", { value: "", children: "All sources" }), sourceOptions.map((source) => (_jsx("option", { value: source, children: source }, source)))] }) }), _jsx(FilterBlock, { label: "Search", children: _jsx("input", { type: "text", value: searchInput, onChange: (event) => setSearchInput(event.target.value), placeholder: "Search titles, paths, or excerpts\u2026", className: "w-full rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 text-sm outline-none transition focus:border-slate-900 dark:border-slate-600 dark:bg-slate-900/60" }) })] }) }), _jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: [error && (_jsx("div", { className: "border-b border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800 dark:border-red-400/40 dark:bg-red-950/40 dark:text-red-200", children: error })), entities.length === 0 && !loading ? (_jsx("div", { className: "p-6", children: _jsx(EmptyState, { title: "No docs found", description: "Try adjusting your dataset, source, or search filters." }) })) : (_jsxs("div", { className: "overflow-x-auto", children: [_jsxs("table", { className: "min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800", children: [_jsx("thead", { className: "bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:bg-slate-900/60", children: _jsxs("tr", { children: [_jsx("th", { className: "px-4 py-3", children: "Project" }), _jsx("th", { className: "px-4 py-3", children: "Title" }), _jsx("th", { className: "px-4 py-3", children: "Type" }), _jsx("th", { className: "px-4 py-3", children: "Source" }), _jsx("th", { className: "px-4 py-3", children: "Updated" })] }) }), _jsx("tbody", { className: "divide-y divide-slate-100 dark:divide-slate-800", children: entities.map((entity) => (_jsxs("tr", { className: "cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/40", onClick: () => {
                                                        setSelectedEntity(entity);
                                                        navigate(`/cdm/docs/${encodeURIComponent(entity.cdmId)}`);
                                                    }, children: [_jsxs("td", { className: "px-4 py-3", children: [_jsx("p", { className: "font-medium text-slate-900 dark:text-slate-100", children: entity.docProjectName ?? "—" }), _jsx("p", { className: "text-[11px] uppercase tracking-[0.3em] text-slate-500", children: entity.docProjectKey ?? " " })] }), _jsxs("td", { className: "px-4 py-3", children: [_jsx("p", { className: "font-semibold text-slate-900 dark:text-white", children: entity.docTitle ?? entity.title ?? entity.cdmId }), _jsx("p", { className: "text-xs text-slate-500 dark:text-slate-400 line-clamp-2", children: entity.docContentExcerpt ?? "No excerpt available" })] }), _jsx("td", { className: "px-4 py-3 text-slate-700 dark:text-slate-200", children: entity.docType ?? entity.state ?? "—" }), _jsxs("td", { className: "px-4 py-3 text-slate-700 dark:text-slate-200", children: [_jsx("p", { children: formatDatasetLabel(entity, datasetLookup) }), _jsx("p", { className: "text-xs text-slate-500 dark:text-slate-400", children: entity.docSourceSystem ?? entity.sourceSystem })] }), _jsx("td", { className: "px-4 py-3 text-xs text-slate-500 dark:text-slate-400", children: formatDateTime(entity.docUpdatedAt ?? entity.updatedAt) })] }, entity.cdmId))) })] }), loading && (_jsx("div", { className: "border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-500 dark:border-slate-800", children: "Loading\u2026" })), !loading && pageInfo.hasNextPage && (_jsx("div", { className: "border-t border-slate-100 px-4 py-3 text-center dark:border-slate-800", children: _jsx("button", { type: "button", onClick: () => loadEntities(pageInfo.endCursor, false), className: "rounded-full border border-slate-300 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: "Load more" }) }))] }))] })] }), _jsx("div", { className: "rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: selectedEntity ? (_jsx(DocDetailCard, { entity: selectedEntity, datasetLookup: datasetLookup, metadataEndpoint: metadataEndpoint, authToken: authToken })) : (_jsx(EmptyState, { title: "Select a doc", description: "Choose a document to view metadata and content excerpts." })) })] }));
}
function EmptyState({ title, description }) {
    return (_jsxs("div", { className: "flex flex-col items-center justify-center gap-2 text-center text-slate-500", children: [_jsx("p", { className: "text-sm font-semibold text-slate-600 dark:text-slate-200", children: title }), _jsx("p", { className: "text-xs text-slate-500 dark:text-slate-400", children: description })] }));
}
function FilterBlock({ label, children }) {
    return (_jsxs("label", { className: "flex flex-col gap-1", children: [_jsx("span", { className: "text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500", children: label }), children] }));
}
function SignalsInlineSummary({ signals, loading, entityRef }) {
    return (_jsxs("div", { className: "rounded-2xl border border-slate-200 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/40", "data-testid": "cdm-doc-signals", children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Signals" }), _jsx("p", { className: "text-xs text-slate-600 dark:text-slate-300", children: "Recent signals for this document" })] }), _jsx(Link, { to: `/signals?entityRef=${encodeURIComponent(entityRef)}`, className: "rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: "View all" })] }), loading ? (_jsx("p", { className: "mt-2 text-xs text-slate-500", children: "Loading signals\u2026" })) : signals.length === 0 ? (_jsx("p", { className: "mt-2 text-sm text-slate-600 dark:text-slate-300", children: "No signals for this document." })) : (_jsx("ul", { className: "mt-3 divide-y divide-slate-100 text-sm dark:divide-slate-800", children: signals.slice(0, 3).map((signal) => (_jsxs("li", { className: "flex items-center justify-between gap-3 py-2", "data-testid": "cdm-doc-signal-row", children: [_jsxs("div", { children: [_jsx("p", { className: "font-semibold text-slate-900 dark:text-slate-100", children: signal.summary }), _jsx("p", { className: "text-xs text-slate-500", children: signal.definitionSlug })] }), _jsx("span", { className: "rounded-full border border-slate-300 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 dark:border-slate-600 dark:text-slate-200", children: signal.severity })] }, signal.id))) }))] }));
}
function DocDetailCard({ entity, datasetLookup, metadataEndpoint, authToken, }) {
    const [signals, setSignals] = useState([]);
    const [signalsLoading, setSignalsLoading] = useState(false);
    const datasetId = entity.docDatasetId ??
        (typeof entity.data?.datasetId === "string" ? entity.data.datasetId : null) ??
        null;
    const datasetRecord = datasetId ? datasetLookup.get(datasetId) : null;
    const datasetName = datasetRecord?.name ?? entity.docDatasetName ?? datasetId ?? "—";
    const datasetEndpoint = datasetRecord?.endpointName ?? entity.docSourceEndpointId ?? null;
    const datasetLink = datasetId ? `/catalog/datasets/${datasetId}` : null;
    const sourceSystem = entity.docSourceSystem ?? entity.sourceSystem;
    const sourceUrl = entity.sourceUrl ?? entity.docUrl ?? (typeof entity.data?.url === "string" ? entity.data.url : null) ?? null;
    const updatedAt = entity.docUpdatedAt ?? entity.updatedAt;
    const location = entity.docLocation ?? (typeof entity.data?.path === "string" ? entity.data.path : null);
    const metadata = entity.rawSource ?? entity.data ?? {};
    useEffect(() => {
        let cancelled = false;
        const loadSignals = async () => {
            if (!metadataEndpoint || !entity.cdmId) {
                setSignals([]);
                return;
            }
            setSignalsLoading(true);
            try {
                const resp = await fetchMetadataGraphQL(metadataEndpoint, SIGNALS_FOR_ENTITY_QUERY, { entityRef: `cdm.doc.item:${entity.cdmId}`, first: 5 }, undefined, { token: authToken ?? undefined });
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
    }, [metadataEndpoint, authToken, entity.cdmId]);
    const detailRows = [
        { label: "Project / Workspace", value: formatProjectLabel(entity) },
        { label: "Location", value: location ?? "—" },
        { label: "Type", value: entity.docType ?? entity.state ?? "—" },
        { label: "Dataset", value: datasetName ?? "—" },
        { label: "Source id", value: entity.sourceId ?? entity.cdmId },
        { label: "Source system", value: sourceSystem ?? "—" },
        { label: "Source endpoint", value: datasetEndpoint ?? "—" },
        { label: "Updated", value: formatDateTime(updatedAt) },
    ];
    return (_jsxs("div", { className: "space-y-5", children: [_jsxs("div", { children: [_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500", children: "CDM DOC" }), _jsx("h2", { className: "text-xl font-semibold text-slate-900 dark:text-white", children: entity.docTitle ?? entity.title ?? entity.cdmId }), _jsxs("p", { className: "text-xs text-slate-500", children: [sourceSystem, datasetName ? ` · ${datasetName}` : null] })] }), _jsxs("div", { className: "flex flex-wrap gap-3", children: [sourceUrl && (_jsx("a", { className: "rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", href: sourceUrl, target: "_blank", rel: "noreferrer", children: "Open in source" })), datasetLink && (_jsx("a", { className: "rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", href: datasetLink, children: "View dataset" }))] }), _jsx(SignalsInlineSummary, { signals: signals, loading: signalsLoading, entityRef: `cdm.doc.item:${entity.cdmId}` }), _jsx("dl", { className: "space-y-4 text-sm", children: detailRows.map((row) => (_jsxs("div", { children: [_jsx("dt", { className: "text-[10px] uppercase tracking-[0.4em] text-slate-500", children: row.label }), _jsx("dd", { className: "text-slate-900 dark:text-slate-100", children: row.value ?? "—" })] }, row.label))) }), entity.docContentExcerpt && (_jsxs("div", { className: "rounded-2xl bg-slate-50/80 p-4 text-sm text-slate-700 shadow-inner dark:bg-slate-800/50 dark:text-slate-200", children: [_jsx("p", { className: "text-[10px] uppercase tracking-[0.4em] text-slate-500", children: "Content excerpt" }), _jsx("p", { className: "mt-2 whitespace-pre-line", children: entity.docContentExcerpt })] })), _jsxs("details", { className: "rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/40", open: true, children: [_jsx("summary", { className: "cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-200", children: "Raw CDM payload" }), _jsx("pre", { className: "mt-2 overflow-x-auto rounded-xl bg-slate-900/80 p-4 text-xs text-slate-100", children: JSON.stringify(metadata, null, 2) })] })] }));
}
function formatDatasetLabel(entity, lookup) {
    if (entity.docDatasetId) {
        const match = lookup.get(entity.docDatasetId);
        if (match) {
            return `${match.name} · ${match.endpointName}`;
        }
        if (entity.docDatasetName) {
            return entity.docDatasetName;
        }
        return entity.docDatasetId;
    }
    return entity.docDatasetName ?? entity.sourceSystem;
}
function formatProjectLabel(entity) {
    if (entity.docProjectName && entity.docProjectKey) {
        return `${entity.docProjectName} (${entity.docProjectKey})`;
    }
    return entity.docProjectName ?? entity.docProjectKey ?? "—";
}
function formatDateTime(value) {
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
