import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LuActivity, LuArrowUpRight, LuFilter, LuRefreshCcw, LuTriangle } from "react-icons/lu";
import { fetchMetadataGraphQL } from "../metadata/api";
import { SIGNAL_DEFINITIONS_QUERY, SIGNAL_INSTANCES_PAGE_QUERY, CDM_ENTITY_QUERY } from "../metadata/queries";
import { useDebouncedValue } from "../metadata/hooks";
import { formatDateTime, formatRelativeTime } from "../lib/format";
const PAGE_SIZE = 25;
const SEVERITY_OPTIONS = ["CRITICAL", "ERROR", "WARNING", "INFO"];
const STATUS_OPTIONS = ["OPEN", "RESOLVED", "SUPPRESSED"];
function resolveDomainFromModel(modelId) {
    if (!modelId)
        return null;
    if (modelId.startsWith("cdm.work.item"))
        return "WORK_ITEM";
    if (modelId.startsWith("cdm.doc.item"))
        return "DOC_ITEM";
    return null;
}
export function SignalsConsole({ metadataEndpoint, authToken }) {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const initialEntityRef = searchParams.get("entityRef") ?? "";
    const headers = useMemo(() => ({ token: authToken ?? undefined }), [authToken]);
    const [definitions, setDefinitions] = useState([]);
    const [rows, setRows] = useState([]);
    const [pageCursor, setPageCursor] = useState(null);
    const [hasNextPage, setHasNextPage] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [selectedSeverities, setSelectedSeverities] = useState([]);
    const [selectedStatuses, setSelectedStatuses] = useState(["OPEN"]);
    const [selectedSourceFamilies, setSelectedSourceFamilies] = useState([]);
    const [selectedEntityKinds, setSelectedEntityKinds] = useState([]);
    const [selectedPolicyKinds, setSelectedPolicyKinds] = useState([]);
    const [definitionSearch, setDefinitionSearch] = useState("");
    const [entityRefFilter, setEntityRefFilter] = useState(initialEntityRef);
    const [timeWindow, setTimeWindow] = useState("any");
    const [entityDetails, setEntityDetails] = useState({});
    const entityDetailsRef = useRef({});
    const debouncedDefinitionSearch = useDebouncedValue(definitionSearch, 300);
    const debouncedEntityRef = useDebouncedValue(entityRefFilter, 300);
    const sourceFamilyOptions = useMemo(() => {
        const values = new Set();
        definitions.forEach((def) => {
            if (def.sourceFamily)
                values.add(def.sourceFamily);
        });
        rows.forEach((row) => {
            if (row.sourceFamily)
                values.add(row.sourceFamily);
        });
        return Array.from(values).sort();
    }, [definitions, rows]);
    const entityKindOptions = useMemo(() => {
        const values = new Set();
        definitions.forEach((def) => {
            if (def.entityKind)
                values.add(def.entityKind);
        });
        rows.forEach((row) => values.add(row.entityKind));
        return Array.from(values).sort();
    }, [definitions, rows]);
    const policyKindOptions = useMemo(() => {
        const values = new Set();
        definitions.forEach((def) => {
            if (def.policyKind)
                values.add(def.policyKind);
        });
        rows.forEach((row) => {
            if (row.policyKind)
                values.add(row.policyKind);
        });
        return Array.from(values).sort();
    }, [definitions, rows]);
    const timeWindowFromIso = useMemo(() => {
        if (timeWindow === "24h") {
            return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        }
        if (timeWindow === "7d") {
            return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        }
        return undefined;
    }, [timeWindow]);
    const loadDefinitions = useCallback(async () => {
        if (!metadataEndpoint)
            return;
        try {
            const data = await fetchMetadataGraphQL(metadataEndpoint, SIGNAL_DEFINITIONS_QUERY, undefined, undefined, headers);
            setDefinitions(data.signalDefinitions ?? []);
        }
        catch (err) {
            console.error(err);
        }
    }, [metadataEndpoint, headers]);
    const enrichEntities = useCallback(async (records, reset) => {
        if (!metadataEndpoint)
            return;
        const pending = {};
        for (const row of records) {
            if (entityDetailsRef.current[row.entityRef]) {
                continue;
            }
            const domain = resolveDomainFromModel(row.entityCdmModelId);
            if (!domain || !row.entityCdmId) {
                continue;
            }
            try {
                const detail = await fetchMetadataGraphQL(metadataEndpoint, CDM_ENTITY_QUERY, { id: row.entityCdmId, domain }, undefined, headers);
                const entity = detail.cdmEntity;
                if (entity) {
                    pending[row.entityRef] = {
                        title: entity.title ?? entity.docTitle ?? null,
                        sourceUrl: entity.sourceUrl ?? entity.docUrl ?? null,
                    };
                }
            }
            catch (err) {
                console.warn("[signals] failed to enrich entity", row.entityRef, err);
            }
        }
        if (Object.keys(pending).length > 0) {
            setEntityDetails((prev) => (reset ? { ...pending } : { ...prev, ...pending }));
        }
    }, [metadataEndpoint, headers]);
    const buildFilter = useCallback(() => {
        const filter = {};
        if (selectedSeverities.length)
            filter.severity = selectedSeverities;
        if (selectedStatuses.length)
            filter.status = selectedStatuses;
        if (selectedSourceFamilies.length)
            filter.sourceFamily = selectedSourceFamilies;
        if (selectedEntityKinds.length)
            filter.entityKinds = selectedEntityKinds;
        if (selectedPolicyKinds.length)
            filter.policyKind = selectedPolicyKinds;
        if (debouncedDefinitionSearch.trim().length)
            filter.definitionSearch = debouncedDefinitionSearch.trim();
        if (debouncedEntityRef.trim().length)
            filter.entityRef = debouncedEntityRef.trim();
        if (timeWindowFromIso)
            filter.from = timeWindowFromIso;
        return Object.keys(filter).length ? filter : undefined;
    }, [selectedSeverities, selectedStatuses, selectedSourceFamilies, selectedEntityKinds, selectedPolicyKinds, debouncedDefinitionSearch, debouncedEntityRef, timeWindowFromIso]);
    const loadSignals = useCallback(async (cursor, reset) => {
        if (!metadataEndpoint) {
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const variables = {
                filter: buildFilter(),
                first: PAGE_SIZE,
                after: cursor,
            };
            const data = await fetchMetadataGraphQL(metadataEndpoint, SIGNAL_INSTANCES_PAGE_QUERY, variables, undefined, headers);
            const nextRows = data.signalInstancesPage?.rows ?? [];
            setRows((prev) => (reset ? nextRows : [...prev, ...nextRows]));
            setHasNextPage(Boolean(data.signalInstancesPage?.hasNextPage));
            setPageCursor(data.signalInstancesPage?.cursor ?? null);
            await enrichEntities(nextRows, reset);
        }
        catch (err) {
            console.error(err);
            setError(err.message);
        }
        finally {
            setLoading(false);
        }
    }, [metadataEndpoint, headers, buildFilter, enrichEntities]);
    useEffect(() => {
        loadDefinitions();
    }, [loadDefinitions]);
    useEffect(() => {
        const nextParams = new URLSearchParams(searchParams);
        if (entityRefFilter) {
            nextParams.set("entityRef", entityRefFilter);
        }
        else {
            nextParams.delete("entityRef");
        }
        setSearchParams(nextParams, { replace: true });
    }, [entityRefFilter, searchParams, setSearchParams]);
    useEffect(() => {
        entityDetailsRef.current = entityDetails;
    }, [entityDetails]);
    useEffect(() => {
        loadSignals(null, true);
    }, [loadSignals]);
    const toggleSelection = useCallback((value, list, setter) => {
        setter(list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);
    }, []);
    const handleViewEntity = useCallback((row) => {
        const domain = resolveDomainFromModel(row.entityCdmModelId);
        if (!domain || !row.entityCdmId) {
            return;
        }
        if (domain === "WORK_ITEM") {
            navigate(`/cdm/work?selected=${encodeURIComponent(row.entityCdmId)}`);
        }
        else if (domain === "DOC_ITEM") {
            navigate(`/cdm/docs/${encodeURIComponent(row.entityCdmId)}`);
        }
    }, [navigate]);
    const clearFilters = useCallback(() => {
        setSelectedSeverities([]);
        setSelectedStatuses(["OPEN"]);
        setSelectedSourceFamilies([]);
        setSelectedEntityKinds([]);
        setSelectedPolicyKinds([]);
        setDefinitionSearch("");
        setEntityRefFilter(initialEntityRef ?? "");
        setTimeWindow("any");
        setRows([]);
        setPageCursor(null);
        setHasNextPage(false);
        setEntityDetails({});
    }, [initialEntityRef]);
    if (!metadataEndpoint) {
        return (_jsx("div", { className: "p-6 text-sm text-slate-500", "data-testid": "signals-view", children: "Signals view unavailable: metadata endpoint not configured." }));
    }
    return (_jsxs("div", { className: "flex h-full flex-col gap-6", "data-testid": "signals-view", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500", children: "Signals" }), _jsx("h1", { className: "text-2xl font-semibold text-slate-900 dark:text-white", children: "Signals Explorer" }), _jsx("p", { className: "text-xs text-slate-500 dark:text-slate-400", children: "List, filter, and navigate SignalInstances across CDM entities." })] }), _jsxs("div", { className: "flex items-center gap-2 text-sm", children: [_jsxs("button", { type: "button", className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", onClick: () => loadSignals(null, true), "data-testid": "signals-refresh", children: [_jsx(LuRefreshCcw, { className: "h-4 w-4" }), " Refresh"] }), _jsxs("button", { type: "button", className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", onClick: clearFilters, children: [_jsx(LuFilter, { className: "h-4 w-4" }), " Clear filters"] })] })] }), _jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: [_jsxs("div", { className: "grid gap-4 md:grid-cols-4", children: [_jsx(FilterBlock, { label: "Definition search", children: _jsx("input", { value: definitionSearch, onChange: (event) => setDefinitionSearch(event.target.value), placeholder: "Search slug or title", className: "w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" }) }), _jsx(FilterBlock, { label: "Entity reference", children: _jsx("input", { value: entityRefFilter, onChange: (event) => setEntityRefFilter(event.target.value), placeholder: "cdm.work.item:\u2026", className: "w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100", "data-testid": "signal-filter-entity-ref" }) }), _jsx(FilterBlock, { label: "Time window", children: _jsxs("select", { value: timeWindow, onChange: (event) => setTimeWindow(event.target.value), className: "w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100", children: [_jsx("option", { value: "any", children: "Any time" }), _jsx("option", { value: "24h", children: "Last 24 hours" }), _jsx("option", { value: "7d", children: "Last 7 days" })] }) }), _jsx(FilterBlock, { label: "Source family", children: _jsx("div", { className: "flex flex-wrap gap-2", children: sourceFamilyOptions.length === 0 ? (_jsx("span", { className: "text-xs text-slate-500", children: "No source families yet." })) : (sourceFamilyOptions.map((option) => (_jsx(TogglePill, { label: option, active: selectedSourceFamilies.includes(option), onClick: () => toggleSelection(option, selectedSourceFamilies, setSelectedSourceFamilies), dataTestId: `signal-filter-source-${option}` }, option)))) }) })] }), _jsxs("div", { className: "mt-4 grid gap-4 md:grid-cols-3", children: [_jsx(FilterGroup, { title: "Severity", options: SEVERITY_OPTIONS, selected: selectedSeverities, onToggle: (value) => toggleSelection(value, selectedSeverities, setSelectedSeverities), dataPrefix: "signal-filter-severity" }), _jsx(FilterGroup, { title: "Status", options: STATUS_OPTIONS, selected: selectedStatuses, onToggle: (value) => toggleSelection(value, selectedStatuses, setSelectedStatuses), dataPrefix: "signal-filter-status" }), _jsx(FilterGroup, { title: "Entity kind", options: entityKindOptions, selected: selectedEntityKinds, onToggle: (value) => toggleSelection(value, selectedEntityKinds, setSelectedEntityKinds), dataPrefix: "signal-filter-entity" })] }), _jsx("div", { className: "mt-4 grid gap-4 md:grid-cols-2", children: _jsx(FilterGroup, { title: "Policy", options: policyKindOptions, selected: selectedPolicyKinds, onToggle: (value) => toggleSelection(value, selectedPolicyKinds, setSelectedPolicyKinds), dataPrefix: "signal-filter-policy" }) })] }), _jsxs("div", { className: "rounded-3xl border border-slate-200 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-900/60", children: [error ? (_jsx("div", { className: "border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100", children: error })) : null, _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800", children: [_jsx("thead", { className: "bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:bg-slate-900/60", children: _jsxs("tr", { children: [_jsx("th", { className: "px-4 py-3", children: "Severity" }), _jsx("th", { className: "px-4 py-3", children: "Status" }), _jsx("th", { className: "px-4 py-3", children: "Summary" }), _jsx("th", { className: "px-4 py-3", children: "Definition" }), _jsx("th", { className: "px-4 py-3", children: "Source" }), _jsx("th", { className: "px-4 py-3", children: "Entity" }), _jsx("th", { className: "px-4 py-3", children: "Updated" }), _jsx("th", { className: "px-4 py-3", children: "Actions" })] }) }), _jsx("tbody", { className: "divide-y divide-slate-100 dark:divide-slate-800", children: rows.length === 0 && !loading ? (_jsx("tr", { children: _jsx("td", { colSpan: 8, className: "px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400", children: "No signals match the current filters." }) })) : (rows.map((row) => (_jsxs("tr", { "data-testid": "signal-row", className: "hover:bg-slate-50 dark:hover:bg-slate-800/40", children: [_jsx("td", { className: "px-4 py-3", children: _jsx(SeverityPill, { severity: row.severity }) }), _jsx("td", { className: "px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 dark:text-slate-300", children: row.status }), _jsx("td", { className: "px-4 py-3 text-slate-800 dark:text-slate-100", children: row.summary }), _jsxs("td", { className: "px-4 py-3", children: [_jsx("p", { className: "font-semibold text-slate-900 dark:text-white", children: row.definitionTitle }), _jsx("p", { className: "text-xs text-slate-500", children: row.definitionSlug })] }), _jsx("td", { className: "px-4 py-3 text-xs text-slate-600 dark:text-slate-300", children: _jsxs("div", { className: "flex flex-col", children: [_jsx("span", { children: row.sourceFamily ?? "—" }), _jsx("span", { className: "text-[11px] uppercase tracking-[0.3em] text-slate-500", children: row.entityKind })] }) }), _jsxs("td", { className: "px-4 py-3 text-sm text-slate-800 dark:text-slate-100", children: [_jsx("p", { className: "font-semibold", children: entityDetails[row.entityRef]?.title ?? row.entityCdmId ?? row.entityRef }), _jsx("p", { className: "text-xs text-slate-500", children: row.entityCdmModelId ?? "—" })] }), _jsx("td", { className: "px-4 py-3 text-xs text-slate-500 dark:text-slate-400", children: row.lastSeenAt ? (_jsx("span", { title: formatDateTime(row.lastSeenAt), children: formatRelativeTime(row.lastSeenAt) })) : (row.updatedAt ? _jsx("span", { title: formatDateTime(row.updatedAt), children: formatRelativeTime(row.updatedAt) }) : "—") }), _jsx("td", { className: "px-4 py-3", children: _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsxs("button", { type: "button", onClick: () => handleViewEntity(row), className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", disabled: !row.entityCdmId, "data-testid": "signal-view-entity", children: [_jsx(LuArrowUpRight, { className: "h-4 w-4" }), " View entity"] }), entityDetails[row.entityRef]?.sourceUrl ? (_jsxs("a", { href: entityDetails[row.entityRef]?.sourceUrl ?? undefined, target: "_blank", rel: "noreferrer", className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", "data-testid": "signal-open-source", children: [_jsx(LuActivity, { className: "h-4 w-4" }), " Open in source"] })) : null] }) })] }, row.id)))) })] }) }), loading ? (_jsx("div", { className: "border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-500 dark:border-slate-800", children: "Loading signals\u2026" })) : null, !loading && hasNextPage ? (_jsx("div", { className: "border-t border-slate-100 px-4 py-3 text-center dark:border-slate-800", children: _jsx("button", { type: "button", onClick: () => loadSignals(pageCursor, false), className: "rounded-full border border-slate-300 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", "data-testid": "signals-load-more", children: "Load more" }) })) : null] })] }));
}
function FilterBlock({ label, children }) {
    return (_jsxs("label", { className: "flex flex-col gap-1 text-sm", children: [_jsx("span", { className: "text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500", children: label }), children] }));
}
function FilterGroup({ title, options, selected, onToggle, dataPrefix, }) {
    return (_jsxs("div", { className: "space-y-2", children: [_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500", children: title }), _jsx("div", { className: "flex flex-wrap gap-2", children: options.length === 0 ? (_jsx("span", { className: "text-xs text-slate-500", children: "No options detected yet." })) : (options.map((option) => (_jsx(TogglePill, { label: option, active: selected.includes(option), onClick: () => onToggle(option), dataTestId: `${dataPrefix}-${option}` }, option)))) })] }));
}
function TogglePill({ label, active, onClick, dataTestId, }) {
    return (_jsx("button", { type: "button", onClick: onClick, "data-testid": dataTestId, className: `rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] transition ${active
            ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
            : "border-slate-200 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200"}`, children: label }));
}
function SeverityPill({ severity }) {
    const tone = severityTone(severity);
    return (_jsxs("span", { className: `inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] ${tone.bg} ${tone.text}`, children: [_jsx(LuTriangle, { className: "h-4 w-4" }), severity] }));
}
function severityTone(severity) {
    switch (severity) {
        case "CRITICAL":
            return { bg: "bg-rose-100 dark:bg-rose-900/40", text: "text-rose-700 dark:text-rose-100" };
        case "ERROR":
            return { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-100" };
        case "WARNING":
            return { bg: "bg-yellow-100 dark:bg-yellow-900/40", text: "text-yellow-700 dark:text-yellow-100" };
        default:
            return { bg: "bg-slate-100 dark:bg-slate-800", text: "text-slate-700 dark:text-slate-200" };
    }
}
