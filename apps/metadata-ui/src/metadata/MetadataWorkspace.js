import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuArrowUpRight, LuCircleAlert, LuCircleCheck, LuHistory, LuInfo, LuNetwork, LuRefreshCcw, LuSearch, LuSquarePlus, LuTable, } from "react-icons/lu";
import { formatDateTime, formatPreviewValue, formatRelativeTime } from "../lib/format";
import { fetchMetadataGraphQL } from "./api";
import { ENDPOINT_DATASETS_QUERY, COLLECTION_RUNS_QUERY, METADATA_ENDPOINT_TEMPLATES_QUERY, METADATA_OVERVIEW_QUERY, METADATA_ENDPOINTS_PAGED_QUERY, METADATA_CATALOG_DATASET_QUERY, PREVIEW_METADATA_DATASET_MUTATION, REGISTER_METADATA_ENDPOINT_MUTATION, UPDATE_METADATA_ENDPOINT_MUTATION, DELETE_METADATA_ENDPOINT_MUTATION, TEST_METADATA_ENDPOINT_MUTATION, TRIGGER_ENDPOINT_COLLECTION_MUTATION, } from "./queries";
import { parseListInput, previewTableColumns } from "./utils";
import { useAsyncAction, useCatalogDatasetConnection, useDebouncedValue, usePagedQuery, useToastQueue, } from "./hooks";
import { formatIngestionMode, formatIngestionSchedule, formatIngestionSink, ingestionStateTone, } from "../ingestion/stateTone";
const metadataNavItems = [
    { id: "catalog", type: "section", label: "Catalog", description: "Datasets & schema", icon: LuTable },
    { id: "endpoints", type: "section", label: "Endpoints", description: "Sources & templates", icon: LuNetwork },
    { id: "collections", type: "section", label: "Collections", description: "Run history", icon: LuHistory },
];
const toastToneStyles = {
    success: {
        className: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-400/50 dark:bg-emerald-500/10 dark:text-emerald-100",
        icon: LuCircleCheck,
    },
    error: {
        className: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100",
        icon: LuCircleAlert,
    },
    info: {
        className: "border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
        icon: LuInfo,
    },
};
const metadataSectionTabs = [
    { id: "catalog", label: "Catalog" },
    { id: "endpoints", label: "Endpoints" },
    { id: "collections", label: "Collections" },
];
const templateFamilies = [
    { id: "JDBC", label: "JDBC sources", description: "Warehouses, data lakes, transactional stores." },
    { id: "HTTP", label: "HTTP APIs", description: "SaaS systems like Jira, Confluence, ServiceNow." },
    { id: "STREAM", label: "Streaming", description: "Kafka, Confluent, and event hubs." },
];
function extractTemplateIdFromConfig(config) {
    if (!config || typeof config !== "object") {
        return null;
    }
    const templateId = config.templateId;
    return typeof templateId === "string" ? templateId : null;
}
function parseTemplateParametersFromConfig(config) {
    if (!config || typeof config !== "object") {
        return {};
    }
    const parameters = config.parameters;
    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
        return {};
    }
    return Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, value === undefined || value === null ? "" : String(value)]));
}
function buildTemplateValuesForTemplate(template, parameters) {
    if (!template) {
        return {};
    }
    return template.fields.reduce((acc, field) => {
        acc[field.key] = parameters[field.key] ?? "";
        return acc;
    }, {});
}
function serializeTemplateConfigSignature(templateId, values) {
    const sortedParameters = Object.entries(values)
        .map(([key, value]) => [key, value ?? ""])
        .sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify({ templateId, parameters: sortedParameters });
}
function buildTemplateConnectionUrl(template, parameters) {
    if (!template?.connection?.urlTemplate) {
        return null;
    }
    let resolved = template.connection.urlTemplate;
    resolved = resolved.replace(/{{\s*([^}]+)\s*}}/g, (_match, key) => {
        const normalizedKey = String(key).trim();
        const replacement = parameters[normalizedKey];
        return typeof replacement === "string" ? replacement : "";
    });
    resolved = resolved.replace(/{{[^}]+}}/g, "");
    const trimmed = resolved.trim();
    return trimmed.length > 0 ? trimmed : null;
}
const statusStyles = {
    QUEUED: {
        badge: "bg-amber-50 text-amber-700 border border-amber-200",
        dot: "bg-amber-500",
    },
    RUNNING: {
        badge: "bg-sky-50 text-sky-700 border border-sky-200",
        dot: "bg-sky-500 animate-pulse",
    },
    SUCCEEDED: {
        badge: "bg-emerald-50 text-emerald-700 border border-emerald-200",
        dot: "bg-emerald-500",
    },
    FAILED: {
        badge: "bg-rose-50 text-rose-700 border border-rose-200",
        dot: "bg-rose-500",
    },
    SKIPPED: {
        badge: "bg-slate-50 text-slate-700 border border-slate-200",
        dot: "bg-slate-500",
    },
};
const COLLECTION_STATUS_VALUES = [
    "QUEUED",
    "RUNNING",
    "SUCCEEDED",
    "FAILED",
    "SKIPPED",
];
export function MetadataWorkspace({ metadataEndpoint, authToken, projectSlug, userRole, datasetDetailRouteId, onDatasetDetailRouteChange, }) {
    const toastQueue = useToastQueue();
    const [metadataCollections, setMetadataCollections] = useState([]);
    const [metadataRuns, setMetadataRuns] = useState([]);
    const [metadataTemplates, setMetadataTemplates] = useState([]);
    const [metadataTemplatesLoading, setMetadataTemplatesLoading] = useState(false);
    const [metadataTemplatesError, setMetadataTemplatesError] = useState(null);
    const [metadataTemplateValues, setMetadataTemplateValues] = useState({});
    const [metadataTemplateFamily, setMetadataTemplateFamily] = useState("JDBC");
    const [selectedTemplateId, setSelectedTemplateId] = useState(null);
    const [metadataFormMode, setMetadataFormMode] = useState("register");
    const [metadataEditingEndpointId, setMetadataEditingEndpointId] = useState(null);
    const [metadataInitialConfigSignature, setMetadataInitialConfigSignature] = useState(null);
    const [metadataLastTestConfigSignature, setMetadataLastTestConfigSignature] = useState(null);
    const [metadataEndpointName, setMetadataEndpointName] = useState("");
    const [metadataEndpointDescription, setMetadataEndpointDescription] = useState("");
    const [metadataEndpointLabels, setMetadataEndpointLabels] = useState("");
    const [metadataLoading, setMetadataLoading] = useState(false);
    const [metadataError, setMetadataError] = useState(null);
    const [metadataRefreshToken, setMetadataRefreshToken] = useState(0);
    const [metadataSection, setMetadataSection] = useState("catalog");
    const [metadataView, setMetadataView] = useState("overview");
    const [metadataCatalogSearch, setMetadataCatalogSearch] = useState("");
    const [metadataCatalogEndpointFilter, setMetadataCatalogEndpointFilter] = useState("all");
    const [metadataEndpointPickerQuery, setMetadataEndpointPickerQuery] = useState("");
    const [metadataEndpointPickerOpen, setMetadataEndpointPickerOpen] = useState(false);
    const endpointPickerRef = useRef(null);
    const debouncedEndpointPickerSearch = useDebouncedValue(metadataEndpointPickerQuery, 300);
    const [metadataCatalogLabelFilter, setMetadataCatalogLabelFilter] = useState("all");
    const [metadataCatalogSelection, setMetadataCatalogSelection] = useState(null);
    const [metadataMutationError, setMetadataMutationError] = useState(null);
    const [metadataRegistering, setMetadataRegistering] = useState(false);
    const [metadataRunOverrides, setMetadataRunOverrides] = useState({});
    const [metadataEndpointsSearch, setMetadataEndpointsSearch] = useState("");
    const [pendingTriggerEndpointId, setPendingTriggerEndpointId] = useState(null);
    const [metadataTesting, setMetadataTesting] = useState(false);
    const [metadataTestResult, setMetadataTestResult] = useState(null);
    const [metadataDeletingEndpointId, setMetadataDeletingEndpointId] = useState(null);
    const [metadataCatalogPreviewRows, setMetadataCatalogPreviewRows] = useState({});
    const [metadataCatalogPreviewErrors, setMetadataCatalogPreviewErrors] = useState({});
    const [metadataCatalogPreviewingId, setMetadataCatalogPreviewingId] = useState(null);
    const [metadataCollectionsEndpointFilter, setMetadataCollectionsEndpointFilter] = useState("all");
    const [metadataCollectionsStatusFilter, setMetadataCollectionsStatusFilter] = useState("all");
    const [sectionNavCollapsed, setSectionNavCollapsed] = useState(false);
    const [metadataEndpointDetailId, setMetadataEndpointDetailId] = useState(null);
    const [metadataDatasetDetailId, setMetadataDatasetDetailId] = useState(datasetDetailRouteId ?? null);
    const [catalogDatasetSnapshot, setCatalogDatasetSnapshot] = useState([]);
    const [catalogHiddenEndpointIds, setCatalogHiddenEndpointIds] = useState([]);
    const [datasetDetailCache, setDatasetDetailCache] = useState({});
    const [datasetDetailLoading, setDatasetDetailLoading] = useState(false);
    const [datasetDetailError, setDatasetDetailError] = useState(null);
    const [pendingDatasetNavigationId, setPendingDatasetNavigationId] = useState(null);
    const [pendingEndpointNavigationId, setPendingEndpointNavigationId] = useState(null);
    const metadataHeaderCopy = useMemo(() => {
        if (metadataView === "endpoint-register") {
            return {
                title: "Register endpoint",
                subtitle: "Onboard a new data source, capture connection requirements, and brief an agent for credential collection.",
            };
        }
        switch (metadataSection) {
            case "catalog":
                return {
                    title: "Catalog overview",
                    subtitle: "Inspect datasets powering the designer, preview schema, and open detailed metadata without leaving the workspace.",
                };
            case "endpoints":
                return {
                    title: "Endpoint sources",
                    subtitle: "Review registered integrations, search sources, and trigger metadata collections with local feedback.",
                };
            case "collections":
            default:
                return {
                    title: "Collection runs",
                    subtitle: "Monitor recent metadata collections, drill into results, and navigate back to endpoints when needed.",
                };
        }
    }, [metadataSection, metadataView]);
    const normalizedCatalogSearch = metadataCatalogSearch.trim().toLowerCase();
    const matchesCatalogSearch = useCallback((dataset, searchTerm) => {
        if (!searchTerm.length) {
            return true;
        }
        const haystack = [
            dataset.displayName,
            dataset.id,
            dataset.schema,
            dataset.entity,
            dataset.sourceEndpoint?.name,
            dataset.sourceEndpointId,
            ...(dataset.labels ?? []),
        ];
        return haystack.some((value) => {
            if (!value) {
                return false;
            }
            try {
                return value.toLowerCase().includes(searchTerm);
            }
            catch {
                return String(value).toLowerCase().includes(searchTerm);
            }
        });
    }, []);
    const sidebarOverlayWidth = sectionNavCollapsed ? "3.5rem" : "14rem";
    const detailRequestKeyRef = useRef(0);
    const inflightDatasetDetailIdRef = useRef(null);
    const debouncedCatalogSearch = useDebouncedValue(metadataCatalogSearch, 300);
    const debouncedEndpointsSearch = useDebouncedValue(metadataEndpointsSearch, 300);
    const metadataEndpointQueryVariables = useMemo(() => {
        const trimmedSearch = debouncedEndpointsSearch.trim();
        return {
            projectSlug: projectSlug ?? undefined,
            search: trimmedSearch.length ? trimmedSearch : undefined,
        };
    }, [projectSlug, debouncedEndpointsSearch]);
    const selectEndpointsConnection = useCallback((payload) => {
        const nodes = payload.endpoints ?? [];
        return {
            nodes,
            pageInfo: {
                hasNextPage: nodes.length === 25,
                hasPreviousPage: false,
                startCursor: nodes[0]?.id ?? null,
                endCursor: nodes[nodes.length - 1]?.id ?? null,
            },
        };
    }, []);
    const { items: metadataEndpoints, loading: metadataEndpointsLoading, error: metadataEndpointsError, pageInfo: metadataEndpointsPageInfo, fetchNext: fetchMoreMetadataEndpoints, refresh: refreshMetadataEndpoints, } = usePagedQuery({
        metadataEndpoint,
        token: authToken ?? undefined,
        query: METADATA_ENDPOINTS_PAGED_QUERY,
        variables: metadataEndpointQueryVariables,
        pageSize: 25,
        selectConnection: selectEndpointsConnection,
    });
    const metadataEndpointComboVariables = useMemo(() => {
        const trimmedSearch = debouncedEndpointPickerSearch.trim();
        return {
            projectSlug: projectSlug ?? undefined,
            search: trimmedSearch.length ? trimmedSearch : undefined,
        };
    }, [projectSlug, debouncedEndpointPickerSearch]);
    const { items: metadataEndpointPickerOptions, loading: metadataEndpointPickerLoading, pageInfo: metadataEndpointPickerPageInfo, fetchNext: fetchMoreMetadataEndpointOptions, refresh: refreshMetadataEndpointOptions, } = usePagedQuery({
        metadataEndpoint,
        token: authToken ?? undefined,
        query: METADATA_ENDPOINTS_PAGED_QUERY,
        variables: metadataEndpointComboVariables,
        pageSize: 25,
        selectConnection: selectEndpointsConnection,
    });
    const endpointFilterValue = metadataCatalogEndpointFilter === "all" || metadataCatalogEndpointFilter === "unlinked"
        ? null
        : metadataCatalogEndpointFilter;
    const labelFilterValue = metadataCatalogLabelFilter === "all" || metadataCatalogLabelFilter === "unlabeled"
        ? null
        : metadataCatalogLabelFilter;
    const unlabeledOnly = metadataCatalogLabelFilter === "unlabeled" || metadataCatalogEndpointFilter === "unlinked";
    const { datasets: catalogDatasets, loading: catalogDatasetsLoading, error: catalogDatasetsError, pageInfo: catalogDatasetsPageInfo, fetchNext: fetchMoreCatalogDatasets, refresh: refreshCatalogDatasets, } = useCatalogDatasetConnection({
        metadataEndpoint,
        token: authToken ?? undefined,
        endpointId: endpointFilterValue,
        label: labelFilterValue,
        search: debouncedCatalogSearch.trim().length ? debouncedCatalogSearch.trim() : undefined,
        unlabeledOnly,
        pageSize: 25,
    });
    const resolvedRole = userRole ??
        ((typeof document !== "undefined"
            ? document.body.dataset.metadataAuthRole
            : undefined) ??
            "USER");
    useEffect(() => {
        if (catalogDatasetsError) {
            setMetadataError((prev) => prev ?? catalogDatasetsError);
        }
    }, [catalogDatasetsError]);
    useEffect(() => {
        if (typeof document === "undefined") {
            return;
        }
        const handleClickOutside = (event) => {
            if (endpointPickerRef.current && !endpointPickerRef.current.contains(event.target)) {
                setMetadataEndpointPickerOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);
    useEffect(() => {
        if (metadataSection !== "catalog") {
            setMetadataEndpointPickerOpen(false);
        }
    }, [metadataSection]);
    const canModifyEndpoints = resolvedRole === "ADMIN" || resolvedRole === "MANAGER";
    const canDeleteEndpoints = resolvedRole === "ADMIN";
    const metadataEditingEndpoint = useMemo(() => (metadataEditingEndpointId ? metadataEndpoints.find((endpoint) => endpoint.id === metadataEditingEndpointId) ?? null : null), [metadataEditingEndpointId, metadataEndpoints]);
    const catalogDatasetBaseList = catalogDatasets.length > 0 ? catalogDatasets : catalogDatasetSnapshot;
    const metadataCatalogFilteredDatasets = useMemo(() => {
        let datasetList = catalogDatasetBaseList;
        if (catalogHiddenEndpointIds.length > 0) {
            const hiddenSet = new Set(catalogHiddenEndpointIds);
            datasetList = datasetList.filter((dataset) => {
                const endpointId = dataset.sourceEndpointId ?? null;
                return !endpointId || !hiddenSet.has(endpointId);
            });
        }
        if (normalizedCatalogSearch.length > 0 &&
            catalogDatasets.length === 0 &&
            catalogDatasetSnapshot.length > 0) {
            datasetList = datasetList.filter((dataset) => matchesCatalogSearch(dataset, normalizedCatalogSearch));
        }
        return datasetList;
    }, [
        catalogDatasetBaseList,
        catalogDatasets.length,
        catalogDatasetSnapshot.length,
        catalogHiddenEndpointIds,
        matchesCatalogSearch,
        normalizedCatalogSearch,
    ]);
    const hasMetadataSnapshot = metadataCollections.length > 0 || metadataEndpoints.length > 0 || metadataCatalogFilteredDatasets.length > 0;
    const metadataCatalogSelectedDataset = useMemo(() => {
        if (metadataCatalogSelection) {
            const match = catalogDatasetBaseList.find((dataset) => dataset.id === metadataCatalogSelection);
            if (match) {
                return match;
            }
        }
        return metadataCatalogFilteredDatasets[0] ?? catalogDatasetBaseList[0] ?? null;
    }, [catalogDatasetBaseList, metadataCatalogFilteredDatasets, metadataCatalogSelection]);
    const metadataDatasetDetail = useMemo(() => {
        if (!metadataDatasetDetailId) {
            return null;
        }
        const selectedDataset = metadataCatalogSelectedDataset && metadataCatalogSelectedDataset.id === metadataDatasetDetailId
            ? metadataCatalogSelectedDataset
            : null;
        return (datasetDetailCache[metadataDatasetDetailId] ??
            catalogDatasets.find((dataset) => dataset.id === metadataDatasetDetailId) ??
            selectedDataset ??
            null);
    }, [catalogDatasets, datasetDetailCache, metadataCatalogSelectedDataset, metadataDatasetDetailId]);
    const metadataEndpointLookup = useMemo(() => {
        const map = new Map();
        const addEndpoint = (entry) => {
            const id = entry?.id;
            if (!id) {
                return;
            }
            const normalized = {
                id,
                sourceId: entry?.sourceId ?? undefined,
                name: entry?.name ?? undefined,
                capabilities: entry?.capabilities ?? undefined,
                url: entry?.url ?? undefined,
            };
            map.set(id, normalized);
            if (normalized.sourceId) {
                map.set(normalized.sourceId, normalized);
            }
        };
        metadataEndpoints.forEach(addEndpoint);
        metadataEndpointPickerOptions.forEach(addEndpoint);
        catalogDatasets.forEach((dataset) => {
            if (dataset.sourceEndpointId && dataset.sourceEndpoint) {
                addEndpoint({
                    id: dataset.sourceEndpointId,
                    sourceId: dataset.sourceEndpointId,
                    name: dataset.sourceEndpoint.name,
                    capabilities: dataset.sourceEndpoint.capabilities ?? undefined,
                });
            }
        });
        if (metadataDatasetDetail?.sourceEndpointId && metadataDatasetDetail.sourceEndpoint) {
            addEndpoint({
                id: metadataDatasetDetail.sourceEndpointId,
                sourceId: metadataDatasetDetail.sourceEndpointId,
                name: metadataDatasetDetail.sourceEndpoint.name,
                capabilities: metadataDatasetDetail.sourceEndpoint.capabilities ?? undefined,
            });
        }
        return map;
    }, [catalogDatasets, metadataDatasetDetail, metadataEndpointPickerOptions, metadataEndpoints]);
    const [pendingTemplateSelection, setPendingTemplateSelection] = useState(null);
    const [pendingEndpointEdit, setPendingEndpointEdit] = useState(null);
    const [metadataRunsLoading, setMetadataRunsLoading] = useState(false);
    const [metadataRunsError, setMetadataRunsError] = useState(null);
    const [metadataRunsRequestKey, setMetadataRunsRequestKey] = useState(0);
    const [metadataRunsLoadedKey, setMetadataRunsLoadedKey] = useState(null);
    const [metadataRunsLoaded, setMetadataRunsLoaded] = useState(false);
    const [endpointDatasetRecords, setEndpointDatasetRecords] = useState({});
    const [endpointDatasetErrors, setEndpointDatasetErrors] = useState({});
    const [endpointDatasetLoading, setEndpointDatasetLoading] = useState({});
    const isRouteDetail = Boolean(datasetDetailRouteId);
    useEffect(() => {
        if (datasetDetailRouteId === undefined) {
            return;
        }
        setMetadataDatasetDetailId(datasetDetailRouteId ?? null);
    }, [datasetDetailRouteId]);
    const updateDatasetDetailId = useCallback((nextId, options) => {
        setMetadataDatasetDetailId(nextId);
        if (options?.syncRoute !== false && onDatasetDetailRouteChange) {
            onDatasetDetailRouteChange(nextId);
        }
    }, [onDatasetDetailRouteChange]);
    useEffect(() => {
        if (metadataView === "overview") {
            return;
        }
        if (metadataDatasetDetailId) {
            updateDatasetDetailId(null, { syncRoute: false });
        }
        if (metadataEndpointDetailId) {
            setMetadataEndpointDetailId(null);
        }
    }, [metadataDatasetDetailId, metadataEndpointDetailId, metadataView, updateDatasetDetailId]);
    useEffect(() => {
        if (!datasetDetailRouteId) {
            return;
        }
        const match = catalogDatasets.find((dataset) => dataset.id === datasetDetailRouteId);
        if (match) {
            setMetadataCatalogSelection(datasetDetailRouteId);
        }
    }, [datasetDetailRouteId, catalogDatasets]);
    useEffect(() => {
        if (catalogDatasets.length > 0) {
            setCatalogDatasetSnapshot(catalogDatasets);
        }
    }, [catalogDatasets]);
    const loadDatasetDetail = useCallback(async (datasetId, options) => {
        if (!datasetId) {
            throw new Error("Dataset identifier missing.");
        }
        if (!options?.force && datasetDetailCache[datasetId]) {
            return datasetDetailCache[datasetId];
        }
        if (!metadataEndpoint) {
            throw new Error("Configure VITE_METADATA_GRAPHQL_ENDPOINT to load dataset detail.");
        }
        if (!authToken) {
            throw new Error("Sign in to load dataset detail.");
        }
        const requestKey = ++detailRequestKeyRef.current;
        inflightDatasetDetailIdRef.current = datasetId;
        setDatasetDetailLoading(true);
        setDatasetDetailError(null);
        try {
            const payload = await fetchMetadataGraphQL(metadataEndpoint, METADATA_CATALOG_DATASET_QUERY, { id: datasetId }, undefined, { token: authToken ?? undefined });
            const detail = payload.metadataDataset ??
                catalogDatasets.find((dataset) => dataset.id === datasetId) ??
                null;
            if (!detail) {
                throw new Error("Dataset not found in this project.");
            }
            setDatasetDetailCache((prev) => ({ ...prev, [detail.id]: detail }));
            return detail;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (detailRequestKeyRef.current === requestKey) {
                setDatasetDetailError(message);
            }
            throw error instanceof Error ? error : new Error(message);
        }
        finally {
            if (detailRequestKeyRef.current === requestKey) {
                setDatasetDetailLoading(false);
            }
            if (inflightDatasetDetailIdRef.current === datasetId) {
                inflightDatasetDetailIdRef.current = null;
            }
        }
    }, [authToken, catalogDatasets, datasetDetailCache, metadataEndpoint]);
    const openDatasetDetailAction = useAsyncAction(async (datasetId) => {
        const detail = await loadDatasetDetail(datasetId, { force: true });
        return detail;
    }, {
        onSuccess: (dataset) => {
            if (!dataset) {
                return;
            }
            toastQueue.pushToast({
                intent: "success",
                title: `Opened ${dataset.displayName}`,
                description: "Dataset detail ready.",
            });
        },
        onError: (error) => {
            toastQueue.pushToast({
                intent: "error",
                title: "Failed to open dataset",
                description: error.message ?? String(error),
            });
        },
    });
    const handleOpenDatasetDetail = useCallback(async (datasetId) => {
        updateDatasetDetailId(datasetId, { syncRoute: false });
        setPendingDatasetNavigationId(datasetId);
        try {
            await openDatasetDetailAction.run(datasetId);
        }
        catch {
            // toast already handled in hook
        }
        finally {
            setPendingDatasetNavigationId((prev) => (prev === datasetId ? null : prev));
        }
    }, [openDatasetDetailAction]);
    const handleOpenDatasetDetailPage = useCallback((datasetId) => {
        if (!datasetId) {
            return;
        }
        updateDatasetDetailId(datasetId, { syncRoute: true });
    }, [updateDatasetDetailId]);
    const navigateToEndpointAction = useAsyncAction(async (endpointId) => {
        if (!endpointId) {
            throw new Error("Endpoint unavailable for this run.");
        }
        setMetadataView("overview");
        setMetadataSection("endpoints");
        setMetadataEndpointDetailId(endpointId);
        return metadataEndpoints.find((endpoint) => endpoint.id === endpointId) ?? null;
    }, {
        onSuccess: (endpoint) => {
            toastQueue.pushToast({
                intent: "success",
                title: endpoint ? `Opened ${endpoint.name}` : "Endpoint ready",
                description: "Endpoint detail focused.",
            });
        },
        onError: (error) => {
            toastQueue.pushToast({
                intent: "error",
                title: "Failed to open endpoint",
                description: error.message ?? String(error),
            });
        },
    });
    const handleViewEndpointFromCollections = useCallback(async (endpointId) => {
        if (!endpointId) {
            toastQueue.pushToast({
                intent: "error",
                title: "Endpoint unavailable",
                description: "This run no longer links to an endpoint.",
            });
            return;
        }
        setPendingEndpointNavigationId(endpointId);
        try {
            await navigateToEndpointAction.run(endpointId);
        }
        catch {
            // toast already emitted
        }
        finally {
            setPendingEndpointNavigationId((prev) => (prev === endpointId ? null : prev));
        }
    }, [navigateToEndpointAction, toastQueue]);
    const getDatasetPreviewState = useCallback((dataset) => {
        if (!dataset) {
            return {
                owner: null,
                endpointCapabilities: [],
                previewRows: [],
                previewError: undefined,
                previewing: false,
                previewBlockReason: null,
                previewAvailability: "unlinked",
                previewStatusMessage: null,
                previewStatusTone: "info",
                canPreview: false,
                sampledAt: null,
            };
        }
        let owner = null;
        if (dataset.sourceEndpointId) {
            owner = metadataEndpointLookup.get(dataset.sourceEndpointId) ?? null;
        }
        if (!owner && dataset.sourceEndpoint?.id) {
            owner = {
                id: dataset.sourceEndpoint.id,
                sourceId: dataset.sourceEndpoint.id,
                name: dataset.sourceEndpoint.name,
                capabilities: dataset.sourceEndpoint.capabilities ?? undefined,
            };
        }
        const endpointCapabilities = owner?.capabilities ?? [];
        const declaresCapabilities = endpointCapabilities.length > 0;
        const supportsPreview = !declaresCapabilities || endpointCapabilities.includes("preview");
        const hasLinkedEndpoint = Boolean(dataset.sourceEndpointId && owner);
        const previewEntry = metadataCatalogPreviewRows[dataset.id];
        const previewRows = (previewEntry?.rows ?? []);
        const previewError = metadataCatalogPreviewErrors[dataset.id];
        const previewing = metadataCatalogPreviewingId === dataset.id;
        const hasLiveSample = previewRows.length > 0;
        let previewAvailability = hasLiveSample ? "sampled" : "ready";
        let previewStatusMessage = null;
        let previewStatusTone = "info";
        let previewBlockReason = null;
        if (!hasLinkedEndpoint) {
            previewAvailability = "unlinked";
            previewStatusMessage = "Link this dataset to a registered endpoint before running previews.";
            previewStatusTone = "warn";
            previewBlockReason = previewStatusMessage;
        }
        else if (!supportsPreview) {
            previewAvailability = "unsupported";
            const ownerName = owner?.name ?? "this endpoint";
            previewStatusMessage = `Preview not supported for ${ownerName}.`;
            previewStatusTone = "warn";
            previewBlockReason = previewStatusMessage;
        }
        else if (previewError) {
            previewAvailability = "error";
            previewStatusMessage = "Preview failed. Review the error below and try again.";
            previewStatusTone = "warn";
        }
        else if (!hasLiveSample && !previewing) {
            previewAvailability = "not_run";
            previewStatusMessage = "No preview sampled yet. Run a preview to inspect live data.";
            previewStatusTone = "neutral";
        }
        const canPreview = !["unlinked", "unsupported"].includes(previewAvailability);
        return {
            owner,
            endpointCapabilities,
            previewRows,
            previewError,
            previewing,
            previewBlockReason,
            previewAvailability,
            previewStatusMessage,
            previewStatusTone,
            canPreview,
            sampledAt: previewEntry?.sampledAt ?? null,
        };
    }, [metadataCatalogPreviewErrors, metadataCatalogPreviewRows, metadataCatalogPreviewingId, metadataEndpointLookup]);
    const metadataCollectionsByEndpoint = useMemo(() => {
        const map = new Map();
        metadataCollections.forEach((collection) => {
            map.set(collection.endpointId, collection);
        });
        return map;
    }, [metadataCollections]);
    useEffect(() => {
        if (datasetDetailRouteId) {
            return;
        }
        if (!metadataCatalogSelectedDataset) {
            setMetadataCatalogSelection(metadataCatalogFilteredDatasets[0]?.id ?? catalogDatasets[0]?.id ?? null);
        }
    }, [catalogDatasets, datasetDetailRouteId, metadataCatalogFilteredDatasets, metadataCatalogSelectedDataset]);
    const metadataCatalogLabelOptions = useMemo(() => {
        const labels = new Set();
        catalogDatasetBaseList.forEach((dataset) => dataset.labels?.forEach((label) => labels.add(label)));
        return Array.from(labels).sort();
    }, [catalogDatasetBaseList]);
    const metadataEndpointDetail = useMemo(() => (metadataEndpointDetailId ? metadataEndpoints.find((endpoint) => endpoint.id === metadataEndpointDetailId) ?? null : null), [metadataEndpointDetailId, metadataEndpoints]);
    const metadataDatasetDetailFields = metadataDatasetDetail?.fields ?? [];
    const detailDataset = metadataDatasetDetail ?? metadataCatalogSelectedDataset ?? null;
    const metadataDatasetDetailDisplayId = metadataDatasetDetail?.upstreamId ?? metadataDatasetDetail?.id ?? null;
    const detailDatasetDisplayId = detailDataset?.upstreamId ?? detailDataset?.id ?? null;
    const catalogPreviewState = useMemo(() => getDatasetPreviewState(metadataCatalogSelectedDataset ?? null), [getDatasetPreviewState, metadataCatalogSelectedDataset]);
    const detailPreviewState = useMemo(() => getDatasetPreviewState(detailDataset), [detailDataset, getDatasetPreviewState]);
    const detailOwner = detailPreviewState.owner;
    const detailEndpointCapabilities = detailPreviewState.endpointCapabilities;
    const detailDeclaresCapabilities = detailEndpointCapabilities.length > 0;
    const detailPreviewRows = detailPreviewState.previewRows.length > 0 ? detailPreviewState.previewRows : detailDataset?.sampleRows ?? [];
    const detailPreviewColumns = previewTableColumns(detailPreviewRows);
    const detailPreviewError = detailPreviewState.previewError;
    const detailPreviewing = detailPreviewState.previewing;
    const detailPreviewStatusMessage = detailPreviewState.previewStatusMessage;
    const detailPreviewStatusTone = detailPreviewState.previewStatusTone;
    const detailSampledAt = detailPreviewState.sampledAt;
    const detailCanPreview = Boolean(detailDataset) && detailPreviewState.canPreview;
    const detailHasLinkedEndpoint = Boolean(detailDataset?.sourceEndpointId && detailOwner);
    const detailProfileBlockReason = (detailOwner && detailDeclaresCapabilities && !detailEndpointCapabilities.includes("profile")
        ? `Dataset profiles disabled: ${detailOwner.name} is missing the "profile" capability.`
        : null) ??
        (!detailHasLinkedEndpoint && detailDataset ? "Link this dataset to a registered endpoint before profiling." : null);
    const detailLastCollectionRun = detailDataset?.lastCollectionRun ?? null;
    const isFieldVisible = useCallback((field) => {
        if (!field.visibleWhen || field.visibleWhen.length === 0) {
            return true;
        }
        return field.visibleWhen.every((rule) => {
            const current = metadataTemplateValues[rule.field] ?? "";
            return rule.values.includes(current);
        });
    }, [metadataTemplateValues]);
    const isFieldRequired = useCallback((field) => {
        if (!field.dependsOn) {
            return field.required;
        }
        const dependsValue = metadataTemplateValues[field.dependsOn];
        if (field.dependsValue === null || field.dependsValue === undefined) {
            return field.required && Boolean(dependsValue);
        }
        return field.required && dependsValue === field.dependsValue;
    }, [metadataTemplateValues]);
    const metadataLatestRunByEndpoint = useMemo(() => {
        const map = new Map();
        metadataRuns.forEach((run) => {
            const endpointId = run.endpoint?.id;
            if (!endpointId) {
                return;
            }
            const existing = map.get(endpointId);
            if (!existing || new Date(run.requestedAt).getTime() > new Date(existing.requestedAt).getTime()) {
                map.set(endpointId, run);
            }
        });
        metadataEndpoints.forEach((endpoint) => {
            const endpointRuns = endpoint.runs ?? [];
            if (map.has(endpoint.id) || endpointRuns.length === 0) {
                return;
            }
            const sorted = [...endpointRuns].sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
            if (sorted.length > 0) {
                map.set(endpoint.id, sorted[0]);
            }
        });
        return map;
    }, [metadataEndpoints, metadataRuns]);
    const metadataTemplatesByFamily = useMemo(() => {
        return metadataTemplates.reduce((groups, template) => {
            const family = template.family;
            groups[family] = [...(groups[family] ?? []), template];
            return groups;
        }, { JDBC: [], HTTP: [], STREAM: [] });
    }, [metadataTemplates]);
    const filteredTemplates = metadataTemplatesByFamily[metadataTemplateFamily] ?? [];
    const ensureTemplatesLoaded = useCallback((options) => {
        if (!metadataEndpoint || !authToken) {
            return;
        }
        if (!options?.force && (metadataTemplatesLoading || metadataTemplates.length > 0)) {
            return;
        }
        setMetadataTemplatesLoading(true);
        setMetadataTemplatesError(null);
        void fetchMetadataGraphQL(metadataEndpoint, METADATA_ENDPOINT_TEMPLATES_QUERY, undefined, undefined, { token: authToken ?? undefined })
            .then((payload) => {
            setMetadataTemplates(payload.endpointTemplates ?? []);
        })
            .catch((error) => {
            setMetadataTemplatesError(error instanceof Error ? error.message : String(error));
        })
            .finally(() => {
            setMetadataTemplatesLoading(false);
        });
    }, [authToken, metadataEndpoint, metadataTemplates.length, metadataTemplatesLoading]);
    const handleRetryLoadTemplates = useCallback(() => {
        ensureTemplatesLoaded({ force: true });
    }, [ensureTemplatesLoaded]);
    const applyTemplateSelection = useCallback((templateId, familyOverride) => {
        if (!metadataTemplates.length) {
            return;
        }
        let targetFamily = familyOverride ?? metadataTemplateFamily;
        let nextTemplateId = templateId;
        if (templateId) {
            const explicitTemplate = metadataTemplates.find((template) => template.id === templateId);
            if (explicitTemplate) {
                targetFamily = explicitTemplate.family;
            }
        }
        if (targetFamily !== metadataTemplateFamily) {
            setMetadataTemplateFamily(targetFamily);
        }
        if (!nextTemplateId) {
            const candidates = metadataTemplatesByFamily[targetFamily] ?? [];
            nextTemplateId = candidates[0]?.id ?? metadataTemplates[0]?.id ?? null;
        }
        if (nextTemplateId) {
            setSelectedTemplateId(nextTemplateId);
        }
    }, [metadataTemplateFamily, metadataTemplates, metadataTemplatesByFamily]);
    const populateEndpointEditFields = useCallback((endpoint) => {
        const templateIdFromConfig = extractTemplateIdFromConfig(endpoint.config);
        let resolvedTemplate = templateIdFromConfig
            ? metadataTemplates.find((template) => template.id === templateIdFromConfig) ?? null
            : null;
        if (!resolvedTemplate) {
            resolvedTemplate = metadataTemplates[0] ?? null;
        }
        if (resolvedTemplate) {
            if (resolvedTemplate.family !== metadataTemplateFamily) {
                setMetadataTemplateFamily(resolvedTemplate.family);
            }
            setSelectedTemplateId(resolvedTemplate.id);
            const initialValues = buildTemplateValuesForTemplate(resolvedTemplate, parseTemplateParametersFromConfig(endpoint.config ?? undefined));
            setMetadataTemplateValues(initialValues);
            const signature = serializeTemplateConfigSignature(resolvedTemplate.id, initialValues);
            setMetadataInitialConfigSignature(signature);
            setMetadataLastTestConfigSignature(signature);
        }
        else {
            setMetadataTemplateValues({});
            setMetadataInitialConfigSignature(null);
            setMetadataLastTestConfigSignature(null);
        }
        setMetadataFormMode("edit");
        setMetadataEditingEndpointId(endpoint.id);
        setMetadataEndpointName(endpoint.name);
        setMetadataEndpointDescription(endpoint.description ?? "");
        setMetadataEndpointLabels((endpoint.labels ?? []).join(", "));
        setMetadataMutationError(null);
        setMetadataTestResult(null);
    }, [metadataTemplateFamily, metadataTemplates]);
    const handleOpenRegistration = useCallback((templateId, familyOverride) => {
        setMetadataFormMode("register");
        setMetadataEditingEndpointId(null);
        setMetadataInitialConfigSignature(null);
        setMetadataLastTestConfigSignature(null);
        setMetadataEndpointName("");
        setMetadataEndpointDescription("");
        setMetadataEndpointLabels("");
        setMetadataTemplateValues({});
        setMetadataTestResult(null);
        setMetadataMutationError(null);
        updateDatasetDetailId(null);
        setMetadataEndpointDetailId(null);
        setPendingEndpointEdit(null);
        setMetadataView("endpoint-register");
        if (metadataTemplates.length > 0) {
            applyTemplateSelection(templateId ?? null, familyOverride ?? null);
        }
        else {
            setPendingTemplateSelection({ templateId: templateId ?? null, familyOverride: familyOverride ?? null });
            ensureTemplatesLoaded();
        }
    }, [applyTemplateSelection, ensureTemplatesLoaded, metadataTemplates.length]);
    const handleOpenEndpointEdit = useCallback((endpoint) => {
        updateDatasetDetailId(null);
        setMetadataEndpointDetailId(null);
        setMetadataView("endpoint-register");
        setPendingTemplateSelection(null);
        if (!metadataTemplates.length) {
            setPendingEndpointEdit(endpoint);
            ensureTemplatesLoaded();
            return;
        }
        setPendingEndpointEdit(null);
        populateEndpointEditFields(endpoint);
    }, [ensureTemplatesLoaded, metadataTemplates.length, populateEndpointEditFields]);
    const handleCloseRegistration = useCallback(() => {
        console.info("[metadata-ui] close registration");
        setMetadataView("overview");
        setMetadataMutationError(null);
        setMetadataTestResult(null);
        setMetadataFormMode("register");
        setMetadataEditingEndpointId(null);
        setMetadataInitialConfigSignature(null);
        setMetadataLastTestConfigSignature(null);
        setPendingTemplateSelection(null);
        setPendingEndpointEdit(null);
        setMetadataEndpointDetailId(null);
        updateDatasetDetailId(null);
    }, []);
    const handleCloseEndpointDetail = useCallback(() => {
        setMetadataEndpointDetailId(null);
        setMetadataMutationError(null);
    }, []);
    const selectedTemplate = useMemo(() => {
        if (selectedTemplateId) {
            const match = metadataTemplates.find((template) => template.id === selectedTemplateId);
            if (match) {
                return match;
            }
        }
        return filteredTemplates[0] ?? metadataTemplates[0] ?? null;
    }, [metadataTemplates, selectedTemplateId, filteredTemplates]);
    const currentTemplateId = selectedTemplate?.id ?? null;
    const isEditingEndpoint = metadataFormMode === "edit" && Boolean(metadataEditingEndpointId);
    const currentConfigSignature = useMemo(() => serializeTemplateConfigSignature(currentTemplateId, metadataTemplateValues), [currentTemplateId, metadataTemplateValues]);
    const connectionChangedFromInitial = isEditingEndpoint && metadataInitialConfigSignature !== currentConfigSignature;
    const requiresRetest = isEditingEndpoint && connectionChangedFromInitial && metadataLastTestConfigSignature !== currentConfigSignature;
    const formTitle = metadataFormMode === "edit" ? "Edit endpoint" : "Register endpoint";
    const submitButtonLabel = metadataFormMode === "edit"
        ? metadataRegistering
            ? "Saving…"
            : "Save changes"
        : metadataRegistering
            ? "Registering…"
            : "Register endpoint";
    const submitDisabled = !canModifyEndpoints ||
        metadataRegistering ||
        (metadataFormMode === "edit" ? requiresRetest : !metadataTestResult?.ok);
    const showRetestWarning = metadataFormMode === "edit" && requiresRetest;
    useEffect(() => {
        if (metadataView !== "endpoint-register") {
            return;
        }
        const familyTemplates = metadataTemplatesByFamily[metadataTemplateFamily] ?? [];
        if (!familyTemplates.length) {
            setSelectedTemplateId((prev) => (prev === null ? prev : null));
            return;
        }
        if (!familyTemplates.some((template) => template.id === selectedTemplateId)) {
            setSelectedTemplateId(familyTemplates[0].id);
        }
    }, [metadataTemplateFamily, metadataTemplatesByFamily, metadataView, selectedTemplateId]);
    useEffect(() => {
        if (!selectedTemplate) {
            setMetadataTemplateValues((prev) => (Object.keys(prev).length ? {} : prev));
            return;
        }
        setMetadataTemplateValues((prev) => {
            const next = selectedTemplate.fields.reduce((acc, field) => {
                acc[field.key] = prev[field.key] ?? "";
                return acc;
            }, {});
            const prevKeys = Object.keys(prev);
            const nextKeys = Object.keys(next);
            const sameLength = prevKeys.length === nextKeys.length;
            const sameValues = sameLength && nextKeys.every((key) => prev[key] === next[key]);
            return sameValues ? prev : next;
        });
    }, [selectedTemplate]);
    const sortedMetadataRuns = useMemo(() => {
        return [...metadataRuns].sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
    }, [metadataRuns]);
    const refreshMetadataWorkspace = useCallback(() => {
        setMetadataRefreshToken((prev) => prev + 1);
        setMetadataRunsLoaded(false);
        setMetadataRunsLoadedKey(null);
        refreshMetadataEndpoints();
    }, [refreshMetadataEndpoints]);
    const refreshMetadataRuns = useCallback(() => {
        setMetadataRunsLoaded(false);
        setMetadataRunsLoadedKey(null);
        setMetadataRunsRequestKey((prev) => prev + 1);
    }, []);
    const handleSelectEndpointFilter = useCallback((value, options) => {
        if (value === "all") {
            setMetadataEndpointPickerQuery("");
        }
        else if (value === "unlinked") {
            setMetadataEndpointPickerQuery("Unlinked datasets");
        }
        else if (options?.label) {
            setMetadataEndpointPickerQuery(options.label);
        }
        setMetadataCatalogEndpointFilter(value);
        setMetadataEndpointPickerOpen(false);
    }, []);
    const loadMetadataRuns = useCallback(async () => {
        if (!metadataEndpoint || !authToken) {
            return;
        }
        if (metadataRunsLoading) {
            return;
        }
        if (metadataRunsLoaded && metadataRunsLoadedKey === metadataRunsRequestKey) {
            return;
        }
        setMetadataRunsLoading(true);
        setMetadataRunsError(null);
        try {
            const payload = await fetchMetadataGraphQL(metadataEndpoint, COLLECTION_RUNS_QUERY, {
                filter: metadataCollectionsEndpointFilter !== "all" || metadataCollectionsStatusFilter !== "all"
                    ? {
                        endpointId: metadataCollectionsEndpointFilter !== "all" ? metadataCollectionsEndpointFilter : undefined,
                        status: metadataCollectionsStatusFilter !== "all" ? metadataCollectionsStatusFilter : undefined,
                    }
                    : undefined,
                first: 30,
            }, undefined, { token: authToken ?? undefined });
            setMetadataRuns(payload.collectionRuns ?? []);
            setMetadataRunsLoaded(true);
            setMetadataRunsLoadedKey(metadataRunsRequestKey);
        }
        catch (error) {
            setMetadataRunsError(error instanceof Error ? error.message : String(error));
        }
        finally {
            setMetadataRunsLoading(false);
        }
    }, [
        authToken,
        metadataEndpoint,
        metadataCollectionsEndpointFilter,
        metadataCollectionsStatusFilter,
        metadataRunsLoaded,
        metadataRunsLoadedKey,
        metadataRunsLoading,
        metadataRunsRequestKey,
    ]);
    useEffect(() => {
        if (metadataView === "overview" && metadataSection === "collections") {
            void loadMetadataRuns();
        }
    }, [metadataSection, metadataView, loadMetadataRuns]);
    useEffect(() => {
        if (metadataView === "overview" && metadataSection === "collections") {
            refreshMetadataRuns();
        }
    }, [
        metadataCollectionsEndpointFilter,
        metadataCollectionsStatusFilter,
        metadataSection,
        metadataView,
        refreshMetadataRuns,
    ]);
    const handleWorkspaceRefresh = useCallback(() => {
        refreshMetadataWorkspace();
        refreshCatalogDatasets();
        if (metadataView === "overview" && metadataSection === "collections") {
            refreshMetadataRuns();
        }
        if (metadataDatasetDetailId) {
            setDatasetDetailCache((prev) => {
                const next = { ...prev };
                delete next[metadataDatasetDetailId];
                return next;
            });
        }
    }, [metadataSection, metadataView, refreshCatalogDatasets, refreshMetadataRuns, refreshMetadataWorkspace]);
    const handleRequirementChange = useCallback((key, value) => {
        setMetadataTemplateValues((prev) => ({ ...prev, [key]: value }));
        setMetadataTestResult(null);
    }, []);
    const handlePreviewMetadataDataset = useCallback(async (datasetId, options) => {
        if (!datasetId) {
            return;
        }
        if (!metadataEndpoint) {
            setMetadataCatalogPreviewErrors((prev) => ({
                ...prev,
                [datasetId]: "Configure VITE_METADATA_GRAPHQL_ENDPOINT to preview datasets.",
            }));
            return;
        }
        if (!authToken) {
            setMetadataCatalogPreviewErrors((prev) => ({
                ...prev,
                [datasetId]: "Sign in to preview datasets.",
            }));
            return;
        }
        const silent = options?.silent ?? false;
        const limit = options?.limit ?? 20;
        if (!silent) {
            setMetadataCatalogPreviewingId(datasetId);
        }
        setMetadataCatalogPreviewErrors((prev) => ({ ...prev, [datasetId]: "" }));
        try {
            const payload = await fetchMetadataGraphQL(metadataEndpoint, PREVIEW_METADATA_DATASET_MUTATION, { id: datasetId, limit }, undefined, { token: authToken });
            setMetadataCatalogPreviewRows((prev) => ({
                ...prev,
                [datasetId]: payload.previewMetadataDataset ?? { rows: [] },
            }));
        }
        catch (error) {
            setMetadataCatalogPreviewErrors((prev) => ({
                ...prev,
                [datasetId]: error instanceof Error ? error.message : String(error),
            }));
        }
        finally {
            if (!silent) {
                setMetadataCatalogPreviewingId((prev) => (prev === datasetId ? null : prev));
            }
        }
    }, [authToken, metadataEndpoint]);
    const handleSubmitMetadataEndpoint = useCallback(async (event) => {
        event.preventDefault();
        console.info("[metadata-ui] submit", { mode: metadataFormMode, editing: metadataEditingEndpointId });
        if (!selectedTemplate) {
            setMetadataMutationError("Select an endpoint template before continuing.");
            return;
        }
        if (!metadataEndpoint) {
            setMetadataMutationError("Configure VITE_METADATA_GRAPHQL_ENDPOINT to manage endpoints.");
            return;
        }
        if (!canModifyEndpoints) {
            setMetadataMutationError("You do not have permission to modify endpoints.");
            return;
        }
        setMetadataRegistering(true);
        setMetadataMutationError(null);
        try {
            const userLabels = parseListInput(metadataEndpointLabels);
            const labels = metadataFormMode === "register"
                ? Array.from(new Set([...(selectedTemplate.defaultLabels ?? []), ...userLabels]))
                : userLabels;
            const configPayload = {
                templateId: selectedTemplate.id,
                parameters: metadataTemplateValues,
            };
            const fallbackUrl = buildTemplateConnectionUrl(selectedTemplate, metadataTemplateValues);
            if (metadataFormMode === "edit" && metadataEditingEndpointId) {
                await fetchMetadataGraphQL(metadataEndpoint, UPDATE_METADATA_ENDPOINT_MUTATION, {
                    id: metadataEditingEndpointId,
                    patch: {
                        name: metadataEndpointName.trim() || `${selectedTemplate.title} endpoint`,
                        description: metadataEndpointDescription.trim() || null,
                        labels,
                        config: configPayload,
                    },
                }, undefined, { token: authToken ?? undefined });
                handleCloseRegistration();
                handleCloseEndpointDetail();
                refreshMetadataWorkspace();
            }
            else {
                await fetchMetadataGraphQL(metadataEndpoint, REGISTER_METADATA_ENDPOINT_MUTATION, {
                    input: {
                        projectSlug: projectSlug ?? undefined,
                        name: metadataEndpointName.trim() || `${selectedTemplate.title} endpoint`,
                        description: metadataEndpointDescription.trim() || selectedTemplate.description || null,
                        verb: selectedTemplate.family === "HTTP" ? "GET" : "POST",
                        url: fallbackUrl,
                        domain: selectedTemplate.domain ?? undefined,
                        labels: labels.length ? labels : undefined,
                        config: configPayload,
                        capabilities: selectedTemplate.capabilities?.map((capability) => capability.key) ?? undefined,
                    },
                }, undefined, { token: authToken ?? undefined });
                setMetadataTemplateValues({});
                setMetadataEndpointName("");
                setMetadataEndpointDescription("");
                setMetadataEndpointLabels("");
                setMetadataTestResult(null);
                handleCloseRegistration();
                handleCloseEndpointDetail();
                refreshMetadataWorkspace();
            }
        }
        catch (error) {
            setMetadataMutationError(error instanceof Error ? error.message : String(error));
        }
        finally {
            setMetadataRegistering(false);
        }
    }, [
        authToken,
        canModifyEndpoints,
        handleCloseEndpointDetail,
        handleCloseRegistration,
        metadataEditingEndpointId,
        metadataEndpoint,
        metadataEndpointDescription,
        metadataEndpointLabels,
        metadataEndpointName,
        metadataFormMode,
        metadataTemplateValues,
        projectSlug,
        refreshMetadataWorkspace,
        selectedTemplate,
    ]);
    const handleTestMetadataEndpoint = useCallback(async () => {
        if (!selectedTemplate) {
            setMetadataMutationError("Select an endpoint template before testing.");
            return;
        }
        if (!metadataEndpoint) {
            setMetadataMutationError("Configure VITE_METADATA_GRAPHQL_ENDPOINT to test endpoints.");
            return;
        }
        setMetadataTesting(true);
        setMetadataTestResult(null);
        try {
            const payload = await fetchMetadataGraphQL(metadataEndpoint, TEST_METADATA_ENDPOINT_MUTATION, {
                input: {
                    templateId: selectedTemplate.id,
                    type: selectedTemplate.family.toLowerCase(),
                    connection: metadataTemplateValues,
                    capabilities: selectedTemplate.capabilities?.map((capability) => capability.key),
                },
            }, undefined, { token: authToken ?? undefined });
            const result = payload.testEndpoint;
            setMetadataTestResult(result);
            if (result.ok) {
                setMetadataLastTestConfigSignature(serializeTemplateConfigSignature(selectedTemplate.id, metadataTemplateValues));
            }
        }
        catch (error) {
            setMetadataTestResult({
                ok: false,
                diagnostics: [
                    {
                        level: "ERROR",
                        code: "E_CONN_TEST_FAILED",
                        message: error instanceof Error ? error.message : String(error),
                    },
                ],
            });
        }
        finally {
            setMetadataTesting(false);
        }
    }, [authToken, metadataEndpoint, metadataEndpointDescription, metadataEndpointLabels, metadataEndpointName, metadataTemplateValues, selectedTemplate]);
    const triggerCollectionAction = useAsyncAction(async (endpointId) => {
        if (!metadataEndpoint) {
            throw new Error("Configure VITE_METADATA_GRAPHQL_ENDPOINT to trigger collections.");
        }
        if (!canModifyEndpoints) {
            throw new Error("You do not have permission to trigger collections.");
        }
        const targetEndpoint = metadataEndpoints.find((endpoint) => endpoint.id === endpointId);
        if (!targetEndpoint) {
            throw new Error("Endpoint not found or no longer visible.");
        }
        const declaredCapabilities = targetEndpoint.capabilities ?? [];
        const supportsMetadataCapability = declaredCapabilities.length === 0 || declaredCapabilities.includes("metadata");
        if (!supportsMetadataCapability) {
            throw new Error(`Cannot trigger collection. ${targetEndpoint.name} is missing the "metadata" capability.`);
        }
        const targetCollection = metadataCollectionsByEndpoint.get(endpointId);
        if (targetCollection && !targetCollection.isEnabled) {
            throw new Error(`Cannot trigger collection because the collection for ${targetEndpoint.name} is disabled.`);
        }
        setMetadataMutationError(null);
        const override = metadataRunOverrides[endpointId];
        const schemaOverride = override
            ? override
                .split(",")
                .map((schema) => schema.trim())
                .filter(Boolean)
            : undefined;
        const payload = await fetchMetadataGraphQL(metadataEndpoint, TRIGGER_ENDPOINT_COLLECTION_MUTATION, {
            endpointId,
            schemaOverride,
        }, undefined, { token: authToken ?? undefined });
        refreshMetadataWorkspace();
        return { endpoint: targetEndpoint, run: payload.triggerEndpointCollection };
    }, {
        onSuccess: (result) => {
            if (!result) {
                return;
            }
            const { endpoint, run } = result;
            if (run?.status === "FAILED") {
                toastQueue.pushToast({
                    intent: "error",
                    title: endpoint ? `Collection failed for ${endpoint.name}` : "Collection failed",
                    description: run.error ?? "Endpoint unreachable in this environment.",
                });
                return;
            }
            toastQueue.pushToast({
                intent: "success",
                title: endpoint ? `Triggered ${endpoint.name}` : "Collection triggered",
                description: "Collection run enqueued.",
            });
        },
        onError: (error) => {
            setMetadataMutationError(error.message ?? String(error));
            toastQueue.pushToast({
                intent: "error",
                title: "Failed to trigger collection",
                description: error.message ?? String(error),
            });
        },
    });
    const handleTriggerMetadataRun = useCallback(async (endpointId) => {
        setPendingTriggerEndpointId(endpointId);
        try {
            await triggerCollectionAction.run(endpointId);
        }
        catch {
            // Error already surfaced via toast + mutation banner
        }
        finally {
            setPendingTriggerEndpointId((prev) => (prev === endpointId ? null : prev));
        }
    }, [triggerCollectionAction]);
    const handleDeleteMetadataEndpoint = useCallback(async (endpoint) => {
        if (!canDeleteEndpoints) {
            setMetadataMutationError("You do not have permission to delete endpoints.");
            return;
        }
        if (!metadataEndpoint) {
            setMetadataMutationError("Configure VITE_METADATA_GRAPHQL_ENDPOINT to delete endpoints.");
            return;
        }
        if (typeof window !== "undefined") {
            const navigatorIsAutomation = Boolean(window.navigator.webdriver);
            const confirmMessage = `Delete “${endpoint.name}”? Metadata collections and their datasets will no longer receive updates.`;
            const confirmDelete = window.confirm(confirmMessage);
            if (!confirmDelete && !navigatorIsAutomation) {
                return;
            }
        }
        setMetadataDeletingEndpointId(endpoint.id);
        setMetadataMutationError(null);
        try {
            await fetchMetadataGraphQL(metadataEndpoint, DELETE_METADATA_ENDPOINT_MUTATION, { id: endpoint.id }, undefined, { token: authToken ?? undefined });
            if (metadataEditingEndpointId === endpoint.id) {
                handleCloseRegistration();
            }
            if (metadataEndpointDetailId === endpoint.id) {
                setMetadataEndpointDetailId(null);
            }
            setCatalogHiddenEndpointIds((prev) => (prev.includes(endpoint.id) ? prev : [...prev, endpoint.id]));
            setMetadataRuns((prev) => prev.filter((run) => run.endpoint?.id !== endpoint.id));
            setMetadataCatalogEndpointFilter((prev) => {
                if (prev === endpoint.id) {
                    setMetadataEndpointPickerQuery("");
                    return "all";
                }
                return prev;
            });
            await refreshCatalogDatasets();
            await refreshMetadataEndpoints();
        }
        catch (error) {
            setMetadataMutationError(error instanceof Error ? error.message : String(error));
        }
        finally {
            setMetadataDeletingEndpointId((prev) => (prev === endpoint.id ? null : prev));
        }
    }, [
        authToken,
        canDeleteEndpoints,
        handleCloseRegistration,
        metadataEditingEndpointId,
        metadataEndpoint,
        metadataEndpointDetailId,
        refreshCatalogDatasets,
        refreshMetadataEndpoints,
    ]);
    const loadEndpointDatasets = useCallback(async (endpointId, options) => {
        if (!metadataEndpoint || !authToken) {
            return;
        }
        if (!options?.force && endpointDatasetRecords[endpointId]) {
            return;
        }
        setEndpointDatasetLoading((prev) => ({ ...prev, [endpointId]: true }));
        try {
            const payload = await fetchMetadataGraphQL(metadataEndpoint, ENDPOINT_DATASETS_QUERY, { endpointId }, undefined, { token: authToken });
            setEndpointDatasetRecords((prev) => ({ ...prev, [endpointId]: payload.endpointDatasets ?? [] }));
            setEndpointDatasetErrors((prev) => {
                const next = { ...prev };
                delete next[endpointId];
                return next;
            });
        }
        catch (error) {
            setEndpointDatasetErrors((prev) => ({
                ...prev,
                [endpointId]: error instanceof Error ? error.message : String(error),
            }));
        }
        finally {
            setEndpointDatasetLoading((prev) => ({ ...prev, [endpointId]: false }));
        }
    }, [authToken, endpointDatasetRecords, metadataEndpoint]);
    useEffect(() => {
        if (!selectedTemplate) {
            return;
        }
        setMetadataTemplateValues((prev) => {
            const next = {};
            selectedTemplate.fields.forEach((field) => {
                if (prev[field.key] !== undefined) {
                    next[field.key] = prev[field.key];
                    return;
                }
                if (field.defaultValue !== null && field.defaultValue !== undefined) {
                    next[field.key] = field.defaultValue;
                    return;
                }
                if (field.valueType === "PORT" && selectedTemplate.defaultPort) {
                    next[field.key] = String(selectedTemplate.defaultPort);
                    return;
                }
                if (field.valueType === "BOOLEAN") {
                    next[field.key] = "false";
                    return;
                }
                next[field.key] = "";
            });
            return next;
        });
        setMetadataEndpointName((prev) => {
            if (prev.trim().length > 0) {
                return prev;
            }
            return `${selectedTemplate.title} endpoint`;
        });
        setMetadataEndpointDescription((prev) => {
            if (prev.trim().length > 0 || !selectedTemplate.description) {
                return prev;
            }
            return selectedTemplate.description;
        });
        setMetadataEndpointLabels((prev) => {
            if (prev.trim().length > 0) {
                return prev;
            }
            return (selectedTemplate.defaultLabels ?? []).join(", ");
        });
        setMetadataTestResult(null);
    }, [selectedTemplate]);
    useEffect(() => {
        if (!metadataTemplates.length) {
            return;
        }
        setSelectedTemplateId((prev) => prev ?? metadataTemplates[0].id);
    }, [metadataTemplates]);
    useEffect(() => {
        if (!metadataEndpointDetailId) {
            return;
        }
        if (endpointDatasetRecords[metadataEndpointDetailId]) {
            return;
        }
        void loadEndpointDatasets(metadataEndpointDetailId);
    }, [metadataEndpointDetailId, endpointDatasetRecords, loadEndpointDatasets]);
    useEffect(() => {
        if (!filteredTemplates.length) {
            return;
        }
        if (!filteredTemplates.some((template) => template.id === selectedTemplateId)) {
            setSelectedTemplateId(filteredTemplates[0].id);
        }
    }, [filteredTemplates, metadataTemplateFamily, selectedTemplateId]);
    useEffect(() => {
        if (pendingTemplateSelection && metadataTemplates.length > 0) {
            applyTemplateSelection(pendingTemplateSelection.templateId, pendingTemplateSelection.familyOverride);
            setPendingTemplateSelection(null);
        }
    }, [applyTemplateSelection, metadataTemplates.length, pendingTemplateSelection]);
    useEffect(() => {
        if (pendingEndpointEdit && metadataTemplates.length > 0) {
            populateEndpointEditFields(pendingEndpointEdit);
            setPendingEndpointEdit(null);
        }
    }, [metadataTemplates.length, pendingEndpointEdit, populateEndpointEditFields]);
    useEffect(() => {
        if (metadataView === "endpoint-register" && metadataTemplates.length === 0 && !metadataTemplatesError) {
            ensureTemplatesLoaded();
        }
    }, [ensureTemplatesLoaded, metadataTemplates.length, metadataTemplatesError, metadataView]);
    useEffect(() => {
        if (!metadataEndpoint) {
            setMetadataError("Configure VITE_METADATA_GRAPHQL_ENDPOINT for metadata workspace access.");
            setMetadataLoading(false);
            return;
        }
        if (!authToken) {
            setMetadataLoading(true);
            setMetadataError(null);
            return;
        }
        const controller = new AbortController();
        const loadMetadataOverview = async () => {
            setMetadataLoading(true);
            setMetadataError(null);
            try {
                const data = await fetchMetadataGraphQL(metadataEndpoint, METADATA_OVERVIEW_QUERY, { projectSlug: projectSlug ?? undefined }, controller.signal, {
                    token: authToken ?? undefined,
                });
                if (controller.signal.aborted) {
                    return;
                }
                setMetadataCollections(data.collections ?? []);
            }
            catch (error) {
                if (!controller.signal.aborted) {
                    setMetadataError(error instanceof Error ? error.message : String(error));
                }
            }
            finally {
                if (!controller.signal.aborted) {
                    setMetadataLoading(false);
                }
            }
        };
        void loadMetadataOverview();
        return () => controller.abort();
    }, [authToken, metadataEndpoint, metadataRefreshToken, projectSlug]);
    useEffect(() => {
        if (!metadataCatalogSelectedDataset || !authToken) {
            return;
        }
        const datasetId = metadataCatalogSelectedDataset.id;
        if (metadataCatalogPreviewRows[datasetId]) {
            return;
        }
        if (metadataCatalogPreviewingId && metadataCatalogPreviewingId !== datasetId) {
            return;
        }
        void handlePreviewMetadataDataset(datasetId, { silent: true });
    }, [
        handlePreviewMetadataDataset,
        authToken,
        metadataCatalogPreviewRows,
        metadataCatalogSelectedDataset,
        metadataCatalogPreviewingId,
    ]);
    useEffect(() => {
        if (!metadataDatasetDetailId) {
            return;
        }
        if (datasetDetailCache[metadataDatasetDetailId]) {
            return;
        }
        if (inflightDatasetDetailIdRef.current === metadataDatasetDetailId) {
            return;
        }
        void loadDatasetDetail(metadataDatasetDetailId).catch(() => {
            /* errors handled via datasetDetailError */
        });
    }, [datasetDetailCache, loadDatasetDetail, metadataDatasetDetailId]);
    useEffect(() => {
        const selectedId = metadataCatalogSelectedDataset?.id;
        if (!selectedId) {
            return;
        }
        if (datasetDetailCache[selectedId]) {
            return;
        }
        if (inflightDatasetDetailIdRef.current === selectedId) {
            return;
        }
        void loadDatasetDetail(selectedId).catch(() => {
            /* non-fatal; catalog view will show fallback state */
        });
    }, [datasetDetailCache, loadDatasetDetail, metadataCatalogSelectedDataset?.id]);
    const renderCatalogSection = () => {
        const catalogDataset = metadataCatalogSelectedDataset && metadataCatalogSelectedDataset.id
            ? datasetDetailCache[metadataCatalogSelectedDataset.id] ?? metadataCatalogSelectedDataset
            : metadataCatalogSelectedDataset;
        const labelFilterOptions = [
            { value: "all", label: "All labels" },
            { value: "unlabeled", label: "Unlabeled" },
            ...metadataCatalogLabelOptions.map((label) => ({ value: label, label })),
        ];
        const activeFilterChips = [];
        if (metadataCatalogSearch.trim().length > 0) {
            activeFilterChips.push({
                label: `Search · ${metadataCatalogSearch.trim()}`,
                onClear: () => setMetadataCatalogSearch(""),
            });
        }
        if (metadataCatalogEndpointFilter !== "all") {
            const endpointLabel = metadataCatalogEndpointFilter === "unlinked"
                ? "Unlinked datasets"
                : metadataEndpointLookup.get(metadataCatalogEndpointFilter)?.name ?? metadataCatalogEndpointFilter;
            activeFilterChips.push({
                label: `Endpoint · ${endpointLabel}`,
                onClear: () => handleSelectEndpointFilter("all"),
            });
        }
        if (metadataCatalogLabelFilter !== "all") {
            const labelName = labelFilterOptions.find((option) => option.value === metadataCatalogLabelFilter)?.label ?? metadataCatalogLabelFilter;
            activeFilterChips.push({
                label: `Label · ${labelName}`,
                onClear: () => setMetadataCatalogLabelFilter("all"),
            });
        }
        const catalogDatasetDisplayId = catalogDataset?.upstreamId ?? catalogDataset?.id ?? null;
        const catalogDatasetFields = catalogDataset?.fields ?? [];
        const selectedDatasetEndpoint = catalogPreviewState.owner;
        const endpointCapabilities = catalogPreviewState.endpointCapabilities;
        const declaresEndpointCapabilities = endpointCapabilities.length > 0;
        const endpointSupportsProfile = !declaresEndpointCapabilities || endpointCapabilities.includes("profile");
        const previewStatusMessage = catalogPreviewState.previewStatusMessage;
        const previewStatusTone = catalogPreviewState.previewStatusTone;
        const hasLinkedEndpoint = Boolean(catalogDataset?.sourceEndpointId && selectedDatasetEndpoint);
        const canPreviewDataset = Boolean(catalogDataset) && catalogPreviewState.canPreview;
        const previewRows = catalogPreviewState.previewRows.length > 0
            ? catalogPreviewState.previewRows
            : catalogDataset?.sampleRows ?? [];
        const previewColumns = previewTableColumns(previewRows);
        const selectedDatasetPreviewError = catalogPreviewState.previewError;
        const isPreviewingActive = Boolean(catalogDataset) && catalogPreviewState.previewing;
        const lastCollectionRun = catalogDataset?.lastCollectionRun ?? null;
        const profileBlockReason = (selectedDatasetEndpoint && declaresEndpointCapabilities && !endpointSupportsProfile
            ? `Dataset profiles disabled: ${selectedDatasetEndpoint.name} is missing the "profile" capability.`
            : null) ??
            (!hasLinkedEndpoint && catalogDataset ? "Link this dataset to a registered endpoint before profiling." : null);
        return (_jsxs("div", { className: "grid gap-6 lg:grid-cols-[320px,1fr]", children: [_jsxs("section", { className: "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900", "data-testid": "metadata-dataset-detail", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Datasets" }), _jsx("p", { className: "text-xs text-slate-500", children: "Search catalog entries ingested from the metadata service." })] }), _jsx("div", { className: "mt-4 space-y-4", children: _jsxs("div", { className: "rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300", children: [_jsx("p", { className: "text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Filter" }), _jsxs("div", { className: "mt-3 space-y-3", children: [_jsxs("div", { className: "relative", children: [_jsx(LuSearch, { className: "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" }), _jsx("label", { htmlFor: "metadata-catalog-search", className: "sr-only", children: "Search name, label, or source" }), _jsx("input", { id: "metadata-catalog-search", value: metadataCatalogSearch, onChange: (event) => setMetadataCatalogSearch(event.target.value), placeholder: "Search name, label, or source", className: "w-full rounded-2xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100" })] }), activeFilterChips.length ? (_jsxs("div", { className: "flex flex-wrap gap-2", children: [activeFilterChips.map((chip) => (_jsxs("button", { type: "button", onClick: chip.onClear, className: "inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200", children: [chip.label, _jsx("span", { "aria-hidden": "true", children: "\u00D7" })] }, chip.label))), _jsx("button", { type: "button", onClick: () => {
                                                            setMetadataCatalogSearch("");
                                                            handleSelectEndpointFilter("all");
                                                            setMetadataCatalogLabelFilter("all");
                                                        }, className: "rounded-full border border-transparent px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 hover:text-slate-900 dark:text-slate-300", children: "Clear all" })] })) : null, _jsxs("div", { className: "grid gap-3 md:grid-cols-2", children: [_jsxs("div", { className: "relative", ref: endpointPickerRef, children: [_jsx("label", { className: "text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Endpoint" }), _jsxs("div", { className: "relative mt-1", children: [_jsx("input", { "data-testid": "metadata-catalog-filter-endpoint", type: "text", role: "combobox", "aria-expanded": metadataEndpointPickerOpen, "aria-haspopup": "listbox", "aria-controls": "metadata-endpoint-picker-list", value: metadataEndpointPickerQuery, onFocus: () => setMetadataEndpointPickerOpen(true), onKeyDown: (event) => {
                                                                            if (event.key === "Escape") {
                                                                                setMetadataEndpointPickerOpen(false);
                                                                            }
                                                                            if (event.key === "ArrowDown" && !metadataEndpointPickerOpen) {
                                                                                setMetadataEndpointPickerOpen(true);
                                                                            }
                                                                        }, onChange: (event) => {
                                                                            setMetadataEndpointPickerQuery(event.target.value);
                                                                            setMetadataEndpointPickerOpen(true);
                                                                        }, placeholder: "Search or select endpoint", className: "w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" }), metadataCatalogEndpointFilter !== "all" ? (_jsx("button", { type: "button", onClick: () => handleSelectEndpointFilter("all"), "data-testid": "metadata-catalog-endpoint-clear", className: "absolute inset-y-0 right-2 my-auto rounded-full border border-transparent px-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 hover:text-slate-900 dark:text-slate-200", children: "Clear" })) : null, metadataEndpointPickerOpen ? (_jsxs("div", { id: "metadata-endpoint-picker-list", className: "absolute left-0 right-0 top-full z-40 mt-2 rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900", children: [_jsxs("div", { className: "flex flex-col gap-1 border-b border-slate-100 p-2 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-200", children: [_jsx("button", { type: "button", onClick: () => handleSelectEndpointFilter("all"), className: "rounded-xl px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800", children: "All endpoints" }), _jsx("button", { type: "button", onClick: () => handleSelectEndpointFilter("unlinked"), className: "rounded-xl px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800", children: "Unlinked datasets" })] }), _jsx("div", { className: "max-h-56 overflow-y-auto", children: metadataEndpointPickerLoading ? (_jsx("p", { className: "px-3 py-2 text-xs text-slate-500", children: "Loading endpoints\u2026" })) : metadataEndpointPickerOptions.length === 0 ? (_jsxs("p", { className: "px-3 py-2 text-xs text-slate-500", children: ["No endpoints match \u201C", metadataEndpointPickerQuery.trim(), "\u201D."] })) : (metadataEndpointPickerOptions.map((endpoint) => (_jsxs("button", { type: "button", onClick: () => handleSelectEndpointFilter(endpoint.id, { label: endpoint.name }), "data-testid": "metadata-endpoint-option", "data-endpoint-id": endpoint.id, className: "flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800", children: [_jsx("span", { className: "font-medium", children: endpoint.name }), endpoint.capabilities?.length ? (_jsx("span", { className: "text-[10px] uppercase tracking-[0.3em] text-slate-400", children: endpoint.capabilities.join(", ") })) : null] }, endpoint.id)))) }), metadataEndpointPickerPageInfo.hasNextPage ? (_jsx("button", { type: "button", onClick: () => fetchMoreMetadataEndpointOptions(), className: "w-full border-t border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300", children: "Load more sources" })) : null, _jsx("div", { className: "border-t border-slate-100 px-3 py-2 text-right dark:border-slate-800", children: _jsx("button", { type: "button", onClick: () => refreshMetadataEndpointOptions(), className: "text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 hover:text-slate-900 dark:text-slate-300", children: "Refresh list" }) })] })) : null] })] }), _jsxs("div", { className: "space-y-1", children: [_jsx("label", { className: "text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Label" }), _jsx("select", { "data-testid": "metadata-catalog-filter-label", className: "w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100", value: metadataCatalogLabelFilter, onChange: (event) => setMetadataCatalogLabelFilter(event.target.value), children: labelFilterOptions.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value))) })] })] })] })] }) }), _jsx("div", { className: "scrollbar-thin mt-4 max-h-[calc(100vh-320px)] overflow-y-auto pr-1", children: catalogDatasetsError ? (_jsxs("div", { className: "rounded-2xl border border-rose-200 bg-rose-50 px-3 py-4 text-xs text-rose-700 dark:border-rose-500/60 dark:bg-rose-950/40 dark:text-rose-200", children: [_jsx("p", { children: catalogDatasetsError }), _jsx("button", { type: "button", onClick: () => refreshCatalogDatasets(), className: "mt-2 rounded-full border border-rose-300 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-rose-600 hover:bg-rose-100 dark:border-rose-400/60 dark:text-rose-200", children: "Retry loading datasets" })] })) : metadataCatalogFilteredDatasets.length === 0 ? (_jsx("p", { className: "rounded-xl border border-dashed border-slate-300 px-3 py-4 text-xs text-slate-500 dark:border-slate-700", "data-testid": "metadata-catalog-empty", children: metadataCatalogSearch.trim().length > 0 || metadataCatalogLabelFilter !== "all" || metadataCatalogEndpointFilter !== "all"
                                    ? "No datasets match the current filters."
                                    : catalogDatasetsLoading
                                        ? "Loading datasets…"
                                        : "No datasets were ingested yet. Trigger a collection run to add catalog entries." })) : (_jsxs(_Fragment, { children: [metadataCatalogFilteredDatasets.map((dataset) => {
                                        const isActive = metadataCatalogSelectedDataset?.id === dataset.id;
                                        const owner = dataset.sourceEndpointId ? metadataEndpointLookup.get(dataset.sourceEndpointId) : null;
                                        return (_jsxs("button", { type: "button", onClick: () => setMetadataCatalogSelection(dataset.id), "data-testid": "metadata-catalog-card", className: `mb-2 flex w-full flex-col rounded-2xl border px-3 py-2 text-left transition ${isActive
                                                ? "border-slate-900 bg-slate-900 text-white shadow dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                                                : "border-slate-200 bg-white text-slate-700 hover:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`, children: [_jsx("span", { className: "text-sm font-semibold", children: dataset.displayName }), _jsx("span", { className: "text-[11px] uppercase tracking-[0.3em] text-slate-400", children: owner ? `Endpoint · ${owner.name}` : "Unlinked" }), _jsx("span", { className: "text-[10px] uppercase tracking-[0.3em] text-slate-400", children: dataset.labels?.length ? `Labels · ${dataset.labels.slice(0, 3).join(", ")}` : dataset.source ?? dataset.id })] }, dataset.id));
                                    }), catalogDatasetsLoading ? (_jsx("p", { className: "text-xs text-slate-500", children: "Loading more datasets\u2026" })) : null, catalogDatasetsPageInfo.hasNextPage ? (_jsx("button", { type: "button", onClick: () => fetchMoreCatalogDatasets(), disabled: catalogDatasetsLoading, className: "mt-2 w-full rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200", children: "Load more datasets" })) : null] })) })] }), _jsx("section", { className: "min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900", children: catalogDataset ? (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-xl font-semibold text-slate-900 dark:text-white", children: catalogDataset.displayName }), catalogDatasetDisplayId ? (_jsx("p", { className: "text-xs uppercase tracking-[0.3em] text-slate-500", children: catalogDatasetDisplayId })) : null] }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx("button", { type: "button", onClick: () => handleOpenDatasetDetail(catalogDataset.id), disabled: pendingDatasetNavigationId === catalogDataset.id, className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200", children: pendingDatasetNavigationId === catalogDataset.id ? (_jsxs(_Fragment, { children: [_jsx(LuHistory, { className: "h-4 w-4 animate-spin" }), "Opening\u2026"] })) : ("View detail") }), _jsxs("button", { type: "button", onClick: () => handlePreviewMetadataDataset(catalogDataset.id), className: `inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] transition ${canPreviewDataset
                                                    ? "border-slate-300 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                                                    : "border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-600"}`, disabled: !canPreviewDataset || isPreviewingActive, "data-testid": "metadata-preview-button", children: [isPreviewingActive ? _jsx(LuHistory, { className: "h-3 w-3 animate-spin" }) : _jsx(LuTable, { className: "h-3 w-3" }), isPreviewingActive ? "Fetching…" : "Preview dataset"] })] })] }), _jsx("p", { className: "text-sm text-slate-600 dark:text-slate-300", children: catalogDataset.description ?? "No description provided." }), _jsxs("div", { className: "flex flex-wrap items-center gap-3 text-xs text-slate-500", children: [_jsxs("span", { children: ["Endpoint \u00B7 ", selectedDatasetEndpoint?.name ?? "Unlinked"] }), catalogDataset.collectedAt ? _jsxs("span", { children: ["Collected ", formatDateTime(catalogDataset.collectedAt)] }) : null, lastCollectionRun ? (_jsxs("span", { children: ["Last collection \u00B7 ", lastCollectionRun.status, " ", lastCollectionRun.completedAt ? formatDateTime(lastCollectionRun.completedAt) : ""] })) : null] }), catalogDataset.labels?.length ? (_jsx("div", { className: "flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.3em] text-slate-500", children: catalogDataset.labels.map((label) => (_jsx("span", { className: "rounded-full border border-slate-300 px-2 py-0.5 dark:border-slate-600", children: label }, label))) })) : null, _jsx(IngestionSummaryCard, { dataset: catalogDataset, className: "mt-4" }), _jsxs("div", { children: [_jsxs("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: ["Fields (", catalogDatasetFields.length, ")"] }), _jsxs("div", { className: "mt-3 space-y-2", children: [catalogDatasetFields.map((field) => (_jsxs("div", { className: "rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("p", { className: "font-medium text-slate-900 dark:text-slate-100", children: field.name }), _jsx("span", { className: "text-[11px] uppercase tracking-[0.3em] text-slate-400", children: field.type })] }), field.description ? _jsx("p", { className: "text-xs text-slate-500 dark:text-slate-400", children: field.description }) : null] }, field.name))), catalogDatasetFields.length === 0 ? (_jsx("p", { className: "rounded-xl border border-dashed border-slate-300 px-4 py-4 text-xs text-slate-500 dark:border-slate-700", children: "No field metadata discovered yet." })) : null] })] }), datasetDetailLoading ? (_jsx("p", { className: "rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700", children: "Loading dataset metadata\u2026" })) : null, datasetDetailError ? (_jsx("p", { className: "rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-400/60 dark:bg-rose-950/40 dark:text-rose-200", children: datasetDetailError })) : null, _jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Preview" }), _jsx("div", { className: "mt-2 flex flex-wrap items-center gap-3", children: catalogPreviewState.sampledAt ? (_jsxs("span", { className: "text-xs text-slate-500 dark:text-slate-300", children: ["Sampled ", formatRelativeTime(catalogPreviewState.sampledAt)] })) : previewStatusMessage ? (_jsx("span", { className: `text-xs ${previewStatusTone === "warn" ? "text-rose-600 dark:text-rose-300" : "text-slate-500 dark:text-slate-300"}`, children: previewStatusMessage })) : (_jsx("span", { className: "text-xs text-slate-500 dark:text-slate-300", children: "Preview pulls 20 live rows per request." })) }), selectedDatasetPreviewError ? (_jsx("p", { className: "mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-400/60 dark:bg-rose-950/40 dark:text-rose-200", children: selectedDatasetPreviewError })) : null, previewRows.length ? (_jsx("div", { className: "mt-3 w-full max-h-64 max-w-full overflow-x-auto overflow-y-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900", "data-testid": "metadata-preview-table", children: _jsxs("table", { className: "min-w-full divide-y divide-slate-200 text-xs dark:divide-slate-700", children: [_jsx("thead", { className: "bg-slate-50 text-left font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300", children: _jsx("tr", { children: previewColumns.map((column) => (_jsx("th", { className: "px-3 py-2 uppercase tracking-[0.3em] text-[10px] text-slate-400", children: column }, column))) }) }), _jsx("tbody", { children: previewRows.map((row, index) => (_jsx("tr", { className: "border-t border-slate-100 dark:border-slate-800", children: previewColumns.map((column) => (_jsx("td", { className: "px-3 py-2 text-slate-700 dark:text-slate-200 break-words whitespace-pre-wrap", children: formatPreviewValue(row[column]) }, column))) }, index))) })] }) })) : (_jsx("p", { className: `mt-2 text-xs ${previewStatusTone === "warn" ? "text-rose-600 dark:text-rose-300" : "text-slate-500 dark:text-slate-300"}`, "data-testid": "metadata-preview-empty", children: isPreviewingActive
                                            ? "Collecting sample rows…"
                                            : previewStatusMessage ?? "No preview sampled yet. Run a preview to inspect live data." }))] }), _jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Profile" }), profileBlockReason ? (_jsx("p", { className: "mt-2 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-300", children: profileBlockReason })) : catalogDataset.profile ? (_jsxs("div", { className: "mt-2 grid gap-3 sm:grid-cols-3", children: [_jsxs("div", { className: "rounded-2xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700", children: [_jsx("p", { className: "text-[11px] uppercase tracking-[0.3em] text-slate-400", children: "Records" }), _jsx("p", { className: "text-base font-semibold text-slate-900 dark:text-white", children: catalogDataset.profile.recordCount ?? "—" })] }), _jsxs("div", { className: "rounded-2xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700", children: [_jsx("p", { className: "text-[11px] uppercase tracking-[0.3em] text-slate-400", children: "Sample size" }), _jsx("p", { className: "text-base font-semibold text-slate-900 dark:text-white", children: catalogDataset.profile.sampleSize ?? "—" })] }), _jsxs("div", { className: "rounded-2xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700", children: [_jsx("p", { className: "text-[11px] uppercase tracking-[0.3em] text-slate-400", children: "Profiled" }), _jsx("p", { className: "text-base font-semibold text-slate-900 dark:text-white", children: catalogDataset.profile.lastProfiledAt
                                                            ? formatDateTime(catalogDataset.profile.lastProfiledAt)
                                                            : "Not recorded" })] })] })) : (_jsx("p", { className: "mt-2 text-xs text-slate-500", "data-testid": "metadata-profile-empty", children: "Profiling not run yet. Trigger a collection to refresh dataset insights." }))] })] })) : (_jsx("p", { className: "rounded-xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500 dark:border-slate-700", "data-testid": "metadata-dataset-empty", children: "Select a dataset on the left to inspect its schema." })) })] }));
    };
    const renderEndpointRegistrationPage = () => (_jsx("div", { className: "space-y-6", "data-testid": "metadata-register-form", children: _jsxs("div", { className: "grid gap-6 lg:grid-cols-[minmax(300px,340px),1fr]", children: [_jsxs("section", { className: "space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Select a template" }), _jsx("p", { className: "text-xs text-slate-500", children: "Choose a family, then pick a specific connector to configure." })] }), _jsx("div", { className: "flex flex-wrap gap-2", children: templateFamilies.map((family) => (_jsx("button", { type: "button", onClick: () => setMetadataTemplateFamily(family.id), className: `rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] ${metadataTemplateFamily === family.id
                                    ? "bg-slate-900 text-white dark:bg-emerald-500 dark:text-slate-900"
                                    : "border border-slate-300 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300"}`, children: family.label }, family.id))) }), _jsx("p", { className: "text-xs text-slate-500", children: templateFamilies.find((family) => family.id === metadataTemplateFamily)?.description ?? "" }), _jsxs("div", { className: "space-y-2", children: [metadataTemplatesError ? (_jsxs("div", { className: "rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100", children: [_jsx("p", { children: metadataTemplatesError }), _jsx("button", { type: "button", onClick: handleRetryLoadTemplates, className: "mt-2 rounded-full border border-rose-300 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-rose-700 hover:bg-rose-100 dark:border-rose-400/60 dark:text-rose-200", children: "Retry" })] })) : null, metadataTemplatesLoading && metadataTemplates.length === 0 ? (_jsx("p", { className: "rounded-xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500 dark:border-slate-700", children: "Loading templates\u2026" })) : filteredTemplates.length === 0 ? (_jsx("p", { className: "rounded-xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500 dark:border-slate-700", children: "No templates found for this family yet." })) : (filteredTemplates.map((template) => {
                                    const isActive = selectedTemplate?.id === template.id;
                                    return (_jsxs("button", { type: "button", onClick: () => setSelectedTemplateId(template.id), className: `w-full rounded-2xl border px-3 py-2 text-left transition ${isActive
                                            ? "border-slate-900 bg-slate-900 text-white shadow dark:border-emerald-400/70 dark:bg-emerald-500/10 dark:text-emerald-100"
                                            : "border-slate-200 text-slate-700 hover:border-slate-900 dark:border-slate-700 dark:text-slate-200"}`, children: [_jsx("p", { className: "text-sm font-semibold", children: template.title }), _jsx("p", { className: "text-[11px] uppercase tracking-[0.3em] text-slate-400", children: template.vendor }), _jsx("p", { className: "mt-1 text-xs text-slate-500 dark:text-slate-400", children: template.description })] }, template.id));
                                }))] }), selectedTemplate ? (_jsxs("div", { className: "space-y-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300", children: [_jsx("p", { className: "text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Agent briefing" }), _jsx("p", { className: "whitespace-pre-wrap", children: selectedTemplate.agentPrompt ?? "Collect credentials and scope for this endpoint." }), selectedTemplate.capabilities?.length ? (_jsx("ul", { className: "list-disc space-y-1 pl-4", children: selectedTemplate.capabilities?.map((capability) => (_jsx("li", { children: capability.label }, capability.key))) })) : null, selectedTemplate.connection?.urlTemplate ? (_jsxs("div", { children: [_jsx("p", { className: "text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Connection template" }), _jsx("pre", { className: "mt-2 overflow-x-auto rounded-xl bg-slate-900/90 p-3 font-mono text-[12px] text-emerald-200 dark:bg-slate-950", children: selectedTemplate.connection.urlTemplate })] })) : null, selectedTemplate.probing?.methods?.length ? (_jsxs("div", { children: [_jsx("p", { className: "text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Version detection" }), _jsx("ul", { className: "mt-2 space-y-2", children: selectedTemplate.probing.methods.map((method) => (_jsxs("li", { className: "rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800", children: [_jsxs("p", { className: "text-sm font-semibold text-slate-900 dark:text-slate-100", children: [method.label, " ", _jsxs("span", { className: "text-xs uppercase tracking-[0.3em] text-slate-400", children: ["(", method.strategy, ")"] })] }), method.description ? (_jsx("p", { className: "text-xs text-slate-500 dark:text-slate-400", children: method.description })) : null, method.requires && method.requires.length ? (_jsxs("p", { className: "text-[11px] text-slate-500", children: ["Requires: ", method.requires.join(", ")] })) : null] }, method.key))) }), selectedTemplate.probing.fallbackMessage ? (_jsx("p", { className: "mt-2 text-[11px] text-slate-500", children: selectedTemplate.probing.fallbackMessage })) : null] })) : null] })) : null] }), _jsx("section", { className: "space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900", children: !selectedTemplate ? (_jsx("p", { className: "text-sm text-slate-500", children: "Select a template to configure connection details." })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "space-y-1", children: [_jsx("p", { className: "text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500", children: formTitle }), _jsx("p", { className: "text-sm text-slate-500", children: metadataFormMode === "edit"
                                            ? "Update the endpoint details and re-test the connection whenever credentials change."
                                            : "Select a template, provide connection parameters, and register the endpoint after a passing test." })] }), metadataMutationError ? (_jsx("p", { className: "rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/50 dark:bg-rose-950/40 dark:text-rose-200", "data-testid": "metadata-mutation-error", children: metadataMutationError })) : null, _jsxs("form", { className: "space-y-4", onSubmit: handleSubmitMetadataEndpoint, children: [_jsxs("div", { className: "grid gap-3 md:grid-cols-2", children: [_jsxs("label", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: ["Endpoint name", _jsx("input", { value: metadataEndpointName, onChange: (event) => setMetadataEndpointName(event.target.value), className: "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" })] }), _jsxs("label", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: ["Labels", _jsx("input", { value: metadataEndpointLabels, onChange: (event) => setMetadataEndpointLabels(event.target.value), placeholder: "analytics, postgres, staging", className: "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" })] })] }), _jsxs("label", { className: "block text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: ["Description", _jsx("textarea", { value: metadataEndpointDescription, onChange: (event) => setMetadataEndpointDescription(event.target.value), className: "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100", rows: 2 })] }), _jsx("div", { className: "space-y-3", children: selectedTemplate.fields.map((field) => {
                                            if (!isFieldVisible(field)) {
                                                return null;
                                            }
                                            const value = metadataTemplateValues[field.key] ?? field.defaultValue ?? "";
                                            const required = isFieldRequired(field);
                                            const commonProps = {
                                                id: `template-${field.key}`,
                                                value,
                                                onChange: (event) => handleRequirementChange(field.key, event.target.value),
                                                required,
                                                className: "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
                                            };
                                            const inputType = field.valueType === "PASSWORD"
                                                ? "password"
                                                : field.valueType === "NUMBER" || field.valueType === "PORT"
                                                    ? "number"
                                                    : "text";
                                            const labelId = `template-${field.key}`;
                                            const advancedBadge = field.advanced ? (_jsx("span", { className: "rounded-full border border-slate-200 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-slate-400 dark:border-slate-600", children: "Advanced" })) : null;
                                            let control;
                                            if (field.valueType === "LIST") {
                                                control = _jsx("textarea", { ...commonProps, placeholder: field.placeholder ?? undefined, rows: 2 });
                                            }
                                            else if (field.valueType === "ENUM" && field.options) {
                                                control = (_jsxs("select", { ...commonProps, children: [_jsxs("option", { value: "", children: ["Select ", field.label] }), field.options.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value)))] }));
                                            }
                                            else if (field.valueType === "JSON") {
                                                control = _jsx("textarea", { ...commonProps, placeholder: field.placeholder ?? undefined, rows: 3 });
                                            }
                                            else if (field.valueType === "TEXT") {
                                                control = _jsx("textarea", { ...commonProps, placeholder: field.placeholder ?? undefined, rows: 4 });
                                            }
                                            else if (field.valueType === "BOOLEAN") {
                                                const checked = (value || "").toLowerCase() === "true";
                                                control = (_jsxs("div", { className: "mt-2 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40", children: [_jsx("input", { id: labelId, type: "checkbox", className: "h-4 w-4 accent-slate-900 dark:accent-emerald-500", checked: checked, onChange: (event) => handleRequirementChange(field.key, event.target.checked ? "true" : "false") }), _jsx("span", { className: "text-sm text-slate-700 dark:text-slate-200", children: checked ? "Enabled" : "Disabled" })] }));
                                            }
                                            else {
                                                control = (_jsx("input", { ...commonProps, type: inputType, placeholder: field.placeholder ?? undefined, autoComplete: field.valueType === "PASSWORD" ? "current-password" : undefined }));
                                            }
                                            return (_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("label", { htmlFor: labelId, className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: [field.label, !required ? " (optional)" : ""] }), advancedBadge] }), control, field.description ? (_jsx("p", { className: "mt-1 text-[11px] text-slate-500", children: field.description })) : field.helpText ? (_jsx("p", { className: "mt-1 text-[11px] text-slate-500", children: field.helpText })) : null] }, field.key));
                                        }) }), _jsxs("div", { className: "flex flex-wrap gap-3", children: [_jsx("button", { type: "button", onClick: handleTestMetadataEndpoint, disabled: !canModifyEndpoints || metadataRegistering || metadataTesting, className: "flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200", children: metadataTesting ? "Testing…" : "Test connection" }), _jsx("button", { type: "submit", disabled: submitDisabled, className: "flex-1 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold uppercase tracking-[0.3em] text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400 dark:bg-emerald-500 dark:hover:bg-emerald-400", children: submitButtonLabel })] }), showRetestWarning ? (_jsx("p", { className: "text-xs text-amber-600", children: "Connection parameters changed. Re-run \u201CTest connection\u201D before saving." })) : null, !canModifyEndpoints ? (_jsx("p", { className: "text-xs text-slate-500", children: "Viewer access cannot register endpoints." })) : null, metadataTestResult ? (_jsxs("div", { "data-testid": "metadata-test-result", className: `rounded-2xl border px-3 py-3 text-xs ${metadataTestResult.ok
                                            ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200"
                                            : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200"}`, children: [_jsx("p", { className: "text-sm font-semibold", children: metadataTestResult.ok ? "Connection parameters validated." : "Connection test reported issues." }), metadataTestResult.diagnostics.map((diagnostic, index) => (_jsxs("div", { className: "mt-2", children: [_jsxs("p", { className: "text-xs font-semibold uppercase tracking-[0.3em]", children: [diagnostic.code, " \u00B7 ", diagnostic.level] }), _jsx("p", { className: "text-sm", children: diagnostic.message }), diagnostic.hint ? _jsx("p", { className: "text-[11px] text-slate-700", children: diagnostic.hint }) : null] }, `${diagnostic.code}-${index}`)))] })) : null] })] })) })] }) }));
    const renderEndpointCardStatus = (run) => {
        if (!run) {
            return (_jsx("span", { "data-testid": "metadata-endpoint-status", "data-status": "none", className: "inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 dark:border-slate-600", children: "No runs" }));
        }
        const style = statusStyles[run.status];
        return (_jsxs("span", { "data-testid": "metadata-endpoint-status", "data-status": run.status.toLowerCase(), className: `inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] ${style.badge}`, title: run.error ?? undefined, children: [_jsx("span", { className: `h-2 w-2 rounded-full ${style.dot}` }), run.status.toLowerCase(), run.completedAt ? _jsxs(_Fragment, { children: [" \u00B7 ", formatRelativeTime(run.completedAt)] }) : null] }));
    };
    const renderEndpointsSection = () => {
        return (_jsx("div", { className: "space-y-6", children: _jsxs("section", { className: "space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Endpoints" }), _jsx("p", { className: "text-xs text-slate-500", children: "Search and page through registered sources." })] }), _jsxs("div", { className: "flex w-full flex-col gap-2 md:flex-1 md:flex-row md:items-center md:justify-end", children: [_jsx("label", { htmlFor: "metadata-endpoints-search", className: "sr-only", children: "Search endpoints" }), _jsx("input", { id: "metadata-endpoints-search", type: "search", value: metadataEndpointsSearch, onChange: (event) => setMetadataEndpointsSearch(event.target.value), placeholder: "Search endpoint name, URL, or description", "data-testid": "metadata-endpoints-search", className: "min-w-[200px] flex-1 rounded-full border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" }), _jsx("button", { type: "button", onClick: () => {
                                            setMetadataEndpointsSearch("");
                                            refreshMetadataEndpoints();
                                        }, className: "rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: "Reset" }), _jsx("button", { type: "button", onClick: () => refreshMetadataEndpoints(), className: "rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200", disabled: metadataEndpointsLoading, children: "Reload sources" })] })] }), metadataEndpointsError ? (_jsxs("p", { className: "rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100", children: [metadataEndpointsError, _jsx("button", { type: "button", onClick: () => refreshMetadataEndpoints(), className: "ml-3 rounded-full border border-rose-300 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-rose-600 hover:bg-rose-100 dark:border-rose-400/60 dark:text-rose-200", children: "Retry" })] })) : null, metadataEndpoints.length === 0 && !metadataEndpointsLoading ? (_jsx("p", { className: "rounded-2xl border border-dashed border-slate-300 px-6 py-6 text-sm text-slate-500 dark:border-slate-700", "data-testid": "metadata-endpoint-empty", children: metadataEndpointsSearch.trim().length > 0
                            ? "No endpoints match the current search."
                            : "No metadata endpoints have been registered yet." })) : null, metadataEndpoints.map((endpoint) => {
                        const collection = metadataCollectionsByEndpoint.get(endpoint.id);
                        const latestRun = metadataLatestRunByEndpoint.get(endpoint.id);
                        const declaredCapabilities = endpoint.capabilities ?? [];
                        const hasDeclaredCapabilities = declaredCapabilities.length > 0;
                        const supportsMetadataCapability = !hasDeclaredCapabilities || declaredCapabilities.includes("metadata");
                        const supportsPreviewCapability = !hasDeclaredCapabilities || declaredCapabilities.includes("preview");
                        const capabilityBlockedReason = hasDeclaredCapabilities && !supportsMetadataCapability
                            ? "Metadata collections disabled: this endpoint is missing the \"metadata\" capability."
                            : null;
                        const collectionBlockedReason = collection && !collection.isEnabled
                            ? "Collection disabled: Enable this collection from the Collections tab to resume runs."
                            : null;
                        const triggerBlockedReason = !canModifyEndpoints
                            ? "Viewer access cannot trigger collections."
                            : capabilityBlockedReason ?? collectionBlockedReason;
                        const canTriggerCollection = !triggerBlockedReason;
                        const previewBlockedReason = hasDeclaredCapabilities && !supportsPreviewCapability
                            ? "Dataset previews disabled: this endpoint is missing the \"preview\" capability."
                            : null;
                        const isTriggerPending = pendingTriggerEndpointId === endpoint.id;
                        return (_jsxs("article", { "data-testid": "metadata-endpoint-card", className: "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-3", children: [_jsxs("div", { className: "flex-1", children: [_jsx("p", { className: "text-lg font-semibold text-slate-900 dark:text-slate-50", children: endpoint.name }), _jsx("p", { className: "text-sm text-slate-600 dark:text-slate-300", children: endpoint.description ?? endpoint.url }), endpoint.detectedVersion ? (_jsxs("p", { className: "text-xs text-slate-500 dark:text-slate-400", children: ["Detected version \u00B7 ", endpoint.detectedVersion] })) : endpoint.versionHint ? (_jsxs("p", { className: "text-xs text-slate-500 dark:text-slate-400", children: ["Version hint \u00B7 ", endpoint.versionHint] })) : null] }), renderEndpointCardStatus(latestRun), _jsx("button", { type: "button", onClick: () => setMetadataEndpointDetailId(endpoint.id), className: "rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300", children: "Details" })] }), latestRun?.status === "SKIPPED" ? (_jsx("p", { className: "mt-2 text-xs text-amber-600 dark:text-amber-300", "data-testid": "metadata-endpoint-skip", children: latestRun.error ?? "Collection skipped due to missing capability." })) : null, latestRun?.status === "FAILED" ? (_jsx("p", { className: "mt-2 text-xs text-rose-600 dark:text-rose-300", "data-testid": "metadata-endpoint-error", children: latestRun.error ?? "Collection failed. Check endpoint configuration." })) : null, _jsx("p", { className: "mt-3 break-all text-xs font-mono text-slate-500 dark:text-slate-400", children: endpoint.url }), endpoint.domain ? (_jsxs("p", { className: "mt-1 text-xs text-slate-500 dark:text-slate-400", children: ["Domain \u00B7 ", endpoint.domain] })) : null, _jsxs("p", { className: "mt-1 text-xs text-slate-500 dark:text-slate-400", children: ["Collection schedule \u00B7", " ", collection?.scheduleCron
                                            ? `${collection.scheduleCron} (${collection.scheduleTimezone ?? "UTC"})`
                                            : "Manual only"] }), endpoint.labels?.length ? (_jsx("div", { className: "mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.3em] text-slate-500", children: endpoint.labels.map((label) => (_jsx("span", { className: "rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-600", children: label }, label))) })) : null, endpoint.capabilities?.length ? (_jsx("div", { className: "mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.3em] text-slate-400", children: endpoint.capabilities.map((capability) => (_jsx("span", { className: "rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-600", children: capability }, capability))) })) : null, capabilityBlockedReason ? (_jsx("div", { className: "mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100", children: capabilityBlockedReason })) : null, collectionBlockedReason && !capabilityBlockedReason ? (_jsx("div", { className: "mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100", children: collectionBlockedReason })) : null, previewBlockedReason ? (_jsx("div", { className: "mt-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-100", children: previewBlockedReason })) : null, _jsxs("div", { className: "mt-4 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300", children: [_jsx("label", { className: "text-[10px] font-semibold uppercase tracking-[0.35em] text-slate-500", children: "Schema override" }), _jsx("input", { value: metadataRunOverrides[endpoint.id] ?? "", onChange: (event) => setMetadataRunOverrides((prev) => ({
                                                ...prev,
                                                [endpoint.id]: event.target.value,
                                            })), placeholder: "public, analytics", className: "w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" }), _jsx("button", { type: "button", onClick: () => handleTriggerMetadataRun(endpoint.id), "data-testid": `metadata-endpoint-trigger-${endpoint.id}`, className: `inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.3em] transition disabled:cursor-not-allowed disabled:opacity-60 ${canTriggerCollection
                                                ? "border-slate-300 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                                                : "border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-600"}`, disabled: !canTriggerCollection || isTriggerPending, title: triggerBlockedReason ?? undefined, children: isTriggerPending ? (_jsxs(_Fragment, { children: [_jsx(LuHistory, { className: "h-4 w-4 animate-spin" }), "Triggering\u2026"] })) : (_jsxs(_Fragment, { children: [_jsx(LuSquarePlus, { className: "h-4 w-4" }), "Trigger collection"] })) })] })] }, endpoint.id));
                    }), metadataEndpointsLoading ? (_jsx("p", { className: "text-xs text-slate-500", "data-testid": "metadata-endpoint-loading", children: "Loading endpoints\u2026" })) : null, metadataEndpointsPageInfo.hasNextPage ? (_jsx("button", { type: "button", onClick: () => fetchMoreMetadataEndpoints(), disabled: metadataEndpointsLoading, className: "w-full rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200", children: "Load more sources" })) : null, _jsx("section", { className: "mt-6 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900", "data-testid": "metadata-graph-nodes", children: _jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { className: "min-w-[200px] flex-1", children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Graph identities" }), _jsx("p", { className: "text-xs text-slate-500 dark:text-slate-400", children: "Manage knowledge base nodes and edges from the dedicated console." })] }), _jsx("a", { href: "/kb/explorer/nodes", className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: "Open Knowledge Base" })] }) })] }) }));
    };
    const renderCollectionsSection = () => {
        const endpointFilterOptions = [{ id: "all", name: "All endpoints" }, ...metadataEndpoints.map((endpoint) => ({ id: endpoint.id, name: endpoint.name }))];
        const hasActiveRunFilter = metadataCollectionsEndpointFilter !== "all" || metadataCollectionsStatusFilter !== "all";
        const filterControls = (_jsx("div", { className: "rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900", children: _jsxs("div", { className: "flex flex-wrap gap-4", children: [_jsxs("label", { className: "flex flex-1 min-w-[180px] flex-col text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: ["Endpoint filter", _jsx("select", { "data-testid": "metadata-collections-filter-endpoint", value: metadataCollectionsEndpointFilter, onChange: (event) => setMetadataCollectionsEndpointFilter(event.target.value), className: "mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100", children: endpointFilterOptions.map((option) => (_jsx("option", { value: option.id, children: option.name }, option.id))) })] }), _jsxs("label", { className: "flex flex-1 min-w-[180px] flex-col text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: ["Status filter", _jsxs("select", { "data-testid": "metadata-collections-filter-status", value: metadataCollectionsStatusFilter, onChange: (event) => setMetadataCollectionsStatusFilter(event.target.value), className: "mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100", children: [_jsx("option", { value: "all", children: "All statuses" }), COLLECTION_STATUS_VALUES.map((status) => (_jsx("option", { value: status, children: status.toLowerCase() }, status)))] })] })] }) }));
        if (metadataRunsLoading && !metadataRunsLoaded) {
            return (_jsxs("div", { className: "space-y-4", "data-testid": "metadata-collections-panel", children: [filterControls, _jsxs("p", { className: "flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300", children: [_jsx(LuHistory, { className: "h-4 w-4 animate-spin" }), "Loading collection runs\u2026"] })] }));
        }
        if (metadataRunsError) {
            return (_jsxs("div", { className: "space-y-4", "data-testid": "metadata-collections-panel", children: [filterControls, _jsxs("div", { className: "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-950/40 dark:text-rose-200", children: [_jsx("p", { children: metadataRunsError }), _jsx("button", { type: "button", onClick: refreshMetadataRuns, className: "mt-2 rounded-full border border-rose-300 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-rose-700 hover:bg-rose-100 dark:border-rose-400/60 dark:text-rose-200", children: "Retry" })] })] }));
        }
        return (_jsxs("div", { className: "space-y-4", "data-testid": "metadata-collections-panel", children: [filterControls, metadataRunsLoading && metadataRunsLoaded ? (_jsx("p", { className: "text-xs text-slate-500", children: "Refreshing run history\u2026" })) : null, sortedMetadataRuns.length === 0 ? (_jsx("p", { className: "rounded-2xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500 dark:border-slate-700", "data-testid": "metadata-collections-empty", children: hasActiveRunFilter
                        ? "No collection runs match the selected filters."
                        : "No collection runs recorded yet. Trigger a run from the endpoint cards." })) : (sortedMetadataRuns.map((run) => (_jsxs("article", { className: "rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300", "data-testid": "metadata-collection-card", "data-endpoint-id": run.endpoint?.id ?? "unknown", "data-status": (run.status ?? "UNKNOWN").toUpperCase(), "data-run-id": run.id, children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400", children: [_jsx("span", { children: run.status }), _jsxs("span", { children: ["\u00B7 Requested ", formatDateTime(run.requestedAt)] })] }), _jsx("p", { className: "mt-1 text-base font-medium text-slate-900 dark:text-white", children: run.endpoint?.name ?? "Unknown endpoint" }), _jsxs("div", { className: "mt-2 grid gap-1 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-3", children: [_jsxs("span", { children: ["Started: ", run.startedAt ? formatDateTime(run.startedAt) : "—"] }), _jsxs("span", { children: ["Completed: ", run.completedAt ? formatDateTime(run.completedAt) : "—"] }), _jsxs("span", { children: ["Run ID: ", run.id] })] }), _jsxs("div", { className: "mt-2 grid gap-1 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-3", children: [_jsxs("span", { children: ["Collection: ", run.collection?.id ?? "—"] }), _jsxs("span", { children: ["Endpoint ID: ", run.endpoint?.id ?? "—"] }), _jsxs("span", { children: ["Requested by: ", run.requestedBy ?? "unknown"] })] }), Array.isArray(run.filters?.schemas) &&
                            (run.filters.schemas?.length ?? 0) > 0 ? (_jsxs("p", { className: "mt-2 text-xs text-slate-500 dark:text-slate-400", children: ["Schemas: ", run.filters.schemas.join(", ")] })) : null, run.error ? (_jsx("p", { className: "mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-400/60 dark:bg-rose-950/40 dark:text-rose-200", children: run.error })) : null, run.endpoint?.id ? (_jsx("div", { className: "mt-3", children: _jsx("button", { "data-testid": "metadata-collections-view-endpoint", type: "button", onClick: () => handleViewEndpointFromCollections(run.endpoint?.id ?? null), disabled: pendingEndpointNavigationId === run.endpoint?.id, className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200", children: pendingEndpointNavigationId === run.endpoint?.id ? (_jsxs(_Fragment, { children: [_jsx(LuHistory, { className: "h-3 w-3 animate-spin" }), "Opening\u2026"] })) : ("View endpoint") }) })) : null] }, run.id))))] }));
    };
    const renderDatasetDetailPage = () => {
        if (!datasetDetailRouteId) {
            return null;
        }
        if (detailDataset === null && datasetDetailLoading) {
            return (_jsx("div", { className: "rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900", children: "Loading dataset detail\u2026" }));
        }
        if (!detailDataset) {
            return (_jsxs("div", { className: "space-y-4 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-950/40 dark:text-rose-200", children: [_jsx("p", { children: datasetDetailError ?? "Dataset not found in this project." }), _jsx("button", { type: "button", onClick: () => updateDatasetDetailId(null), className: "rounded-full border border-rose-400 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em]", children: "Back to catalog" })] }));
        }
        const detailDatasetFields = detailDataset.fields ?? [];
        return (_jsxs("div", { className: "space-y-6", "data-testid": "metadata-dataset-detail-page", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Dataset detail" }), _jsx("p", { className: "text-2xl font-semibold text-slate-900 dark:text-white", children: detailDataset.displayName }), detailDatasetDisplayId ? (_jsx("p", { className: "text-xs uppercase tracking-[0.3em] text-slate-400", children: detailDatasetDisplayId })) : null] }), _jsx("button", { type: "button", onClick: () => updateDatasetDetailId(null), className: "rounded-full border border-slate-300 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200", children: "Back to catalog" })] }), _jsxs("div", { className: "grid gap-6 lg:grid-cols-[2fr,1fr]", children: [_jsxs("section", { className: "space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-3 text-xs text-slate-500", children: [_jsxs("span", { children: ["Endpoint \u00B7 ", detailOwner?.name ?? "Unlinked"] }), detailDataset.schema ? _jsxs("span", { children: ["Schema \u00B7 ", detailDataset.schema] }) : null, detailDataset.entity ? _jsxs("span", { children: ["Entity \u00B7 ", detailDataset.entity] }) : null, detailDataset.collectedAt ? _jsxs("span", { children: ["Collected ", formatDateTime(detailDataset.collectedAt)] }) : null] }), detailLastCollectionRun ? (_jsx("div", { className: "flex flex-wrap gap-2 text-xs text-slate-500", children: _jsxs("span", { children: ["Last collection \u00B7 ", detailLastCollectionRun.status, " ", detailLastCollectionRun.completedAt ? formatDateTime(detailLastCollectionRun.completedAt) : ""] }) })) : null, detailDataset.labels?.length ? (_jsx("div", { className: "flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.3em] text-slate-500", children: detailDataset.labels.map((label) => (_jsx("span", { className: "rounded-full border border-slate-300 px-2 py-0.5 dark:border-slate-600", children: label }, label))) })) : null, _jsx(IngestionSummaryCard, { dataset: detailDataset, className: "mt-4" }), _jsxs("div", { children: [_jsxs("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: ["Fields (", detailDatasetFields.length, ")"] }), _jsxs("div", { className: "mt-2 space-y-2", children: [detailDatasetFields.map((field) => (_jsxs("div", { className: "rounded-2xl border border-slate-200 px-3 py-2 dark:border-slate-700", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-medium text-slate-900 dark:text-slate-100", children: field.name }), _jsx("span", { className: "text-[11px] uppercase tracking-[0.3em] text-slate-400", children: field.type })] }), field.description ? _jsx("p", { className: "text-xs text-slate-500 dark:text-slate-400", children: field.description }) : null] }, field.name))), detailDatasetFields.length === 0 ? (_jsx("p", { className: "rounded-xl border border-dashed border-slate-300 px-4 py-4 text-xs text-slate-500 dark:border-slate-700", children: "No field metadata discovered yet." })) : null] })] }), _jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Preview" }), detailSampledAt ? (_jsxs("p", { className: "mt-2 text-xs text-slate-500 dark:text-slate-300", children: ["Sampled ", formatRelativeTime(detailSampledAt)] })) : detailPreviewStatusMessage ? (_jsx("p", { className: `mt-2 text-xs ${detailPreviewStatusTone === "warn" ? "text-rose-600 dark:text-rose-300" : "text-slate-500 dark:text-slate-300"}`, children: detailPreviewStatusMessage })) : (_jsx("p", { className: "mt-2 text-xs text-slate-500 dark:text-slate-300", children: "Preview pulls 20 live rows per request." })), detailPreviewError ? (_jsx("p", { className: "mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-400/60 dark:bg-rose-950/40 dark:text-rose-200", children: detailPreviewError })) : null, detailPreviewRows.length ? (_jsx("div", { className: "mt-3 w-full max-h-72 max-w-full overflow-x-auto overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700", children: _jsxs("table", { className: "min-w-full divide-y divide-slate-200 text-xs dark:divide-slate-700", children: [_jsx("thead", { className: "bg-slate-50 text-left font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300", children: _jsx("tr", { children: detailPreviewColumns.map((column) => (_jsx("th", { className: "px-3 py-2 uppercase tracking-[0.3em] text-[10px] text-slate-400", children: column }, column))) }) }), _jsx("tbody", { children: detailPreviewRows.map((row, index) => (_jsx("tr", { className: "border-t border-slate-100 dark:border-slate-800", children: detailPreviewColumns.map((column) => (_jsx("td", { className: "px-3 py-2 text-slate-700 dark:text-slate-200 break-words whitespace-pre-wrap", children: formatPreviewValue(row[column]) }, column))) }, index))) })] }) })) : (_jsx("p", { className: `mt-2 text-xs ${detailPreviewStatusTone === "warn" ? "text-rose-600 dark:text-rose-300" : "text-slate-500 dark:text-slate-300"}`, children: detailPreviewing
                                                ? "Collecting sample rows…"
                                                : detailPreviewStatusMessage ?? "No preview sampled yet. Run a preview to inspect live data." })), _jsxs("button", { type: "button", onClick: () => handlePreviewMetadataDataset(detailDataset.id), disabled: !detailCanPreview || detailPreviewing, className: `mt-3 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] transition ${detailCanPreview
                                                ? "border-slate-300 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                                                : "border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-600"}`, children: [detailPreviewing ? _jsx(LuHistory, { className: "h-3 w-3 animate-spin" }) : _jsx(LuTable, { className: "h-3 w-3" }), detailPreviewing ? "Fetching…" : "Preview dataset"] })] })] }), _jsxs("section", { className: "space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900", children: [_jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Profile" }), detailProfileBlockReason ? (_jsx("p", { className: "mt-2 text-xs text-slate-500", children: detailProfileBlockReason })) : detailDataset.profile ? (_jsxs("div", { className: "mt-3 space-y-2 text-xs text-slate-500 dark:text-slate-300", children: [_jsxs("p", { children: ["Record count \u00B7 ", detailDataset.profile.recordCount ?? "—"] }), _jsxs("p", { children: ["Sample size \u00B7 ", detailDataset.profile.sampleSize ?? "—"] }), _jsxs("p", { children: ["Last profiled \u00B7", " ", detailDataset.profile.lastProfiledAt ? formatDateTime(detailDataset.profile.lastProfiledAt) : "Not recorded"] })] })) : (_jsx("p", { className: "mt-2 text-xs text-slate-500", "data-testid": "metadata-profile-empty", children: "Profiling not run yet. Trigger a collection to refresh dataset insights." }))] }), _jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Notes" }), _jsx("p", { className: "mt-2 text-xs text-slate-500", children: "Add dataset descriptions via ingestion payloads to help teammates understand lineage and usage." })] })] })] })] }));
    };
    const showOverviewLoading = metadataLoading && !hasMetadataSnapshot;
    const renderOverviewContent = () => {
        if (showOverviewLoading) {
            return (_jsxs("p", { className: "flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300", children: [_jsx(LuHistory, { className: "h-4 w-4 animate-spin" }), "Loading metadata\u2026"] }));
        }
        if (metadataError) {
            return (_jsx("p", { className: "rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-950/40 dark:text-rose-200", "data-testid": "metadata-error-banner", children: metadataError }));
        }
        if (metadataSection === "catalog" && isRouteDetail) {
            return renderDatasetDetailPage();
        }
        const mutationErrorBanner = metadataMutationError ? (_jsx("p", { className: "mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-950/40 dark:text-rose-200", "data-testid": "metadata-mutation-error", children: metadataMutationError })) : null;
        const sectionContent = (() => {
            if (metadataSection === "catalog") {
                return renderCatalogSection();
            }
            switch (metadataSection) {
                case "endpoints":
                    return renderEndpointsSection();
                case "collections":
                    return renderCollectionsSection();
                default:
                    return null;
            }
        })();
        return (_jsxs(_Fragment, { children: [mutationErrorBanner, sectionContent] }));
    };
    const endpointDatasets = metadataEndpointDetail ? endpointDatasetRecords[metadataEndpointDetail.id] ?? [] : [];
    const endpointDatasetsError = metadataEndpointDetail ? endpointDatasetErrors[metadataEndpointDetail.id] ?? null : null;
    const isEndpointDatasetsLoading = metadataEndpointDetail
        ? Boolean(endpointDatasetLoading[metadataEndpointDetail.id])
        : false;
    const detailRuns = metadataEndpointDetail?.runs ?? [];
    const detailHasRunningRun = detailRuns.some((run) => run.status === "RUNNING");
    const showDetailMutationError = metadataView === "overview" && Boolean(metadataMutationError);
    const toastPortal = toastQueue.toasts.length ? (_jsx("div", { className: "pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-end px-4 sm:px-6", children: _jsx("div", { className: "flex w-full max-w-sm flex-col gap-2", children: toastQueue.toasts.map((toast) => {
                const tone = toastToneStyles[toast.intent];
                const ToneIcon = tone.icon;
                return (_jsx("div", { role: "status", "aria-live": "assertive", className: `pointer-events-auto rounded-2xl border px-4 py-3 text-sm shadow-lg ${tone.className}`, children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx(ToneIcon, { className: "mt-0.5 h-4 w-4", "aria-hidden": "true" }), _jsxs("div", { className: "flex-1", children: [_jsx("p", { className: "font-semibold", children: toast.title }), toast.description ? _jsx("p", { className: "mt-1 text-xs", children: toast.description }) : null] }), _jsx("button", { type: "button", onClick: () => toastQueue.dismissToast(toast.id), className: "text-xs font-semibold uppercase tracking-[0.3em] text-current/70 transition hover:text-current", "aria-label": "Dismiss notification", children: "\u00D7" })] }) }, toast.id));
            }) }) })) : null;
    return (_jsxs(_Fragment, { children: [toastPortal, _jsxs("section", { className: "flex h-full min-h-0 flex-1 overflow-hidden bg-slate-50 dark:bg-slate-950", children: [_jsx("aside", { className: `relative z-50 hidden h-full flex-none border-r border-slate-200 bg-white/80 py-5 transition-[width] dark:border-slate-800 dark:bg-slate-900/40 lg:flex lg:sticky lg:top-0 ${sectionNavCollapsed ? "w-14 px-1.5" : "w-56 px-3.5"}`, children: _jsxs("div", { className: "flex h-full w-full flex-col gap-5", children: [_jsxs("div", { className: "flex items-center justify-between px-1.5", children: [!sectionNavCollapsed && (_jsx("p", { className: "text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Navigation" })), _jsx("button", { type: "button", onClick: () => setSectionNavCollapsed((prev) => !prev), className: "inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300", children: sectionNavCollapsed ? "›" : "‹" })] }), _jsx("div", { className: "flex min-h-0 flex-1 flex-col", children: _jsx("div", { className: "space-y-1.5 overflow-y-auto pr-1 scrollbar-thin", children: metadataNavItems.map((entry) => {
                                            const Icon = entry.icon;
                                            const isActive = metadataView === "overview" && metadataSection === entry.id;
                                            return (_jsxs("button", { type: "button", onClick: () => {
                                                    setMetadataView("overview");
                                                    setMetadataSection(entry.id);
                                                    updateDatasetDetailId(null);
                                                    setMetadataEndpointDetailId(null);
                                                }, className: `group flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition ${isActive
                                                    ? "border-slate-900 bg-slate-900 text-white shadow-sm dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                                                    : "border-slate-200 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200"}`, title: sectionNavCollapsed ? entry.label : undefined, children: [_jsx(Icon, { className: "h-4 w-4 shrink-0" }), !sectionNavCollapsed ? (_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-sm font-semibold", children: entry.label }), _jsx("p", { className: "text-[10px] uppercase tracking-[0.25em] text-slate-400", children: entry.description })] })) : null] }, entry.id));
                                        }) }) })] }) }), _jsxs("div", { className: "flex h-full min-h-0 flex-1 flex-col overflow-hidden", children: [_jsxs("header", { className: "flex flex-wrap items-center justify-between border-b border-slate-200 px-8 py-6 dark:border-slate-800", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Metadata workspace" }), _jsx("h2", { className: "mt-1 text-3xl font-bold text-slate-900 dark:text-white", children: metadataHeaderCopy.title }), _jsx("p", { className: "mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300", children: metadataHeaderCopy.subtitle })] }), metadataView === "endpoint-register" ? (_jsx("button", { type: "button", onClick: handleCloseRegistration, className: "mt-4 inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300 lg:mt-0", children: "\u2190 Back to overview" })) : (_jsxs("div", { className: "mt-4 flex flex-wrap items-center gap-2 lg:mt-0", children: [_jsxs("button", { type: "button", onClick: handleWorkspaceRefresh, className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300", children: [_jsx(LuRefreshCcw, { className: "h-4 w-4" }), " Refresh"] }), _jsxs("button", { type: "button", onClick: () => handleOpenRegistration(), className: "inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold uppercase tracking-[0.3em] text-white shadow transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-500 dark:text-slate-900", "data-testid": "metadata-register-open", "data-role": resolvedRole, disabled: !canModifyEndpoints, title: !canModifyEndpoints ? "Viewer access cannot register endpoints." : undefined, children: [_jsx(LuSquarePlus, { className: "h-4 w-4" }), " Register endpoint"] })] }))] }), metadataView === "overview" ? (_jsxs("div", { className: "relative z-50 flex flex-wrap items-center gap-3 px-8 py-4 lg:hidden", children: [metadataSectionTabs.map((tab) => (_jsx("button", { type: "button", onClick: () => {
                                            setMetadataSection(tab.id);
                                            updateDatasetDetailId(null);
                                            setMetadataEndpointDetailId(null);
                                        }, className: `rounded-full px-4 py-1.5 text-sm font-semibold transition ${metadataSection === tab.id
                                            ? "bg-slate-900 text-white shadow dark:bg-slate-100 dark:text-slate-900"
                                            : "border border-slate-300 text-slate-600 hover:border-slate-900 dark:border-slate-600 dark:text-slate-300"}`, children: tab.label }, tab.id))), _jsx("button", { type: "button", onClick: handleWorkspaceRefresh, className: "rounded-full border border-slate-300 px-4 py-1.5 text-sm font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 dark:border-slate-600 dark:text-slate-300", children: "Refresh" }), _jsx("button", { type: "button", onClick: () => handleOpenRegistration(), className: "ml-auto rounded-full bg-slate-900 px-4 py-1.5 text-sm font-semibold uppercase tracking-[0.3em] text-white shadow transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-500 dark:text-slate-900", "data-testid": "metadata-register-open", "data-role": resolvedRole, disabled: !canModifyEndpoints, title: !canModifyEndpoints ? "Viewer access cannot register endpoints." : undefined, children: "Register endpoint" })] })) : null, _jsx("div", { className: "flex-1 overflow-y-auto px-8 pb-8", children: metadataView === "overview" ? renderOverviewContent() : renderEndpointRegistrationPage() })] })] }), metadataView === "overview" && metadataDatasetDetail && !isRouteDetail ? (_jsxs("div", { className: "fixed inset-0 z-40 flex justify-end", children: [_jsxs("div", { className: "absolute inset-0 flex", children: [_jsx("div", { className: "hidden lg:block", style: { width: sidebarOverlayWidth } }), _jsx("div", { className: "flex-1 bg-slate-900/40", onClick: () => updateDatasetDetailId(null) })] }), _jsxs("section", { className: "relative flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white px-6 py-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950", "data-testid": "metadata-dataset-detail-drawer", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-slate-200 pb-4 dark:border-slate-800", children: [_jsxs("div", { children: [_jsx("p", { className: "text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-500", children: "Dataset detail" }), _jsx("p", { className: "text-base font-semibold text-slate-900 dark:text-white", children: metadataDatasetDetail.displayName }), metadataDatasetDetailDisplayId ? (_jsx("p", { className: "text-xs uppercase tracking-[0.3em] text-slate-500", children: metadataDatasetDetailDisplayId })) : null] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { type: "button", onClick: () => handleOpenDatasetDetailPage(metadataDatasetDetail.id), className: "rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500 hover:border-slate-900 hover:text-slate-900 dark:border-slate-700", children: "Open full page" }), _jsx("button", { type: "button", onClick: () => updateDatasetDetailId(null), className: "rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500 dark:border-slate-700", children: "Close" })] })] }), _jsxs("div", { className: "scrollbar-thin flex-1 space-y-4 overflow-y-auto py-4 pr-1 text-sm text-slate-600 dark:text-slate-300", children: [datasetDetailLoading ? (_jsx("p", { className: "rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700", children: "Loading dataset metadata\u2026" })) : null, datasetDetailError ? (_jsx("p", { className: "rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-400/60 dark:bg-rose-950/40 dark:text-rose-200", children: datasetDetailError })) : null, _jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Description" }), _jsx("p", { className: "mt-1 text-sm", children: metadataDatasetDetail.description ?? "No description provided yet." })] }), _jsxs("div", { className: "grid gap-2 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-2", children: [_jsxs("span", { children: ["Endpoint \u00B7 ", metadataEndpointLookup.get(metadataDatasetDetail.sourceEndpointId ?? "")?.name ?? "Unlinked"] }), _jsxs("span", { children: ["Collected \u00B7 ", metadataDatasetDetail.collectedAt ? formatDateTime(metadataDatasetDetail.collectedAt) : "—"] }), _jsxs("span", { children: ["Entity \u00B7 ", metadataDatasetDetail.entity ?? "—"] }), _jsxs("span", { children: ["Schema \u00B7 ", metadataDatasetDetail.schema ?? "—"] })] }), _jsx(IngestionSummaryCard, { dataset: metadataDatasetDetail, className: "mt-4" }), _jsxs("div", { children: [_jsxs("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: ["Fields (", metadataDatasetDetailFields.length, ")"] }), _jsx("div", { className: "mt-2 space-y-2", children: metadataDatasetDetailFields.map((field) => (_jsxs("div", { className: "rounded-2xl border border-slate-200 px-3 py-2 dark:border-slate-700", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-medium text-slate-900 dark:text-slate-100", children: field.name }), _jsx("span", { className: "text-[11px] uppercase tracking-[0.3em] text-slate-400", children: field.type })] }), field.description ? _jsx("p", { className: "text-xs text-slate-500 dark:text-slate-400", children: field.description }) : null] }, field.name))) }), metadataDatasetDetailFields.length === 0 ? (_jsx("p", { className: "rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500 dark:border-slate-700", children: "No field metadata discovered yet." })) : null] }), _jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Recent preview" }), detailPreviewRows.length ? (_jsxs(_Fragment, { children: [detailSampledAt ? (_jsxs("p", { className: "mt-1 text-xs text-slate-500 dark:text-slate-300", children: ["Sampled ", formatRelativeTime(detailSampledAt)] })) : detailPreviewStatusMessage ? (_jsx("p", { className: `mt-1 text-xs ${detailPreviewStatusTone === "warn" ? "text-rose-600 dark:text-rose-300" : "text-slate-500 dark:text-slate-300"}`, children: detailPreviewStatusMessage })) : null, _jsx("div", { className: "mt-2 max-h-48 overflow-auto rounded-2xl border border-slate-200 dark:border-slate-700", children: _jsxs("table", { className: "min-w-full divide-y divide-slate-200 text-xs dark:divide-slate-800", children: [_jsx("thead", { className: "bg-slate-50 text-left font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300", children: _jsx("tr", { children: detailPreviewColumns.map((column) => (_jsx("th", { className: "px-3 py-2 uppercase tracking-[0.3em] text-[10px] text-slate-400", children: column }, column))) }) }), _jsx("tbody", { children: detailPreviewRows.map((row, index) => (_jsx("tr", { className: "border-t border-slate-100 dark:border-slate-800", children: detailPreviewColumns.map((column) => (_jsx("td", { className: "px-3 py-2 text-slate-700 dark:text-slate-200 break-words whitespace-pre-wrap", children: formatPreviewValue(row[column]) }, column))) }, index))) })] }) })] })) : (_jsx("p", { className: `mt-2 text-xs ${detailPreviewStatusTone === "warn" ? "text-rose-600 dark:text-rose-300" : "text-slate-500 dark:text-slate-300"}`, children: detailPreviewing
                                                    ? "Collecting sample rows…"
                                                    : detailPreviewStatusMessage ?? "No preview sampled yet. Run a preview to inspect live data." }))] })] })] })] })) : null, metadataView === "overview" && metadataEndpointDetail ? (_jsxs("div", { className: "fixed inset-0 z-40 flex justify-end", children: [_jsxs("div", { className: "absolute inset-0 flex", children: [_jsx("div", { className: "hidden lg:block", style: { width: sidebarOverlayWidth } }), _jsx("div", { className: "flex-1 bg-slate-900/40", onClick: handleCloseEndpointDetail })] }), _jsxs("section", { className: "relative flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white px-6 py-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950", "data-testid": "metadata-endpoint-detail", children: [_jsxs("div", { className: "flex items-center justify-between border-b border-slate-200 pb-4 dark:border-slate-800", children: [_jsxs("div", { children: [_jsx("p", { className: "text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-500", children: "Endpoint detail" }), _jsx("p", { className: "text-base font-semibold text-slate-900 dark:text-white", children: metadataEndpointDetail.name }), _jsx("p", { className: "text-xs uppercase tracking-[0.3em] text-slate-500", children: metadataEndpointDetail.id })] }), _jsxs("div", { className: "flex items-center gap-2", children: [canModifyEndpoints ? (_jsx("button", { type: "button", onClick: () => handleOpenEndpointEdit(metadataEndpointDetail), className: "rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300", children: "Edit" })) : null, canDeleteEndpoints ? (_jsx("button", { type: "button", onClick: () => handleDeleteMetadataEndpoint(metadataEndpointDetail), disabled: metadataDeletingEndpointId === metadataEndpointDetail.id || detailHasRunningRun, title: detailHasRunningRun
                                                    ? "Cannot delete while a collection is running."
                                                    : undefined, className: "rounded-full border border-rose-200 px-3 py-1 text-sm text-rose-600 transition hover:border-rose-500 hover:text-rose-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/40 dark:text-rose-200", children: metadataDeletingEndpointId === metadataEndpointDetail.id ? "Deleting…" : "Delete" })) : null, _jsx("button", { type: "button", onClick: handleCloseEndpointDetail, className: "rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500 dark:border-slate-700", children: "Close" })] })] }), showDetailMutationError ? (_jsx("p", { className: "mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/50 dark:bg-rose-950/40 dark:text-rose-200", "data-testid": "metadata-mutation-error", children: metadataMutationError })) : null, _jsxs("div", { className: "scrollbar-thin flex-1 space-y-4 overflow-y-auto py-4 pr-1 text-sm text-slate-600 dark:text-slate-300", children: [_jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Description" }), _jsx("p", { className: "mt-1 text-sm", children: metadataEndpointDetail.description ?? "No description provided yet." })] }), _jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Connection" }), _jsx("p", { className: "mt-1 break-all font-mono text-xs text-slate-500 dark:text-slate-400", children: metadataEndpointDetail.url })] }), _jsxs("div", { className: "grid gap-2 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-2", children: [_jsxs("span", { children: ["Detected version \u00B7 ", metadataEndpointDetail.detectedVersion ?? metadataEndpointDetail.versionHint ?? "—"] }), _jsxs("span", { children: ["Verb \u00B7 ", metadataEndpointDetail.verb] })] }), _jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Config payload" }), _jsx("pre", { className: "mt-2 overflow-x-auto rounded-xl bg-slate-100 p-3 text-[12px] dark:bg-slate-900/40", children: JSON.stringify(metadataEndpointDetail.config, null, 2) })] }), metadataEndpointDetail.capabilities?.length ? (_jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Capabilities" }), _jsx("div", { className: "mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.3em] text-slate-400", children: metadataEndpointDetail.capabilities.map((capability) => (_jsx("span", { className: "rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700", children: capability }, capability))) })] })) : null, _jsxs("div", { "data-testid": "metadata-endpoint-datasets", children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsxs("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: ["Datasets (", endpointDatasets.length, ")"] }), _jsxs("button", { type: "button", onClick: () => metadataEndpointDetail?.id && loadEndpointDatasets(metadataEndpointDetail.id, { force: true }), className: "inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500 transition hover:border-slate-900 hover:text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300", disabled: isEndpointDatasetsLoading, "data-testid": "metadata-endpoint-datasets-refresh", children: [_jsx(LuRefreshCcw, { className: "h-3 w-3" }), "Refresh"] })] }), endpointDatasetsError ? (_jsx("p", { className: "mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200", "data-testid": "metadata-endpoint-datasets-error", children: endpointDatasetsError })) : isEndpointDatasetsLoading ? (_jsx("p", { className: "mt-2 text-xs text-slate-500", "data-testid": "metadata-endpoint-datasets-loading", children: "Loading datasets\u2026" })) : endpointDatasets.length === 0 ? (_jsxs("p", { className: "mt-2 text-xs text-slate-500", "data-testid": "metadata-endpoint-datasets-empty", children: ["No catalog entries linked yet. Tag catalog records with ", _jsxs("code", { children: ["endpoint:", metadataEndpointDetail.id] }), " once collections complete."] })) : (_jsx("ul", { className: "mt-2 space-y-2", "data-testid": "metadata-endpoint-datasets-list", children: endpointDatasets.map((dataset) => {
                                                    const datasetPayload = dataset.payload?.dataset ?? {};
                                                    const displayName = datasetPayload.displayName ?? dataset.id;
                                                    const description = datasetPayload.description ?? "No description provided.";
                                                    return (_jsxs("li", { className: "rounded-2xl border border-slate-200 px-3 py-2 dark:border-slate-700", "data-testid": "metadata-endpoint-dataset-row", children: [_jsx("p", { className: "text-sm font-semibold text-slate-900 dark:text-white", children: displayName }), _jsx("p", { className: "text-xs text-slate-500", children: description }), _jsxs("div", { className: "mt-2 text-[11px] uppercase tracking-[0.3em] text-slate-400", children: ["Updated \u00B7 ", formatDateTime(dataset.updatedAt)] })] }, dataset.id));
                                                }) }))] }), _jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Recent runs" }), detailRuns.length === 0 ? (_jsx("p", { className: "mt-2 text-xs text-slate-500", children: "No runs recorded yet." })) : (detailRuns.map((run) => (_jsxs("div", { className: "mt-2 rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-semibold", children: run.status }), _jsx("span", { children: formatRelativeTime(run.requestedAt) })] }), run.error ? _jsx("p", { className: "mt-1 text-rose-600 dark:text-rose-300", children: run.error }) : null] }, run.id))))] })] })] })] })) : null] }));
}
function formatGraphScope(scope) {
    const parts = [];
    parts.push(scope.orgId ? `org:${scope.orgId}` : "org:unknown");
    if (scope.projectId) {
        parts.push(`project:${scope.projectId}`);
    }
    if (scope.domainId) {
        parts.push(`domain:${scope.domainId}`);
    }
    if (scope.teamId) {
        parts.push(`team:${scope.teamId}`);
    }
    return parts.join(" · ");
}
function IngestionSummaryCard({ dataset, className }) {
    if (!dataset) {
        return null;
    }
    const config = dataset.ingestionConfig ?? null;
    const manageHref = dataset.sourceEndpointId && dataset.sourceEndpointId.length > 0
        ? `/ingestion?endpointId=${encodeURIComponent(dataset.sourceEndpointId)}`
        : "/ingestion";
    const baseClasses = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900";
    const combinedClass = className ? `${baseClasses} ${className}` : baseClasses;
    if (!config) {
        return (_jsxs("section", { className: combinedClass, children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Ingestion" }), _jsx("p", { className: "text-sm text-slate-500", children: "Not configured yet. Enable ingestion to orchestrate runs." })] }), _jsxs("a", { href: manageHref, className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200", children: ["Manage in console", _jsx(LuArrowUpRight, { className: "h-3 w-3", "aria-hidden": "true" })] })] }), _jsx("p", { className: "mt-3 text-xs text-slate-500 dark:text-slate-400", children: "Metadata collection must run before ingestion units become available." })] }));
    }
    const lastStatus = config.lastStatus ?? null;
    const fallbackState = config.enabled ? "IDLE" : "PAUSED";
    const lastState = lastStatus?.state ?? fallbackState;
    const tone = ingestionStateTone[lastState];
    const lastRunRelative = lastStatus?.lastRunAt ? formatRelativeTime(lastStatus.lastRunAt) : "Never";
    const lastRunExact = lastStatus?.lastRunAt ? formatDateTime(lastStatus.lastRunAt) : null;
    const modeLabel = formatIngestionMode(config.runMode);
    const scheduleLabel = formatIngestionSchedule(config.scheduleKind, config.scheduleIntervalMinutes);
    const sinkLabel = formatIngestionSink(config.sinkId);
    return (_jsxs("section", { className: combinedClass, children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-xs font-semibold uppercase tracking-[0.3em] text-slate-500", children: "Ingestion" }), _jsx("p", { className: "text-sm text-slate-500", children: "Configuration applies to this dataset's ingestion unit." })] }), _jsxs("a", { href: manageHref, className: "inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200", children: ["Manage in console", _jsx(LuArrowUpRight, { className: "h-3 w-3", "aria-hidden": "true" })] })] }), _jsxs("dl", { className: "mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("dt", { className: "text-xs uppercase tracking-[0.3em] text-slate-400", children: "Mode" }), _jsx("dd", { className: "font-semibold text-slate-900 dark:text-white", children: modeLabel })] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("dt", { className: "text-xs uppercase tracking-[0.3em] text-slate-400", children: "Schedule" }), _jsx("dd", { children: scheduleLabel })] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("dt", { className: "text-xs uppercase tracking-[0.3em] text-slate-400", children: "Sink" }), _jsx("dd", { children: sinkLabel })] }), _jsxs("div", { children: [_jsx("dt", { className: "text-xs uppercase tracking-[0.3em] text-slate-400", children: "Last run" }), _jsxs("dd", { className: "mt-2", children: [_jsxs("div", { className: `inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${tone.badge}`, children: [_jsx("span", { className: `h-2 w-2 rounded-full ${tone.dot}` }), tone.label] }), _jsxs("p", { className: "mt-1 text-xs text-slate-500 dark:text-slate-400", children: [lastRunRelative, lastRunExact ? ` · ${lastRunExact}` : ""] }), lastStatus?.lastError ? (_jsxs("p", { className: "mt-1 text-xs text-rose-500 dark:text-rose-300", children: ["Last error: ", lastStatus.lastError] })) : null] })] })] })] }));
}
