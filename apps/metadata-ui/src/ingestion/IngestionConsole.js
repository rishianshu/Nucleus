import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LuArrowRight, LuCircleDashed, LuCirclePause, LuCirclePlay, LuCircleSlash, LuClock3, LuInfo, LuRefreshCcw, LuSlidersHorizontal, LuSearch, LuTriangleAlert, LuX, } from "react-icons/lu";
import { formatRelativeTime } from "../lib/format";
import { fetchMetadataGraphQL } from "../metadata/api";
import { INGESTION_ENDPOINTS_QUERY, INGESTION_UNITS_WITH_STATUS_QUERY, START_INGESTION_MUTATION, PAUSE_INGESTION_MUTATION, RESET_INGESTION_CHECKPOINT_MUTATION, CONFIGURE_INGESTION_UNIT_MUTATION, JIRA_FILTER_OPTIONS_QUERY, CONFLUENCE_FILTER_OPTIONS_QUERY, } from "../metadata/queries";
import { useDebouncedValue, useToastQueue } from "../metadata/hooks";
import { formatIngestionMode, formatIngestionSchedule, formatIngestionSink, ingestionStateTone, summarizePolicy, } from "./stateTone";
const endpointSidebarWidth = 320;
const DEFAULT_JIRA_FILTER_FORM = {
    projectKeys: [],
    statuses: [],
    assigneeIds: [],
    updatedFrom: null,
};
const DEFAULT_CONFLUENCE_FILTER_FORM = {
    spaceKeys: [],
    updatedFrom: null,
};
export function IngestionConsole({ metadataEndpoint, authToken, projectSlug, userRole }) {
    const location = useLocation();
    const navigate = useNavigate();
    const endpointQueryParam = useMemo(() => {
        const params = new URLSearchParams(location.search);
        const requested = params.get("endpointId");
        return requested && requested.length > 0 ? requested : null;
    }, [location.search]);
    const [endpointSearch, setEndpointSearch] = useState("");
    const debouncedSearch = useDebouncedValue(endpointSearch, 350);
    const [endpoints, setEndpoints] = useState([]);
    const [endpointLoading, setEndpointLoading] = useState(false);
    const [endpointError, setEndpointError] = useState(null);
    const [selectedEndpointId, setSelectedEndpointId] = useState(endpointQueryParam);
    const [units, setUnits] = useState([]);
    const [unitsLoading, setUnitsLoading] = useState(false);
    const [unitsRefetching, setUnitsRefetching] = useState(false);
    const [unitsError, setUnitsError] = useState(null);
    const [unitsVersion, setUnitsVersion] = useState(0);
    const [actionState, setActionState] = useState({});
    const [configuringUnit, setConfiguringUnit] = useState(null);
    const [configForm, setConfigForm] = useState(null);
    const [configSaving, setConfigSaving] = useState(false);
    const [configError, setConfigError] = useState(null);
    const [sinkDescriptors, setSinkDescriptors] = useState([]);
    const [jiraFilterOptions, setJiraFilterOptions] = useState(null);
    const [jiraFilterLoading, setJiraFilterLoading] = useState(false);
    const [jiraFilterError, setJiraFilterError] = useState(null);
    const [confluenceFilterOptions, setConfluenceFilterOptions] = useState(null);
    const [confluenceFilterLoading, setConfluenceFilterLoading] = useState(false);
    const [confluenceFilterError, setConfluenceFilterError] = useState(null);
    const sinkDescriptorMap = useMemo(() => new Map(sinkDescriptors.map((sink) => [sink.id, sink])), [sinkDescriptors]);
    const cdmSinkEndpoints = useMemo(() => endpoints.filter((endpoint) => {
        const labels = endpoint.labels ?? [];
        return labels.includes("sink:cdm") || labels.includes("cdm-sink");
    }), [endpoints]);
    const sinkSupportsCdm = useCallback((sinkId, modelId) => {
        const descriptor = sinkDescriptorMap.get(sinkId);
        if (!descriptor?.supportedCdmModels || descriptor.supportedCdmModels.length === 0) {
            return false;
        }
        return descriptor.supportedCdmModels.some((pattern) => matchesCdmPattern(pattern, modelId));
    }, [sinkDescriptorMap]);
    const drawerSinkOptions = useMemo(() => {
        if (!configuringUnit || !configForm) {
            return [];
        }
        const baseOptions = sinkDescriptors.map((sink) => sink.id);
        const extras = [configForm.sinkId, configuringUnit.sinkId, "kb"].filter((value) => typeof value === "string" && value.length > 0);
        let merged = Array.from(new Set([...baseOptions, ...extras]));
        if (configForm.mode === "cdm" && configuringUnit.cdmModelId) {
            const compatible = merged.filter((sinkId) => sinkSupportsCdm(sinkId, configuringUnit.cdmModelId));
            if (compatible.length > 0) {
                return compatible;
            }
        }
        return merged;
    }, [configuringUnit, configForm, sinkDescriptors, sinkSupportsCdm]);
    const cdmCompatibleSinkIds = useMemo(() => {
        if (!configuringUnit?.cdmModelId) {
            return [];
        }
        return sinkDescriptors
            .filter((sink) => sinkSupportsCdm(sink.id, configuringUnit.cdmModelId))
            .map((sink) => sink.id);
    }, [configuringUnit, sinkDescriptors, sinkSupportsCdm]);
    const cdmModeActive = Boolean(configForm && configuringUnit?.cdmModelId && configForm.mode === "cdm");
    const selectedSinkSupportsCdm = !cdmModeActive || !configForm || !configuringUnit?.cdmModelId
        ? true
        : sinkSupportsCdm(configForm.sinkId, configuringUnit.cdmModelId);
    const supportsJiraFilters = Boolean(configuringUnit && isJiraUnitId(configuringUnit.unitId));
    const supportsConfluenceFilters = Boolean(configuringUnit && isConfluenceUnitId(configuringUnit.unitId));
    const saveDisabled = !configForm || configSaving || (cdmModeActive && !selectedSinkSupportsCdm);
    const toastQueue = useToastQueue();
    const isAdmin = userRole === "ADMIN";
    const abortRef = useRef(null);
    const updateEndpointQuery = useCallback((nextId) => {
        const params = new URLSearchParams(location.search);
        if (nextId) {
            params.set("endpointId", nextId);
        }
        else {
            params.delete("endpointId");
        }
        const searchString = params.toString();
        navigate({
            pathname: location.pathname,
            search: searchString.length ? `?${searchString}` : "",
        }, { replace: true });
    }, [location.pathname, location.search, navigate]);
    const applySelectedEndpoint = useCallback((nextId, options) => {
        setSelectedEndpointId(nextId);
        if (options?.syncUrl === false) {
            return;
        }
        updateEndpointQuery(nextId);
    }, [updateEndpointQuery]);
    useEffect(() => {
        if (endpointQueryParam === selectedEndpointId) {
            return;
        }
        applySelectedEndpoint(endpointQueryParam, { syncUrl: false });
    }, [endpointQueryParam, selectedEndpointId, applySelectedEndpoint]);
    useEffect(() => {
        if (!metadataEndpoint || !authToken) {
            setEndpoints([]);
            setEndpointLoading(false);
            setEndpointError(null);
            applySelectedEndpoint(null);
            return;
        }
        let cancelled = false;
        setEndpointLoading(true);
        setEndpointError(null);
        fetchMetadataGraphQL(metadataEndpoint, INGESTION_ENDPOINTS_QUERY, {
            projectSlug: projectSlug ?? undefined,
            search: debouncedSearch || undefined,
            first: 200,
        }, undefined, { token: authToken ?? undefined })
            .then((data) => {
            if (cancelled) {
                return;
            }
            setEndpoints(data.endpoints ?? []);
        })
            .catch((error) => {
            if (!cancelled) {
                setEndpointError(error instanceof Error ? error.message : String(error));
            }
        })
            .finally(() => {
            if (!cancelled) {
                setEndpointLoading(false);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [metadataEndpoint, authToken, projectSlug, debouncedSearch, applySelectedEndpoint]);
    const refreshUnits = useCallback(() => {
        setUnitsVersion((prev) => prev + 1);
    }, []);
    const loadUnits = useCallback(async (endpointId, { silent } = {}) => {
        if (!metadataEndpoint || !authToken) {
            setUnits([]);
            setUnitsError(null);
            return;
        }
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        if (!silent) {
            setUnitsLoading(true);
        }
        else {
            setUnitsRefetching(true);
        }
        setUnitsError(null);
        try {
            const payload = await fetchMetadataGraphQL(metadataEndpoint, INGESTION_UNITS_WITH_STATUS_QUERY, { endpointId }, controller.signal, { token: authToken ?? undefined });
            const statuses = new Map(payload.ingestionStatuses?.map((status) => [status.unitId, status]));
            const configMap = new Map((payload.ingestionUnitConfigs ?? []).map((config) => [config.unitId, config]));
            const combined = (payload.ingestionUnits ?? []).map((unit) => {
                const status = statuses.get(unit.unitId);
                const config = configMap.get(unit.unitId) ?? null;
                return {
                    ...unit,
                    datasetId: unit.datasetId ?? unit.unitId,
                    state: status?.state ?? "IDLE",
                    lastRunAt: status?.lastRunAt ?? null,
                    lastRunId: status?.lastRunId ?? null,
                    lastError: status?.lastError ?? null,
                    stats: (status?.stats ?? unit.stats ?? null),
                    checkpoint: (status?.checkpoint ?? null),
                    config,
                };
            });
            combined.sort((a, b) => a.displayName.localeCompare(b.displayName));
            setUnits(combined);
            setSinkDescriptors(payload.ingestionSinks ?? []);
            setUnitsError(null);
        }
        catch (error) {
            if (controller.signal.aborted) {
                return;
            }
            setUnitsError(error instanceof Error ? error.message : String(error));
        }
        finally {
            if (!controller.signal.aborted) {
                setUnitsLoading(false);
                setUnitsRefetching(false);
            }
        }
    }, [metadataEndpoint, authToken]);
    useEffect(() => {
        if (!selectedEndpointId) {
            setUnits([]);
            setSinkDescriptors([]);
            setUnitsError(null);
            return;
        }
        void loadUnits(selectedEndpointId, { silent: Boolean(units.length) });
    }, [selectedEndpointId, loadUnits, unitsVersion]);
    useEffect(() => {
        if (endpointLoading) {
            return;
        }
        if (endpoints.length === 0) {
            if (selectedEndpointId) {
                applySelectedEndpoint(null);
            }
            return;
        }
        const hasSelection = selectedEndpointId && endpoints.some((endpoint) => endpoint.id === selectedEndpointId);
        if (hasSelection) {
            return;
        }
        const desired = (endpointQueryParam &&
            endpoints.find((endpoint) => endpoint.id === endpointQueryParam)?.id) ??
            endpoints[0]?.id ??
            null;
        if (desired) {
            applySelectedEndpoint(desired);
        }
    }, [endpointLoading, endpoints, selectedEndpointId, endpointQueryParam, applySelectedEndpoint]);
    useEffect(() => {
        if (!metadataEndpoint || !authToken || !configuringUnit || !isJiraUnitId(configuringUnit.unitId)) {
            setJiraFilterOptions(null);
            setJiraFilterError(null);
            setJiraFilterLoading(false);
            return;
        }
        let cancelled = false;
        setJiraFilterLoading(true);
        setJiraFilterError(null);
        fetchMetadataGraphQL(metadataEndpoint, JIRA_FILTER_OPTIONS_QUERY, { endpointId: configuringUnit.endpointId }, undefined, { token: authToken ?? undefined })
            .then((result) => {
            if (cancelled) {
                return;
            }
            setJiraFilterOptions(result?.jiraIngestionFilterOptions ?? { projects: [], statuses: [], users: [] });
        })
            .catch((error) => {
            if (cancelled) {
                return;
            }
            setJiraFilterError(error instanceof Error ? error.message : String(error));
            setJiraFilterOptions({ projects: [], statuses: [], users: [] });
        })
            .finally(() => {
            if (!cancelled) {
                setJiraFilterLoading(false);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [metadataEndpoint, authToken, configuringUnit]);
    useEffect(() => {
        if (!metadataEndpoint ||
            !authToken ||
            !configuringUnit ||
            !isConfluenceUnitId(configuringUnit.unitId)) {
            setConfluenceFilterOptions(null);
            setConfluenceFilterError(null);
            setConfluenceFilterLoading(false);
            return;
        }
        let cancelled = false;
        setConfluenceFilterLoading(true);
        setConfluenceFilterError(null);
        fetchMetadataGraphQL(metadataEndpoint, CONFLUENCE_FILTER_OPTIONS_QUERY, { endpointId: configuringUnit.endpointId }, undefined, { token: authToken ?? undefined })
            .then((result) => {
            if (cancelled) {
                return;
            }
            setConfluenceFilterOptions(result?.confluenceIngestionFilterOptions ?? { spaces: [] });
        })
            .catch((error) => {
            if (cancelled) {
                return;
            }
            setConfluenceFilterError(error instanceof Error ? error.message : String(error));
            setConfluenceFilterOptions({ spaces: [] });
        })
            .finally(() => {
            if (!cancelled) {
                setConfluenceFilterLoading(false);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [metadataEndpoint, authToken, configuringUnit]);
    const endpointOptions = useMemo(() => endpoints.map((endpoint) => ({
        id: endpoint.id,
        name: endpoint.name,
        description: endpoint.description ?? endpoint.domain ?? "—",
        disabled: Boolean(endpoint.deletedAt),
    })), [endpoints]);
    const selectedEndpoint = useMemo(() => endpoints.find((endpoint) => endpoint.id === selectedEndpointId) ?? null, [endpoints, selectedEndpointId]);
    const handleAction = useCallback(async (mutation, unitId, intent, successMessage, errorMessage) => {
        if (!metadataEndpoint || !authToken || !selectedEndpointId) {
            toastQueue.pushToast({
                title: "Not connected to metadata API",
                description: "Reload the page and try again.",
                intent: "error",
            });
            return;
        }
        setActionState((prev) => ({ ...prev, [unitId]: intent }));
        try {
            const payload = await fetchMetadataGraphQL(metadataEndpoint, mutation, { endpointId: selectedEndpointId, unitId }, undefined, { token: authToken ?? undefined });
            const result = payload.startIngestion ?? payload.pauseIngestion ?? payload.resetIngestionCheckpoint;
            if (!result?.ok) {
                throw new Error(result?.message || errorMessage);
            }
            toastQueue.pushToast({
                title: successMessage,
                description: result.message ?? undefined,
                intent: "success",
            });
            refreshUnits();
        }
        catch (error) {
            toastQueue.pushToast({
                title: errorMessage,
                description: error instanceof Error ? error.message : String(error),
                intent: "error",
            });
        }
        finally {
            setActionState((prev) => {
                const next = { ...prev };
                delete next[unitId];
                return next;
            });
        }
    }, [metadataEndpoint, authToken, selectedEndpointId, toastQueue, refreshUnits]);
    const ensureUnitConfigured = useCallback((unit, actionLabel) => {
        if (!unit.config || !unit.config.enabled) {
            toastQueue.pushToast({
                title: `${actionLabel} unavailable`,
                description: "Configure and enable this unit first.",
                intent: "info",
            });
            return false;
        }
        return true;
    }, [toastQueue]);
    const persistConfig = useCallback(async (unit, overrides, intent) => {
        if (!metadataEndpoint || !authToken) {
            return;
        }
        setActionState((prev) => ({ ...prev, [unit.unitId]: intent }));
        const input = buildConfigInput(unit, overrides);
        try {
            await fetchMetadataGraphQL(metadataEndpoint, CONFIGURE_INGESTION_UNIT_MUTATION, { input }, undefined, { token: authToken ?? undefined });
            toastQueue.pushToast({
                title: overrides.enabled === undefined ? "Configuration saved" : overrides.enabled ? "Ingestion enabled" : "Ingestion disabled",
                description: `${unit.displayName} updated.`,
                intent: "success",
            });
            refreshUnits();
        }
        catch (error) {
            toastQueue.pushToast({
                title: `Unable to update ${unit.displayName}`,
                description: error instanceof Error ? error.message : String(error),
                intent: "error",
            });
            throw error;
        }
        finally {
            setActionState((prev) => {
                const next = { ...prev };
                delete next[unit.unitId];
                return next;
            });
        }
    }, [metadataEndpoint, authToken, toastQueue, refreshUnits]);
    const handleToggleUnit = useCallback((unit, nextEnabled) => {
        void persistConfig(unit, { enabled: nextEnabled }, "toggle");
    }, [persistConfig]);
    const openConfigureDrawer = useCallback((unit) => {
        setConfiguringUnit(unit);
        setConfigForm({
            enabled: unit.config?.enabled ?? false,
            runMode: (unit.config?.runMode ?? unit.defaultMode ?? "FULL").toUpperCase(),
            mode: unit.config?.mode ?? "raw",
            scheduleKind: (unit.config?.scheduleKind ?? unit.defaultScheduleKind ?? "MANUAL").toUpperCase(),
            scheduleIntervalMinutes: unit.config?.scheduleIntervalMinutes ?? unit.defaultScheduleIntervalMinutes ?? 15,
            sinkId: unit.config?.sinkId ?? unit.sinkId,
            sinkEndpointId: unit.config?.sinkEndpointId ?? null,
            policyText: stringifyPolicy(unit.config?.policy ?? unit.defaultPolicy ?? null),
            jiraFilter: reduceJiraFilterToFormValue(unit.config?.jiraFilter ?? null),
            confluenceFilter: reduceConfluenceFilterToFormValue(unit.config?.confluenceFilter ?? null),
        });
        setConfigError(null);
    }, []);
    const closeConfigureDrawer = useCallback(() => {
        setConfiguringUnit(null);
        setConfigForm(null);
        setConfigError(null);
        setJiraFilterOptions(null);
        setJiraFilterError(null);
        setJiraFilterLoading(false);
        setConfluenceFilterOptions(null);
        setConfluenceFilterError(null);
        setConfluenceFilterLoading(false);
    }, []);
    const updateConfigForm = useCallback((patch) => {
        setConfigForm((prev) => (prev ? { ...prev, ...patch } : prev));
    }, []);
    const updateJiraFilterForm = useCallback((patch) => {
        setConfigForm((prev) => (prev ? { ...prev, jiraFilter: { ...prev.jiraFilter, ...patch } } : prev));
    }, []);
    const resetJiraFilterForm = useCallback(() => {
        setConfigForm((prev) => (prev ? { ...prev, jiraFilter: { ...DEFAULT_JIRA_FILTER_FORM } } : prev));
    }, []);
    const updateConfluenceFilterForm = useCallback((patch) => {
        setConfigForm((prev) => prev ? { ...prev, confluenceFilter: { ...prev.confluenceFilter, ...patch } } : prev);
    }, []);
    const resetConfluenceFilterForm = useCallback(() => {
        setConfigForm((prev) => prev ? { ...prev, confluenceFilter: { ...DEFAULT_CONFLUENCE_FILTER_FORM } } : prev);
    }, []);
    const handleFilterMultiSelect = useCallback((event, field) => {
        const values = Array.from(event.target.selectedOptions).map((option) => option.value);
        updateJiraFilterForm({ [field]: values });
    }, [updateJiraFilterForm]);
    const handleConfluenceSpaceSelect = useCallback((event) => {
        const values = Array.from(event.target.selectedOptions).map((option) => option.value);
        updateConfluenceFilterForm({ spaceKeys: values });
    }, [updateConfluenceFilterForm]);
    const handleSaveConfig = useCallback(async () => {
        if (!configuringUnit || !configForm) {
            return;
        }
        let parsedPolicy = null;
        if (configForm.policyText.trim().length) {
            try {
                parsedPolicy = JSON.parse(configForm.policyText);
            }
            catch (error) {
                setConfigError("Policy must be valid JSON.");
                return;
            }
        }
        if (configForm.mode === "cdm" && configuringUnit.cdmModelId && !sinkSupportsCdm(configForm.sinkId, configuringUnit.cdmModelId)) {
            setConfigError("Select a sink that supports this CDM model.");
            return;
        }
        if (configForm.mode === "cdm" && !configForm.sinkEndpointId) {
            setConfigError("Select a sink endpoint for CDM mode.");
            return;
        }
        setConfigSaving(true);
        setConfigError(null);
        try {
            await persistConfig(configuringUnit, {
                enabled: configForm.enabled,
                runMode: configForm.runMode,
                mode: configForm.mode ?? "raw",
                sinkId: configForm.sinkId,
                sinkEndpointId: configForm.sinkEndpointId ?? null,
                scheduleKind: configForm.scheduleKind,
                scheduleIntervalMinutes: configForm.scheduleKind === "INTERVAL" ? configForm.scheduleIntervalMinutes : null,
                policy: parsedPolicy,
                jiraFilter: configForm.jiraFilter,
                confluenceFilter: configForm.confluenceFilter,
            }, "configure");
            closeConfigureDrawer();
        }
        catch (error) {
            setConfigError(error instanceof Error ? error.message : String(error));
        }
        finally {
            setConfigSaving(false);
        }
    }, [configuringUnit, configForm, persistConfig, closeConfigureDrawer]);
    const handleRunUnit = useCallback((unit) => {
        if (!ensureUnitConfigured(unit, "Run ingestion")) {
            return;
        }
        handleAction(START_INGESTION_MUTATION, unit.unitId, "start", "Ingestion run started", "Unable to start ingestion");
    }, [handleAction, ensureUnitConfigured]);
    const handlePauseUnit = useCallback((unit) => {
        if (!ensureUnitConfigured(unit, "Pause ingestion")) {
            return;
        }
        handleAction(PAUSE_INGESTION_MUTATION, unit.unitId, "pause", "Ingestion paused", "Unable to pause ingestion");
    }, [handleAction, ensureUnitConfigured]);
    const handleResetUnit = useCallback((unit) => {
        if (!ensureUnitConfigured(unit, "Reset checkpoint")) {
            return;
        }
        handleAction(RESET_INGESTION_CHECKPOINT_MUTATION, unit.unitId, "reset", "Checkpoint reset", "Unable to reset checkpoint");
    }, [handleAction, ensureUnitConfigured]);
    const toastPortal = toastQueue.toasts.length ? (_jsx("div", { className: "pointer-events-none fixed inset-x-0 top-4 z-40 flex justify-end px-4 sm:px-6", children: _jsx("div", { className: "flex w-full max-w-sm flex-col gap-2", children: toastQueue.toasts.map((toast) => {
                const tone = toast.intent === "success" ? "text-emerald-200" : toast.intent === "error" ? "text-rose-200" : "text-white";
                return (_jsx("div", { className: `pointer-events-auto rounded-2xl border border-white/10 bg-slate-900/90 px-4 py-3 text-sm text-white shadow-2xl backdrop-blur ${toast.intent === "success" ? "border-emerald-400/40" : toast.intent === "error" ? "border-rose-400/50" : ""}`, children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx(LuInfo, { className: `mt-0.5 h-4 w-4 ${tone}`, "aria-hidden": "true" }), _jsxs("div", { className: "flex-1", children: [_jsx("p", { className: "font-semibold", children: toast.title }), toast.description ? _jsx("p", { className: "mt-1 text-xs text-slate-200", children: toast.description }) : null] }), _jsx("button", { type: "button", onClick: () => toastQueue.dismissToast(toast.id), className: "text-xs font-semibold uppercase tracking-[0.3em] text-white/70 transition hover:text-white", children: "\u00D7" })] }) }, toast.id));
            }) }) })) : null;
    return (_jsxs("div", { className: "relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-950 text-slate-100", "data-testid": "ingestion-console", children: [toastPortal, _jsxs("div", { className: "flex flex-none flex-col gap-3 border-b border-white/5 px-6 py-5", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-[11px] font-semibold uppercase tracking-[0.4em] text-slate-400", children: "Control Plane" }), _jsx("h1", { className: "text-2xl font-semibold text-white", children: "Ingestion" }), _jsx("p", { className: "text-sm text-slate-400", children: "Discover units, trigger runs, and keep Temporal workflows in sync. Updates stream directly from Metadata API." })] }), _jsx("div", { className: "flex items-center gap-3", children: _jsxs("button", { type: "button", onClick: () => selectedEndpointId && loadUnits(selectedEndpointId, { silent: Boolean(units.length) }), disabled: !selectedEndpointId || unitsLoading, className: "inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:border-white disabled:cursor-not-allowed disabled:opacity-40", children: [_jsx(LuRefreshCcw, { className: "h-4 w-4", "aria-hidden": "true" }), "Refresh"] }) })] }), unitsRefetching ? (_jsxs("div", { className: "flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400", children: [_jsx(LuRefreshCcw, { className: "h-3 w-3 animate-spin", "aria-hidden": "true" }), "Updating latest status\u2026"] })) : null] }), _jsxs("div", { className: "flex min-h-0 flex-1 overflow-hidden", children: [_jsxs("aside", { className: "flex h-full flex-col border-r border-white/5 bg-slate-950/60 px-5 py-5 backdrop-blur", style: { width: endpointSidebarWidth }, children: [_jsxs("div", { className: "space-y-3", children: [_jsx("label", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-400", children: "Endpoints" }), _jsxs("div", { className: "relative", children: [_jsx(LuSearch, { className: "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" }), _jsx("input", { type: "search", placeholder: "Search by name or domain", value: endpointSearch, onChange: (event) => setEndpointSearch(event.target.value), className: "w-full rounded-2xl border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-sm text-white placeholder:text-slate-500 focus:border-white focus:outline-none" })] })] }), _jsx("div", { className: "mt-4 flex-1 overflow-y-auto pr-2", children: endpointLoading && !endpoints.length ? (_jsx("div", { className: "space-y-3", children: Array.from({ length: 6 }).map((_, index) => (_jsx("div", { className: "h-16 rounded-2xl bg-white/5 animate-pulse" }, index))) })) : endpointError ? (_jsxs("div", { className: "rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-4 text-sm text-rose-100", children: ["Unable to load endpoints.", _jsx("br", {}), endpointError] })) : endpointOptions.length ? (_jsx("div", { className: "space-y-2", children: endpointOptions.map((endpoint) => {
                                        const isActive = endpoint.id === selectedEndpointId;
                                        return (_jsxs("button", { type: "button", disabled: endpoint.disabled, onClick: () => applySelectedEndpoint(endpoint.id), className: `w-full rounded-2xl border px-4 py-3 text-left transition ${isActive
                                                ? "border-white bg-white/5 shadow-lg"
                                                : "border-white/5 bg-white/5 hover:border-white/40"} ${endpoint.disabled ? "opacity-50" : ""}`, children: [_jsx("p", { className: "text-sm font-semibold text-white", children: endpoint.name }), _jsx("p", { className: "text-xs text-slate-400", children: endpoint.description })] }, endpoint.id));
                                    }) })) : (_jsx("div", { className: "rounded-2xl border border-white/10 px-4 py-6 text-center text-sm text-slate-400", children: "No endpoints match this filter." })) })] }), _jsx("main", { className: "flex min-h-0 flex-1 flex-col px-6 py-5", children: !selectedEndpoint ? (_jsxs("div", { className: "flex h-full flex-col items-center justify-center text-center text-slate-400", children: [_jsx(LuCircleSlash, { className: "mb-3 h-10 w-10 text-slate-500" }), _jsx("p", { className: "text-lg font-semibold text-white", children: "Select an endpoint to inspect ingestion" }), _jsx("p", { className: "mt-1 text-sm", children: "Use the sidebar to choose a source. Units, checkpoints, and actions will show here." })] })) : unitsLoading && !units.length ? (_jsx("div", { className: "flex flex-1 items-center justify-center", children: _jsxs("div", { className: "flex flex-col items-center gap-3 text-slate-400", children: [_jsx(LuRefreshCcw, { className: "h-8 w-8 animate-spin text-slate-300" }), _jsx("p", { children: "Loading ingestion units\u2026" })] }) })) : unitsError ? (_jsxs("div", { className: "flex flex-1 flex-col items-center justify-center text-center text-rose-100", children: [_jsx(LuTriangleAlert, { className: "mb-3 h-10 w-10" }), _jsx("p", { className: "text-lg font-semibold", children: "Unable to load ingestion units" }), _jsx("p", { className: "mt-1 text-sm text-rose-200", children: unitsError }), _jsxs("button", { type: "button", onClick: () => selectedEndpointId && loadUnits(selectedEndpointId), className: "mt-4 inline-flex items-center gap-2 rounded-full border border-white/40 px-4 py-2 text-sm font-semibold text-white transition hover:border-white", children: [_jsx(LuRefreshCcw, { className: "h-4 w-4" }), "Retry"] })] })) : units.length === 0 ? (_jsxs("div", { className: "flex flex-1 flex-col items-center justify-center text-center text-slate-400", "data-testid": "ingestion-empty-state", children: [_jsx(LuCircleDashed, { className: "mb-3 h-10 w-10 text-slate-500" }), _jsx("p", { className: "text-lg font-semibold text-white", children: "No ingestion units yet" }), _jsx("p", { className: "mt-1 text-sm", children: "The selected endpoint has not registered any units. Configure a driver or re-register the source." })] })) : (_jsxs("div", { className: "flex h-full flex-col", children: [_jsxs("div", { className: "flex flex-col gap-2 rounded-3xl border border-white/10 bg-white/5 px-5 py-4", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.3em] text-slate-400", children: [_jsx("span", { className: "font-semibold text-white", children: selectedEndpoint.name }), _jsx(LuArrowRight, { className: "h-3 w-3 text-slate-500", "aria-hidden": "true" }), _jsx("span", { children: selectedEndpoint.domain ?? "custom" })] }), _jsx("div", { className: "flex flex-wrap items-center gap-2 text-sm text-slate-300", children: selectedEndpoint.capabilities?.slice(0, 4).map((capability) => (_jsx("span", { className: "rounded-full border border-white/10 px-2 py-0.5 text-xs uppercase tracking-[0.2em]", children: capability }, capability))) })] }), _jsx("div", { className: "mt-6 flex-1 overflow-auto rounded-3xl border border-white/5 bg-slate-950/40", children: _jsxs("table", { className: "min-w-full divide-y divide-white/5 text-sm", children: [_jsx("thead", { children: _jsxs("tr", { className: "text-left text-xs uppercase tracking-[0.35em] text-slate-400", children: [_jsx("th", { className: "px-6 py-4", children: "Unit" }), _jsx("th", { className: "px-6 py-4", children: "State" }), _jsx("th", { className: "px-6 py-4", children: "Mode" }), _jsx("th", { className: "px-6 py-4", children: "Schedule" }), _jsx("th", { className: "px-6 py-4", children: "Sink" }), _jsx("th", { className: "px-6 py-4", children: "Last Run" }), _jsx("th", { className: "px-6 py-4", children: "Stats" }), _jsx("th", { className: "px-6 py-4", children: "Actions" })] }) }), _jsx("tbody", { className: "divide-y divide-white/5", children: units.map((unit) => {
                                                    const tone = ingestionStateTone[unit.state];
                                                    const relativeRun = unit.lastRunAt ? formatRelativeTime(unit.lastRunAt) : "Never";
                                                    const isBusy = Boolean(actionState[unit.unitId]);
                                                    const localIntent = actionState[unit.unitId];
                                                    const statsSummary = summarizeStats(unit.stats);
                                                    const config = unit.config;
                                                    const isConfigured = Boolean(config);
                                                    const isEnabled = Boolean(config?.enabled);
                                                    const effectiveMode = formatIngestionMode(config?.runMode ?? unit.defaultMode ?? "FULL");
                                                    const scheduleKind = (config?.scheduleKind ?? unit.defaultScheduleKind ?? "MANUAL").toUpperCase();
                                                    const scheduleInterval = scheduleKind === "INTERVAL"
                                                        ? config?.scheduleIntervalMinutes ?? unit.defaultScheduleIntervalMinutes ?? 15
                                                        : null;
                                                    const scheduleLabel = formatIngestionSchedule(scheduleKind, scheduleInterval);
                                                    const sinkLabel = formatIngestionSink(config?.sinkId ?? unit.sinkId);
                                                    const policySummary = summarizePolicy(config?.policy ?? unit.defaultPolicy ?? null);
                                                    const canMutate = isAdmin;
                                                    const canControl = canMutate && isEnabled;
                                                    return (_jsxs("tr", { className: "align-top text-slate-200", "data-testid": "ingestion-unit-row", children: [_jsxs("td", { className: "px-6 py-4", children: [_jsx("div", { className: "font-semibold text-white", children: unit.displayName }), _jsx("p", { className: "text-xs text-slate-400", children: unit.unitId })] }), _jsxs("td", { className: "px-6 py-4", children: [_jsxs("div", { className: `inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${tone.badge}`, children: [_jsx("span", { className: `h-2 w-2 rounded-full ${tone.dot}` }), tone.label] }), unit.lastError ? (_jsxs("p", { className: "mt-2 flex items-center gap-2 text-xs text-rose-200", children: [_jsx(LuTriangleAlert, { className: "h-3 w-3" }), " ", unit.lastError] })) : null] }), _jsxs("td", { className: "px-6 py-4", children: [_jsx("div", { className: "inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em]", children: effectiveMode }), policySummary.length ? (_jsx("div", { className: "mt-2 text-[11px] uppercase tracking-[0.3em] text-slate-400", children: policySummary.join(" · ") })) : (_jsx("p", { className: "mt-2 text-xs text-slate-500", children: "No policy overrides." })), !isConfigured ? (_jsx("p", { className: "mt-2 text-xs text-amber-200", children: "Configure this unit to enable ingestion." })) : null] }), _jsxs("td", { className: "px-6 py-4", children: [_jsxs("div", { className: "flex items-center gap-2 text-slate-300", children: [_jsx(LuClock3, { className: "h-4 w-4" }), " ", scheduleLabel] }), scheduleKind === "INTERVAL" && scheduleInterval ? (_jsxs("p", { className: "text-xs text-slate-500", children: ["Interval \u00B7 every ", scheduleInterval, " minutes"] })) : (_jsx("p", { className: "text-xs text-slate-500", children: "Manual runs only." }))] }), _jsxs("td", { className: "px-6 py-4", children: [_jsx("div", { className: "inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em]", children: sinkLabel }), _jsx("p", { className: "mt-2 text-xs text-slate-500", children: isEnabled ? "Enabled" : isConfigured ? "Configured but disabled" : "Not configured" })] }), _jsxs("td", { className: "px-6 py-4", children: [_jsxs("div", { className: "flex items-center gap-2 text-slate-300", children: [_jsx(LuClock3, { className: "h-4 w-4" }), " ", relativeRun] }), unit.lastRunId ? _jsx("p", { className: "text-xs text-slate-500", children: unit.lastRunId }) : null] }), _jsx("td", { className: "px-6 py-4", children: statsSummary ? (_jsx("div", { className: "flex flex-wrap gap-2 text-xs", children: statsSummary.map((entry) => (_jsxs("span", { className: "rounded-full border border-white/10 px-2 py-0.5 text-slate-300", children: [entry.label, ": ", _jsx("span", { className: "font-semibold text-white", children: entry.value })] }, entry.label))) })) : (_jsx("span", { className: "text-xs text-slate-500", children: "No stats" })) }), _jsx("td", { className: "px-6 py-4", children: _jsxs("div", { className: "flex flex-col gap-3", children: [_jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsxs("button", { type: "button", onClick: () => openConfigureDrawer(unit), disabled: !canMutate, className: "inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-slate-200 transition hover:border-white disabled:cursor-not-allowed disabled:opacity-40", children: [_jsx(LuSlidersHorizontal, { className: "h-3 w-3" }), "Configure"] }), _jsxs("button", { type: "button", onClick: () => handleToggleUnit(unit, !isEnabled), disabled: !canMutate || isBusy, className: `inline-flex items-center gap-3 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] transition ${isEnabled
                                                                                        ? "border-emerald-400/30 text-emerald-100"
                                                                                        : "border-slate-400/40 text-slate-200"} disabled:cursor-not-allowed disabled:opacity-40`, children: [_jsx("span", { className: `flex h-5 w-10 items-center rounded-full ${isEnabled ? "bg-emerald-500/70" : "bg-slate-600/80"}`, children: _jsx("span", { className: `h-4 w-4 rounded-full bg-white transition ${isEnabled ? "translate-x-5" : "translate-x-1"}` }) }), isEnabled ? "Disable" : "Enable"] })] }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsxs("button", { type: "button", onClick: () => handleRunUnit(unit), disabled: isBusy || !canControl, className: "inline-flex items-center gap-2 rounded-full border border-emerald-400/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-100 transition hover:border-emerald-200 disabled:cursor-not-allowed disabled:opacity-50", children: [localIntent === "start" ? (_jsx(LuRefreshCcw, { className: "h-3 w-3 animate-spin" })) : (_jsx(LuCirclePlay, { className: "h-3 w-3" })), "Run"] }), _jsxs("button", { type: "button", onClick: () => handlePauseUnit(unit), disabled: isBusy || !canControl, className: "inline-flex items-center gap-2 rounded-full border border-amber-400/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-amber-100 transition hover:border-amber-200 disabled:cursor-not-allowed disabled:opacity-50", children: [localIntent === "pause" ? (_jsx(LuRefreshCcw, { className: "h-3 w-3 animate-spin" })) : (_jsx(LuCirclePause, { className: "h-3 w-3" })), "Pause"] }), _jsxs("button", { type: "button", onClick: () => handleResetUnit(unit), disabled: isBusy || !canControl, className: "inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-slate-200 transition hover:border-white disabled:cursor-not-allowed disabled:opacity-50", children: [localIntent === "reset" ? (_jsx(LuRefreshCcw, { className: "h-3 w-3 animate-spin" })) : (_jsx(LuCircleSlash, { className: "h-3 w-3" })), "Reset"] })] })] }) })] }, unit.unitId));
                                                }) })] }) })] })) })] }), configuringUnit && configForm ? (_jsxs("div", { className: "pointer-events-auto fixed inset-0 z-40 flex", children: [_jsx("div", { className: "absolute inset-0 bg-slate-950/70 backdrop-blur-sm", "aria-hidden": "true", onClick: () => {
                            if (!configSaving) {
                                closeConfigureDrawer();
                            }
                        } }), _jsxs("div", { className: "relative ml-auto flex h-full w-full max-w-md flex-col bg-slate-950/95 p-6 text-slate-100 shadow-2xl", children: [_jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsxs("div", { children: [_jsx("p", { className: "text-[11px] font-semibold uppercase tracking-[0.4em] text-slate-400", children: "Configure ingestion" }), _jsx("h2", { className: "text-xl font-semibold text-white", children: configuringUnit.displayName }), _jsx("p", { className: "text-xs text-slate-400", children: configuringUnit.datasetId ?? configuringUnit.unitId })] }), _jsx("button", { type: "button", onClick: closeConfigureDrawer, disabled: configSaving, className: "rounded-full border border-white/20 p-2 text-slate-200 transition hover:border-white disabled:cursor-not-allowed disabled:opacity-40", "aria-label": "Close configure drawer", children: _jsx(LuX, { className: "h-4 w-4", "aria-hidden": "true" }) })] }), configError ? (_jsx("div", { className: "mt-4 rounded-2xl border border-rose-500/50 bg-rose-500/20 px-4 py-3 text-sm text-rose-100", role: "alert", children: configError })) : null, _jsxs("div", { className: "mt-5 flex-1 space-y-5 overflow-y-auto", children: [_jsx("section", { className: "rounded-2xl border border-white/10 p-4", children: _jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-400", children: "Enable ingestion" }), _jsx("p", { className: "text-[13px] text-slate-400", children: "Toggle to allow schedules and manual runs." })] }), _jsxs("button", { type: "button", onClick: () => updateConfigForm({ enabled: !configForm.enabled }), className: `inline-flex items-center gap-3 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] transition ${configForm.enabled ? "border-emerald-400/40 text-emerald-100" : "border-slate-500/50 text-slate-200"}`, children: [_jsx("span", { className: `flex h-5 w-10 items-center rounded-full ${configForm.enabled ? "bg-emerald-500/70" : "bg-slate-600/80"}`, children: _jsx("span", { className: `h-4 w-4 rounded-full bg-white transition ${configForm.enabled ? "translate-x-5" : "translate-x-1"}` }) }), configForm.enabled ? "Enabled" : "Disabled"] })] }) }), _jsxs("section", { className: "rounded-2xl border border-white/10 p-4", children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-400", children: "Mode & policy" }), _jsxs("div", { className: "mt-3 space-y-3", children: [_jsxs("label", { className: "block text-sm text-slate-200", children: ["Mode", _jsx("select", { value: configForm.runMode, onChange: (event) => updateConfigForm({ runMode: event.target.value.toUpperCase() }), className: "mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white", children: Array.from(new Set((configuringUnit.supportedModes ?? [configuringUnit.defaultMode ?? "FULL"]).map((mode) => (mode ?? "FULL").toUpperCase()))).map((mode) => (_jsx("option", { value: mode, children: mode === "INCREMENTAL" ? "Incremental (cursor)" : mode === "FULL" ? "Full refresh" : mode }, mode))) })] }), configuringUnit.cdmModelId ? (_jsxs("label", { className: "block text-sm text-slate-200", children: ["Data format", _jsxs("select", { value: configForm.mode, onChange: (event) => {
                                                                    const nextMode = event.target.value;
                                                                    if (nextMode === "cdm" &&
                                                                        configuringUnit.cdmModelId &&
                                                                        cdmCompatibleSinkIds.length > 0 &&
                                                                        !sinkSupportsCdm(configForm.sinkId, configuringUnit.cdmModelId)) {
                                                                        updateConfigForm({ mode: nextMode, sinkId: cdmCompatibleSinkIds[0] });
                                                                        return;
                                                                    }
                                                                    updateConfigForm({ mode: nextMode });
                                                                }, className: "mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white", children: [_jsx("option", { value: "raw", children: "Store raw source data" }), _jsxs("option", { value: "cdm", disabled: cdmCompatibleSinkIds.length === 0, children: ["Apply CDM (", configuringUnit.cdmModelId, ")"] })] }), configForm.mode === "cdm" && cdmCompatibleSinkIds.length === 0 ? (_jsx("span", { className: "mt-1 block text-xs text-amber-300", children: "No sinks currently support this CDM model." })) : null] })) : null, _jsxs("label", { className: "block text-sm text-slate-200", children: ["Policy (JSON)", _jsx("textarea", { value: configForm.policyText, onChange: (event) => updateConfigForm({ policyText: event.target.value }), rows: 4, className: "mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white", placeholder: '{"cursorField":"updated","primaryKeys":["id"]}' }), _jsxs("span", { className: "mt-1 block text-xs text-slate-400", children: ["Leave empty to use the endpoint defaults (", summarizePolicy(configuringUnit.defaultPolicy ?? null).join(" · ") || "no cursor", ")."] })] })] })] }), supportsJiraFilters && configForm ? (_jsxs("section", { className: "rounded-2xl border border-white/10 p-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-400", children: "Filters" }), _jsx("button", { type: "button", onClick: resetJiraFilterForm, className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-300/80 transition hover:text-white", children: "Clear" })] }), _jsxs("div", { className: "mt-3 grid gap-3", children: [_jsxs("label", { className: "block text-sm text-slate-200", children: ["Projects", _jsx("select", { multiple: true, value: configForm.jiraFilter.projectKeys, onChange: (event) => handleFilterMultiSelect(event, "projectKeys"), disabled: jiraFilterLoading, className: "mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white", children: (jiraFilterOptions?.projects ?? []).map((project) => (_jsx("option", { value: project.key, className: "bg-slate-900 text-slate-100", children: project.name ?? project.key }, project.key))) })] }), _jsxs("label", { className: "block text-sm text-slate-200", children: ["Statuses", _jsx("select", { multiple: true, value: configForm.jiraFilter.statuses, onChange: (event) => handleFilterMultiSelect(event, "statuses"), disabled: jiraFilterLoading, className: "mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white", children: (jiraFilterOptions?.statuses ?? []).map((status) => (_jsxs("option", { value: status.name, className: "bg-slate-900 text-slate-100", children: [status.name, status.category ? ` · ${status.category}` : ""] }, status.id))) })] }), _jsxs("label", { className: "block text-sm text-slate-200", children: ["Assignees", _jsx("select", { multiple: true, value: configForm.jiraFilter.assigneeIds, onChange: (event) => handleFilterMultiSelect(event, "assigneeIds"), disabled: jiraFilterLoading, className: "mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white", children: (jiraFilterOptions?.users ?? []).map((user) => (_jsxs("option", { value: user.accountId, className: "bg-slate-900 text-slate-100", children: [user.displayName ?? user.accountId, user.email ? ` · ${user.email}` : ""] }, user.accountId))) })] }), _jsxs("label", { className: "block text-sm text-slate-200", children: ["Updated from", _jsx("input", { type: "datetime-local", value: formatDateInputValue(configForm.jiraFilter.updatedFrom), onChange: (event) => {
                                                                    const raw = event.target.value;
                                                                    if (!raw) {
                                                                        updateJiraFilterForm({ updatedFrom: null });
                                                                        return;
                                                                    }
                                                                    const parsed = new Date(raw);
                                                                    if (Number.isNaN(parsed.getTime())) {
                                                                        return;
                                                                    }
                                                                    updateJiraFilterForm({ updatedFrom: parsed.toISOString() });
                                                                }, className: "mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white" }), _jsx("span", { className: "mt-1 block text-xs text-slate-400", children: "Leave blank to sync full history for new projects." })] })] }), jiraFilterLoading ? (_jsx("p", { className: "mt-2 text-xs text-slate-400", children: "Loading filter options\u2026" })) : jiraFilterError ? (_jsx("p", { className: "mt-2 text-xs text-amber-300", children: jiraFilterError })) : null, _jsx("p", { className: "mt-3 text-xs text-slate-400", children: "Filter changes keep existing project cursors. Newly added projects use the Updated From timestamp (or all history if not set)." })] })) : null, supportsConfluenceFilters && configForm ? (_jsxs("section", { className: "rounded-2xl border border-white/10 p-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-400", children: "Filters" }), _jsx("button", { type: "button", onClick: resetConfluenceFilterForm, className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-300/80 transition hover:text-white", children: "Clear" })] }), _jsxs("div", { className: "mt-3 grid gap-3", children: [_jsxs("label", { className: "block text-sm text-slate-200", children: ["Spaces", _jsx("select", { multiple: true, value: configForm.confluenceFilter.spaceKeys, onChange: handleConfluenceSpaceSelect, disabled: confluenceFilterLoading, className: "mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white", children: (confluenceFilterOptions?.spaces ?? []).map((space) => (_jsx("option", { value: space.key, className: "bg-slate-900 text-slate-100", children: space.name ?? space.key }, space.key))) })] }), _jsxs("label", { className: "block text-sm text-slate-200", children: ["Updated from", _jsx("input", { type: "datetime-local", value: formatDateInputValue(configForm.confluenceFilter.updatedFrom), onChange: (event) => {
                                                                    const raw = event.target.value;
                                                                    if (!raw) {
                                                                        updateConfluenceFilterForm({ updatedFrom: null });
                                                                        return;
                                                                    }
                                                                    const parsed = new Date(raw);
                                                                    if (Number.isNaN(parsed.getTime())) {
                                                                        return;
                                                                    }
                                                                    updateConfluenceFilterForm({ updatedFrom: parsed.toISOString() });
                                                                }, className: "mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white" }), _jsx("span", { className: "mt-1 block text-xs text-slate-400", children: "Leave blank to pull the most recent content from selected spaces." })] })] }), confluenceFilterLoading ? (_jsx("p", { className: "mt-2 text-xs text-slate-400", children: "Loading Confluence spaces\u2026" })) : confluenceFilterError ? (_jsx("p", { className: "mt-2 text-xs text-amber-300", children: confluenceFilterError })) : null, _jsx("p", { className: "mt-3 text-xs text-slate-400", children: "The ingestion planner keeps a watermark per space so reruns only fetch content updated after the last successful run." })] })) : null, _jsxs("section", { className: "rounded-2xl border border-white/10 p-4", children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-400", children: "Schedule" }), _jsxs("div", { className: "mt-3 space-y-3", children: [_jsxs("label", { className: "block text-sm text-slate-200", children: ["Trigger", _jsxs("select", { value: configForm.scheduleKind, onChange: (event) => updateConfigForm({ scheduleKind: event.target.value.toUpperCase() }), className: "mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white", children: [_jsx("option", { value: "MANUAL", children: "Manual only" }), _jsx("option", { value: "INTERVAL", children: "Fixed interval" })] })] }), configForm.scheduleKind === "INTERVAL" ? (_jsxs("label", { className: "block text-sm text-slate-200", children: ["Interval (minutes)", _jsx("input", { type: "number", min: 1, value: configForm.scheduleIntervalMinutes, onChange: (event) => updateConfigForm({
                                                                    scheduleIntervalMinutes: Math.max(1, Number(event.target.value) || 1),
                                                                }), className: "mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white" })] })) : null] })] }), _jsxs("section", { className: "rounded-2xl border border-white/10 p-4", children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-400", children: "Sink" }), _jsxs("label", { className: "mt-3 block text-sm text-slate-200", children: ["Destination", _jsx("select", { value: configForm.sinkId, onChange: (event) => updateConfigForm({ sinkId: event.target.value }), className: "mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white", children: drawerSinkOptions.map((sink) => {
                                                            const disabled = configForm.mode === "cdm" && configuringUnit.cdmModelId
                                                                ? !sinkSupportsCdm(sink, configuringUnit.cdmModelId)
                                                                : false;
                                                            return (_jsx("option", { value: sink, disabled: disabled, children: formatIngestionSink(sink) }, sink));
                                                        }) }), _jsx("span", { className: "mt-1 block text-xs text-slate-400", children: "Registered sinks determine where normalized records land (Knowledge Base is the default)." }), configForm.mode === "cdm" && configuringUnit.cdmModelId && !sinkSupportsCdm(configForm.sinkId, configuringUnit.cdmModelId) ? (_jsxs("span", { className: "mt-1 block text-xs text-amber-300", children: ["Select a sink that supports ", configuringUnit.cdmModelId, " to enable CDM mode."] })) : null, configForm.mode === "cdm" ? (_jsx("div", { className: "mt-4", children: _jsxs("label", { className: "block text-sm text-slate-200", children: ["Sink endpoint", cdmSinkEndpoints.length > 0 ? (_jsxs("select", { value: configForm.sinkEndpointId ?? "", onChange: (event) => updateConfigForm({ sinkEndpointId: event.target.value || null }), className: "mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white", children: [_jsx("option", { value: "", children: "Select CDM sink endpoint" }), cdmSinkEndpoints.map((endpoint) => (_jsx("option", { value: endpoint.id, children: endpoint.name }, endpoint.id)))] })) : (_jsxs("p", { className: "mt-2 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200", children: ["No CDM sink endpoints found. Register a ", _jsx("code", { className: "font-mono text-amber-100", children: "cdm.jdbc" }), " endpoint to enable CDM mode."] }))] }) })) : null] })] })] }), _jsxs("div", { className: "mt-6 flex justify-end gap-3", children: [_jsx("button", { type: "button", onClick: closeConfigureDrawer, disabled: configSaving, className: "rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-white disabled:cursor-not-allowed disabled:opacity-40", children: "Cancel" }), _jsxs("button", { type: "button", onClick: handleSaveConfig, disabled: saveDisabled, className: "inline-flex items-center gap-2 rounded-full border border-emerald-400/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-200 disabled:cursor-not-allowed disabled:opacity-40", children: [configSaving ? _jsx(LuRefreshCcw, { className: "h-4 w-4 animate-spin" }) : null, "Save"] })] })] })] })) : null] }));
}
function summarizeStats(stats) {
    if (!stats) {
        return null;
    }
    const entries = [];
    const upserts = getNumeric(stats, ["upserts", "driver.upserts"]);
    const edges = getNumeric(stats, ["edges", "driver.edges"]);
    const processed = getNumeric(stats, ["driver.processed", "processed"]);
    if (typeof upserts === "number") {
        entries.push({ label: "Upserts", value: upserts.toLocaleString() });
    }
    if (typeof edges === "number") {
        entries.push({ label: "Edges", value: edges.toLocaleString() });
    }
    if (typeof processed === "number") {
        entries.push({ label: "Processed", value: processed.toLocaleString() });
    }
    if (!entries.length) {
        const firstKey = Object.keys(stats)[0];
        if (firstKey) {
            entries.push({
                label: firstKey,
                value: typeof stats[firstKey] === "number" ? String(stats[firstKey]) : "—",
            });
        }
    }
    return entries;
}
function getNumeric(stats, keys) {
    for (const key of keys) {
        const value = extractNested(stats, key);
        if (typeof value === "number") {
            return value;
        }
    }
    return null;
}
function extractNested(payload, path) {
    return path.split(".").reduce((acc, segment) => {
        if (acc && typeof acc === "object" && segment in acc) {
            return acc[segment];
        }
        return undefined;
    }, payload);
}
function buildConfigInput(unit, overrides) {
    const fallback = {
        enabled: unit.config?.enabled ?? false,
        runMode: unit.config?.runMode ?? unit.defaultMode ?? "FULL",
        mode: unit.config?.mode ?? "raw",
        sinkId: unit.config?.sinkId ?? unit.sinkId ?? "kb",
        sinkEndpointId: unit.config?.sinkEndpointId ?? null,
        scheduleKind: unit.config?.scheduleKind ?? unit.defaultScheduleKind ?? "MANUAL",
        scheduleIntervalMinutes: unit.config?.scheduleIntervalMinutes ?? unit.defaultScheduleIntervalMinutes ?? null,
        policy: unit.config?.policy ?? unit.defaultPolicy ?? null,
        jiraFilter: reduceJiraFilterToFormValue(unit.config?.jiraFilter ?? null),
        confluenceFilter: reduceConfluenceFilterToFormValue(unit.config?.confluenceFilter ?? null),
    };
    const supportsJira = isJiraUnitId(unit.unitId);
    const supportsConfluence = isConfluenceUnitId(unit.unitId);
    const nextScheduleKind = normalizeScheduleKind(overrides.scheduleKind ?? fallback.scheduleKind);
    const intervalValue = nextScheduleKind === "INTERVAL"
        ? overrides.scheduleIntervalMinutes ?? fallback.scheduleIntervalMinutes ?? 15
        : null;
    const nextJiraFilter = overrides.jiraFilter === undefined
        ? fallback.jiraFilter
        : overrides.jiraFilter ?? DEFAULT_JIRA_FILTER_FORM;
    const nextConfluenceFilter = overrides.confluenceFilter === undefined
        ? fallback.confluenceFilter
        : overrides.confluenceFilter ?? DEFAULT_CONFLUENCE_FILTER_FORM;
    return {
        endpointId: unit.endpointId,
        datasetId: unit.datasetId ?? unit.unitId,
        unitId: unit.unitId,
        enabled: overrides.enabled ?? fallback.enabled,
        runMode: formatIngestionMode(overrides.runMode ?? fallback.runMode),
        mode: (overrides.mode ?? fallback.mode ?? "raw").toLowerCase(),
        sinkId: (overrides.sinkId ?? fallback.sinkId ?? "kb").trim(),
        sinkEndpointId: overrides.sinkEndpointId === undefined ? fallback.sinkEndpointId : overrides.sinkEndpointId,
        scheduleKind: nextScheduleKind,
        scheduleIntervalMinutes: nextScheduleKind === "INTERVAL"
            ? Math.max(1, Math.trunc(typeof intervalValue === "number" && !Number.isNaN(intervalValue) ? intervalValue : 15))
            : null,
        policy: overrides.policy === undefined ? fallback.policy : overrides.policy,
        jiraFilter: supportsJira ? formatJiraFilterInputFromForm(nextJiraFilter) : undefined,
        confluenceFilter: supportsConfluence ? formatConfluenceFilterInputFromForm(nextConfluenceFilter) : undefined,
    };
}
function matchesCdmPattern(pattern, target) {
    if (pattern === "*" || pattern === target) {
        return true;
    }
    if (pattern.endsWith("*")) {
        return target.startsWith(pattern.slice(0, -1));
    }
    return pattern === target;
}
function normalizeScheduleKind(kind) {
    return (kind ?? "MANUAL").toUpperCase() === "INTERVAL" ? "INTERVAL" : "MANUAL";
}
function stringifyPolicy(policy) {
    if (!policy) {
        return "";
    }
    try {
        return JSON.stringify(policy, null, 2);
    }
    catch {
        return "";
    }
}
function reduceJiraFilterToFormValue(source) {
    if (!source) {
        return { ...DEFAULT_JIRA_FILTER_FORM };
    }
    return {
        projectKeys: coerceFilterArray(source.projectKeys),
        statuses: coerceFilterArray(source.statuses),
        assigneeIds: coerceFilterArray(source.assigneeIds),
        updatedFrom: source.updatedFrom ?? null,
    };
}
function coerceFilterArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(new Set(value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0)));
}
function formatJiraFilterInputFromForm(filter) {
    if (!filter) {
        return null;
    }
    const payload = {};
    if (filter.projectKeys.length) {
        payload.projectKeys = filter.projectKeys;
    }
    if (filter.statuses.length) {
        payload.statuses = filter.statuses;
    }
    if (filter.assigneeIds.length) {
        payload.assigneeIds = filter.assigneeIds;
    }
    if (filter.updatedFrom) {
        payload.updatedFrom = filter.updatedFrom;
    }
    return Object.keys(payload).length ? payload : null;
}
function reduceConfluenceFilterToFormValue(source) {
    if (!source) {
        return { ...DEFAULT_CONFLUENCE_FILTER_FORM };
    }
    return {
        spaceKeys: coerceFilterArray(source.spaceKeys),
        updatedFrom: source.updatedFrom ?? null,
    };
}
function formatConfluenceFilterInputFromForm(filter) {
    if (!filter) {
        return null;
    }
    const payload = {};
    if (filter.spaceKeys.length) {
        payload.spaceKeys = filter.spaceKeys;
    }
    if (filter.updatedFrom) {
        payload.updatedFrom = filter.updatedFrom;
    }
    return Object.keys(payload).length ? payload : null;
}
function formatDateInputValue(value) {
    if (!value) {
        return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    return date.toISOString().slice(0, 16);
}
function isJiraUnitId(unitId) {
    if (!unitId) {
        return false;
    }
    return unitId.toLowerCase().startsWith("jira.");
}
function isConfluenceUnitId(unitId) {
    if (!unitId) {
        return false;
    }
    return unitId.toLowerCase().startsWith("confluence.");
}
