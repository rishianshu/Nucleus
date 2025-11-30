import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useMemo, useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchMetadataGraphQL } from "../metadata/api";
import { CDM_ENTITY_CONNECTION_QUERY, CDM_ENTITY_QUERY } from "../metadata/queries";
import { useDebouncedValue } from "../metadata/hooks";
const PAGE_SIZE = 25;
export function CdmDocsListView({ metadataEndpoint, authToken }) {
    const navigate = useNavigate();
    const { entityId } = useParams();
    const [sourceFilter, setSourceFilter] = useState("");
    const [spaceFilter, setSpaceFilter] = useState("");
    const [searchInput, setSearchInput] = useState("");
    const [entities, setEntities] = useState([]);
    const [pageInfo, setPageInfo] = useState({ endCursor: null, hasNextPage: false });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [selectedEntity, setSelectedEntity] = useState(null);
    const headers = useMemo(() => ({ token: authToken ?? undefined }), [authToken]);
    const debouncedSearch = useDebouncedValue(searchInput, 300);
    const filterVariables = useMemo(() => {
        return {
            domain: "DOC_ITEM",
            sourceSystems: sourceFilter ? [sourceFilter] : undefined,
            docSpaceIds: spaceFilter ? [spaceFilter] : undefined,
            search: debouncedSearch || undefined,
        };
    }, [sourceFilter, spaceFilter, debouncedSearch]);
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
    const uniqueSources = useMemo(() => Array.from(new Set(entities.map((entity) => entity.sourceSystem))).sort(), [entities]);
    const uniqueSpaces = useMemo(() => {
        const values = entities
            .map((entity) => (typeof entity.data?.spaceCdmId === "string" ? entity.data.spaceCdmId : null))
            .filter(Boolean);
        return Array.from(new Set(values)).sort();
    }, [entities]);
    if (!metadataEndpoint) {
        return _jsx(EmptyState, { title: "Metadata endpoint not configured", description: "Cannot load CDM docs data." });
    }
    return (_jsxs("div", { className: "grid gap-6 lg:grid-cols-[2fr,1fr]", children: [_jsxs("div", { className: "space-y-4", children: [_jsx("div", { className: "rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: _jsxs("div", { className: "grid gap-3 sm:grid-cols-3", children: [_jsxs("label", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: ["Source", _jsxs("select", { className: "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100", value: sourceFilter, onChange: (event) => {
                                                setSourceFilter(event.target.value);
                                                loadEntities(null, true);
                                            }, children: [_jsx("option", { value: "", children: "All" }), uniqueSources.map((source) => (_jsx("option", { value: source, children: source }, source)))] })] }), _jsxs("label", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: ["Space", _jsxs("select", { className: "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100", value: spaceFilter, onChange: (event) => {
                                                setSpaceFilter(event.target.value);
                                                loadEntities(null, true);
                                            }, children: [_jsx("option", { value: "", children: "All" }), uniqueSpaces.map((space) => (_jsx("option", { value: space, children: space }, space)))] })] }), _jsxs("label", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: ["Search", _jsx("input", { type: "text", className: "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100", placeholder: "Search title", value: searchInput, onChange: (event) => setSearchInput(event.target.value) })] })] }) }), _jsx("div", { className: "rounded-3xl border border-slate-200 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: error ? (_jsx("div", { className: "p-6 text-sm text-rose-500", children: error })) : (_jsxs("div", { className: "overflow-x-auto", children: [_jsxs("table", { className: "min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800", children: [_jsx("thead", { className: "bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:bg-slate-900/60", children: _jsxs("tr", { children: [_jsx("th", { className: "px-4 py-3", children: "Title" }), _jsx("th", { className: "px-4 py-3", children: "Space" }), _jsx("th", { className: "px-4 py-3", children: "Source" }), _jsx("th", { className: "px-4 py-3", children: "Updated" })] }) }), _jsx("tbody", { className: "divide-y divide-slate-100 dark:divide-slate-800", children: entities.length === 0 && !loading ? (_jsx("tr", { children: _jsx("td", { colSpan: 4, className: "px-4 py-6 text-center text-sm text-slate-500", children: "No CDM docs found. Adjust filters or run CDM ingestion." }) })) : (entities.map((entity) => (_jsxs("tr", { className: "cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/40", onClick: () => {
                                                    setSelectedEntity(entity);
                                                    navigate(`/cdm/docs/${encodeURIComponent(entity.cdmId)}`);
                                                }, children: [_jsx("td", { className: "px-4 py-3 font-medium text-slate-900 dark:text-slate-100", children: entity.title ?? entity.cdmId }), _jsx("td", { className: "px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-500", children: typeof entity.data?.spaceCdmId === "string" ? entity.data.spaceCdmId : "—" }), _jsx("td", { className: "px-4 py-3 text-slate-700 dark:text-slate-200", children: entity.sourceSystem }), _jsx("td", { className: "px-4 py-3 text-xs text-slate-500 dark:text-slate-400", children: entity.updatedAt ? new Date(entity.updatedAt).toLocaleString() : "—" })] }, entity.cdmId)))) })] }), loading && (_jsx("div", { className: "border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-500 dark:border-slate-800", children: "Loading\u2026" })), !loading && pageInfo.hasNextPage && (_jsx("div", { className: "border-t border-slate-100 px-4 py-3 text-center dark:border-slate-800", children: _jsx("button", { type: "button", onClick: () => loadEntities(pageInfo.endCursor, false), className: "rounded-full border border-slate-300 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: "Load more" }) }))] })) })] }), _jsx("div", { className: "rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: selectedEntity ? (_jsx(DocDetailCard, { entity: selectedEntity })) : (_jsx(EmptyState, { title: "Select a doc", description: "Choose a doc item to view metadata." })) })] }));
}
function EmptyState({ title, description }) {
    return (_jsxs("div", { className: "flex flex-col items-center justify-center gap-2 text-center text-slate-500", children: [_jsx("p", { className: "text-sm font-semibold text-slate-600 dark:text-slate-200", children: title }), _jsx("p", { className: "text-xs text-slate-500 dark:text-slate-400", children: description })] }));
}
function DocDetailCard({ entity }) {
    const metadata = entity.data ?? {};
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500", children: "CDM DOC" }), _jsx("h2", { className: "text-xl font-semibold text-slate-900 dark:text-white", children: entity.title ?? entity.cdmId }), _jsxs("p", { className: "text-xs text-slate-500", children: ["Source \u00B7 ", entity.sourceSystem] })] }), _jsxs("dl", { className: "space-y-3 text-sm", children: [_jsxs("div", { children: [_jsx("dt", { className: "text-xs uppercase tracking-[0.3em] text-slate-500", children: "CDM ID" }), _jsx("dd", { className: "font-mono text-slate-900 dark:text-slate-100", children: entity.cdmId })] }), _jsxs("div", { children: [_jsx("dt", { className: "text-xs uppercase tracking-[0.3em] text-slate-500", children: "Space" }), _jsx("dd", { children: typeof metadata.spaceCdmId === "string" ? metadata.spaceCdmId : "—" })] }), _jsxs("div", { children: [_jsx("dt", { className: "text-xs uppercase tracking-[0.3em] text-slate-500", children: "Type" }), _jsx("dd", { children: typeof metadata.docType === "string" ? metadata.docType : entity.state ?? "—" })] }), _jsxs("div", { children: [_jsx("dt", { className: "text-xs uppercase tracking-[0.3em] text-slate-500", children: "Updated" }), _jsx("dd", { children: entity.updatedAt ? new Date(entity.updatedAt).toLocaleString() : "—" })] }), _jsxs("div", { children: [_jsx("dt", { className: "text-xs uppercase tracking-[0.3em] text-slate-500", children: "Link" }), _jsx("dd", { children: typeof metadata.url === "string" ? (_jsx("a", { href: metadata.url, target: "_blank", rel: "noreferrer", className: "text-blue-600 underline", children: "Open in source" })) : ("—") })] })] })] }));
}
