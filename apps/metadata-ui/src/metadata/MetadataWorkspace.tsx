import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IconType } from "react-icons";
import {
  LuArrowUpRight,
  LuCircleAlert,
  LuCircleCheck,
  LuEllipsis,
  LuHistory,
  LuInfo,
  LuNetwork,
  LuRefreshCcw,
  LuSearch,
  LuSquarePlus,
  LuTable,
} from "react-icons/lu";
import { formatDateTime, formatPreviewValue, formatRelativeTime } from "../lib/format";
import { fetchMetadataGraphQL } from "./api";
import {
  ENDPOINT_DATASETS_QUERY,
  COLLECTION_RUNS_QUERY,
  METADATA_ENDPOINT_TEMPLATES_QUERY,
  METADATA_OVERVIEW_QUERY,
  METADATA_ENDPOINTS_PAGED_QUERY,
  METADATA_CATALOG_DATASET_QUERY,
  CATALOG_DATASET_PREVIEW_QUERY,
  PREVIEW_METADATA_DATASET_MUTATION,
  REGISTER_METADATA_ENDPOINT_MUTATION,
  UPDATE_METADATA_ENDPOINT_MUTATION,
  DELETE_METADATA_ENDPOINT_MUTATION,
  TEST_METADATA_ENDPOINT_MUTATION,
  TRIGGER_ENDPOINT_COLLECTION_MUTATION,
  START_ONEDRIVE_AUTH_MUTATION,
} from "./queries";
import type {
  CatalogDataset,
  DatasetPreviewResult,
  EndpointDatasetRecord,
  MetadataCollectionRunSummary,
  MetadataCollectionSummary,
  MetadataEndpointSummary,
  MetadataEndpointTemplate,
  MetadataEndpointTemplateField,
  MetadataEndpointTestResult,
  GraphNodeSummary,
  IngestionState,
} from "./types";
import { parseListInput, previewTableColumns } from "./utils";
import {
  useAsyncAction,
  useCatalogDatasetConnection,
  useDebouncedValue,
  usePagedQuery,
  useToastQueue,
  type ToastIntent,
} from "./hooks";
import type { Role } from "../auth/AuthProvider";
import {
  formatIngestionMode,
  formatIngestionSchedule,
  formatIngestionSink,
  ingestionStateTone,
} from "../ingestion/stateTone";

type MetadataWorkspaceProps = {
  metadataEndpoint: string | null;
  authToken?: string | null;
  projectSlug?: string | null;
  userRole: Role;
  datasetDetailRouteId?: string | null;
  onDatasetDetailRouteChange?: (datasetId: string | null) => void;
};

type MetadataSection = "catalog" | "endpoints" | "collections";
type MetadataView = "overview" | "endpoint-register";
type TemplateFamily = "JDBC" | "HTTP" | "STREAM";
type DatasetPreviewAvailability = "ready" | "sampled" | "not_run" | "unsupported" | "unlinked" | "error";
type PreviewStatusTone = "info" | "neutral" | "warn";
type EndpointLookupEntry = {
  id?: string | null;
  sourceId?: string | null;
  name?: string | null;
  capabilities?: string[] | null;
  url?: string | null;
};
type DatasetPreviewSummary = {
  owner: EndpointLookupEntry | null;
  endpointCapabilities: string[];
  previewRows: Array<Record<string, unknown>>;
  previewError?: string;
  previewing: boolean;
  previewBlockReason: string | null;
  previewAvailability: DatasetPreviewAvailability;
  previewStatusMessage: string | null;
  previewStatusTone: PreviewStatusTone;
  canPreview: boolean;
  sampledAt: string | null;
};

function isConfluenceDataset(dataset: CatalogDataset | null): boolean {
  if (!dataset) {
    return false;
  }
  if (typeof dataset.schema === "string" && dataset.schema.toUpperCase() === "CONFLUENCE") {
    return true;
  }
  return Boolean(
    dataset.labels?.some((label) => typeof label === "string" && label.toLowerCase().includes("confluence")),
  );
}

function extractConfluenceExcerpt(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const stripped = value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return stripped.length ? stripped : null;
}

type ConfluencePreviewRow = {
  pageId?: string | null;
  title?: string | null;
  spaceKey?: string | null;
  url?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  excerpt?: string | null;
};

type MetadataNavEntry = { id: MetadataSection; type: "section"; label: string; description: string; icon: IconType };

  const metadataNavItems: MetadataNavEntry[] = [
    { id: "catalog", type: "section" as const, label: "Catalog", description: "Datasets & schema", icon: LuTable },
    { id: "endpoints", type: "section" as const, label: "Endpoints", description: "Sources & templates", icon: LuNetwork },
    { id: "collections", type: "section" as const, label: "Collections", description: "Run history", icon: LuHistory },
  ];


const toastToneStyles: Record<ToastIntent, { className: string; icon: IconType }> = {
  success: {
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-400/50 dark:bg-emerald-500/10 dark:text-emerald-100",
    icon: LuCircleCheck,
  },
  error: {
    className:
      "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100",
    icon: LuCircleAlert,
  },
  info: {
    className: "border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
    icon: LuInfo,
  },
};

const metadataSectionTabs: Array<{ id: MetadataSection; label: string }> = [
  { id: "catalog", label: "Catalog" },
  { id: "endpoints", label: "Endpoints" },
  { id: "collections", label: "Collections" },
];

const templateFamilies: Array<{ id: TemplateFamily; label: string; description: string }> = [
  { id: "JDBC", label: "JDBC sources", description: "Warehouses, data lakes, transactional stores." },
  { id: "HTTP", label: "HTTP APIs", description: "SaaS systems like Jira, Confluence, ServiceNow." },
  { id: "STREAM", label: "Streaming", description: "Kafka, Confluent, and event hubs." },
];

function extractTemplateIdFromConfig(config?: Record<string, unknown> | null): string | null {
  if (!config || typeof config !== "object") {
    return null;
  }
  const templateId = (config as Record<string, unknown>).templateId;
  return typeof templateId === "string" ? templateId : null;
}

function parseTemplateParametersFromConfig(config?: Record<string, unknown> | null): Record<string, string> {
  if (!config || typeof config !== "object") {
    return {};
  }
  const parameters = (config as Record<string, unknown>).parameters;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(parameters).map(([key, value]) => [key, value === undefined || value === null ? "" : String(value)]),
  );
}

function buildTemplateValuesForTemplate(
  template: MetadataEndpointTemplate | null,
  parameters: Record<string, string>,
): Record<string, string> {
  if (!template) {
    return {};
  }
  return template.fields.reduce<Record<string, string>>((acc, field) => {
    acc[field.key] = parameters[field.key] ?? "";
    return acc;
  }, {});
}

function serializeTemplateConfigSignature(templateId: string | null, values: Record<string, string>) {
  const sortedParameters = Object.entries(values)
    .map(([key, value]) => [key, value ?? ""])
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({ templateId, parameters: sortedParameters });
}

function buildTemplateConnectionUrl(
  template: MetadataEndpointTemplate | null,
  parameters: Record<string, string>,
): string | null {
  if (!template?.connection?.urlTemplate) {
    return null;
  }
  let resolved = template.connection.urlTemplate;
  resolved = resolved.replace(/{{\s*([^}]+)\s*}}/g, (_match, key: string) => {
    const normalizedKey = String(key).trim();
    const replacement = parameters[normalizedKey];
    return typeof replacement === "string" ? replacement : "";
  });
  resolved = resolved.replace(/{{[^}]+}}/g, "");
  const trimmed = resolved.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const statusStyles: Record<
  MetadataCollectionRunSummary["status"],
  { badge: string; dot: string }
> = {
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

const COLLECTION_STATUS_VALUES: MetadataCollectionRunSummary["status"][] = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "SKIPPED",
];

export function MetadataWorkspace({
  metadataEndpoint,
  authToken,
  projectSlug,
  userRole,
  datasetDetailRouteId,
  onDatasetDetailRouteChange,
}: MetadataWorkspaceProps) {
  const toastQueue = useToastQueue();
  const [metadataCollections, setMetadataCollections] = useState<MetadataCollectionSummary[]>([]);
  const [metadataRuns, setMetadataRuns] = useState<MetadataCollectionRunSummary[]>([]);
  const [metadataRunStatusOverrides, setMetadataRunStatusOverrides] = useState<
    Record<string, MetadataCollectionRunSummary>
  >({});
  const [metadataTemplates, setMetadataTemplates] = useState<MetadataEndpointTemplate[]>([]);
  const [metadataTemplatesLoading, setMetadataTemplatesLoading] = useState(false);
  const [metadataTemplatesError, setMetadataTemplatesError] = useState<string | null>(null);
  const [metadataTemplateValues, setMetadataTemplateValues] = useState<Record<string, string>>({});
  const [metadataTemplateFamily, setMetadataTemplateFamily] = useState<TemplateFamily>("JDBC");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [metadataFormMode, setMetadataFormMode] = useState<"register" | "edit">("register");
  const [metadataEditingEndpointId, setMetadataEditingEndpointId] = useState<string | null>(null);
  const [metadataInitialConfigSignature, setMetadataInitialConfigSignature] = useState<string | null>(null);
  const [metadataLastTestConfigSignature, setMetadataLastTestConfigSignature] = useState<string | null>(null);
  const [metadataEndpointName, setMetadataEndpointName] = useState("");
  const [metadataEndpointDescription, setMetadataEndpointDescription] = useState("");
  const [metadataEndpointLabels, setMetadataEndpointLabels] = useState("");
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [metadataRefreshToken, setMetadataRefreshToken] = useState(0);
  const [metadataSection, setMetadataSection] = useState<MetadataSection>("catalog");
  const [metadataView, setMetadataView] = useState<MetadataView>("overview");
  const [metadataCatalogSearch, setMetadataCatalogSearch] = useState("");
  const [metadataCatalogEndpointFilter, setMetadataCatalogEndpointFilter] = useState<string>("all");
  const [metadataEndpointPickerQuery, setMetadataEndpointPickerQuery] = useState("");
  const [metadataEndpointPickerOpen, setMetadataEndpointPickerOpen] = useState(false);
  const endpointPickerRef = useRef<HTMLDivElement | null>(null);
  const debouncedEndpointPickerSearch = useDebouncedValue(metadataEndpointPickerQuery, 300);
  const [metadataCatalogLabelFilter, setMetadataCatalogLabelFilter] = useState<string>("all");
  const [metadataCatalogSelection, setMetadataCatalogSelection] = useState<string | null>(null);
  const [metadataMutationError, setMetadataMutationError] = useState<string | null>(null);
  const [metadataRegistering, setMetadataRegistering] = useState(false);
  const [metadataRunOverrides, setMetadataRunOverrides] = useState<Record<string, string>>({});
  const [metadataEndpointsSearch, setMetadataEndpointsSearch] = useState("");
  const [pendingTriggerEndpointId, setPendingTriggerEndpointId] = useState<string | null>(null);
  const [metadataTesting, setMetadataTesting] = useState(false);
  const [metadataTestResult, setMetadataTestResult] = useState<MetadataEndpointTestResult | null>(null);
  const [metadataOneDriveAuthUrl, setMetadataOneDriveAuthUrl] = useState<string | null>(null);
  const [metadataOneDriveAuthError, setMetadataOneDriveAuthError] = useState<string | null>(null);
  const [metadataDeletingEndpointId, setMetadataDeletingEndpointId] = useState<string | null>(null);
  const [metadataCatalogPreviewRows, setMetadataCatalogPreviewRows] = useState<Record<string, DatasetPreviewResult>>({});
  const [metadataCatalogPreviewErrors, setMetadataCatalogPreviewErrors] = useState<Record<string, string>>({});
  const [metadataCatalogPreviewingId, setMetadataCatalogPreviewingId] = useState<string | null>(null);
  const [metadataCollectionsEndpointFilter, setMetadataCollectionsEndpointFilter] = useState<string>("all");
  const [metadataCollectionsStatusFilter, setMetadataCollectionsStatusFilter] = useState<string>("all");
  const [sectionNavCollapsed, setSectionNavCollapsed] = useState(false);
  const [metadataEndpointDetailId, setMetadataEndpointDetailId] = useState<string | null>(null);
  const [metadataDatasetDetailId, setMetadataDatasetDetailId] = useState<string | null>(datasetDetailRouteId ?? null);
  const [catalogDatasetSnapshot, setCatalogDatasetSnapshot] = useState<CatalogDataset[]>([]);
  const [catalogHiddenEndpointIds, setCatalogHiddenEndpointIds] = useState<string[]>([]);
  const [datasetDetailCache, setDatasetDetailCache] = useState<Record<string, CatalogDataset>>({});
  const [datasetDetailLoading, setDatasetDetailLoading] = useState(false);
  const [datasetDetailError, setDatasetDetailError] = useState<string | null>(null);
  const [pendingDatasetNavigationId, setPendingDatasetNavigationId] = useState<string | null>(null);
  const [pendingEndpointNavigationId, setPendingEndpointNavigationId] = useState<string | null>(null);
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
  const matchesCatalogSearch = useCallback((dataset: CatalogDataset, searchTerm: string) => {
    if (!searchTerm.length) {
      return true;
    }
    const haystack: Array<string | null | undefined> = [
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
      } catch {
        return String(value).toLowerCase().includes(searchTerm);
      }
    });
  }, []);
  const sidebarOverlayWidth = sectionNavCollapsed ? "3.5rem" : "14rem";
  const detailRequestKeyRef = useRef(0);
  const inflightDatasetDetailIdRef = useRef<string | null>(null);
  const debouncedCatalogSearch = useDebouncedValue(metadataCatalogSearch, 300);
  const debouncedEndpointsSearch = useDebouncedValue(metadataEndpointsSearch, 300);
  const metadataEndpointQueryVariables = useMemo(() => {
    const trimmedSearch = debouncedEndpointsSearch.trim();
    return {
      projectSlug: projectSlug ?? undefined,
      search: trimmedSearch.length ? trimmedSearch : undefined,
    };
  }, [projectSlug, debouncedEndpointsSearch]);
  const selectEndpointsConnection = useCallback((payload: { endpoints?: MetadataEndpointSummary[] }) => {
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
  const {
    items: metadataEndpoints,
    loading: metadataEndpointsLoading,
    error: metadataEndpointsError,
    pageInfo: metadataEndpointsPageInfo,
    fetchNext: fetchMoreMetadataEndpoints,
    refresh: refreshMetadataEndpoints,
  } = usePagedQuery<MetadataEndpointSummary>({
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
  const {
    items: metadataEndpointPickerOptions,
    loading: metadataEndpointPickerLoading,
    pageInfo: metadataEndpointPickerPageInfo,
    fetchNext: fetchMoreMetadataEndpointOptions,
    refresh: refreshMetadataEndpointOptions,
  } = usePagedQuery<MetadataEndpointSummary>({
    metadataEndpoint,
    token: authToken ?? undefined,
    query: METADATA_ENDPOINTS_PAGED_QUERY,
    variables: metadataEndpointComboVariables,
    pageSize: 25,
    selectConnection: selectEndpointsConnection,
  });
  const endpointFilterValue =
    metadataCatalogEndpointFilter === "all" || metadataCatalogEndpointFilter === "unlinked"
      ? null
      : metadataCatalogEndpointFilter;
  const labelFilterValue =
    metadataCatalogLabelFilter === "all" || metadataCatalogLabelFilter === "unlabeled"
      ? null
      : metadataCatalogLabelFilter;
  const unlabeledOnly = metadataCatalogLabelFilter === "unlabeled" || metadataCatalogEndpointFilter === "unlinked";
  const {
    datasets: catalogDatasets,
    loading: catalogDatasetsLoading,
    error: catalogDatasetsError,
    pageInfo: catalogDatasetsPageInfo,
    fetchNext: fetchMoreCatalogDatasets,
    refresh: refreshCatalogDatasets,
  } = useCatalogDatasetConnection({
    metadataEndpoint,
    token: authToken ?? undefined,
    endpointId: endpointFilterValue,
    label: labelFilterValue,
    search: debouncedCatalogSearch.trim().length ? debouncedCatalogSearch.trim() : undefined,
    unlabeledOnly,
    pageSize: 25,
  });
  const resolvedRole =
    userRole ??
    ((typeof document !== "undefined"
      ? (document.body.dataset.metadataAuthRole as Role | undefined)
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
    const handleClickOutside = (event: MouseEvent) => {
      if (endpointPickerRef.current && !endpointPickerRef.current.contains(event.target as Node)) {
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
  const metadataEditingEndpoint = useMemo(
    () => (metadataEditingEndpointId ? metadataEndpoints.find((endpoint) => endpoint.id === metadataEditingEndpointId) ?? null : null),
    [metadataEditingEndpointId, metadataEndpoints],
  );
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
    if (
      normalizedCatalogSearch.length > 0 &&
      catalogDatasets.length === 0 &&
      catalogDatasetSnapshot.length > 0
    ) {
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
  const hasMetadataSnapshot =
    metadataCollections.length > 0 || metadataEndpoints.length > 0 || metadataCatalogFilteredDatasets.length > 0;
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
    const selectedDataset =
      metadataCatalogSelectedDataset && metadataCatalogSelectedDataset.id === metadataDatasetDetailId
        ? metadataCatalogSelectedDataset
        : null;
    return (
      datasetDetailCache[metadataDatasetDetailId] ??
      catalogDatasets.find((dataset) => dataset.id === metadataDatasetDetailId) ??
      selectedDataset ??
      null
    );
  }, [catalogDatasets, datasetDetailCache, metadataCatalogSelectedDataset, metadataDatasetDetailId]);

  const metadataEndpointLookup = useMemo(() => {
    const map = new Map<string, EndpointLookupEntry>();
    const addEndpoint = (entry?: EndpointLookupEntry | null) => {
      const id = entry?.id;
      if (!id) {
        return;
      }
      const normalized: EndpointLookupEntry = {
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
  const [pendingTemplateSelection, setPendingTemplateSelection] = useState<{ templateId: string | null; familyOverride: TemplateFamily | null } | null>(null);
  const [pendingEndpointEdit, setPendingEndpointEdit] = useState<MetadataEndpointSummary | null>(null);
  const [metadataRunsLoading, setMetadataRunsLoading] = useState(false);
  const [metadataRunsError, setMetadataRunsError] = useState<string | null>(null);
  const [metadataRunsRequestKey, setMetadataRunsRequestKey] = useState(0);
  const [metadataRunsLoadedKey, setMetadataRunsLoadedKey] = useState<number | null>(null);
  const [metadataRunsLoaded, setMetadataRunsLoaded] = useState(false);
  const [endpointDatasetRecords, setEndpointDatasetRecords] = useState<Record<string, EndpointDatasetRecord[]>>({});
  const [endpointDatasetErrors, setEndpointDatasetErrors] = useState<Record<string, string>>({});
  const [endpointDatasetLoading, setEndpointDatasetLoading] = useState<Record<string, boolean>>({});
  const isRouteDetail = Boolean(datasetDetailRouteId);
  useEffect(() => {
    if (datasetDetailRouteId === undefined) {
      return;
    }
    setMetadataDatasetDetailId(datasetDetailRouteId ?? null);
  }, [datasetDetailRouteId]);
  const updateDatasetDetailId = useCallback(
    (nextId: string | null, options?: { syncRoute?: boolean }) => {
      setMetadataDatasetDetailId(nextId);
      if (options?.syncRoute !== false && onDatasetDetailRouteChange) {
        onDatasetDetailRouteChange(nextId);
      }
    },
    [onDatasetDetailRouteChange],
  );
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
  const loadDatasetDetail = useCallback(
    async (datasetId: string, options?: { force?: boolean }) => {
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
        const payload = await fetchMetadataGraphQL<{
          metadataDataset?: CatalogDataset | null;
        }>(
          metadataEndpoint,
          METADATA_CATALOG_DATASET_QUERY,
          { id: datasetId },
          undefined,
          { token: authToken ?? undefined },
        );
        const detail =
          payload.metadataDataset ??
          catalogDatasets.find((dataset) => dataset.id === datasetId) ??
          null;
        if (!detail) {
          throw new Error("Dataset not found in this project.");
        }
        setDatasetDetailCache((prev) => ({ ...prev, [detail.id]: detail }));
        return detail;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (detailRequestKeyRef.current === requestKey) {
          setDatasetDetailError(message);
        }
        throw error instanceof Error ? error : new Error(message);
      } finally {
        if (detailRequestKeyRef.current === requestKey) {
          setDatasetDetailLoading(false);
        }
        if (inflightDatasetDetailIdRef.current === datasetId) {
          inflightDatasetDetailIdRef.current = null;
        }
      }
    },
    [authToken, catalogDatasets, datasetDetailCache, metadataEndpoint],
  );

  const openDatasetDetailAction = useAsyncAction(
    async (datasetId: string) => {
      const detail = await loadDatasetDetail(datasetId, { force: true });
      return detail;
    },
    {
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
    },
  );

  const handleOpenDatasetDetail = useCallback(
    async (datasetId: string) => {
      updateDatasetDetailId(datasetId, { syncRoute: false });
      setPendingDatasetNavigationId(datasetId);
      try {
        await openDatasetDetailAction.run(datasetId);
      } catch {
        // toast already handled in hook
      } finally {
        setPendingDatasetNavigationId((prev) => (prev === datasetId ? null : prev));
      }
    },
    [openDatasetDetailAction],
  );

  const handleOpenDatasetDetailPage = useCallback(
    (datasetId: string | null) => {
      if (!datasetId) {
        return;
      }
      updateDatasetDetailId(datasetId, { syncRoute: true });
    },
    [updateDatasetDetailId],
  );

  const navigateToEndpointAction = useAsyncAction(
    async (endpointId: string | null) => {
      if (!endpointId) {
        throw new Error("Endpoint unavailable for this run.");
      }
      setMetadataView("overview");
      setMetadataSection("endpoints");
      setMetadataEndpointDetailId(endpointId);
      return metadataEndpoints.find((endpoint) => endpoint.id === endpointId) ?? null;
    },
    {
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
    },
  );

  const handleViewEndpointFromCollections = useCallback(
    async (endpointId: string | null) => {
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
      } catch {
        // toast already emitted
      } finally {
        setPendingEndpointNavigationId((prev) => (prev === endpointId ? null : prev));
      }
    },
    [navigateToEndpointAction, toastQueue],
  );

  const getDatasetPreviewState = useCallback(
    (dataset: CatalogDataset | null): DatasetPreviewSummary => {
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
      let owner: EndpointLookupEntry | null = null;
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
      const declaredEndpointLink = Boolean(dataset.sourceEndpointId);
      const ownerResolved = Boolean(owner);
      const hasLinkedEndpoint = declaredEndpointLink || ownerResolved;
      const previewEntry = metadataCatalogPreviewRows[dataset.id];
      let previewRows = (previewEntry?.rows ?? []) as Array<Record<string, unknown>>;
      if (previewRows.length === 0) {
        const cachedSample = datasetDetailCache[dataset.id]?.sampleRows ?? (dataset.sampleRows as Array<Record<string, unknown>> | undefined);
        if (Array.isArray(cachedSample)) {
          previewRows = cachedSample;
        }
      }
      const previewError = metadataCatalogPreviewErrors[dataset.id];
      const previewing = metadataCatalogPreviewingId === dataset.id;
      const hasLiveSample = previewRows.length > 0;
      let previewSampledAt = previewEntry?.sampledAt ?? null;
      let previewAvailability: DatasetPreviewAvailability = hasLiveSample ? "sampled" : "ready";
      let previewStatusMessage: string | null = null;
      let previewStatusTone: PreviewStatusTone = "info";
      let previewBlockReason: string | null = null;
      if (!declaredEndpointLink) {
        previewAvailability = "unlinked";
        previewStatusMessage = "Link this dataset to a registered endpoint before running previews.";
        previewStatusTone = "warn";
        previewBlockReason = previewStatusMessage;
      } else if (!ownerResolved) {
        previewStatusMessage = "Resolving endpoint link…";
        previewStatusTone = "neutral";
      } else if (!supportsPreview) {
        previewAvailability = "unsupported";
        const ownerName = owner?.name ?? "this endpoint";
        previewStatusMessage = `Preview not supported for ${ownerName}.`;
        previewStatusTone = "warn";
        previewBlockReason = previewStatusMessage;
      } else if (previewError) {
        previewAvailability = "error";
        previewStatusMessage = "Preview failed. Review the error below and try again.";
        previewStatusTone = "warn";
      } else if (!hasLiveSample && !previewing) {
        previewAvailability = "not_run";
        previewStatusMessage = "No preview sampled yet. Run a preview to inspect live data.";
        previewStatusTone = "neutral";
      }
      const canPreview = !["unlinked", "unsupported"].includes(previewAvailability);
      if (!canPreview) {
        previewRows = [];
        previewSampledAt = null;
      }
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
        sampledAt: previewSampledAt,
      };
    },
    [datasetDetailCache, metadataCatalogPreviewErrors, metadataCatalogPreviewRows, metadataCatalogPreviewingId, metadataEndpointLookup],
  );

  const metadataCollectionsByEndpoint = useMemo(() => {
    const map = new Map<string, MetadataCollectionSummary>();
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
    const labels = new Set<string>();
    catalogDatasetBaseList.forEach((dataset) => dataset.labels?.forEach((label) => labels.add(label)));
    return Array.from(labels).sort();
  }, [catalogDatasetBaseList]);

  const metadataEndpointDetail = useMemo(
    () => (metadataEndpointDetailId ? metadataEndpoints.find((endpoint) => endpoint.id === metadataEndpointDetailId) ?? null : null),
    [metadataEndpointDetailId, metadataEndpoints],
  );
  const metadataDatasetDetailFields = metadataDatasetDetail?.fields ?? [];
  const detailDataset = metadataDatasetDetail ?? metadataCatalogSelectedDataset ?? null;
  const metadataDatasetDetailDisplayId = metadataDatasetDetail?.upstreamId ?? metadataDatasetDetail?.id ?? null;
  const detailDatasetDisplayId = detailDataset?.upstreamId ?? detailDataset?.id ?? null;
  const catalogPreviewState = useMemo(
    () => getDatasetPreviewState(metadataCatalogSelectedDataset ?? null),
    [getDatasetPreviewState, metadataCatalogSelectedDataset],
  );
  const detailPreviewState = useMemo(() => getDatasetPreviewState(detailDataset), [detailDataset, getDatasetPreviewState]);
  const detailOwner = detailPreviewState.owner;
  const detailEndpointCapabilities = detailPreviewState.endpointCapabilities;
  const detailDeclaresCapabilities = detailEndpointCapabilities.length > 0;
  const detailPreviewRows =
    detailPreviewState.previewRows.length > 0 ? detailPreviewState.previewRows : detailDataset?.sampleRows ?? [];
  const detailPreviewColumns = previewTableColumns(detailPreviewRows);
  const detailPreviewError = detailPreviewState.previewError;
  const detailPreviewing = detailPreviewState.previewing;
  const detailPreviewStatusMessage = detailPreviewState.previewStatusMessage;
  const detailPreviewStatusTone = detailPreviewState.previewStatusTone;
  const detailSampledAt = detailPreviewState.sampledAt;
  const detailCanPreview = Boolean(detailDataset) && detailPreviewState.canPreview;
  const detailHasLinkedEndpoint = Boolean(detailDataset?.sourceEndpointId && detailOwner);
  const detailProfileBlockReason =
    (detailOwner && detailDeclaresCapabilities && !detailEndpointCapabilities.includes("profile")
      ? `Dataset profiles disabled: ${detailOwner.name} is missing the "profile" capability.`
      : null) ??
    (!detailHasLinkedEndpoint && detailDataset ? "Link this dataset to a registered endpoint before profiling." : null);
  const detailLastCollectionRun = detailDataset?.lastCollectionRun ?? null;

  const isFieldVisible = useCallback(
    (field: MetadataEndpointTemplateField) => {
      if (!field.visibleWhen || field.visibleWhen.length === 0) {
        return true;
      }
      return field.visibleWhen.every((rule) => {
        const current = metadataTemplateValues[rule.field] ?? "";
        return rule.values.includes(current);
      });
    },
    [metadataTemplateValues],
  );

  const isFieldRequired = useCallback(
    (field: MetadataEndpointTemplateField) => {
      if (!field.dependsOn) {
        return field.required;
      }
      const dependsValue = metadataTemplateValues[field.dependsOn];
      if (field.dependsValue === null || field.dependsValue === undefined) {
        return field.required && Boolean(dependsValue);
      }
      return field.required && dependsValue === field.dependsValue;
    },
    [metadataTemplateValues],
  );

  const metadataLatestRunByEndpoint = useMemo(() => {
    const map = new Map<string, MetadataCollectionRunSummary>();
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
      if (!endpointRuns.length) {
        const override = metadataRunStatusOverrides[endpoint.id];
        if (override) {
          map.set(endpoint.id, override);
        }
        return;
      }
      const sortedRuns = [...endpointRuns].sort(
        (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
      );
      const latestEndpointRun =
        sortedRuns.find((run) => run.status !== "QUEUED" && run.status !== "RUNNING") ?? sortedRuns[0];
      const existing = map.get(endpoint.id);
      const override = metadataRunStatusOverrides[endpoint.id];
      let candidate = latestEndpointRun;
      if (override) {
        const overrideTime = new Date(override.requestedAt).getTime();
        const candidateTime = candidate?.requestedAt ? new Date(candidate.requestedAt).getTime() : 0;
        const overrideIsRunning = override.status === "RUNNING" || override.status === "QUEUED";
        const candidateIsTerminal = candidate && candidate.status !== "RUNNING" && candidate.status !== "QUEUED";
        if (overrideIsRunning && candidateIsTerminal) {
          // Prefer a completed run over a stale running override.
        } else if (!candidate || overrideTime >= candidateTime) {
          candidate = override;
        }
      }
      if (
        candidate &&
        (!existing ||
          (candidate.requestedAt &&
            new Date(candidate.requestedAt).getTime() > new Date(existing.requestedAt).getTime()))
      ) {
        map.set(endpoint.id, candidate);
      }
    });
    Object.entries(metadataRunStatusOverrides).forEach(([endpointId, override]) => {
      if (!map.has(endpointId)) {
        map.set(endpointId, override);
      }
    });
    return map;
  }, [metadataEndpoints, metadataRuns, metadataRunStatusOverrides]);

  const metadataTemplatesByFamily = useMemo(() => {
    return metadataTemplates.reduce<Record<TemplateFamily, MetadataEndpointTemplate[]>>(
      (groups, template) => {
        const family = template.family;
        groups[family] = [...(groups[family] ?? []), template];
        return groups;
      },
      { JDBC: [], HTTP: [], STREAM: [] },
    );
  }, [metadataTemplates]);

  const filteredTemplates = metadataTemplatesByFamily[metadataTemplateFamily] ?? [];

  useEffect(() => {
    setMetadataRunStatusOverrides((prev) => {
      if (!Object.keys(prev).length) {
        return prev;
      }
      let mutated = false;
      const next = { ...prev };
      metadataEndpoints.forEach((endpoint) => {
        if (!endpoint.id) {
          return;
        }
        const override = prev[endpoint.id];
        if (!override) {
          return;
        }
        const endpointRuns = endpoint.runs ?? [];
        if (!endpointRuns.length) {
          return;
        }
        const latestEndpointRun = [...endpointRuns].sort(
          (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
        )[0];
        if (!latestEndpointRun) {
          return;
        }
        if (latestEndpointRun.status === "RUNNING" || latestEndpointRun.status === "QUEUED") {
          return;
        }
        const latestTimestamp = latestEndpointRun.requestedAt
          ? new Date(latestEndpointRun.requestedAt).getTime()
          : 0;
        const overrideTimestamp = override.requestedAt ? new Date(override.requestedAt).getTime() : 0;
        if (latestTimestamp >= overrideTimestamp) {
          next[endpoint.id] = latestEndpointRun;
          mutated = true;
        }
      });
      return mutated ? next : prev;
    });
  }, [metadataEndpoints]);

  const ensureTemplatesLoaded = useCallback(
    (options?: { force?: boolean }) => {
      if (!metadataEndpoint || !authToken) {
        return;
      }
      if (!options?.force && (metadataTemplatesLoading || metadataTemplates.length > 0)) {
        return;
      }
      setMetadataTemplatesLoading(true);
      setMetadataTemplatesError(null);
      void fetchMetadataGraphQL<{ endpointTemplates: MetadataEndpointTemplate[] }>(
        metadataEndpoint,
        METADATA_ENDPOINT_TEMPLATES_QUERY,
        undefined,
        undefined,
        { token: authToken ?? undefined },
      )
        .then((payload) => {
          setMetadataTemplates(payload.endpointTemplates ?? []);
        })
        .catch((error) => {
          setMetadataTemplatesError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          setMetadataTemplatesLoading(false);
        });
    },
    [authToken, metadataEndpoint, metadataTemplates.length, metadataTemplatesLoading],
  );
  const handleRetryLoadTemplates = useCallback(() => {
    ensureTemplatesLoaded({ force: true });
  }, [ensureTemplatesLoaded]);

  const applyTemplateSelection = useCallback(
    (templateId: string | null, familyOverride: TemplateFamily | null) => {
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
    },
    [metadataTemplateFamily, metadataTemplates, metadataTemplatesByFamily],
  );

  const populateEndpointEditFields = useCallback(
    (endpoint: MetadataEndpointSummary) => {
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
        const initialValues = buildTemplateValuesForTemplate(
          resolvedTemplate,
          parseTemplateParametersFromConfig(endpoint.config ?? undefined),
        );
        setMetadataTemplateValues(initialValues);
        const signature = serializeTemplateConfigSignature(resolvedTemplate.id, initialValues);
        setMetadataInitialConfigSignature(signature);
        setMetadataLastTestConfigSignature(signature);
      } else {
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
    },
    [metadataTemplateFamily, metadataTemplates],
  );

  const handleOpenRegistration = useCallback(
    (templateId?: string, familyOverride?: TemplateFamily) => {
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
      } else {
        setPendingTemplateSelection({ templateId: templateId ?? null, familyOverride: familyOverride ?? null });
        ensureTemplatesLoaded();
      }
    },
    [applyTemplateSelection, ensureTemplatesLoaded, metadataTemplates.length],
  );

  const handleOpenEndpointEdit = useCallback(
    (endpoint: MetadataEndpointSummary) => {
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
    },
    [ensureTemplatesLoaded, metadataTemplates.length, populateEndpointEditFields],
  );

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
  const currentConfigSignature = useMemo(
    () => serializeTemplateConfigSignature(currentTemplateId, metadataTemplateValues),
    [currentTemplateId, metadataTemplateValues],
  );
  const connectionChangedFromInitial = isEditingEndpoint && metadataInitialConfigSignature !== currentConfigSignature;
  const requiresRetest =
    isEditingEndpoint && connectionChangedFromInitial && metadataLastTestConfigSignature !== currentConfigSignature;
  const formTitle = metadataFormMode === "edit" ? "Edit endpoint" : "Register endpoint";
  const submitButtonLabel =
    metadataFormMode === "edit"
      ? metadataRegistering
        ? "Saving…"
        : "Save changes"
      : metadataRegistering
        ? "Registering…"
        : "Register endpoint";
  const currentAuthMode =
    (metadataTemplateValues.auth_mode ?? metadataTemplateValues.authMode ?? "").toLowerCase();
  const allowSaveWithoutTest = selectedTemplate?.id === "http.onedrive" && currentAuthMode === "delegated";
  const submitDisabled =
    !canModifyEndpoints ||
    metadataRegistering ||
    (metadataFormMode === "edit"
      ? !allowSaveWithoutTest && requiresRetest
      : !allowSaveWithoutTest && !metadataTestResult?.ok);
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
      const next = selectedTemplate.fields.reduce<Record<string, string>>((acc, field) => {
        acc[field.key] = prev[field.key] ?? field.defaultValue ?? "";
        return acc;
      }, {});
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      const sameLength = prevKeys.length === nextKeys.length;
      const sameValues = sameLength && nextKeys.every((key) => prev[key] === next[key]);
      return sameValues ? prev : next;
    });
  }, [selectedTemplate]);

  useEffect(() => {
    if (!selectedTemplate || metadataFormMode !== "register") {
      return;
    }
    const templateDefaults = Array.isArray(selectedTemplate.defaultLabels)
      ? selectedTemplate.defaultLabels.join(", ")
      : "";
    setMetadataEndpointLabels(templateDefaults);
  }, [metadataFormMode, selectedTemplate]);

  useEffect(() => {
    setMetadataOneDriveAuthUrl(null);
    setMetadataOneDriveAuthError(null);
  }, [metadataEditingEndpointId, selectedTemplateId, metadataTemplateValues.auth_mode, metadataTemplateValues.authMode]);

  const sortedMetadataRuns = useMemo(() => {
    return [...metadataRuns].sort(
      (a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
    );
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
  const handleSelectEndpointFilter = useCallback((value: string, options?: { label?: string }) => {
    if (value === "all") {
      setMetadataEndpointPickerQuery("");
    } else if (value === "unlinked") {
      setMetadataEndpointPickerQuery("Unlinked datasets");
    } else if (options?.label) {
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
      const payload = await fetchMetadataGraphQL<{
        collectionRuns: MetadataCollectionRunSummary[];
      }>(
        metadataEndpoint,
        COLLECTION_RUNS_QUERY,
        {
          filter:
            metadataCollectionsEndpointFilter !== "all" || metadataCollectionsStatusFilter !== "all"
              ? {
                  endpointId: metadataCollectionsEndpointFilter !== "all" ? metadataCollectionsEndpointFilter : undefined,
                  status: metadataCollectionsStatusFilter !== "all" ? metadataCollectionsStatusFilter : undefined,
                }
              : undefined,
          first: 30,
        },
        undefined,
        { token: authToken ?? undefined },
      );
      setMetadataRuns(payload.collectionRuns ?? []);
      setMetadataRunsLoaded(true);
      setMetadataRunsLoadedKey(metadataRunsRequestKey);
    } catch (error) {
      setMetadataRunsError(error instanceof Error ? error.message : String(error));
    } finally {
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

  const pollCollectionRunCompletion = useCallback(
    async (endpointId: string, runId: string | null) => {
      if (!metadataEndpoint || !authToken || !runId) {
        return;
      }
      console.info("[metadata-ui] polling collection run", { endpointId, runId });
      for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
          const payload = await fetchMetadataGraphQL<{
            collectionRuns: MetadataCollectionRunSummary[];
          }>(
            metadataEndpoint,
            COLLECTION_RUNS_QUERY,
            { filter: { endpointId }, first: 5 },
            undefined,
            { token: authToken ?? undefined },
          );
          const match = payload.collectionRuns?.find((run) => run.id === runId);
          if (match && match.status !== "QUEUED" && match.status !== "RUNNING") {
            setMetadataRuns((prev) => {
              const next = prev.filter((run) => run.id !== match.id);
              return [match, ...next];
            });
            console.info("[metadata-ui] collection run completed", {
              endpointId,
              runId,
              status: match.status,
            });
            setMetadataRunStatusOverrides((prev) => ({
              ...prev,
              [endpointId]: match,
            }));
            refreshMetadataWorkspace();
            return;
          }
        } catch {
          // ignore fetch errors and retry
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    },
    [authToken, metadataEndpoint, refreshMetadataWorkspace, setMetadataRuns, setMetadataRunStatusOverrides],
  );

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

  const handleRequirementChange = useCallback((key: string, value: string) => {
    setMetadataTemplateValues((prev) => ({ ...prev, [key]: value }));
    setMetadataTestResult(null);
  }, []);

  const handleLoadCatalogDatasetPreview = useCallback(
    async (datasetId: string) => {
      if (!datasetId) {
        return;
      }
      if (!metadataEndpoint || !authToken) {
        return;
      }
      try {
        const payload = await fetchMetadataGraphQL<{
          catalogDatasetPreview: DatasetPreviewResult | null;
        }>(
          metadataEndpoint,
          CATALOG_DATASET_PREVIEW_QUERY,
          { id: datasetId },
          undefined,
          { token: authToken },
        );
        setMetadataCatalogPreviewRows((prev) => ({
          ...prev,
          [datasetId]: payload.catalogDatasetPreview ?? { rows: [] },
        }));
        setMetadataCatalogPreviewErrors((prev) => ({ ...prev, [datasetId]: "" }));
      } catch (error) {
        setMetadataCatalogPreviewErrors((prev) => ({
          ...prev,
          [datasetId]: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [authToken, metadataEndpoint],
  );

  useEffect(() => {
    if (!metadataCatalogSelectedDataset) {
      return;
    }
    const datasetId = metadataCatalogSelectedDataset.id;
    if (!datasetId) {
      return;
    }
    if (metadataCatalogPreviewRows[datasetId]) {
      return;
    }
    void handleLoadCatalogDatasetPreview(datasetId);
  }, [handleLoadCatalogDatasetPreview, metadataCatalogPreviewRows, metadataCatalogSelectedDataset]);

  const handlePreviewMetadataDataset = useCallback(
    async (datasetId: string, options?: { limit?: number }) => {
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
      const limit = options?.limit ?? 20;
      setMetadataCatalogPreviewingId(datasetId);
      setMetadataCatalogPreviewErrors((prev) => ({ ...prev, [datasetId]: "" }));
      try {
        const payload = await fetchMetadataGraphQL<{
          previewMetadataDataset: DatasetPreviewResult | null;
        }>(
          metadataEndpoint,
          PREVIEW_METADATA_DATASET_MUTATION,
          { id: datasetId, limit },
          undefined,
          { token: authToken },
        );
        setMetadataCatalogPreviewRows((prev) => ({
          ...prev,
          [datasetId]: payload.previewMetadataDataset ?? { rows: [] },
        }));
      } catch (error) {
        setMetadataCatalogPreviewErrors((prev) => ({
          ...prev,
          [datasetId]: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        setMetadataCatalogPreviewingId((prev) => (prev === datasetId ? null : prev));
      }
    },
    [authToken, metadataEndpoint],
  );

  const handleSubmitMetadataEndpoint = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
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
        const labels =
          metadataFormMode === "register"
            ? Array.from(new Set([...(selectedTemplate.defaultLabels ?? []), ...userLabels]))
            : userLabels;
        const configPayload: Record<string, unknown> = {
          templateId: selectedTemplate.id,
          parameters: metadataTemplateValues,
        };
        const fallbackUrl = buildTemplateConnectionUrl(selectedTemplate, metadataTemplateValues);
        if (metadataFormMode === "edit" && metadataEditingEndpointId) {
          await fetchMetadataGraphQL(
            metadataEndpoint,
            UPDATE_METADATA_ENDPOINT_MUTATION,
            {
              id: metadataEditingEndpointId,
              patch: {
                name: metadataEndpointName.trim() || `${selectedTemplate.title} endpoint`,
                description: metadataEndpointDescription.trim() || null,
                labels,
                config: configPayload,
              },
            },
            undefined,
            { token: authToken ?? undefined },
          );
          handleCloseRegistration();
          handleCloseEndpointDetail();
          refreshMetadataWorkspace();
        } else {
          await fetchMetadataGraphQL(
            metadataEndpoint,
            REGISTER_METADATA_ENDPOINT_MUTATION,
            {
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
            },
            undefined,
            { token: authToken ?? undefined },
          );
          setMetadataTemplateValues({});
          setMetadataEndpointName("");
          setMetadataEndpointDescription("");
          setMetadataEndpointLabels("");
          setMetadataTestResult(null);
          handleCloseRegistration();
          handleCloseEndpointDetail();
          refreshMetadataWorkspace();
        }
      } catch (error) {
        setMetadataMutationError(error instanceof Error ? error.message : String(error));
      } finally {
        setMetadataRegistering(false);
      }
    },
    [
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
    ],
  );

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
      const payload = await fetchMetadataGraphQL<{
        testEndpoint: MetadataEndpointTestResult;
      }>(
        metadataEndpoint,
        TEST_METADATA_ENDPOINT_MUTATION,
        {
          input: {
            templateId: selectedTemplate.id,
            type: selectedTemplate.family.toLowerCase(),
            connection: metadataTemplateValues,
            capabilities: selectedTemplate.capabilities?.map((capability) => capability.key),
          },
        },
        undefined,
        { token: authToken ?? undefined },
      );
      const result = payload.testEndpoint;
      setMetadataTestResult(result);
      if (result.ok) {
        setMetadataLastTestConfigSignature(
          serializeTemplateConfigSignature(selectedTemplate!.id, metadataTemplateValues),
        );
      }
    } catch (error) {
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
    } finally {
      setMetadataTesting(false);
    }
  }, [authToken, metadataEndpoint, metadataEndpointDescription, metadataEndpointLabels, metadataEndpointName, metadataTemplateValues, selectedTemplate]);

  const handleStartOneDriveAuth = useCallback(async () => {
    if (!selectedTemplate || selectedTemplate.id !== "http.onedrive") {
      setMetadataOneDriveAuthError("Select the OneDrive template to start delegated auth.");
      return;
    }
    if ((metadataTemplateValues.auth_mode ?? metadataTemplateValues.authMode) !== "delegated") {
      setMetadataOneDriveAuthError("Set auth_mode to delegated before connecting.");
      return;
    }
    const clientId =
      (metadataTemplateValues.client_id ?? metadataTemplateValues.clientId ?? "").trim().toLowerCase();
    if (!clientId || clientId.includes("stub")) {
      setMetadataOneDriveAuthError(
        "Provide a real Azure AD app client_id (not stub-client-id) for delegated OneDrive authentication.",
      );
      return;
    }
    if (!metadataEndpoint || !authToken) {
      setMetadataOneDriveAuthError("Configure the metadata API endpoint before starting delegated auth.");
      return;
    }
    if (!metadataEditingEndpointId) {
      setMetadataOneDriveAuthError("Save the endpoint first, then start delegated auth.");
      return;
    }
    try {
      setMetadataOneDriveAuthError(null);
      const payload = await fetchMetadataGraphQL<{
        startOneDriveAuth: { authSessionId: string; authUrl: string; state: string };
      }>(
        metadataEndpoint,
        START_ONEDRIVE_AUTH_MUTATION,
        { endpointId: metadataEditingEndpointId },
        undefined,
        { token: authToken ?? undefined },
      );
      const authSession = payload.startOneDriveAuth;
      setMetadataOneDriveAuthUrl(authSession?.authUrl ?? null);
      if (authSession?.authUrl) {
        try {
          window.open(authSession.authUrl, "_blank", "noopener,noreferrer");
        } catch {
          // ignore window open failures (e.g., headless tests)
        }
      }
    } catch (error) {
      setMetadataOneDriveAuthError(error instanceof Error ? error.message : String(error));
    }
  }, [authToken, metadataEditingEndpointId, metadataEndpoint, metadataTemplateValues, selectedTemplate]);

  const triggerCollectionAction = useAsyncAction(
    async (endpointId: string) => {
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
      const supportsMetadataCapability =
        declaredCapabilities.length === 0 || declaredCapabilities.includes("metadata");
      if (!supportsMetadataCapability) {
        throw new Error(`Cannot trigger collection. ${targetEndpoint.name} is missing the "metadata" capability.`);
      }
      const targetCollection = metadataCollectionsByEndpoint.get(endpointId);
      if (targetCollection && !targetCollection.isEnabled) {
        throw new Error(
          `Cannot trigger collection because the collection for ${targetEndpoint.name} is disabled.`,
        );
      }
      setMetadataMutationError(null);
      console.info("[metadata-ui] collection run started", { endpointId, name: targetEndpoint.name });
      setMetadataRunStatusOverrides((prev) => ({
        ...prev,
        [endpointId]: {
          id: `pending-${Date.now()}`,
          status: "RUNNING",
          requestedAt: new Date().toISOString(),
          endpoint: { id: endpointId, name: targetEndpoint.name },
          completedAt: null,
          error: null,
        },
      }));
      const override = metadataRunOverrides[endpointId];
      const schemaOverride = override
        ? override
            .split(",")
            .map((schema) => schema.trim())
            .filter(Boolean)
        : undefined;
      const payload = await fetchMetadataGraphQL<{
        triggerEndpointCollection: { id: string; status: MetadataCollectionRunSummary["status"]; error?: string | null };
      }>(
        metadataEndpoint,
        TRIGGER_ENDPOINT_COLLECTION_MUTATION,
        {
          endpointId,
          schemaOverride,
        },
        undefined,
        { token: authToken ?? undefined },
      );
      const triggeredRun = payload.triggerEndpointCollection ?? null;
      if (triggeredRun) {
        setMetadataRunStatusOverrides((prev) => ({
          ...prev,
          [endpointId]: {
            ...prev[endpointId],
            ...triggeredRun,
            requestedAt: prev[endpointId]?.requestedAt ?? new Date().toISOString(),
            endpoint: { id: endpointId, name: targetEndpoint.name },
          },
        }));
      }
      refreshMetadataWorkspace();
      const runId = triggeredRun?.id ?? null;
      if (triggeredRun?.status && triggeredRun.status !== "QUEUED" && triggeredRun.status !== "RUNNING") {
        return;
      }
      if (runId) {
        void pollCollectionRunCompletion(endpointId, runId);
      }
      refreshMetadataRuns();
      return { endpoint: targetEndpoint, run: payload.triggerEndpointCollection };
    },
    {
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
    },
  );

  const handleTriggerMetadataRun = useCallback(
    async (endpointId: string) => {
      setPendingTriggerEndpointId(endpointId);
      try {
        await triggerCollectionAction.run(endpointId);
      } catch {
        // Error already surfaced via toast + mutation banner
      } finally {
        setPendingTriggerEndpointId((prev) => (prev === endpointId ? null : prev));
      }
    },
    [triggerCollectionAction],
  );

  const handleDeleteMetadataEndpoint = useCallback(
    async (endpoint: MetadataEndpointSummary) => {
      if (!canDeleteEndpoints) {
        setMetadataMutationError("You do not have permission to delete endpoints.");
        return;
      }
      if (!metadataEndpoint) {
        setMetadataMutationError("Configure VITE_METADATA_GRAPHQL_ENDPOINT to delete endpoints.");
        return;
      }
      if (typeof window !== "undefined") {
        const navigatorIsAutomation = Boolean((window.navigator as Navigator & { webdriver?: boolean }).webdriver);
        const confirmMessage = `Delete “${endpoint.name}”? Metadata collections and their datasets will no longer receive updates.`;
        const confirmDelete = window.confirm(confirmMessage);
        if (!confirmDelete && !navigatorIsAutomation) {
          return;
        }
      }
      setMetadataDeletingEndpointId(endpoint.id);
      setMetadataMutationError(null);
      try {
        await fetchMetadataGraphQL(
          metadataEndpoint,
          DELETE_METADATA_ENDPOINT_MUTATION,
          { id: endpoint.id },
          undefined,
          { token: authToken ?? undefined },
        );
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
      } catch (error) {
        setMetadataMutationError(error instanceof Error ? error.message : String(error));
      } finally {
        setMetadataDeletingEndpointId((prev) => (prev === endpoint.id ? null : prev));
      }
    },
    [
      authToken,
      canDeleteEndpoints,
      handleCloseRegistration,
      metadataEditingEndpointId,
      metadataEndpoint,
      metadataEndpointDetailId,
      refreshCatalogDatasets,
      refreshMetadataEndpoints,
    ],
  );

  const loadEndpointDatasets = useCallback(
    async (endpointId: string, options?: { force?: boolean }) => {
      if (!metadataEndpoint || !authToken) {
        return;
      }
      if (!options?.force && endpointDatasetRecords[endpointId]) {
        return;
      }
      setEndpointDatasetLoading((prev) => ({ ...prev, [endpointId]: true }));
      try {
        const payload = await fetchMetadataGraphQL<{ endpointDatasets: EndpointDatasetRecord[] }>(
          metadataEndpoint,
          ENDPOINT_DATASETS_QUERY,
          { endpointId },
          undefined,
          { token: authToken },
        );
        setEndpointDatasetRecords((prev) => ({ ...prev, [endpointId]: payload.endpointDatasets ?? [] }));
        setEndpointDatasetErrors((prev) => {
          const next = { ...prev };
          delete next[endpointId];
          return next;
        });
      } catch (error) {
        setEndpointDatasetErrors((prev) => ({
          ...prev,
          [endpointId]: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        setEndpointDatasetLoading((prev) => ({ ...prev, [endpointId]: false }));
      }
    },
    [authToken, endpointDatasetRecords, metadataEndpoint],
  );

  useEffect(() => {
    if (!selectedTemplate) {
      return;
    }
    setMetadataTemplateValues((prev) => {
      const next: Record<string, string> = {};
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
        const data = await fetchMetadataGraphQL<{
          endpoints: MetadataEndpointSummary[];
          collections: MetadataCollectionSummary[];
        }>(
          metadataEndpoint,
          METADATA_OVERVIEW_QUERY,
          { projectSlug: projectSlug ?? undefined },
          controller.signal,
          {
            token: authToken ?? undefined,
          },
        );
        if (controller.signal.aborted) {
          return;
        }
        setMetadataCollections(data.collections ?? []);
      } catch (error) {
        if (!controller.signal.aborted) {
          setMetadataError(error instanceof Error ? error.message : String(error));
        }
      } finally {
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
    if (metadataCatalogPreviewingId === datasetId) {
      return;
    }
    void handleLoadCatalogDatasetPreview(datasetId);
  }, [
    authToken,
    handleLoadCatalogDatasetPreview,
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
    const catalogDataset =
      metadataCatalogSelectedDataset && metadataCatalogSelectedDataset.id
        ? datasetDetailCache[metadataCatalogSelectedDataset.id] ?? metadataCatalogSelectedDataset
        : metadataCatalogSelectedDataset;
    const labelFilterOptions = [
      { value: "all", label: "All labels" },
      { value: "unlabeled", label: "Unlabeled" },
      ...metadataCatalogLabelOptions.map((label) => ({ value: label, label })),
    ];
    const activeFilterChips: Array<{ label: string; onClear: () => void }> = [];
    if (metadataCatalogSearch.trim().length > 0) {
      activeFilterChips.push({
        label: `Search · ${metadataCatalogSearch.trim()}`,
        onClear: () => setMetadataCatalogSearch(""),
      });
    }
    if (metadataCatalogEndpointFilter !== "all") {
      const endpointLabel =
        metadataCatalogEndpointFilter === "unlinked"
          ? "Unlinked datasets"
          : metadataEndpointLookup.get(metadataCatalogEndpointFilter)?.name ?? metadataCatalogEndpointFilter;
      activeFilterChips.push({
        label: `Endpoint · ${endpointLabel}`,
        onClear: () => handleSelectEndpointFilter("all"),
      });
    }
    if (metadataCatalogLabelFilter !== "all") {
      const labelName =
        labelFilterOptions.find((option) => option.value === metadataCatalogLabelFilter)?.label ?? metadataCatalogLabelFilter;
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
    const previewRows: Array<Record<string, unknown>> =
      catalogPreviewState.previewRows.length > 0
        ? catalogPreviewState.previewRows
        : catalogDataset?.sampleRows ?? [];
    const previewColumns = previewTableColumns(previewRows);
    const isConfluencePreview = isConfluenceDataset(catalogDataset);
    const confluencePreviewRows: ConfluencePreviewRow[] = isConfluencePreview
      ? (previewRows.filter((row): row is ConfluencePreviewRow => {
          if (!row || typeof row !== "object") {
            return false;
          }
          const candidate = row as ConfluencePreviewRow;
          return Boolean(candidate.pageId || candidate.title || candidate.spaceKey);
        }) as ConfluencePreviewRow[])
      : [];
    const showConfluencePreview = isConfluencePreview && confluencePreviewRows.length > 0;
    const selectedDatasetPreviewError = catalogPreviewState.previewError;
    const isPreviewingActive = Boolean(catalogDataset) && catalogPreviewState.previewing;
    const lastCollectionRun = catalogDataset?.lastCollectionRun ?? null;
    const shouldShowEmptyPreview = !showConfluencePreview && (previewRows.length === 0 || !canPreviewDataset);
    const previewEmptyMessage = !canPreviewDataset
      ? previewStatusMessage ?? catalogPreviewState.previewBlockReason ?? "Preview disabled for this dataset."
      : previewStatusMessage ??
        (isPreviewingActive ? "Collecting sample rows…" : "No preview sampled yet. Run a preview to inspect live data.");
    const shouldRenderEmptyMessage = shouldShowEmptyPreview;
    const profileBlockReason =
      (selectedDatasetEndpoint && declaresEndpointCapabilities && !endpointSupportsProfile
        ? `Dataset profiles disabled: ${selectedDatasetEndpoint.name} is missing the "profile" capability.`
        : null) ??
      (!hasLinkedEndpoint && catalogDataset ? "Link this dataset to a registered endpoint before profiling." : null);

    return (
      <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900" data-testid="metadata-dataset-detail">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">Datasets</p>
            <p className="text-xs text-slate-500">Search catalog entries ingested from the metadata service.</p>
          </div>
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">Filter</p>
              <div className="mt-3 space-y-3">
                <div className="relative">
                  <LuSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <label htmlFor="metadata-catalog-search" className="sr-only">
                    Search name, label, or source
                  </label>
                  <input
                    id="metadata-catalog-search"
                    value={metadataCatalogSearch}
                    onChange={(event) => setMetadataCatalogSearch(event.target.value)}
                    placeholder="Search name, label, or source"
                    className="w-full rounded-2xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                {activeFilterChips.length ? (
                  <div className="flex flex-wrap gap-2">
                    {activeFilterChips.map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={chip.onClear}
                        className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                      >
                        {chip.label}
                        <span aria-hidden="true">×</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setMetadataCatalogSearch("");
                        handleSelectEndpointFilter("all");
                        setMetadataCatalogLabelFilter("all");
                      }}
                      className="rounded-full border border-transparent px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 hover:text-slate-900 dark:text-slate-300"
                    >
                      Clear all
                    </button>
                  </div>
                ) : null}
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="relative" ref={endpointPickerRef}>
                    <label className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">Endpoint</label>
                    <div className="relative mt-1">
                      <input
                        data-testid="metadata-catalog-filter-endpoint"
                        type="text"
                        role="combobox"
                        aria-expanded={metadataEndpointPickerOpen}
                        aria-haspopup="listbox"
                        aria-controls="metadata-endpoint-picker-list"
                        value={metadataEndpointPickerQuery}
                        onFocus={() => setMetadataEndpointPickerOpen(true)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setMetadataEndpointPickerOpen(false);
                          }
                          if (event.key === "ArrowDown" && !metadataEndpointPickerOpen) {
                            setMetadataEndpointPickerOpen(true);
                          }
                        }}
                        onChange={(event) => {
                          setMetadataEndpointPickerQuery(event.target.value);
                          setMetadataEndpointPickerOpen(true);
                        }}
                        placeholder="Search or select endpoint"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                      {metadataCatalogEndpointFilter !== "all" ? (
                        <button
                          type="button"
                          onClick={() => handleSelectEndpointFilter("all")}
                          data-testid="metadata-catalog-endpoint-clear"
                          className="absolute inset-y-0 right-2 my-auto rounded-full border border-transparent px-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 hover:text-slate-900 dark:text-slate-200"
                        >
                          Clear
                        </button>
                      ) : null}
                      {metadataEndpointPickerOpen ? (
                        <div
                          id="metadata-endpoint-picker-list"
                          className="absolute left-0 right-0 top-full z-40 mt-2 rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
                        >
                          <div className="flex flex-col gap-1 border-b border-slate-100 p-2 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-200">
                            <button
                              type="button"
                              onClick={() => handleSelectEndpointFilter("all")}
                              className="rounded-xl px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              All endpoints
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSelectEndpointFilter("unlinked")}
                              className="rounded-xl px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              Unlinked datasets
                            </button>
                          </div>
                          <div className="max-h-56 overflow-y-auto">
                            {metadataEndpointPickerLoading ? (
                              <p className="px-3 py-2 text-xs text-slate-500">Loading endpoints…</p>
                            ) : metadataEndpointPickerOptions.length === 0 ? (
                              <p className="px-3 py-2 text-xs text-slate-500">
                                No endpoints match “{metadataEndpointPickerQuery.trim()}”.
                              </p>
                            ) : (
                              metadataEndpointPickerOptions.map((endpoint) => (
                                <button
                                  key={endpoint.id}
                                  type="button"
                                  onClick={() => handleSelectEndpointFilter(endpoint.id, { label: endpoint.name })}
                                  data-testid="metadata-endpoint-option"
                                  data-endpoint-id={endpoint.id}
                                  className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                                >
                                  <span className="font-medium">{endpoint.name}</span>
                                  {endpoint.capabilities?.length ? (
                                    <span className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
                                      {endpoint.capabilities.join(", ")}
                                    </span>
                                  ) : null}
                                </button>
                              ))
                            )}
                          </div>
                          {metadataEndpointPickerPageInfo.hasNextPage ? (
                            <button
                              type="button"
                              onClick={() => fetchMoreMetadataEndpointOptions()}
                              className="w-full border-t border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300"
                            >
                              Load more sources
                            </button>
                          ) : null}
                          <div className="border-t border-slate-100 px-3 py-2 text-right dark:border-slate-800">
                            <button
                              type="button"
                              onClick={() => refreshMetadataEndpointOptions()}
                              className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 hover:text-slate-900 dark:text-slate-300"
                            >
                              Refresh list
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">Label</label>
                    <select
                      data-testid="metadata-catalog-filter-label"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      value={metadataCatalogLabelFilter}
                      onChange={(event) => setMetadataCatalogLabelFilter(event.target.value)}
                    >
                      {labelFilterOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="scrollbar-thin mt-4 max-h-[calc(100vh-320px)] overflow-y-auto pr-1">
            {catalogDatasetsError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-4 text-xs text-rose-700 dark:border-rose-500/60 dark:bg-rose-950/40 dark:text-rose-200">
                <p>{catalogDatasetsError}</p>
                <button
                  type="button"
                  onClick={() => refreshCatalogDatasets()}
                  className="mt-2 rounded-full border border-rose-300 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-rose-600 hover:bg-rose-100 dark:border-rose-400/60 dark:text-rose-200"
                >
                  Retry loading datasets
                </button>
              </div>
            ) : metadataCatalogFilteredDatasets.length === 0 ? (
              <p
                className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-xs text-slate-500 dark:border-slate-700"
                data-testid="metadata-catalog-empty"
              >
                {metadataCatalogSearch.trim().length > 0 || metadataCatalogLabelFilter !== "all" || metadataCatalogEndpointFilter !== "all"
                  ? "No datasets match the current filters."
                  : catalogDatasetsLoading
                    ? "Loading datasets…"
                    : "No datasets were ingested yet. Trigger a collection run to add catalog entries."}
              </p>
            ) : (
              <>
                {metadataCatalogFilteredDatasets.map((dataset) => {
                  const isActive = metadataCatalogSelectedDataset?.id === dataset.id;
                  const owner = dataset.sourceEndpointId ? metadataEndpointLookup.get(dataset.sourceEndpointId) : null;
                  return (
                    <button
                      key={dataset.id}
                      type="button"
                      onClick={() => setMetadataCatalogSelection(dataset.id)}
                      data-testid="metadata-catalog-card"
                      className={`mb-2 flex w-full flex-col rounded-2xl border px-3 py-2 text-left transition ${
                        isActive
                          ? "border-slate-900 bg-slate-900 text-white shadow dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      }`}
                    >
                      <span className="text-sm font-semibold">{dataset.displayName}</span>
                      <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">
                        {owner ? `Endpoint · ${owner.name}` : "Unlinked"}
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
                        {dataset.labels?.length ? `Labels · ${dataset.labels.slice(0, 3).join(", ")}` : dataset.source ?? dataset.id}
                      </span>
                    </button>
                  );
                })}
                {catalogDatasetsLoading ? (
                  <p className="text-xs text-slate-500">Loading more datasets…</p>
                ) : null}
                {catalogDatasetsPageInfo.hasNextPage ? (
                  <button
                    type="button"
                    onClick={() => fetchMoreCatalogDatasets()}
                    disabled={catalogDatasetsLoading}
                    className="mt-2 w-full rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200"
                  >
                    Load more datasets
                  </button>
                ) : null}
              </>
            )}
          </div>
        </section>
        <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {catalogDataset ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xl font-semibold text-slate-900 dark:text-white">{catalogDataset.displayName}</p>
                  {catalogDatasetDisplayId ? (
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{catalogDatasetDisplayId}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenDatasetDetail(catalogDataset.id)}
                    disabled={pendingDatasetNavigationId === catalogDataset.id}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200"
                  >
                    {pendingDatasetNavigationId === catalogDataset.id ? (
                      <>
                        <LuHistory className="h-4 w-4 animate-spin" />
                        Opening…
                      </>
                    ) : (
                      "View detail"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePreviewMetadataDataset(catalogDataset.id)}
                    className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] transition ${
                      canPreviewDataset
                        ? "border-slate-300 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                        : "border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-600"
                    }`}
                    disabled={!canPreviewDataset || isPreviewingActive}
                    data-testid="metadata-preview-button"
                  >
                    {isPreviewingActive ? <LuHistory className="h-3 w-3 animate-spin" /> : <LuTable className="h-3 w-3" />}
                    {isPreviewingActive ? "Fetching…" : "Preview dataset"}
                  </button>
                </div>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">{catalogDataset.description ?? "No description provided."}</p>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span>Endpoint · {selectedDatasetEndpoint?.name ?? "Unlinked"}</span>
                {catalogDataset.collectedAt ? <span>Collected {formatDateTime(catalogDataset.collectedAt)}</span> : null}
                {lastCollectionRun ? (
                  <span>
                    Last collection · {lastCollectionRun.status}{" "}
                    {lastCollectionRun.completedAt ? formatDateTime(lastCollectionRun.completedAt) : ""}
                  </span>
                ) : null}
              </div>
              {catalogDataset.labels?.length ? (
                <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.3em] text-slate-500">
                  {catalogDataset.labels.map((label: string) => (
                    <span key={label} className="rounded-full border border-slate-300 px-2 py-0.5 dark:border-slate-600">
                      {label}
                    </span>
                  ))}
                </div>
              ) : null}
              <IngestionSummaryCard dataset={catalogDataset} className="mt-4" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Fields ({catalogDatasetFields.length})</p>
                <div className="mt-3 space-y-2">
                  {catalogDatasetFields.map((field) => (
                    <div key={field.name} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-slate-900 dark:text-slate-100">{field.name}</p>
                        <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">{field.type}</span>
                      </div>
                      {field.description ? <p className="text-xs text-slate-500 dark:text-slate-400">{field.description}</p> : null}
                    </div>
                  ))}
                  {catalogDatasetFields.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-300 px-4 py-4 text-xs text-slate-500 dark:border-slate-700">
                      No field metadata discovered yet.
                    </p>
                  ) : null}
                </div>
              </div>
              {datasetDetailLoading ? (
                <p className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700">
                  Loading dataset metadata…
                </p>
              ) : null}
              {datasetDetailError ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-400/60 dark:bg-rose-950/40 dark:text-rose-200">
                  {datasetDetailError}
                </p>
              ) : null}
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Preview</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {catalogPreviewState.sampledAt ? (
                    <span className="text-xs text-slate-500 dark:text-slate-300">
                      Sampled {formatRelativeTime(catalogPreviewState.sampledAt)}
                    </span>
                  ) : previewStatusMessage ? (
                    <span
                      className={`text-xs ${
                        previewStatusTone === "warn" ? "text-rose-600 dark:text-rose-300" : "text-slate-500 dark:text-slate-300"
                      }`}
                    >
                      {previewStatusMessage}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500 dark:text-slate-300">
                      Preview pulls 20 live rows per request.
                    </span>
                  )}
                </div>
                {shouldRenderEmptyMessage ? (
                  <p
                    className={`mt-2 text-xs ${
                      previewStatusTone === "warn" ? "text-rose-600 dark:text-rose-300" : "text-slate-500 dark:text-slate-300"
                    }`}
                  >
                    {previewEmptyMessage}
                  </p>
                ) : null}
                {selectedDatasetPreviewError ? (
                  <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-400/60 dark:bg-rose-950/40 dark:text-rose-200">
                    {selectedDatasetPreviewError}
                  </p>
                ) : null}
                {showConfluencePreview ? (
                  <div className="mt-3 space-y-3" data-testid="metadata-confluence-preview">
                    {confluencePreviewRows.slice(0, 3).map((row, index) => {
                      const excerpt = extractConfluenceExcerpt(row.excerpt);
                      const displayTitle = row.title ?? row.pageId ?? `Confluence page ${index + 1}`;
                      return (
                        <article
                          key={`${row.pageId ?? row.url ?? index}`}
                          className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/60"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold text-slate-900 dark:text-slate-100">{displayTitle}</p>
                              {row.spaceKey ? (
                                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                                  Space · {row.spaceKey}
                                </p>
                              ) : null}
                            </div>
                            {row.updatedAt ? (
                              <span className="text-xs text-slate-500 dark:text-slate-300">
                                {formatDateTime(row.updatedAt)}
                              </span>
                            ) : null}
                          </div>
                          {excerpt ? (
                            <p className="mt-3 text-sm text-slate-600 dark:text-slate-200">{excerpt}</p>
                          ) : null}
                          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-300">
                            {row.updatedBy ? <span>Updated by {row.updatedBy}</span> : null}
                            {row.url ? (
                              <a
                                href={row.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-slate-900 hover:underline dark:text-slate-100"
                              >
                                <LuArrowUpRight className="h-3 w-3" />
                                View in Confluence
                              </a>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : previewRows.length ? (
                  <div
                    className="mt-3 w-full max-h-64 max-w-full overflow-x-auto overflow-y-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                    data-testid="metadata-preview-table"
                  >
                    <table className="min-w-full divide-y divide-slate-200 text-xs dark:divide-slate-700">
                      <thead className="bg-slate-50 text-left font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                        <tr>
                          {previewColumns.map((column) => (
                            <th key={column} className="px-3 py-2 uppercase tracking-[0.3em] text-[10px] text-slate-400">
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, index) => (
                          <tr key={index} className="border-t border-slate-100 dark:border-slate-800">
                            {previewColumns.map((column) => (
                              <td
                                key={column}
                                className="px-3 py-2 text-slate-700 dark:text-slate-200 break-words whitespace-pre-wrap"
                              >
                                {formatPreviewValue((row as Record<string, unknown>)[column])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : shouldRenderEmptyMessage ? (
                  <p
                    className={`mt-2 text-xs ${
                      previewStatusTone === "warn" ? "text-rose-600 dark:text-rose-300" : "text-slate-500 dark:text-slate-300"
                    }`}
                    data-testid="metadata-preview-empty"
                  >
                    {previewEmptyMessage}
                  </p>
                ) : null}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Profile</p>
                {profileBlockReason ? (
                  <p className="mt-2 rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-300">
                    {profileBlockReason}
                  </p>
                ) : catalogDataset.profile ? (
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700">
                      <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Records</p>
                      <p className="text-base font-semibold text-slate-900 dark:text-white">
                        {catalogDataset.profile.recordCount ?? "—"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700">
                      <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Sample size</p>
                      <p className="text-base font-semibold text-slate-900 dark:text-white">
                        {catalogDataset.profile.sampleSize ?? "—"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700">
                      <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Profiled</p>
                      <p className="text-base font-semibold text-slate-900 dark:text-white">
                        {catalogDataset.profile.lastProfiledAt
                          ? formatDateTime(catalogDataset.profile.lastProfiledAt)
                          : "Not recorded"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500" data-testid="metadata-profile-empty">
                    Profiling not run yet. Trigger a collection to refresh dataset insights.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500 dark:border-slate-700" data-testid="metadata-dataset-empty">
              Select a dataset on the left to inspect its schema.
            </p>
          )}
        </section>
      </div>
    );
  };

  const renderEndpointRegistrationPage = () => (
    <div className="space-y-6" data-testid="metadata-register-form">
      <div className="grid gap-6 lg:grid-cols-[minmax(300px,340px),1fr]">
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">Select a template</p>
            <p className="text-xs text-slate-500">Choose a family, then pick a specific connector to configure.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {templateFamilies.map((family) => (
              <button
                key={family.id}
                type="button"
                onClick={() => setMetadataTemplateFamily(family.id)}
                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] ${
                  metadataTemplateFamily === family.id
                    ? "bg-slate-900 text-white dark:bg-emerald-500 dark:text-slate-900"
                    : "border border-slate-300 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300"
                }`}
              >
                {family.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            {templateFamilies.find((family) => family.id === metadataTemplateFamily)?.description ?? ""}
          </p>
          <div className="space-y-2">
            {metadataTemplatesError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100">
                <p>{metadataTemplatesError}</p>
                <button
                  type="button"
                  onClick={handleRetryLoadTemplates}
                  className="mt-2 rounded-full border border-rose-300 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-rose-700 hover:bg-rose-100 dark:border-rose-400/60 dark:text-rose-200"
                >
                  Retry
                </button>
              </div>
            ) : null}
            {metadataTemplatesLoading && metadataTemplates.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500 dark:border-slate-700">
                Loading templates…
              </p>
            ) : filteredTemplates.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500 dark:border-slate-700">
                No templates found for this family yet.
              </p>
            ) : (
              filteredTemplates.map((template) => {
                const isActive = selectedTemplate?.id === template.id;
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => setSelectedTemplateId(template.id)}
                    className={`w-full rounded-2xl border px-3 py-2 text-left transition ${
                      isActive
                        ? "border-slate-900 bg-slate-900 text-white shadow dark:border-emerald-400/70 dark:bg-emerald-500/10 dark:text-emerald-100"
                        : "border-slate-200 text-slate-700 hover:border-slate-900 dark:border-slate-700 dark:text-slate-200"
                    }`}
                  >
                    <p className="text-sm font-semibold">{template.title}</p>
                    <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">{template.vendor}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{template.description}</p>
                  </button>
                );
              })
            )}
          </div>
          {selectedTemplate ? (
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">Agent briefing</p>
              <p className="whitespace-pre-wrap">{selectedTemplate.agentPrompt ?? "Collect credentials and scope for this endpoint."}</p>
              {selectedTemplate.capabilities?.length ? (
                <ul className="list-disc space-y-1 pl-4">
                  {Array.from(new Map(selectedTemplate.capabilities.map((capability) => [capability.key, capability])).values()).map((capability) => (
                    <li key={capability.key}>{capability.label}</li>
                  ))}
                </ul>
              ) : null}
              {selectedTemplate.connection?.urlTemplate ? (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">Connection template</p>
                  <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-900/90 p-3 font-mono text-[12px] text-emerald-200 dark:bg-slate-950">
                    {selectedTemplate.connection.urlTemplate}
                  </pre>
                </div>
              ) : null}
              {selectedTemplate.probing?.methods?.length ? (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">Version detection</p>
                  <ul className="mt-2 space-y-2">
                    {selectedTemplate.probing.methods.map((method) => (
                      <li key={method.key} className="rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-800">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {method.label} <span className="text-xs uppercase tracking-[0.3em] text-slate-400">({method.strategy})</span>
                        </p>
                        {method.description ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400">{method.description}</p>
                        ) : null}
                        {method.requires && method.requires.length ? (
                          <p className="text-[11px] text-slate-500">Requires: {method.requires.join(", ")}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {selectedTemplate.probing.fallbackMessage ? (
                    <p className="mt-2 text-[11px] text-slate-500">{selectedTemplate.probing.fallbackMessage}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {!selectedTemplate ? (
            <p className="text-sm text-slate-500">Select a template to configure connection details.</p>
              ) : (
                <>
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">{formTitle}</p>
                    <p className="text-sm text-slate-500">
                      {metadataFormMode === "edit"
                        ? "Update the endpoint details and re-test the connection whenever credentials change."
                        : "Select a template, provide connection parameters, and register the endpoint after a passing test."}
                    </p>
                  </div>
                  {metadataMutationError ? (
                    <p
                      className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/50 dark:bg-rose-950/40 dark:text-rose-200"
                      data-testid="metadata-mutation-error"
                    >
                      {metadataMutationError}
                    </p>
                  ) : null}
                  <form className="space-y-4" onSubmit={handleSubmitMetadataEndpoint}>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                        Endpoint name
                    <input
                      value={metadataEndpointName}
                      onChange={(event) => setMetadataEndpointName(event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                    Labels
                    <input
                      value={metadataEndpointLabels}
                      onChange={(event) => setMetadataEndpointLabels(event.target.value)}
                      placeholder="analytics, postgres, staging"
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </label>
                </div>
                <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                  Description
                  <textarea
                    value={metadataEndpointDescription}
                    onChange={(event) => setMetadataEndpointDescription(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    rows={2}
                  />
                </label>
                <div className="space-y-3">
                  {(selectedTemplate.id === "http.onedrive"
                    ? [...selectedTemplate.fields].sort((a, b) => {
                        const onedriveFieldOrder: Record<string, number> = {
                          auth_mode: 10,
                          drive_id: 20,
                          root_path: 30,
                          include_file_types: 40,
                          exclude_patterns: 50,
                          base_url: 60,
                          tenant_id: 70,
                          client_id: 80,
                          client_secret: 90,
                          delegated_connected: 100,
                        };
                        const aScore = onedriveFieldOrder[a.key] ?? 1000;
                        const bScore = onedriveFieldOrder[b.key] ?? 1000;
                        return aScore - bScore;
                      })
                    : selectedTemplate.fields
                  ).map((field) => {
                    if (!isFieldVisible(field)) {
                      return null;
                    }
                    const value = metadataTemplateValues[field.key] ?? field.defaultValue ?? "";
                    const required = isFieldRequired(field);
                    const commonProps = {
                      id: `template-${field.key}`,
                      value,
                      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
                        handleRequirementChange(field.key, event.target.value),
                      required,
                      className:
                        "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
                    };
                    const inputType =
                      field.valueType === "PASSWORD"
                        ? "password"
                        : field.valueType === "NUMBER" || field.valueType === "PORT"
                          ? "number"
                          : "text";
                    const labelId = `template-${field.key}`;
                    const advancedBadge = field.advanced ? (
                      <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-slate-400 dark:border-slate-600">
                        Advanced
                      </span>
                    ) : null;
                    let control: JSX.Element;
                    if (field.valueType === "LIST") {
                      control = <textarea {...commonProps} placeholder={field.placeholder ?? undefined} rows={2} />;
                    } else if (field.valueType === "ENUM" && field.options) {
                      control = (
                        <select {...commonProps}>
                          <option value="">Select {field.label}</option>
                          {field.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      );
                    } else if (field.valueType === "JSON") {
                      control = <textarea {...commonProps} placeholder={field.placeholder ?? undefined} rows={3} />;
                    } else if (field.valueType === "TEXT") {
                      control = <textarea {...commonProps} placeholder={field.placeholder ?? undefined} rows={4} />;
                    } else if (field.valueType === "BOOLEAN") {
                      const checked = (value || "").toLowerCase() === "true";
                      control = (
                        <div className="mt-2 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
                          <input
                            id={labelId}
                            type="checkbox"
                            className="h-4 w-4 accent-slate-900 dark:accent-emerald-500"
                            checked={checked}
                            onChange={(event) => handleRequirementChange(field.key, event.target.checked ? "true" : "false")}
                          />
                          <span className="text-sm text-slate-700 dark:text-slate-200">
                            {checked ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                      );
                    } else {
                      control = (
                        <input
                          {...commonProps}
                          type={inputType}
                          placeholder={field.placeholder ?? undefined}
                          autoComplete={field.valueType === "PASSWORD" ? "current-password" : undefined}
                        />
                      );
                    }

                    return (
                      <div key={field.key}>
                        <div className="flex items-center justify-between gap-3">
                          <label
                            htmlFor={labelId}
                            className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500"
                          >
                            {field.label}
                            {!required ? " (optional)" : ""}
                          </label>
                          {advancedBadge}
                        </div>
                        {control}
                        {field.description ? (
                          <p className="mt-1 text-[11px] text-slate-500">{field.description}</p>
                        ) : field.helpText ? (
                          <p className="mt-1 text-[11px] text-slate-500">{field.helpText}</p>
                        ) : null}
                      </div>
                    );
                  })}
                    </div>
                    {selectedTemplate?.id === "http.onedrive" &&
                    (metadataTemplateValues.auth_mode ?? metadataTemplateValues.authMode) === "delegated" ? (
                      <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900/40">
                        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Delegated auth</p>
                        <p className="text-sm text-slate-700 dark:text-slate-200">
                          Status: {metadataEditingEndpoint?.delegatedConnected ? "Connected" : "Not connected yet"}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Client credential fields are hidden in delegated mode; save (test optional here) and click Connect to launch the browser sign-in.
                        </p>
                        {metadataOneDriveAuthError ? (
                          <p className="text-xs text-rose-600" data-testid="metadata-onedrive-auth-error">
                            {metadataOneDriveAuthError}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={handleStartOneDriveAuth}
                            className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] transition ${
                              metadataEditingEndpointId
                                ? "border-slate-300 text-slate-700 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                                : "border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500"
                            }`}
                          >
                            {metadataOneDriveAuthUrl ? "Re-open auth" : "Connect OneDrive"}
                          </button>
                          {metadataOneDriveAuthUrl ? (
                            <a
                              href={metadataOneDriveAuthUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full border border-emerald-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-700 transition hover:border-emerald-700 hover:text-emerald-900 dark:border-emerald-500/50 dark:text-emerald-200"
                            >
                              Open auth link
                            </a>
                          ) : null}
                        </div>
                        {!metadataEditingEndpointId ? (
                          <p className="text-xs text-slate-500">
                            Save the endpoint first, then click Connect to launch the delegated sign-in.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={handleTestMetadataEndpoint}
                        disabled={!canModifyEndpoints || metadataRegistering || metadataTesting}
                        className="flex-1 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200"
                      >
                        {metadataTesting ? "Testing…" : "Test connection"}
                      </button>
                      <button
                        type="submit"
                        disabled={submitDisabled}
                        className="flex-1 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold uppercase tracking-[0.3em] text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                      >
                        {submitButtonLabel}
                      </button>
                    </div>
                    {showRetestWarning ? (
                      <p className="text-xs text-amber-600">
                        Connection parameters changed. Re-run “Test connection” before saving.
                      </p>
                    ) : null}
                    {!canModifyEndpoints ? (
                      <p className="text-xs text-slate-500">Viewer access cannot register endpoints.</p>
                    ) : null}
                    {metadataTestResult ? (
                      <div
                    data-testid="metadata-test-result"
                    className={`rounded-2xl border px-3 py-3 text-xs ${
                      metadataTestResult.ok
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200"
                        : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200"
                    }`}
                  >
                    <p className="text-sm font-semibold">
                      {metadataTestResult.ok ? "Connection parameters validated." : "Connection test reported issues."}
                    </p>
                    {metadataTestResult.diagnostics.map((diagnostic, index) => (
                      <div key={`${diagnostic.code}-${index}`} className="mt-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.3em]">
                          {diagnostic.code} · {diagnostic.level}
                        </p>
                        <p className="text-sm">{diagnostic.message}</p>
                        {diagnostic.hint ? <p className="text-[11px] text-slate-700">{diagnostic.hint}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );

  const renderEndpointCardStatus = (run: MetadataCollectionRunSummary | undefined) => {
    if (!run) {
      return (
        <span
          data-testid="metadata-endpoint-status"
          data-status="none"
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 dark:border-slate-600"
        >
          No runs
        </span>
      );
    }
    const style = statusStyles[run.status];
    return (
      <span
        data-testid="metadata-endpoint-status"
        data-status={run.status.toLowerCase()}
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] ${style.badge}`}
        title={run.error ?? undefined}
      >
        <span className={`h-2 w-2 rounded-full ${style.dot}`} />
        {run.status.toLowerCase()}
        {run.completedAt ? <> · {formatRelativeTime(run.completedAt)}</> : null}
      </span>
    );
  };

  const renderEndpointsSection = () => {
    return (
      <div className="space-y-6">
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">Endpoints</p>
              <p className="text-xs text-slate-500">Search and page through registered sources.</p>
            </div>
            <div className="flex w-full flex-col gap-2 md:flex-1 md:flex-row md:items-center md:justify-end">
              <label htmlFor="metadata-endpoints-search" className="sr-only">
                Search endpoints
              </label>
              <input
                id="metadata-endpoints-search"
                type="search"
                value={metadataEndpointsSearch}
                onChange={(event) => setMetadataEndpointsSearch(event.target.value)}
                placeholder="Search endpoint name, URL, or description"
                data-testid="metadata-endpoints-search"
                className="min-w-[200px] flex-1 rounded-full border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={() => {
                  setMetadataEndpointsSearch("");
                  refreshMetadataEndpoints();
                }}
                className="rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => refreshMetadataEndpoints()}
                className="rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200"
                disabled={metadataEndpointsLoading}
              >
                Reload sources
              </button>
            </div>
          </div>
          {metadataEndpointsError ? (
            <p className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100">
              {metadataEndpointsError}
              <button
                type="button"
                onClick={() => refreshMetadataEndpoints()}
                className="ml-3 rounded-full border border-rose-300 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-rose-600 hover:bg-rose-100 dark:border-rose-400/60 dark:text-rose-200"
              >
                Retry
              </button>
            </p>
          ) : null}
          {metadataEndpoints.length === 0 && !metadataEndpointsLoading ? (
            <p
              className="rounded-2xl border border-dashed border-slate-300 px-6 py-6 text-sm text-slate-500 dark:border-slate-700"
              data-testid="metadata-endpoint-empty"
            >
              {metadataEndpointsSearch.trim().length > 0
                ? "No endpoints match the current search."
                : "No metadata endpoints have been registered yet."}
            </p>
          ) : null}
        {metadataEndpoints.map((endpoint) => {
          const collection = metadataCollectionsByEndpoint.get(endpoint.id);
          const latestRun = metadataLatestRunByEndpoint.get(endpoint.id);
          const declaredCapabilities = endpoint.capabilities ?? [];
          const hasDeclaredCapabilities = declaredCapabilities.length > 0;
          const supportsMetadataCapability =
            !hasDeclaredCapabilities || declaredCapabilities.includes("metadata");
          const supportsPreviewCapability =
            !hasDeclaredCapabilities || declaredCapabilities.includes("preview");
          const capabilityBlockedReason =
            hasDeclaredCapabilities && !supportsMetadataCapability
              ? "Metadata collections disabled: this endpoint is missing the \"metadata\" capability."
              : null;
          const collectionBlockedReason =
            collection && !collection.isEnabled
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
        return (
          <article
            key={endpoint.id}
            data-testid="metadata-endpoint-card"
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1">
                <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">{endpoint.name}</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">{endpoint.description ?? endpoint.url}</p>
                {endpoint.config && typeof endpoint.config === "object" ? (
                  (() => {
                    const parameters =
                      (endpoint.config as Record<string, unknown>).parameters && typeof (endpoint.config as Record<string, unknown>).parameters === "object"
                        ? ((endpoint.config as Record<string, unknown>).parameters as Record<string, unknown>)
                        : null;
                    const authMode =
                      typeof parameters?.auth_mode === "string"
                        ? parameters.auth_mode
                        : typeof parameters?.authMode === "string"
                          ? parameters.authMode
                          : null;
                    if (authMode && authMode.toLowerCase() === "delegated") {
                      return (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-emerald-200 px-2 py-0.5 text-[11px] uppercase tracking-[0.3em] text-emerald-700 dark:border-emerald-500/50 dark:text-emerald-200">
                          Delegated {endpoint.delegatedConnected ? "connected" : "pending"}
                        </span>
                      );
                    }
                    return null;
                  })()
                ) : null}
                {endpoint.detectedVersion ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">Detected version · {endpoint.detectedVersion}</p>
                ) : endpoint.versionHint ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">Version hint · {endpoint.versionHint}</p>
                ) : null}
                </div>
                {renderEndpointCardStatus(latestRun)}
                <button
                  type="button"
                  onClick={() => setMetadataEndpointDetailId(endpoint.id)}
                  className="rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300"
                >
                  Details
                </button>
              </div>
              {latestRun?.status === "SKIPPED" ? (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-300" data-testid="metadata-endpoint-skip">
                  {latestRun.error ?? "Collection skipped due to missing capability."}
                </p>
              ) : null}
              {latestRun?.status === "FAILED" ? (
                <p className="mt-2 text-xs text-rose-600 dark:text-rose-300" data-testid="metadata-endpoint-error">
                  {latestRun.error ?? "Collection failed. Check endpoint configuration."}
                </p>
              ) : null}
              <p className="mt-3 break-all text-xs font-mono text-slate-500 dark:text-slate-400">{endpoint.url}</p>
              {endpoint.domain ? (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Domain · {endpoint.domain}</p>
              ) : null}
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Collection schedule ·{" "}
                {collection?.scheduleCron
                  ? `${collection.scheduleCron} (${collection.scheduleTimezone ?? "UTC"})`
                  : "Manual only"}
              </p>
              {endpoint.labels?.length ? (
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.3em] text-slate-500">
                  {endpoint.labels.map((label) => (
                    <span key={label} className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-600">
                      {label}
                    </span>
                  ))}
                </div>
              ) : null}
              {endpoint.capabilities?.length ? (
                <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.3em] text-slate-400">
                  {Array.from(new Set(endpoint.capabilities)).map((capability) => (
                    <span key={capability} className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-600">
                      {capability}
                    </span>
                  ))}
                </div>
              ) : null}
              {capabilityBlockedReason ? (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
                  {capabilityBlockedReason}
                </div>
              ) : null}
              {collectionBlockedReason && !capabilityBlockedReason ? (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
                  {collectionBlockedReason}
                </div>
              ) : null}
              {previewBlockedReason ? (
                <div className="mt-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-100">
                  {previewBlockedReason}
                </div>
              ) : null}
              <div className="mt-4 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                <label className="text-[10px] font-semibold uppercase tracking-[0.35em] text-slate-500">Schema override</label>
                <input
                  value={metadataRunOverrides[endpoint.id] ?? ""}
                  onChange={(event) =>
                    setMetadataRunOverrides((prev) => ({
                      ...prev,
                      [endpoint.id]: event.target.value,
                    }))
                  }
                  placeholder="public, analytics"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => handleTriggerMetadataRun(endpoint.id)}
                  data-testid={`metadata-endpoint-trigger-${endpoint.id}`}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.3em] transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    canTriggerCollection
                      ? "border-slate-300 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                      : "border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-600"
                  }`}
                  disabled={!canTriggerCollection || isTriggerPending}
                  title={triggerBlockedReason ?? undefined}
                >
                  {isTriggerPending ? (
                    <>
                      <LuHistory className="h-4 w-4 animate-spin" />
                      Triggering…
                    </>
                  ) : (
                    <>
                      <LuSquarePlus className="h-4 w-4" />
                      Trigger collection
                    </>
                  )}
                </button>
              </div>
            </article>
          );
        })}
        {metadataEndpointsLoading ? (
          <p className="text-xs text-slate-500" data-testid="metadata-endpoint-loading">
            Loading endpoints…
          </p>
        ) : null}
        {metadataEndpointsPageInfo.hasNextPage ? (
          <button
            type="button"
            onClick={() => fetchMoreMetadataEndpoints()}
            disabled={metadataEndpointsLoading}
            className="w-full rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200"
          >
            Load more sources
          </button>
        ) : null}
        <section
          className="mt-6 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          data-testid="metadata-graph-nodes"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-[200px] flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Graph identities</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Manage knowledge base nodes and edges from the dedicated console.
              </p>
            </div>
            <a
              href="/kb/explorer/nodes"
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
            >
              Open Knowledge Base
            </a>
          </div>
        </section>
        </section>
      </div>
    );
  };

  const renderCollectionsSection = () => {
    const endpointFilterOptions = [{ id: "all", name: "All endpoints" }, ...metadataEndpoints.map((endpoint) => ({ id: endpoint.id, name: endpoint.name }))];
    const hasActiveRunFilter =
      metadataCollectionsEndpointFilter !== "all" || metadataCollectionsStatusFilter !== "all";
    const filterControls = (
      <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-1 min-w-[180px] flex-col text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            Endpoint filter
            <select
              data-testid="metadata-collections-filter-endpoint"
              value={metadataCollectionsEndpointFilter}
              onChange={(event) => setMetadataCollectionsEndpointFilter(event.target.value)}
              className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {endpointFilterOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 min-w-[180px] flex-col text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            Status filter
            <select
              data-testid="metadata-collections-filter-status"
              value={metadataCollectionsStatusFilter}
              onChange={(event) => setMetadataCollectionsStatusFilter(event.target.value)}
              className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="all">All statuses</option>
              {COLLECTION_STATUS_VALUES.map((status) => (
                <option key={status} value={status}>
                  {status.toLowerCase()}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    );
    if (metadataRunsLoading && !metadataRunsLoaded) {
      return (
        <div className="space-y-4" data-testid="metadata-collections-panel">
          {filterControls}
          <p className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
            <LuHistory className="h-4 w-4 animate-spin" />
            Loading collection runs…
          </p>
        </div>
      );
    }
    if (metadataRunsError) {
      return (
        <div className="space-y-4" data-testid="metadata-collections-panel">
          {filterControls}
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-950/40 dark:text-rose-200">
            <p>{metadataRunsError}</p>
            <button
              type="button"
              onClick={refreshMetadataRuns}
              className="mt-2 rounded-full border border-rose-300 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-rose-700 hover:bg-rose-100 dark:border-rose-400/60 dark:text-rose-200"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-4" data-testid="metadata-collections-panel">
        {filterControls}
        {metadataRunsLoading && metadataRunsLoaded ? (
          <p className="text-xs text-slate-500">Refreshing run history…</p>
        ) : null}
        {sortedMetadataRuns.length === 0 ? (
          <p
            className="rounded-2xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500 dark:border-slate-700"
            data-testid="metadata-collections-empty"
          >
            {hasActiveRunFilter
              ? "No collection runs match the selected filters."
              : "No collection runs recorded yet. Trigger a run from the endpoint cards."}
          </p>
        ) : (
          sortedMetadataRuns.map((run) => (
            <article
              key={run.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
              data-testid="metadata-collection-card"
              data-endpoint-id={run.endpoint?.id ?? "unknown"}
              data-status={(run.status ?? "UNKNOWN").toUpperCase()}
              data-run-id={run.id}
            >
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                <span>{run.status}</span>
                <span>· Requested {formatDateTime(run.requestedAt)}</span>
              </div>
              <p className="mt-1 text-base font-medium text-slate-900 dark:text-white">{run.endpoint?.name ?? "Unknown endpoint"}</p>
              <div className="mt-2 grid gap-1 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-3">
                <span>Started: {run.startedAt ? formatDateTime(run.startedAt) : "—"}</span>
                <span>Completed: {run.completedAt ? formatDateTime(run.completedAt) : "—"}</span>
                <span>Run ID: {run.id}</span>
              </div>
              <div className="mt-2 grid gap-1 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-3">
                <span>Collection: {run.collection?.id ?? "—"}</span>
                <span>Endpoint ID: {run.endpoint?.id ?? "—"}</span>
                <span>Requested by: {run.requestedBy ?? "unknown"}</span>
              </div>
              {Array.isArray((run.filters as { schemas?: string[] } | undefined)?.schemas) &&
              ((run.filters as { schemas?: string[] }).schemas?.length ?? 0) > 0 ? (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Schemas: {(run.filters as { schemas?: string[] }).schemas!.join(", ")}
                </p>
              ) : null}
              {run.error ? (
                <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-400/60 dark:bg-rose-950/40 dark:text-rose-200">
                  {run.error}
                </p>
              ) : null}
              {run.endpoint?.id ? (
                <div className="mt-3">
                  <button
                    data-testid="metadata-collections-view-endpoint"
                    type="button"
                    onClick={() => handleViewEndpointFromCollections(run.endpoint?.id ?? null)}
                    disabled={pendingEndpointNavigationId === run.endpoint?.id}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200"
                  >
                    {pendingEndpointNavigationId === run.endpoint?.id ? (
                      <>
                        <LuHistory className="h-3 w-3 animate-spin" />
                        Opening…
                      </>
                    ) : (
                      "View endpoint"
                    )}
                  </button>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>
    );
  };

  const renderDatasetDetailPage = () => {
    if (!datasetDetailRouteId) {
      return null;
    }
    if (detailDataset === null && datasetDetailLoading) {
      return (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900">
          Loading dataset detail…
        </div>
      );
    }
    if (!detailDataset) {
      return (
        <div className="space-y-4 rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-950/40 dark:text-rose-200">
          <p>{datasetDetailError ?? "Dataset not found in this project."}</p>
          <button
            type="button"
            onClick={() => updateDatasetDetailId(null)}
            className="rounded-full border border-rose-400 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em]"
          >
            Back to catalog
          </button>
        </div>
      );
    }
    const detailDatasetFields = detailDataset.fields ?? [];

    return (
      <div className="space-y-6" data-testid="metadata-dataset-detail-page">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Dataset detail</p>
            <p className="text-2xl font-semibold text-slate-900 dark:text-white">{detailDataset.displayName}</p>
            {detailDatasetDisplayId ? (
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{detailDatasetDisplayId}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => updateDatasetDetailId(null)}
            className="rounded-full border border-slate-300 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
          >
            Back to catalog
          </button>
        </div>
        <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span>Endpoint · {detailOwner?.name ?? "Unlinked"}</span>
              {detailDataset.schema ? <span>Schema · {detailDataset.schema}</span> : null}
              {detailDataset.entity ? <span>Entity · {detailDataset.entity}</span> : null}
              {detailDataset.collectedAt ? <span>Collected {formatDateTime(detailDataset.collectedAt)}</span> : null}
            </div>
            {detailLastCollectionRun ? (
              <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                <span>
                  Last collection · {detailLastCollectionRun.status}{" "}
                  {detailLastCollectionRun.completedAt ? formatDateTime(detailLastCollectionRun.completedAt) : ""}
                </span>
              </div>
            ) : null}
            {detailDataset.labels?.length ? (
              <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.3em] text-slate-500">
                {detailDataset.labels.map((label) => (
                  <span key={label} className="rounded-full border border-slate-300 px-2 py-0.5 dark:border-slate-600">
                    {label}
                  </span>
                ))}
              </div>
            ) : null}
            <IngestionSummaryCard dataset={detailDataset} className="mt-4" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                Fields ({detailDatasetFields.length})
              </p>
              <div className="mt-2 space-y-2">
                {detailDatasetFields.map((field) => (
                  <div key={field.name} className="rounded-2xl border border-slate-200 px-3 py-2 dark:border-slate-700">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-900 dark:text-slate-100">{field.name}</span>
                      <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">{field.type}</span>
                    </div>
                    {field.description ? <p className="text-xs text-slate-500 dark:text-slate-400">{field.description}</p> : null}
                  </div>
                ))}
                {detailDatasetFields.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-300 px-4 py-4 text-xs text-slate-500 dark:border-slate-700">
                    No field metadata discovered yet.
                  </p>
                ) : null}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Preview</p>
              {detailSampledAt ? (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">
                  Sampled {formatRelativeTime(detailSampledAt)}
                </p>
              ) : detailPreviewStatusMessage ? (
                <p
                  className={`mt-2 text-xs ${
                    detailPreviewStatusTone === "warn" ? "text-rose-600 dark:text-rose-300" : "text-slate-500 dark:text-slate-300"
                  }`}
                >
                  {detailPreviewStatusMessage}
                </p>
              ) : (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-300">Preview pulls 20 live rows per request.</p>
              )}
              {detailPreviewError ? (
                <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-400/60 dark:bg-rose-950/40 dark:text-rose-200">
                  {detailPreviewError}
                </p>
              ) : null}
                {detailPreviewRows.length ? (
                  <div className="mt-3 w-full max-h-72 max-w-full overflow-x-auto overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700">
                  <table className="min-w-full divide-y divide-slate-200 text-xs dark:divide-slate-700">
                    <thead className="bg-slate-50 text-left font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                      <tr>
                        {detailPreviewColumns.map((column) => (
                          <th key={column} className="px-3 py-2 uppercase tracking-[0.3em] text-[10px] text-slate-400">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detailPreviewRows.map((row, index) => (
                        <tr key={index} className="border-t border-slate-100 dark:border-slate-800">
                          {detailPreviewColumns.map((column) => (
                              <td
                                key={column}
                                className="px-3 py-2 text-slate-700 dark:text-slate-200 break-words whitespace-pre-wrap"
                              >
                                {formatPreviewValue((row as Record<string, unknown>)[column])}
                              </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p
                  className={`mt-2 text-xs ${
                    detailPreviewStatusTone === "warn" ? "text-rose-600 dark:text-rose-300" : "text-slate-500 dark:text-slate-300"
                  }`}
                >
                  {detailPreviewing
                    ? "Collecting sample rows…"
                    : detailPreviewStatusMessage ?? "No preview sampled yet. Run a preview to inspect live data."}
                </p>
              )}
              <button
                type="button"
                onClick={() => handlePreviewMetadataDataset(detailDataset.id)}
                disabled={!detailCanPreview || detailPreviewing}
                className={`mt-3 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] transition ${
                  detailCanPreview
                    ? "border-slate-300 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                    : "border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-600"
                }`}
              >
                {detailPreviewing ? <LuHistory className="h-3 w-3 animate-spin" /> : <LuTable className="h-3 w-3" />}
                {detailPreviewing ? "Fetching…" : "Preview dataset"}
              </button>
            </div>
          </section>
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Profile</p>
              {detailProfileBlockReason ? (
                <p className="mt-2 text-xs text-slate-500">{detailProfileBlockReason}</p>
              ) : detailDataset.profile ? (
                <div className="mt-3 space-y-2 text-xs text-slate-500 dark:text-slate-300">
                  <p>Record count · {detailDataset.profile.recordCount ?? "—"}</p>
                  <p>Sample size · {detailDataset.profile.sampleSize ?? "—"}</p>
                  <p>
                    Last profiled ·{" "}
                    {detailDataset.profile.lastProfiledAt ? formatDateTime(detailDataset.profile.lastProfiledAt) : "Not recorded"}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-500" data-testid="metadata-profile-empty">
                  Profiling not run yet. Trigger a collection to refresh dataset insights.
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Notes</p>
              <p className="mt-2 text-xs text-slate-500">
                Add dataset descriptions via ingestion payloads to help teammates understand lineage and usage.
              </p>
            </div>
          </section>
        </div>
      </div>
    );
  };

  const showOverviewLoading = metadataLoading && !hasMetadataSnapshot;
  const renderOverviewContent = () => {
    if (showOverviewLoading) {
      return (
        <p className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
          <LuHistory className="h-4 w-4 animate-spin" />
          Loading metadata…
        </p>
      );
    }
    if (metadataError) {
      return (
        <p
          className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-950/40 dark:text-rose-200"
          data-testid="metadata-error-banner"
        >
          {metadataError}
        </p>
      );
    }
    if (metadataSection === "catalog" && isRouteDetail) {
      return renderDatasetDetailPage();
    }
    const mutationErrorBanner = metadataMutationError ? (
      <p
        className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-950/40 dark:text-rose-200"
        data-testid="metadata-mutation-error"
      >
        {metadataMutationError}
      </p>
    ) : null;
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
    return (
      <>
        {mutationErrorBanner}
        {sectionContent}
      </>
    );
  };

  const endpointDatasets = metadataEndpointDetail ? endpointDatasetRecords[metadataEndpointDetail.id] ?? [] : [];
  const endpointDatasetsError = metadataEndpointDetail ? endpointDatasetErrors[metadataEndpointDetail.id] ?? null : null;
  const isEndpointDatasetsLoading = metadataEndpointDetail
    ? Boolean(endpointDatasetLoading[metadataEndpointDetail.id])
    : false;
  const detailRuns = metadataEndpointDetail?.runs ?? [];
  const detailHasRunningRun = detailRuns.some((run) => run.status === "RUNNING");
  const showDetailMutationError = metadataView === "overview" && Boolean(metadataMutationError);
  const toastPortal = toastQueue.toasts.length ? (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex justify-end px-4 sm:px-6">
      <div className="flex w-full max-w-sm flex-col gap-2">
        {toastQueue.toasts.map((toast) => {
          const tone = toastToneStyles[toast.intent];
          const ToneIcon = tone.icon;
          return (
            <div
              key={toast.id}
              role="status"
              aria-live="assertive"
              className={`pointer-events-auto rounded-2xl border px-4 py-3 text-sm shadow-lg ${tone.className}`}
            >
              <div className="flex items-start gap-3">
                <ToneIcon className="mt-0.5 h-4 w-4" aria-hidden="true" />
                <div className="flex-1">
                  <p className="font-semibold">{toast.title}</p>
                  {toast.description ? <p className="mt-1 text-xs">{toast.description}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => toastQueue.dismissToast(toast.id)}
                  className="text-xs font-semibold uppercase tracking-[0.3em] text-current/70 transition hover:text-current"
                  aria-label="Dismiss notification"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <>
      {toastPortal}
      <section className="flex h-full min-h-0 flex-1 overflow-hidden bg-slate-50 dark:bg-slate-950">
        <aside
          className={`relative z-50 hidden h-full flex-none border-r border-slate-200 bg-white/80 py-5 transition-[width] dark:border-slate-800 dark:bg-slate-900/40 lg:flex lg:sticky lg:top-0 ${
            sectionNavCollapsed ? "w-14 px-1.5" : "w-56 px-3.5"
          }`}
        >
          <div className="flex h-full w-full flex-col gap-5">
            <div className="flex items-center justify-between px-1.5">
              {!sectionNavCollapsed && (
                <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500">Navigation</p>
              )}
              <button
                type="button"
                onClick={() => setSectionNavCollapsed((prev) => !prev)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300"
              >
                {sectionNavCollapsed ? "›" : "‹"}
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
                {metadataNavItems.map((entry) => {
                  const Icon = entry.icon;
                  const isActive = metadataView === "overview" && metadataSection === entry.id;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => {
                        setMetadataView("overview");
                        setMetadataSection(entry.id);
                        updateDatasetDetailId(null);
                        setMetadataEndpointDetailId(null);
                      }}
                      className={`group flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition ${
                        isActive
                          ? "border-slate-900 bg-slate-900 text-white shadow-sm dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                          : "border-slate-200 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200"
                      }`}
                      title={sectionNavCollapsed ? entry.label : undefined}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!sectionNavCollapsed ? (
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{entry.label}</p>
                          <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">{entry.description}</p>
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <header className="flex flex-wrap items-center justify-between border-b border-slate-200 px-8 py-6 dark:border-slate-800">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">Metadata workspace</p>
            <h2 className="mt-1 text-3xl font-bold text-slate-900 dark:text-white">{metadataHeaderCopy.title}</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">{metadataHeaderCopy.subtitle}</p>
          </div>
          {metadataView === "endpoint-register" ? (
            <button
              type="button"
              onClick={handleCloseRegistration}
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300 lg:mt-0"
            >
              ← Back to overview
            </button>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-2 lg:mt-0">
              <button
                type="button"
                onClick={handleWorkspaceRefresh}
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300"
              >
                <LuRefreshCcw className="h-4 w-4" /> Refresh
              </button>
            <button
              type="button"
              onClick={() => handleOpenRegistration()}
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold uppercase tracking-[0.3em] text-white shadow transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-500 dark:text-slate-900"
              data-testid="metadata-register-open"
              data-role={resolvedRole}
              disabled={!canModifyEndpoints}
              title={!canModifyEndpoints ? "Viewer access cannot register endpoints." : undefined}
            >
              <LuSquarePlus className="h-4 w-4" /> Register endpoint
            </button>
            </div>
          )}
        </header>
        {metadataView === "overview" ? (
          <div className="relative z-50 flex flex-wrap items-center gap-3 px-8 py-4 lg:hidden">
            {metadataSectionTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setMetadataSection(tab.id);
                  updateDatasetDetailId(null);
                  setMetadataEndpointDetailId(null);
                }}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                  metadataSection === tab.id
                    ? "bg-slate-900 text-white shadow dark:bg-slate-100 dark:text-slate-900"
                    : "border border-slate-300 text-slate-600 hover:border-slate-900 dark:border-slate-600 dark:text-slate-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
            <button
              type="button"
              onClick={handleWorkspaceRefresh}
              className="rounded-full border border-slate-300 px-4 py-1.5 text-sm font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 dark:border-slate-600 dark:text-slate-300"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => handleOpenRegistration()}
              className="ml-auto rounded-full bg-slate-900 px-4 py-1.5 text-sm font-semibold uppercase tracking-[0.3em] text-white shadow transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-500 dark:text-slate-900"
              data-testid="metadata-register-open"
              data-role={resolvedRole}
              disabled={!canModifyEndpoints}
              title={!canModifyEndpoints ? "Viewer access cannot register endpoints." : undefined}
            >
              Register endpoint
            </button>
          </div>
        ) : null}
        <div className="flex-1 overflow-y-auto px-8 pb-8">
          {metadataView === "overview" ? renderOverviewContent() : renderEndpointRegistrationPage()}
        </div>
        </div>
      </section>
      {metadataView === "overview" && metadataDatasetDetail && !isRouteDetail ? (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 flex">
            <div className="hidden lg:block" style={{ width: sidebarOverlayWidth }} />
            <div className="flex-1 bg-slate-900/40" onClick={() => updateDatasetDetailId(null)} />
          </div>
          <section
            className="relative flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white px-6 py-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950"
            data-testid="metadata-dataset-detail-drawer"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-500">Dataset detail</p>
                <p className="text-base font-semibold text-slate-900 dark:text-white">{metadataDatasetDetail.displayName}</p>
                {metadataDatasetDetailDisplayId ? (
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{metadataDatasetDetailDisplayId}</p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleOpenDatasetDetailPage(metadataDatasetDetail.id)}
                  className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500 hover:border-slate-900 hover:text-slate-900 dark:border-slate-700"
                >
                  Open full page
                </button>
                <button
                  type="button"
                  onClick={() => updateDatasetDetailId(null)}
                  className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500 dark:border-slate-700"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto py-4 pr-1 text-sm text-slate-600 dark:text-slate-300">
              {datasetDetailLoading ? (
                <p className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700">
                  Loading dataset metadata…
                </p>
              ) : null}
              {datasetDetailError ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-400/60 dark:bg-rose-950/40 dark:text-rose-200">
                  {datasetDetailError}
                </p>
              ) : null}
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Description</p>
                <p className="mt-1 text-sm">{metadataDatasetDetail.description ?? "No description provided yet."}</p>
              </div>
              <div className="grid gap-2 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-2">
                <span>Endpoint · {metadataEndpointLookup.get(metadataDatasetDetail.sourceEndpointId ?? "")?.name ?? "Unlinked"}</span>
                <span>Collected · {metadataDatasetDetail.collectedAt ? formatDateTime(metadataDatasetDetail.collectedAt) : "—"}</span>
                <span>Entity · {metadataDatasetDetail.entity ?? "—"}</span>
                <span>Schema · {metadataDatasetDetail.schema ?? "—"}</span>
              </div>
              <IngestionSummaryCard dataset={metadataDatasetDetail} className="mt-4" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Fields ({metadataDatasetDetailFields.length})</p>
                <div className="mt-2 space-y-2">
                  {metadataDatasetDetailFields.map((field) => (
                    <div key={field.name} className="rounded-2xl border border-slate-200 px-3 py-2 dark:border-slate-700">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-900 dark:text-slate-100">{field.name}</span>
                        <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">{field.type}</span>
                      </div>
                      {field.description ? <p className="text-xs text-slate-500 dark:text-slate-400">{field.description}</p> : null}
                    </div>
                  ))}
                </div>
                {metadataDatasetDetailFields.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500 dark:border-slate-700">
                    No field metadata discovered yet.
                  </p>
                ) : null}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Recent preview</p>
                {detailPreviewRows.length ? (
                  <>
                    {detailSampledAt ? (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                        Sampled {formatRelativeTime(detailSampledAt)}
                      </p>
                    ) : detailPreviewStatusMessage ? (
                      <p
                        className={`mt-1 text-xs ${
                          detailPreviewStatusTone === "warn" ? "text-rose-600 dark:text-rose-300" : "text-slate-500 dark:text-slate-300"
                        }`}
                      >
                        {detailPreviewStatusMessage}
                      </p>
                    ) : null}
                    <div className="mt-2 max-h-48 overflow-auto rounded-2xl border border-slate-200 dark:border-slate-700">
                      <table className="min-w-full divide-y divide-slate-200 text-xs dark:divide-slate-800">
                        <thead className="bg-slate-50 text-left font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                          <tr>
                            {detailPreviewColumns.map((column) => (
                              <th key={column} className="px-3 py-2 uppercase tracking-[0.3em] text-[10px] text-slate-400">
                                {column}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {detailPreviewRows.map((row, index) => (
                            <tr key={index} className="border-t border-slate-100 dark:border-slate-800">
                              {detailPreviewColumns.map((column) => (
                              <td
                                key={column}
                                className="px-3 py-2 text-slate-700 dark:text-slate-200 break-words whitespace-pre-wrap"
                              >
                                {formatPreviewValue((row as Record<string, unknown>)[column])}
                              </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p
                    className={`mt-2 text-xs ${
                      detailPreviewStatusTone === "warn" ? "text-rose-600 dark:text-rose-300" : "text-slate-500 dark:text-slate-300"
                    }`}
                  >
                    {detailPreviewing
                      ? "Collecting sample rows…"
                      : detailPreviewStatusMessage ?? "No preview sampled yet. Run a preview to inspect live data."}
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
      {metadataView === "overview" && metadataEndpointDetail ? (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 flex">
            <div className="hidden lg:block" style={{ width: sidebarOverlayWidth }} />
            <div className="flex-1 bg-slate-900/40" onClick={handleCloseEndpointDetail} />
          </div>
          <section
            className="relative flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white px-6 py-6 shadow-2xl dark:border-slate-800 dark:bg-slate-950"
            data-testid="metadata-endpoint-detail"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-500">Endpoint detail</p>
                <p className="text-base font-semibold text-slate-900 dark:text-white">{metadataEndpointDetail.name}</p>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{metadataEndpointDetail.id}</p>
              </div>
              <div className="flex items-center gap-2">
                {canModifyEndpoints ? (
                  <button
                    type="button"
                    onClick={() => handleOpenEndpointEdit(metadataEndpointDetail)}
                    className="rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-300"
                  >
                    Edit
                  </button>
                ) : null}
                {canDeleteEndpoints ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteMetadataEndpoint(metadataEndpointDetail)}
                    disabled={metadataDeletingEndpointId === metadataEndpointDetail.id || detailHasRunningRun}
                    title={
                      detailHasRunningRun
                        ? "Cannot delete while a collection is running."
                        : undefined
                    }
                    className="rounded-full border border-rose-200 px-3 py-1 text-sm text-rose-600 transition hover:border-rose-500 hover:text-rose-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/40 dark:text-rose-200"
                  >
                    {metadataDeletingEndpointId === metadataEndpointDetail.id ? "Deleting…" : "Delete"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={handleCloseEndpointDetail}
                  className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500 dark:border-slate-700"
                >
                  Close
                </button>
              </div>
            </div>
            {showDetailMutationError ? (
              <p
                className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/50 dark:bg-rose-950/40 dark:text-rose-200"
                data-testid="metadata-mutation-error"
              >
                {metadataMutationError}
              </p>
            ) : null}
            <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto py-4 pr-1 text-sm text-slate-600 dark:text-slate-300">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Description</p>
                <p className="mt-1 text-sm">{metadataEndpointDetail.description ?? "No description provided yet."}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Connection</p>
                <p className="mt-1 break-all font-mono text-xs text-slate-500 dark:text-slate-400">{metadataEndpointDetail.url}</p>
              </div>
              <div className="grid gap-2 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-2">
                <span>
                  Detected version · {metadataEndpointDetail.detectedVersion ?? metadataEndpointDetail.versionHint ?? "—"}
                </span>
                <span>Verb · {metadataEndpointDetail.verb}</span>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Config payload</p>
                <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-100 p-3 text-[12px] dark:bg-slate-900/40">
                  {JSON.stringify(metadataEndpointDetail.config, null, 2)}
                </pre>
              </div>
              {metadataEndpointDetail.capabilities?.length ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Capabilities</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.3em] text-slate-400">
                    {Array.from(new Set(metadataEndpointDetail.capabilities)).map((capability) => (
                      <span key={capability} className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700">
                        {capability}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              <div data-testid="metadata-endpoint-datasets">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                    Datasets ({endpointDatasets.length})
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      metadataEndpointDetail?.id && loadEndpointDatasets(metadataEndpointDetail.id, { force: true })
                    }
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500 transition hover:border-slate-900 hover:text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
                    disabled={isEndpointDatasetsLoading}
                    data-testid="metadata-endpoint-datasets-refresh"
                  >
                    <LuRefreshCcw className="h-3 w-3" />
                    Refresh
                  </button>
                </div>
                {endpointDatasetsError ? (
                  <p
                    className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200"
                    data-testid="metadata-endpoint-datasets-error"
                  >
                    {endpointDatasetsError}
                  </p>
                ) : isEndpointDatasetsLoading ? (
                  <p className="mt-2 text-xs text-slate-500" data-testid="metadata-endpoint-datasets-loading">
                    Loading datasets…
                  </p>
                ) : endpointDatasets.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500" data-testid="metadata-endpoint-datasets-empty">
                    No catalog entries linked yet. Tag catalog records with <code>endpoint:{metadataEndpointDetail.id}</code> once
                    collections complete.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2" data-testid="metadata-endpoint-datasets-list">
                    {endpointDatasets.map((dataset) => {
                      const datasetPayload =
                        (dataset.payload?.dataset as { displayName?: string; description?: string } | undefined) ?? {};
                      const displayName = datasetPayload.displayName ?? dataset.id;
                      const description = datasetPayload.description ?? "No description provided.";
                      return (
                        <li
                          key={dataset.id}
                          className="rounded-2xl border border-slate-200 px-3 py-2 dark:border-slate-700"
                          data-testid="metadata-endpoint-dataset-row"
                        >
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">{displayName}</p>
                          <p className="text-xs text-slate-500">{description}</p>
                          <div className="mt-2 text-[11px] uppercase tracking-[0.3em] text-slate-400">
                            Updated · {formatDateTime(dataset.updatedAt)}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Recent runs</p>
                {detailRuns.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">No runs recorded yet.</p>
                ) : (
                  detailRuns.map((run) => (
                    <div key={run.id} className="mt-2 rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-slate-700">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{run.status}</span>
                        <span>{formatRelativeTime(run.requestedAt)}</span>
                      </div>
                      {run.error ? <p className="mt-1 text-rose-600 dark:text-rose-300">{run.error}</p> : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function formatGraphScope(scope: GraphNodeSummary["scope"]): string {
  const parts: string[] = [];
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

type IngestionSummaryCardProps = {
  dataset: CatalogDataset | null | undefined;
  className?: string;
};

function IngestionSummaryCard({ dataset, className }: IngestionSummaryCardProps) {
  if (!dataset) {
    return null;
  }
  const config = dataset.ingestionConfig ?? null;
  const manageHref =
    dataset.sourceEndpointId && dataset.sourceEndpointId.length > 0
      ? `/ingestion?endpointId=${encodeURIComponent(dataset.sourceEndpointId)}`
      : "/ingestion";
  const baseClasses =
    "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900";
  const combinedClass = className ? `${baseClasses} ${className}` : baseClasses;
  if (!config) {
    return (
      <section className={combinedClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Ingestion</p>
            <p className="text-sm text-slate-500">Not configured yet. Enable ingestion to orchestrate runs.</p>
          </div>
          <a
            href={manageHref}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200"
          >
            Manage in console
            <LuArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Metadata collection must run before ingestion units become available.
        </p>
      </section>
    );
  }
  const lastStatus = config.lastStatus ?? null;
  const fallbackState: IngestionState = config.enabled ? "IDLE" : "PAUSED";
  const lastState = (lastStatus?.state as IngestionState | undefined) ?? fallbackState;
  const tone = ingestionStateTone[lastState];
  const lastRunRelative = lastStatus?.lastRunAt ? formatRelativeTime(lastStatus.lastRunAt) : "Never";
  const lastRunExact = lastStatus?.lastRunAt ? formatDateTime(lastStatus.lastRunAt) : null;
  const modeLabel = formatIngestionMode(config.runMode);
  const scheduleLabel = formatIngestionSchedule(config.scheduleKind, config.scheduleIntervalMinutes);
  const sinkLabel = formatIngestionSink(config.sinkId);
  return (
    <section className={combinedClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Ingestion</p>
          <p className="text-sm text-slate-500">Configuration applies to this dataset&apos;s ingestion unit.</p>
        </div>
        <a
          href={manageHref}
          className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200"
        >
          Manage in console
          <LuArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>
      <dl className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
        <div className="flex items-center justify-between">
          <dt className="text-xs uppercase tracking-[0.3em] text-slate-400">Mode</dt>
          <dd className="font-semibold text-slate-900 dark:text-white">{modeLabel}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-xs uppercase tracking-[0.3em] text-slate-400">Schedule</dt>
          <dd>{scheduleLabel}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-xs uppercase tracking-[0.3em] text-slate-400">Sink</dt>
          <dd>{sinkLabel}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.3em] text-slate-400">Last run</dt>
          <dd className="mt-2">
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${tone.badge}`}>
              <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
              {tone.label}
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {lastRunRelative}
              {lastRunExact ? ` · ${lastRunExact}` : ""}
            </p>
            {lastStatus?.lastError ? (
              <p className="mt-1 text-xs text-rose-500 dark:text-rose-300">Last error: {lastStatus.lastError}</p>
            ) : null}
          </dd>
        </div>
      </dl>
    </section>
  );
}
