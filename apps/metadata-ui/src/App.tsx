import { ChangeEvent, FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
import { createGraphQLReportingRegistryClient } from "@reporting/registry";
import { MetadataClient, type MetadataClientMode } from "@metadata/client";
import { SmartEditor } from "./components/SmartEditor";
import { PreviewPane, PreviewPayload } from "./components/PreviewPane";
import { MetadataProvider, useMetadataScope } from "./metadata/MetadataContext";
import { useMetadataCompletions, MetadataMacro } from "./hooks/useMetadataCompletions";
import { MetadataWorkspace } from "./metadata/MetadataWorkspace";
import { MetadataAuthBoundary } from "./metadata/MetadataAuthBoundary";
import { useAuth } from "./auth/AuthProvider";
import { formatDateTime, formatRelativeTime, formatPreviewValue } from "./lib/format";
import { fetchMetadataGraphQL } from "./metadata/api";
import type { CatalogDataset } from "./metadata/types";
import {
  LuBookMarked,
  LuCode,
  LuEllipsis,
  LuHistory,
  LuLayers,
  LuMessagesSquare,
  LuPanelLeftClose,
  LuPanelLeftOpen,
  LuPlay,
  LuRefreshCcw,
  LuSave,
  LuSearch,
  LuSlidersHorizontal,
  LuSparkles,
  LuSquarePlus,
  LuTable,
  LuStickyNote,
  LuUpload,
} from "react-icons/lu";

type EditorLanguage = "sql" | "python" | "markdown" | "text";
type EditorMode = "auto" | EditorLanguage;

type EditorContext = {
  language: EditorLanguage;
  dialect?: string | null;
  isDbt?: boolean;
  compatibility?: string | null;
};

type DocumentPanelProps = {
  activeTab: "editor" | "dashboards";
  currentDefinition: DesignerDefinition | null;
  currentDashboard: DashboardDefinition | null;
  isDrafting: boolean;
  selectedVersionId: string | null;
  selectedDashboardVersionId: string | null;
  renderManualEditor: () => JSX.Element;
  renderDashboardComposer: () => JSX.Element;
  editorContext: EditorContext;
  previewPayload: PreviewPayload | null;
  toolbar: ReactNode;
};

type RefAssistantState = {
  slugInput: string;
  suggestions: DesignerDefinition[];
  position: { top: number; left: number };
  replaceRange: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
};

type InlineSuggestionOverlay = {
  id: string;
  suggestion: AgentSuggestion;
  top: number;
  messageId: string;
};

const SQL_KEYWORDS = [
  "select",
  "from",
  "where",
  "join",
  "left",
  "right",
  "inner",
  "outer",
  "group",
  "by",
  "order",
  "limit",
  "having",
  "with",
  "union",
  "all",
  "distinct",
  "insert",
  "update",
  "delete",
  "create",
  "replace",
  "as",
  "on",
];

const SQL_BREAK_KEYWORDS = ["FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "GROUP", "ORDER", "HAVING", "LIMIT", "UNION"];

const detectEditorContext = (input: string, mode: EditorMode): EditorContext => {
  const forcedLanguage = mode !== "auto" ? mode : null;
  const text = input ?? "";
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  const inferLanguage = (): EditorLanguage => {
    if (forcedLanguage) {
      return forcedLanguage;
    }
    if (/(select|with|insert|update|delete)\s+/i.test(trimmed)) {
      return "sql";
    }
    if (/```|^\s*#|^\s*\*/m.test(trimmed)) {
      return "markdown";
    }
    if (/(def |class |import |from |lambda )/i.test(trimmed)) {
      return "python";
    }
    return "text";
  };

  const language = inferLanguage();
  if (language !== "sql") {
    return { language };
  }

  const isDbt = /{{\s*config|{{\s*ref|{{\s*var|{%-?\s*set/i.test(lower);
  let dialect: string | null = null;
  if (/spark|delta|databricks/i.test(trimmed)) {
    dialect = "SparkSQL";
  } else if (/bigquery|unnest|STRUCT\(/i.test(trimmed)) {
    dialect = "BigQuery";
  } else if (/postgres|jsonb|::/i.test(trimmed)) {
    dialect = "PostgreSQL";
  } else {
    dialect = "StandardSQL";
  }

  return {
    language,
    dialect,
    isDbt,
    compatibility: isDbt ? `dbt macros (${dialect})` : dialect,
  };
};

const formatEditorContent = (input: string, context: EditorContext): string => {
  if (context.language !== "sql") {
    return input;
  }
  let output = input;
  const keywordRegex = new RegExp(`\\b(${SQL_KEYWORDS.join("|")})\\b`, "gi");
  output = output.replace(keywordRegex, (match) => match.toUpperCase());
  SQL_BREAK_KEYWORDS.forEach((keyword) => {
    const breakRegex = new RegExp(`\\s+(${keyword})(?=\\b)`, "g");
    output = output.replace(breakRegex, (full, group) => `\n${group}`);
  });
  output = output.replace(/\n{3,}/g, "\n\n");
  return output.trim() ? `${output.trim()}\n` : output;
};

const datasetMatchesEndpoint = (dataset: CatalogDataset, rawEndpointId: string | null | undefined): boolean => {
  if (!rawEndpointId) {
    return false;
  }
  const normalized = rawEndpointId.trim();
  if (!normalized.length) {
    return false;
  }
  if (dataset.sourceEndpointId && dataset.sourceEndpointId.trim() === normalized) {
    return true;
  }
  const labels = dataset.labels ?? [];
  return labels.some((label) => {
    if (!label) {
      return false;
    }
    if (label === `endpoint:${normalized}`) {
      return true;
    }
    if (label.startsWith("endpoint:")) {
      return label.slice("endpoint:".length).trim() === normalized;
    }
    return false;
  });
};

type HealthPayload = {
  status: string;
  version: string;
};

type DesignerVersion = {
  id: string;
  status: string;
  queryTemplate?: string | null;
  defaultFilters?: Record<string, unknown> | null;
  notes?: string | null;
  createdAt: string;
  publishedAt?: string | null;
};

type DesignerDefinition = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  type: string;
  personaTags: string[];
  currentVersion?: { id: string; status: string; publishedAt?: string | null } | null;
  versions?: DesignerVersion[] | null;
};

type ReportRunSummary = {
  id: string;
  reportVersionId: string;
  status: string;
  executedAt: string;
  durationMs: number;
  cacheHit: boolean;
  workflowId?: string | null;
  temporalRunId?: string | null;
  error?: string | null;
  payload?: Record<string, unknown> | null;
};

type AgentConversationSummary = {
  id: string;
  persona?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string | null;
};

type BootstrapResponse = {
  health: HealthPayload;
  reportDefinitions: DesignerDefinition[];
  reportDashboards: DashboardDefinition[];
  agentConversations: AgentConversationSummary[];
};

type CreateDefinitionResponse = {
  createReportDefinition: DesignerDefinition;
};

type CreateVersionResponse = {
  createReportVersion: DesignerVersion;
};

type PublishVersionResponse = {
  publishReportVersion: DesignerDefinition;
};

type CreateDashboardResponse = {
  createReportDashboard: DashboardDefinition;
};

type CreateDashboardVersionResponse = {
  createDashboardVersion: DashboardVersion;
};

type AddDashboardTileResponse = {
  addDashboardTile: DashboardTile;
};

type PublishDashboardVersionResponse = {
  publishDashboardVersion: DashboardDefinition;
};

type DashboardVersionResponse = {
  dashboardVersion: DashboardVersion | null;
};

type VersionFormState = {
  queryTemplate: string;
  defaultFilters: string;
  notes: string;
};

type AgentSuggestion = {
  id: string;
  title: string;
  summary: string;
  query: string;
  filters?: Record<string, unknown>;
  datasetId?: string | null;
  persona?: string | null;
};

type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  suggestions?: AgentSuggestion[];
  createdAt?: string;
};

type AgentDesignResponse = {
  agentDesign: {
    reflectionId: string;
    suggestions: AgentSuggestion[];
  };
};

type StartConversationResponse = {
  startAgentConversation: {
    reflectionId: string;
  };
};

type AgentConversationDetailResponse = {
  agentConversation: {
    conversation: AgentConversationSummary;
    messages: AgentMessage[];
  } | null;
};

type DashboardTileDraft = {
  id: string;
  definitionId: string;
  versionId?: string | null;
  title: string;
  subtitle?: string;
  note?: string;
};

type DashboardTile = {
  id: string;
  reportDefinitionId: string;
  reportVersionId?: string | null;
  position?: Record<string, unknown> | null;
  size?: Record<string, unknown> | null;
  tileOverrides?: Record<string, unknown> | null;
};

type DashboardVersion = {
  id: string;
  status: string;
  layout?: Record<string, unknown> | null;
  publishedAt?: string | null;
  createdAt: string;
  tiles?: DashboardTile[] | null;
};

type DashboardDefinition = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  personaTags: string[];
  currentVersion?: { id: string; status: string; publishedAt?: string | null } | null;
  versions?: DashboardVersion[] | null;
};

const TENANT_HEADER = import.meta.env.VITE_METADATA_TENANT_ID ?? "dev";
const METADATA_MODE = import.meta.env.VITE_METADATA_CLIENT_MODE as MetadataClientMode | undefined;
const METADATA_ENDPOINT = import.meta.env.VITE_METADATA_GRAPHQL_ENDPOINT ?? "/metadata/graphql";

const BOOTSTRAP_QUERY = `
  query DesignerBootstrap {
    health { status version }
    reportDefinitions {
      id
      slug
      name
      description
      type
      personaTags
      currentVersion { id status publishedAt }
      versions {
        id
        status
        queryTemplate
        defaultFilters
        notes
        createdAt
        publishedAt
      }
    }
    reportDashboards {
      id
      slug
      name
      description
      personaTags
      currentVersion { id status publishedAt }
      versions {
        id
        status
        layout
        publishedAt
        createdAt
        tiles {
          id
          reportDefinitionId
          reportVersionId
          position
          size
          tileOverrides
        }
      }
    }
    agentConversations {
      id
      persona
      status
      createdAt
      updatedAt
      lastMessageAt
    }
  }
`;

const CREATE_DEFINITION_MUTATION = `
  mutation CreateDefinition($input: CreateReportDefinitionInput!) {
    createReportDefinition(input: $input) {
      id
      slug
      name
      description
      type
      personaTags
      currentVersion { id status publishedAt }
      versions {
        id
        status
        queryTemplate
        defaultFilters
        notes
        createdAt
        publishedAt
      }
    }
  }
`;

const CREATE_VERSION_MUTATION = `
  mutation CreateVersion($input: CreateReportVersionInput!) {
    createReportVersion(input: $input) {
      id
      status
      queryTemplate
      defaultFilters
      notes
      createdAt
      publishedAt
    }
  }
`;

const PUBLISH_VERSION_MUTATION = `
  mutation PublishVersion($id: ID!) {
    publishReportVersion(id: $id) {
      id
      slug
      name
      description
      type
      personaTags
      currentVersion { id status publishedAt }
      versions {
        id
        status
        queryTemplate
        defaultFilters
        notes
        createdAt
        publishedAt
      }
    }
  }
`;

const CREATE_DASHBOARD_MUTATION = `
  mutation CreateDashboard($input: CreateReportDashboardInput!) {
    createReportDashboard(input: $input) {
      id
      slug
      name
      description
      personaTags
      currentVersion { id status publishedAt }
      versions {
        id
        status
        layout
        publishedAt
        createdAt
        tiles {
          id
          reportDefinitionId
          reportVersionId
          position
          size
          tileOverrides
        }
      }
    }
  }
`;

const CREATE_DASHBOARD_VERSION_MUTATION = `
  mutation CreateDashboardVersion($input: CreateDashboardVersionInput!) {
    createDashboardVersion(input: $input) {
      id
      status
      layout
      publishedAt
      createdAt
      tiles {
        id
        reportDefinitionId
        reportVersionId
        position
        size
        tileOverrides
      }
    }
  }
`;

const ADD_DASHBOARD_TILE_MUTATION = `
  mutation AddDashboardTile($input: AddDashboardTileInput!) {
    addDashboardTile(input: $input) {
      id
      reportDefinitionId
      reportVersionId
      position
      size
      tileOverrides
    }
  }
`;

const PUBLISH_DASHBOARD_VERSION_MUTATION = `
  mutation PublishDashboardVersion($id: ID!) {
    publishDashboardVersion(id: $id) {
      id
      slug
      name
      description
      personaTags
      currentVersion { id status publishedAt }
      versions {
        id
        status
        layout
        publishedAt
        createdAt
        tiles {
          id
          reportDefinitionId
          reportVersionId
          position
          size
          tileOverrides
        }
      }
    }
  }
`;

const DASHBOARD_VERSION_QUERY = `
  query DashboardVersion($id: ID!) {
    dashboardVersion(id: $id) {
      id
      status
      layout
      publishedAt
      createdAt
      tiles {
        id
        reportDefinitionId
        reportVersionId
        position
        size
        tileOverrides
      }
    }
  }
`;

const AGENT_DESIGN_MUTATION = `
  mutation AgentDesign($input: AgentDesignInput!) {
    agentDesign(input: $input) {
      reflectionId
      suggestions {
        id
        title
        summary
        query
        filters
        datasetId
        persona
      }
    }
  }
`;

const START_CONVERSATION_MUTATION = `
  mutation StartAgentConversation($input: StartAgentConversationInput) {
    startAgentConversation(input: $input) {
      reflectionId
      suggestions { id }
    }
  }
`;

const AGENT_CONVERSATION_QUERY = `
  query AgentConversation($id: ID!) {
    agentConversation(id: $id) {
      conversation {
        id
        persona
        status
        createdAt
        updatedAt
        lastMessageAt
      }
      messages {
        id
        role
        content
        createdAt
        suggestions {
          id
          title
          summary
          query
          filters
          datasetId
          persona
        }
      }
    }
  }
`;

async function fetchGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
  signal?: AbortSignal,
  options?: { token?: string | null },
): Promise<T> {
  const response = await fetch("/api/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tenant-id": TENANT_HEADER,
      ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { data?: T; errors?: Array<{ message?: string }> };
  if (payload.errors?.length) {
    throw new Error(payload.errors[0]?.message ?? "Unknown GraphQL error");
  }

  if (!payload.data) {
    throw new Error("GraphQL response missing data payload");
  }

  return payload.data;
}

const emptyVersionForm = (): VersionFormState => ({
  queryTemplate: "",
  defaultFilters: "",
  notes: "",
});

const extractPreviewPayload = (run: ReportRunSummary | null): PreviewPayload | null => {
  if (!run || !run.payload || typeof run.payload !== "object") {
    return null;
  }
  const payload = run.payload as Record<string, unknown>;
  const table =
    payload.table && typeof payload.table === "object" && payload.table !== null
      ? (payload.table as Record<string, unknown>)
      : null;
  if (table) {
    const columns = Array.isArray(table.columns) ? (table.columns as unknown[]).map((column) => String(column)) : [];
    const rows = Array.isArray(table.rows)
      ? (table.rows as unknown[][]).map((row) =>
          columns.map((_, columnIndex) => {
            const cell = row?.[columnIndex];
            if (cell === null || cell === undefined) {
              return null;
            }
            if (typeof cell === "string" || typeof cell === "number" || typeof cell === "boolean") {
              return cell;
            }
            try {
              return JSON.stringify(cell);
            } catch {
              return String(cell);
            }
          }),
        )
      : [];
    return { type: "table", columns, rows };
  }
  if (typeof payload.markdown === "string") {
    return { type: "markdown", markdown: payload.markdown };
  }
  if (typeof payload.text === "string") {
    return { type: "text", text: payload.text };
  }
  if (typeof payload.error === "string") {
    return { type: "error", error: payload.error };
  }
  return null;
};

const NEW_DASHBOARD_KEY = "__new__";
const DEFAULT_PERSONA_TAG = "MANAGER";

const normalisePersonaTags = (value: string): string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.toUpperCase());

const tileOverridesFromDraft = (draft: DashboardTileDraft): Record<string, unknown> => {
  const overrides: Record<string, unknown> = {};
  if (draft.title?.trim()) {
    overrides.title = draft.title.trim();
  }
  if (draft.subtitle?.trim()) {
    overrides.subtitle = draft.subtitle.trim();
  }
  if (draft.note?.trim()) {
    overrides.note = draft.note.trim();
  }
  return overrides;
};

const draftFromTile = (
  tile: DashboardTile,
  definitions: DesignerDefinition[],
): DashboardTileDraft => {
  const overrides = (tile.tileOverrides ?? {}) as Record<string, unknown>;
  const definition = definitions.find((entry) => entry.id === tile.reportDefinitionId);
  const fallbackTitle = definition?.name ?? `Report ${tile.reportDefinitionId.slice(0, 6)}`;
  const title =
    typeof overrides.title === "string" && overrides.title.trim().length
      ? overrides.title
      : fallbackTitle;
  const subtitle =
    typeof overrides.subtitle === "string" && overrides.subtitle.trim().length
      ? overrides.subtitle
      : undefined;
  const note =
    typeof overrides.note === "string" && overrides.note.trim().length
      ? overrides.note
      : undefined;

  return {
    id: tile.id,
    definitionId: tile.reportDefinitionId,
    versionId: tile.reportVersionId ?? null,
    title,
    subtitle,
    note,
  };
};

const resolveDraftVersion = (
  draft: DashboardTileDraft,
  definition: DesignerDefinition | null | undefined,
): string | null => {
  if (draft.versionId) {
    return draft.versionId;
  }
  if (definition?.currentVersion?.id) {
    return definition.currentVersion.id;
  }
  const fallback = definition?.versions?.[0]?.id ?? null;
  return fallback;
};

export function App() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "dark";
    const stored = window.localStorage.getItem("reporting-theme");
    if (stored === "light" || stored === "dark") {
      return stored;
    }
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });
  const auth = useAuth();
  useEffect(() => {
    if (import.meta.env.DEV && typeof window !== "undefined") {
      (window as typeof window & { __metadataRuntimeUser?: typeof auth.user }).__metadataRuntimeUser = auth.user;
    }
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info("[App] auth user role", auth.user?.role);
    }
  }, [auth.user]);
  const registryClient = useMemo(
    () =>
      createGraphQLReportingRegistryClient({
        endpoint: "/api/graphql",
        tenantId: TENANT_HEADER,
        fetchImpl: fetch,
        headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : undefined,
      }),
    [auth.token],
  );
  const { metadataClient, metadataClientError } = useMemo(() => {
    try {
      const headersProvider = () => (auth.token ? { Authorization: `Bearer ${auth.token}` } : undefined);
      return {
        metadataClient: new MetadataClient({
          mode: METADATA_MODE,
          graphqlEndpoint: METADATA_ENDPOINT,
          headers: headersProvider,
        }),
        metadataClientError: null,
      };
    } catch (error) {
      return {
        metadataClient: null,
        metadataClientError: error instanceof Error ? error.message : String(error),
      };
    }
  }, [auth.token]);
  const fetchGraphQLWithAuth = useCallback(
    async <T,>(query: string, variables?: Record<string, unknown>, signal?: AbortSignal) => {
      if (!auth.token) {
        throw new Error("Authentication required");
      }
      return fetchGraphQL<T>(query, variables, signal, { token: auth.token });
    },
    [auth.token],
  );

  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [definitions, setDefinitions] = useState<DesignerDefinition[]>([]);
  const definitionMacros = useMemo<MetadataMacro[]>(() => {
    return definitions.map((definition) => ({
      name: definition.slug,
      description: definition.description ?? null,
    }));
  }, [definitions]);
  const [catalogDatasets, setCatalogDatasets] = useState<CatalogDataset[]>([]);
  const [selectedDatasetIds, setSelectedDatasetIds] = useState<string[]>([]);
  const [focusedDatasetId, setFocusedDatasetId] = useState<string | null>(null);
  const catalogDatasetMap = useMemo(() => {
    return new Map(catalogDatasets.map((dataset) => [dataset.id, dataset]));
  }, [catalogDatasets]);
  useEffect(() => {
    setSelectedDatasetIds((prev) =>
      prev.filter((datasetId) => catalogDatasets.some((dataset) => dataset.id === datasetId)),
    );
  }, [catalogDatasets]);
  const resolvedAgentDatasetIds = useMemo(() => {
    if (selectedDatasetIds.length > 0) {
      return selectedDatasetIds;
    }
    return catalogDatasets.map((dataset) => dataset.id);
  }, [selectedDatasetIds, catalogDatasets]);
  const focusedDataset = useMemo(() => {
    if (focusedDatasetId && catalogDatasetMap.has(focusedDatasetId)) {
      return catalogDatasetMap.get(focusedDatasetId) ?? null;
    }
    if (selectedDatasetIds.length > 0) {
      const scoped = selectedDatasetIds.find((id) => catalogDatasetMap.has(id));
      if (scoped) {
        return catalogDatasetMap.get(scoped) ?? null;
      }
    }
    return catalogDatasets[0] ?? null;
  }, [focusedDatasetId, catalogDatasetMap, selectedDatasetIds, catalogDatasets]);
  const [dashboards, setDashboards] = useState<DashboardDefinition[]>([]);
  const [selectedDashboardId, setSelectedDashboardId] = useState<string | null>(null);
  const [selectedDashboardVersionId, setSelectedDashboardVersionId] = useState<string | null>(null);
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [isDrafting, setIsDrafting] = useState<boolean>(false);
  const [versionForm, setVersionForm] = useState<VersionFormState>(emptyVersionForm);
  const [runs, setRuns] = useState<ReportRunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState<boolean>(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [previewRun, setPreviewRun] = useState<ReportRunSummary | null>(null);
  const [previewPayload, setPreviewPayload] = useState<PreviewPayload | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>(() => {
    if (typeof window === "undefined") {
      return "auto";
    }
    const stored = window.localStorage.getItem("designer-editor-mode");
    if (stored === "auto" || stored === "sql" || stored === "python" || stored === "markdown" || stored === "text") {
      return stored;
    }
    return "auto";
  });
  const editorContext = useMemo(() => detectEditorContext(versionForm.queryTemplate, editorMode), [versionForm.queryTemplate, editorMode]);
  const metadataCompletions = useMetadataCompletions({ datasets: catalogDatasets, selectedDatasetIds, macros: definitionMacros });
  const syncDatasetSelection = useCallback(
    (nextDatasets: CatalogDataset[]) => {
      const remainingIds = new Set(nextDatasets.map((dataset) => dataset.id));
      setSelectedDatasetIds((prev) => prev.filter((id) => remainingIds.has(id)));
      setFocusedDatasetId((prev) => (prev && remainingIds.has(prev) ? prev : nextDatasets[0]?.id ?? null));
    },
    [setFocusedDatasetId, setSelectedDatasetIds],
  );
  const handleEndpointDeleted = useCallback(
    async (endpointId: string) => {
      const normalized = endpointId?.trim();
      if (!normalized) {
        return;
      }
      setCatalogDatasets((prev) => {
        const next = prev.filter((dataset) => !datasetMatchesEndpoint(dataset, normalized));
        syncDatasetSelection(next);
        return next;
      });
      if (!metadataClient) {
        return;
      }
      try {
        const refreshed = await metadataClient.listDatasets();
        setCatalogDatasets(() => {
          const next = refreshed.filter((dataset) => !datasetMatchesEndpoint(dataset, normalized));
          syncDatasetSelection(next);
          return next;
        });
      } catch (error) {
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.warn("[Metadata] failed to refresh datasets after delete", error);
        }
      }
    },
    [metadataClient, syncDatasetSelection],
  );
  useEffect(() => {
    if (import.meta.env.DEV && typeof window !== "undefined") {
      (window as typeof window & { __catalogDatasets?: CatalogDataset[] }).__catalogDatasets = catalogDatasets;
      // eslint-disable-next-line no-console
      console.info("[App] catalog datasets count", catalogDatasets.length);
    }
  }, [catalogDatasets]);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const editorDecorationsRef = useRef<string[]>([]);
  const inlineSuggestionPositionsRef = useRef<Array<{ id: string; suggestion: AgentSuggestion; lineNumber: number; messageId: string }>>([]);
  const completionsRef = useRef(metadataCompletions);
  const manualEditorRef = useRef<HTMLDivElement | null>(null);
  const [refAssistantState, setRefAssistantState] = useState<RefAssistantState | null>(null);
  const [inlineSuggestionOverlays, setInlineSuggestionOverlays] = useState<InlineSuggestionOverlay[]>([]);

  useEffect(() => {
    completionsRef.current = metadataCompletions;
  }, [metadataCompletions]);

  useEffect(() => {
    if (!monacoRef.current || editorContext.language !== "sql") {
      return;
    }
    const monaco = monacoRef.current;
    const provider = monaco.languages.registerCompletionItemProvider("sql", {
      triggerCharacters: [" ", ".", "{"],
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word ? word.startColumn : position.column,
          endColumn: position.column,
        };
        const suggestions = completionsRef.current.map((completion) => ({
          label: completion.label,
          kind:
            completion.kind === "table"
              ? monaco.languages.CompletionItemKind.Class
              : completion.kind === "column"
                ? monaco.languages.CompletionItemKind.Field
                : monaco.languages.CompletionItemKind.Function,
          insertText: completion.insertText,
          range,
          detail: completion.detail,
          documentation: completion.documentation,
          filterText: completion.filterText ?? completion.label,
        }));
        return { suggestions };
      },
    });
    return () => {
      provider.dispose();
    };
  }, [editorContext.language]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) {
      return;
    }
    const model = editor.getModel();
    if (!model) {
      return;
    }
    if (editorContext.language !== "sql") {
      monaco.editor.setModelMarkers(model, "workspace-lint", []);
      return;
    }
    const sqlValue = model.getValue();
    const lower = sqlValue.toLowerCase();
    const markers: Monaco.editor.IMarkerData[] = [];

    if (lower.includes("select") && !lower.includes("from")) {
      markers.push({
        severity: monaco.MarkerSeverity.Warning,
        message: "SELECT statement missing FROM clause",
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 5,
      });
    }

    if (lower.includes("{{ ref(") && !lower.includes("}}")) {
      markers.push({
        severity: monaco.MarkerSeverity.Info,
        message: "Incomplete dbt ref() block",
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 5,
      });
    }

    if (!/limit\s+\d+/i.test(sqlValue) && sqlValue.split("\n").length > 100) {
      markers.push({
        severity: monaco.MarkerSeverity.Hint,
        message: "Long-running query without LIMIT detected",
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 5,
      });
    }

    const scopedDatasets =
      selectedDatasetIds.length > 0 ? catalogDatasets.filter((dataset) => selectedDatasetIds.includes(dataset.id)) : catalogDatasets;
    const datasetTokens = new Set<string>();
    scopedDatasets.forEach((dataset) => {
      [dataset.displayName, dataset.id, dataset.source].forEach((token) => {
        if (token) {
          datasetTokens.add(token.toLowerCase());
        }
      });
    });

    const tableMatches = model.findMatches("\\b(from|join)\\s+([\\w\\.\\\"`]+)", false, true, false, null, true);
    tableMatches.forEach((match) => {
      const tableToken = match.matches?.[2]?.replace(/[`"]/g, "");
      if (!tableToken) {
        return;
      }
      if (datasetTokens.size > 0 && !datasetTokens.has(tableToken.toLowerCase())) {
        markers.push({
          severity: monaco.MarkerSeverity.Warning,
          message: `Dataset "${tableToken}" is not in the current metadata scope`,
          startLineNumber: match.range.startLineNumber,
          startColumn: match.range.startColumn,
          endLineNumber: match.range.endLineNumber,
          endColumn: match.range.endColumn,
        });
      }
    });

    const definitionSlugSet = new Set(definitions.map((definition) => definition.slug.toLowerCase()));
    const refMatches = model.findMatches("\\{\\{\\s*ref\\(['\"]([^'\"\\s]+)['\"]\\)\\s*}}", false, true, false, null, true);
    refMatches.forEach((match) => {
      const slug = match.matches?.[1];
      if (!slug) {
        return;
      }
      if (!definitionSlugSet.has(slug.toLowerCase())) {
        markers.push({
          severity: monaco.MarkerSeverity.Info,
          message: `Unknown ref('${slug}') – no matching definition`,
          startLineNumber: match.range.startLineNumber,
          startColumn: match.range.startColumn,
          endLineNumber: match.range.endLineNumber,
          endColumn: match.range.endColumn,
        });
      }
    });

    monaco.editor.setModelMarkers(model, "workspace-lint", markers);
  }, [versionForm.queryTemplate, editorContext.language, catalogDatasets, selectedDatasetIds, definitions]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) {
      return;
    }
    const model = editor.getModel();
    if (!model) {
      return;
    }

    const updateAssistant = () => {
      if (editorContext.language !== "sql") {
        setRefAssistantState(null);
        return;
      }
      const position = editor.getPosition();
      const editorDomNode = editor.getDomNode();
      const container = manualEditorRef.current;
      if (!position || !editorDomNode || !container) {
        setRefAssistantState(null);
        return;
      }
      const offset = model.getOffsetAt(position);
      const startOffset = Math.max(0, offset - 160);
      const rangeStart = model.getPositionAt(startOffset);
      const contextRange = new monaco.Range(rangeStart.lineNumber, rangeStart.column, position.lineNumber, position.column);
      const contextText = model.getValueInRange(contextRange);
      const refMatch = contextText.match(/\{\{\s*ref\(['"]([\w\-]*)$/i);
      if (!refMatch) {
        setRefAssistantState(null);
        return;
      }
      const slugInput = refMatch[1] ?? "";
      const normalized = slugInput.toLowerCase();
      const suggestionPool = definitions.filter((definition) => definition.slug.toLowerCase().includes(normalized));
      if (!suggestionPool.length) {
        setRefAssistantState(null);
        return;
      }
      const cursorCoords = editor.getScrolledVisiblePosition(position);
      if (!cursorCoords) {
        setRefAssistantState(null);
        return;
      }
      const editorRect = editorDomNode.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const positionTop = cursorCoords.top + editorRect.top - containerRect.top + cursorCoords.height + 12;
      const positionLeft = cursorCoords.left + editorRect.left - containerRect.left + 12;
      const replaceStartOffset = Math.max(0, offset - slugInput.length);
      const replaceStart = model.getPositionAt(replaceStartOffset);
      setRefAssistantState({
        slugInput,
        suggestions: suggestionPool.slice(0, 6),
        position: {
          top: Math.max(0, positionTop),
          left: Math.max(0, positionLeft),
        },
        replaceRange: {
          startLineNumber: replaceStart.lineNumber,
          startColumn: replaceStart.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        },
      });
    };
    const disposables: Monaco.IDisposable[] = [
      editor.onDidChangeCursorSelection(updateAssistant),
      editor.onDidScrollChange(updateAssistant),
      model.onDidChangeContent(updateAssistant),
    ];
    updateAssistant();

    return () => {
      setRefAssistantState(null);
      disposables.forEach((disposable) => disposable.dispose());
    };
  }, [definitions, editorContext.language]);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const insertDatasetSnippet = useCallback(
    (dataset: CatalogDataset) => {
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      if (!editor || !monaco) {
        setActionError("Editor not ready yet. Try again in a moment.");
        return;
      }
      const model = editor.getModel();
      if (!model) {
        setActionError("Unable to access editor model.");
        return;
      }
      const columns = dataset.fields.map((field) => field.name).filter(Boolean).slice(0, 5);
      const selectBlock = columns.length ? columns.map((column) => `  ${column}`).join(",\n") : "  *";
      const tableName = dataset.source ?? dataset.id;
      const snippet = [
        `-- ${dataset.displayName}`,
        "SELECT",
        selectBlock,
        `FROM ${tableName}`,
        "WHERE /* add filters */",
        "LIMIT 50;",
        "",
      ].join("\n");
      let selection = editor.getSelection();
      if (!selection) {
        const lastLine = model.getLineCount();
        const lastColumn = model.getLineMaxColumn(lastLine);
        selection = new monaco.Selection(lastLine, lastColumn, lastLine, lastColumn);
      }
      editor.executeEdits("metadata-snippet", [
        {
          range: selection,
          text: snippet,
          forceMoveMarkers: true,
        },
      ]);
      editor.focus();
      setStatusMessage(`Inserted ${dataset.displayName} snippet into the draft.`);
      setRefAssistantState(null);
    },
    [setStatusMessage, setActionError],
  );

  const handleApplyRefSuggestion = useCallback(
    (slug: string) => {
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      if (!editor || !monaco || !refAssistantState) {
        return;
      }
      const model = editor.getModel();
      if (!model) {
        return;
      }
      const range = new monaco.Range(
        refAssistantState.replaceRange.startLineNumber,
        refAssistantState.replaceRange.startColumn,
        refAssistantState.replaceRange.endLineNumber,
        refAssistantState.replaceRange.endColumn,
      );
      editor.executeEdits("ref-assistant-apply", [
        {
          range,
          text: slug,
          forceMoveMarkers: true,
        },
      ]);
      editor.focus();
      setStatusMessage(`Inserted ref('${slug}') helper.`);
      setRefAssistantState(null);
    },
    [refAssistantState, setStatusMessage],
  );
  const handleDismissSuggestion = useCallback((suggestionId: string) => {
    setDismissedSuggestionIds((prev) => (prev.includes(suggestionId) ? prev : [...prev, suggestionId]));
  }, []);
  const [loading, setLoading] = useState<boolean>(true);
  const [conversations, setConversations] = useState<AgentConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversationMessages, setConversationMessages] = useState<AgentMessage[]>([]);
  const [conversationLoading, setConversationLoading] = useState<boolean>(false);
  const [startingConversation, setStartingConversation] = useState<boolean>(false);
  const [newConversationPersona, setNewConversationPersona] = useState<string>("");
  const [schemaDrawerOpen, setSchemaDrawerOpen] = useState<boolean>(false);
  const [showSessions, setShowSessions] = useState<boolean>(false);
  const [showVersionsPanel, setShowVersionsPanel] = useState<boolean>(false);
  const [showRunPanel, setShowRunPanel] = useState<boolean>(false);
  const [splitRatio, setSplitRatio] = useState<number>(() => {
    if (typeof window === "undefined") {
      return 0.35;
    }
    const stored = window.localStorage.getItem("designer-split-ratio");
    if (!stored) {
      return 0.35;
    }
    const parsed = Number.parseFloat(stored);
    if (Number.isFinite(parsed) && parsed > 0.15 && parsed < 0.85) {
      return parsed;
    }
    return 0.35;
  });
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const toolbarMenuRef = useRef<HTMLDivElement | null>(null);
  const commandPaletteInputRef = useRef<HTMLInputElement | null>(null);

  const [newDefinitionForm, setNewDefinitionForm] = useState({
    name: "",
    slug: "",
    description: "",
    personaTags: "",
  });
  const [creatingDefinition, setCreatingDefinition] = useState<boolean>(false);
  const [savingDraft, setSavingDraft] = useState<boolean>(false);
  const [publishing, setPublishing] = useState<boolean>(false);
  const [runningReport, setRunningReport] = useState<boolean>(false);
  const [savingDashboard, setSavingDashboard] = useState<boolean>(false);
  const [publishingDashboard, setPublishingDashboard] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"editor" | "dashboards">("editor");
  const [agentInput, setAgentInput] = useState<string>("");
  const [agentProcessing, setAgentProcessing] = useState<boolean>(false);
  const [dashboardName, setDashboardName] = useState<string>("Persona Overview");
  const [dashboardPersona, setDashboardPersona] = useState<string>(DEFAULT_PERSONA_TAG);
  const [dashboardDescription, setDashboardDescription] = useState<string>("");
  const [dashboardTiles, setDashboardTiles] = useState<DashboardTileDraft[]>([]);
  const [dashboardSelectedDefinition, setDashboardSelectedDefinition] = useState<string>("");
  const [dashboardSelectedVersion, setDashboardSelectedVersion] = useState<string>("");
  const [dashboardTileTitle, setDashboardTileTitle] = useState<string>("Team Health");
  const [dashboardTileSubtitle, setDashboardTileSubtitle] = useState<string>("");
  const [dashboardTileNote, setDashboardTileNote] = useState<string>("");
  const [showFiltersEditor, setShowFiltersEditor] = useState<boolean>(false);
  const [showNotesEditor, setShowNotesEditor] = useState<boolean>(false);
  const [navExpanded, setNavExpanded] = useState<boolean>(false);
  const [activeWorkspace, setActiveWorkspace] = useState<"designer" | "metadata">("metadata");
  const [toolbarMenuOpen, setToolbarMenuOpen] = useState<boolean>(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState<boolean>(false);
  const [commandQuery, setCommandQuery] = useState<string>("");
  const [dismissedSuggestionIds, setDismissedSuggestionIds] = useState<string[]>([]);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  if (!metadataClient) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 p-8 text-center text-slate-100">
        <p className="text-xl font-semibold">Metadata service unavailable</p>
        <p className="max-w-2xl text-sm text-slate-300">
          {metadataClientError ??
            "Configure VITE_METADATA_GRAPHQL_ENDPOINT (and optionally VITE_METADATA_CLIENT_MODE=remote) so the designer can query datasets."}
        </p>
      </div>
    );
  }
  const resolveSuggestionLineNumber = useCallback((query: string, model: Monaco.editor.ITextModel): number | null => {
    if (!query.trim()) {
      return null;
    }
    const candidateLine = query
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (!candidateLine) {
      return null;
    }
    const matches = model.findMatches(candidateLine, false, false, false, null, false);
    if (!matches.length) {
      return null;
    }
    return matches[0].range.startLineNumber;
  }, []);

  useEffect(() => {
    if (!highlightedMessageId) {
      return;
    }
    const element = document.getElementById(`message-${highlightedMessageId}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const timeout = window.setTimeout(() => setHighlightedMessageId(null), 2000);
    return () => window.clearTimeout(timeout);
  }, [highlightedMessageId]);
  const dismissedSuggestionSet = useMemo(() => new Set(dismissedSuggestionIds), [dismissedSuggestionIds]);
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) {
      return;
    }
    const model = editor.getModel();
    if (!model) {
      return;
    }
    const clearDecorations = () => {
      if (editorDecorationsRef.current.length > 0) {
        editor.deltaDecorations(editorDecorationsRef.current, []);
        editorDecorationsRef.current = [];
      }
    };
    const assistantSuggestions = conversationMessages
      .filter((message) => message.role === "assistant" && (message.suggestions?.length ?? 0) > 0)
      .flatMap((message) => (message.suggestions ?? []).map((suggestion) => ({ suggestion, messageId: message.id })))
      .filter((entry) => !dismissedSuggestionSet.has(entry.suggestion.id));
    if (!assistantSuggestions.length) {
      clearDecorations();
      inlineSuggestionPositionsRef.current = [];
      setInlineSuggestionOverlays([]);
      return;
    }
    const targetSuggestions = assistantSuggestions.slice(-3);
    const lineEntries: Array<{ id: string; suggestion: AgentSuggestion; lineNumber: number; messageId: string }> = [];
    const decorations: Monaco.editor.IModelDeltaDecoration[] = targetSuggestions.map((entry, index) => {
      const { suggestion, messageId } = entry;
      const resolvedLine =
        resolveSuggestionLineNumber(suggestion.query, model) ?? Math.min(model.getLineCount(), 1 + index);
      lineEntries.push({ id: suggestion.id, suggestion, lineNumber: resolvedLine, messageId });
      const range = new monaco.Range(resolvedLine, 1, resolvedLine, model.getLineMaxColumn(resolvedLine));
      return {
        range,
        options: {
          isWholeLine: true,
          inlineClassName: "agent-inline-annotation",
          linesDecorationsClassName: "agent-inline-annotation-gutter",
          hoverMessage: {
            value: `**Agent hint**\n\n${suggestion.summary || "Generated by agent"}`,
          },
        },
      };
    });
    editorDecorationsRef.current = editor.deltaDecorations(editorDecorationsRef.current, decorations);
    inlineSuggestionPositionsRef.current = lineEntries;

    const updateOverlayPositions = () => {
      if (!inlineSuggestionPositionsRef.current.length) {
        setInlineSuggestionOverlays([]);
        return;
      }
      const overlays = inlineSuggestionPositionsRef.current
        .map((entry, index) => {
          const lineTop = editor.getTopForLineNumber(entry.lineNumber) - editor.getScrollTop();
          const container = manualEditorRef.current;
          if (!container) {
            return null;
          }
          const containerHeight = container.clientHeight || 0;
          const offsetTop = Math.max(0, lineTop + 8);
          const clampedTop = Math.min(Math.max(0, offsetTop), Math.max(0, containerHeight - 60));
          return {
            id: `${entry.id}-${index}`,
            suggestion: entry.suggestion,
            top: clampedTop,
            messageId: entry.messageId,
          };
        })
        .filter((entry): entry is InlineSuggestionOverlay => Boolean(entry));
      setInlineSuggestionOverlays(overlays);
    };

    updateOverlayPositions();
    const overlayDisposables = [
      editor.onDidScrollChange(updateOverlayPositions),
      editor.onDidLayoutChange(updateOverlayPositions),
      model.onDidChangeContent(updateOverlayPositions),
    ];

    return () => {
      clearDecorations();
      inlineSuggestionPositionsRef.current = [];
      setInlineSuggestionOverlays([]);
      overlayDisposables.forEach((disposable) => disposable.dispose());
    };
  }, [conversationMessages, resolveSuggestionLineNumber, versionForm.queryTemplate, dismissedSuggestionIds]);
  const toggleDatasetSelection = useCallback((datasetId: string) => {
    setSelectedDatasetIds((prev) =>
      prev.includes(datasetId) ? prev.filter((id) => id !== datasetId) : [...prev, datasetId],
    );
  }, []);
  const appendDatasetToPrompt = useCallback((dataset: CatalogDataset) => {
    const hint = `Focus on dataset ${dataset.displayName} (${dataset.id}).`;
    setAgentInput((prev) => {
      if (!prev.trim()) {
        return hint;
      }
      if (prev.includes(dataset.id) || prev.includes(dataset.displayName)) {
        return prev;
      }
      return `${prev.trim()}\n\n${hint}`;
    });
    setSelectedDatasetIds((prev) => (prev.includes(dataset.id) ? prev : [...prev, dataset.id]));
  }, []);
  useEffect(() => {
    if (!catalogDatasets.length) {
      if (focusedDatasetId !== null) {
        setFocusedDatasetId(null);
      }
      return;
    }
    setFocusedDatasetId((prev) => {
      if (prev && catalogDatasets.some((dataset) => dataset.id === prev)) {
        return prev;
      }
      const firstScoped = selectedDatasetIds.find((datasetId) =>
        catalogDatasets.some((dataset) => dataset.id === datasetId),
      );
      if (firstScoped) {
        return firstScoped;
      }
      return catalogDatasets[0]?.id ?? null;
    });
  }, [catalogDatasets, selectedDatasetIds, focusedDatasetId]);

  const loadConversation = useCallback(async (conversationId: string) => {
    setConversationLoading(true);
    setActionError(null);
    try {
      const payload = await fetchGraphQLWithAuth<AgentConversationDetailResponse>(AGENT_CONVERSATION_QUERY, {
        id: conversationId,
      });
      const detail = payload.agentConversation;
      if (!detail) {
        return;
      }
      setConversationMessages(detail.messages ?? []);
      setConversations((prev) => {
        const remaining = prev.filter((entry) => entry.id !== detail.conversation.id);
        return [detail.conversation, ...remaining];
      });
    } catch (error) {
      const normalized = normalizeActionErrorMessage(error);
      if (normalized) {
        setActionError(normalized);
      }
    } finally {
      setConversationLoading(false);
      setDismissedSuggestionIds([]);
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("reporting-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!toolbarMenuOpen) {
      return;
    }
    const handleClickAway = (event: MouseEvent) => {
      if (toolbarMenuRef.current && !toolbarMenuRef.current.contains(event.target as Node)) {
        setToolbarMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClickAway);
    return () => {
      window.removeEventListener("mousedown", handleClickAway);
    };
  }, [toolbarMenuOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("designer-editor-mode", editorMode);
  }, [editorMode]);

  useEffect(() => {
    if (!isResizing) {
      return;
    }
    const handleMouseMove = (event: MouseEvent) => {
      const container = canvasRef.current;
      if (!container) {
        return;
      }
      const bounds = container.getBoundingClientRect();
      const ratio = (event.clientX - bounds.left) / bounds.width;
      setSplitRatio(Math.min(0.75, Math.max(0.25, ratio)));
    };
    const handleMouseUp = () => {
      setIsResizing(false);
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem("designer-split-ratio", splitRatio.toString());
  }, [splitRatio]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleKeydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        setSchemaDrawerOpen(true);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
        return;
      }
      if (event.key === "Escape") {
        setCommandPaletteOpen(false);
        setRefAssistantState(null);
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("keydown", handleKeydown);
    };
  }, []);

  useEffect(() => {
    if (commandPaletteOpen) {
      commandPaletteInputRef.current?.focus();
    } else {
      setCommandQuery("");
    }
  }, [commandPaletteOpen]);

  useEffect(() => {
    if (!metadataClient || !auth.user || !auth.token) {
      return;
    }
    const controller = new AbortController();
    const bootstrap = async () => {
      try {
        const data = await fetchGraphQLWithAuth<BootstrapResponse>(BOOTSTRAP_QUERY, undefined, controller.signal);
        const datasets = await metadataClient.listDatasets();
        if (controller.signal.aborted) {
          return;
        }
        setHealth(data.health);
        setDefinitions(data.reportDefinitions ?? []);
        setCatalogDatasets(datasets);
        setDashboards(data.reportDashboards ?? []);
        setConversations(data.agentConversations ?? []);
        const firstDefinition = data.reportDefinitions?.[0];
        const latestVersion = firstDefinition?.versions?.[0] ?? null;
        setSelectedDefinitionId(firstDefinition?.id ?? null);
        setSelectedVersionId(latestVersion?.id ?? null);
        const firstDashboard = data.reportDashboards?.[0];
        const firstDashboardVersion = firstDashboard?.versions?.[0] ?? null;
        setSelectedDashboardId(firstDashboard?.id ?? null);
        setSelectedDashboardVersionId(firstDashboardVersion?.id ?? null);
        if ((data.agentConversations?.length ?? 0) > 0) {
          const firstConversation = data.agentConversations![0];
          setActiveConversationId(firstConversation.id);
          void loadConversation(firstConversation.id);
        }
        if (latestVersion) {
          setVersionForm({
            queryTemplate: latestVersion.queryTemplate ?? "",
            defaultFilters: latestVersion.defaultFilters
              ? JSON.stringify(latestVersion.defaultFilters, null, 2)
              : "",
            notes: latestVersion.notes ?? "",
          });
        } else {
          setVersionForm(emptyVersionForm());
          setIsDrafting(Boolean(firstDefinition));
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          const normalized = normalizeActionErrorMessage(error);
          if (normalized) {
            setActionError(normalized);
          }
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void bootstrap();
    return () => controller.abort();
  }, [auth.token, auth.user, loadConversation, metadataClient]);

  const createSuggestionForPrompt = useCallback(
    (prompt?: string): AgentSuggestion | undefined => {
      const datasetPool =
        selectedDatasetIds.length > 0
          ? catalogDatasets.filter((entry) => selectedDatasetIds.includes(entry.id))
          : catalogDatasets;
      if (!datasetPool.length) {
        return undefined;
      }
      const dataset = datasetPool[0];
      const fieldNames = dataset.fields.map((field) => field.name).filter(Boolean);
      const selectedFields = fieldNames.slice(0, 3);
      if (selectedFields.length === 0) {
        selectedFields.push("metric_value");
      }
      const normalizedPrompt = (prompt ?? "").toLowerCase();
      const focusField =
        selectedFields.find((field) => normalizedPrompt.includes(field.toLowerCase())) ??
        selectedFields[0];
      const query = [
        "SELECT",
        `  ${selectedFields.join(", ")}`,
        `FROM ${dataset.source ?? dataset.id ?? "dataset"}`,
        "WHERE /* apply filters */",
        `ORDER BY ${focusField} DESC`,
        "LIMIT 50;",
      ].join("\n");
      return {
        id: `suggestion-${dataset.id}-${Date.now()}`,
        title: `Explore ${dataset.displayName}`,
        summary: `Focus on ${focusField} to evaluate ${dataset.displayName.toLowerCase()}.`,
        query,
        filters: {
          datasetId: dataset.id,
          persona: dashboardPersona || "MANAGER",
        },
      };
    },
    [catalogDatasets, dashboardPersona, selectedDatasetIds],
  );


  const refreshRuns = useCallback(
    async (reportVersionId: string | null) => {
      if (!reportVersionId) {
        setRuns([]);
        return;
      }
      setRunsLoading(true);
      setRunsError(null);
      try {
        const runSummaries = await registryClient.listRuns({ reportVersionId });
        setRuns(runSummaries);
      } catch (error) {
        setRunsError((error as Error).message);
      } finally {
        setRunsLoading(false);
      }
    },
    [registryClient],
  );

  useEffect(() => {
    if (!selectedDefinitionId) {
      setRuns([]);
      return;
    }
    if (isDrafting) {
      setRuns([]);
      return;
    }
    const definition = definitions.find((entry) => entry.id === selectedDefinitionId);
    if (!definition) {
      return;
    }
    const definitionVersions = definition.versions ?? [];
    let currentVersion: DesignerVersion | null = null;
    if (selectedVersionId) {
      currentVersion = definitionVersions.find((entry) => entry.id === selectedVersionId) ?? null;
    }
    if (!currentVersion && !isDrafting) {
      currentVersion = definitionVersions[0] ?? null;
    }
    const resolvedVersionId = currentVersion?.id ?? null;

    if (currentVersion) {
      setVersionForm({
        queryTemplate: currentVersion.queryTemplate ?? "",
        defaultFilters: currentVersion.defaultFilters
          ? JSON.stringify(currentVersion.defaultFilters, null, 2)
          : "",
        notes: currentVersion.notes ?? "",
      });
    } else if (!isDrafting) {
      setVersionForm(emptyVersionForm());
    }

    if (resolvedVersionId !== selectedVersionId) {
      setSelectedVersionId(resolvedVersionId);
    }

    void refreshRuns(resolvedVersionId);
  }, [definitions, selectedDefinitionId, selectedVersionId, isDrafting, refreshRuns]);

  useEffect(() => {
    if (!runs.length) {
      setPreviewRun(null);
      return;
    }
    setPreviewRun((previous) => {
      if (!previous) {
        return runs[0];
      }
      const replacement = runs.find((run) => run.id === previous.id);
      return replacement ?? runs[0];
    });
  }, [runs]);

  useEffect(() => {
    setPreviewPayload(extractPreviewPayload(previewRun));
  }, [previewRun]);

  useEffect(() => {
    if (!selectedDashboardId) {
      return;
    }
    const dashboard = dashboards.find((entry) => entry.id === selectedDashboardId);
    if (!dashboard) {
      return;
    }
    setDashboardName(dashboard.name);
    setDashboardDescription(dashboard.description ?? "");
    setDashboardPersona(
      dashboard.personaTags?.length ? dashboard.personaTags.join(", ") : DEFAULT_PERSONA_TAG,
    );

    const versionList = dashboard.versions ?? [];
    let version: DashboardVersion | null = null;
    if (selectedDashboardVersionId) {
      version = versionList.find((item) => item.id === selectedDashboardVersionId) ?? null;
    }
    if (!version && dashboard.currentVersion?.id) {
      version = versionList.find((item) => item.id === dashboard.currentVersion?.id) ?? null;
    }
    if (!version) {
      version = versionList[0] ?? null;
    }
    const resolvedVersionId = version?.id ?? null;
    if (resolvedVersionId !== selectedDashboardVersionId) {
      setSelectedDashboardVersionId(resolvedVersionId);
    }
    if (version?.tiles?.length) {
      setDashboardTiles(version.tiles.map((tile) => draftFromTile(tile, definitions)));
    } else {
      setDashboardTiles([]);
    }
  }, [dashboards, selectedDashboardId, selectedDashboardVersionId, definitions]);

  const handleCreateDefinition = async () => {
    if (!newDefinitionForm.name.trim()) {
      setActionError("Definition name is required.");
      return;
    }
    setCreatingDefinition(true);
    setActionError(null);
    try {
      const personaTags = newDefinitionForm.personaTags
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

      const payload = await fetchGraphQLWithAuth<CreateDefinitionResponse>(CREATE_DEFINITION_MUTATION, {
        input: {
          name: newDefinitionForm.name.trim(),
          slug: newDefinitionForm.slug.trim() || undefined,
          description: newDefinitionForm.description.trim() || undefined,
          personaTags,
          type: "QUERY",
        },
      });

      const created = payload.createReportDefinition;
      setDefinitions((prev) => [created, ...prev]);
      setSelectedDefinitionId(created.id);
      setSelectedVersionId(null);
      setIsDrafting(true);
      setVersionForm(emptyVersionForm());
      setRuns([]);
      setStatusMessage(`Created definition “${created.name}”.`);

      setNewDefinitionForm({
        name: "",
        slug: "",
        description: "",
        personaTags: "",
      });
    } catch (error) {
      const normalized = normalizeActionErrorMessage(error);
      if (normalized) {
        setActionError(normalized);
      }
    } finally {
      setCreatingDefinition(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!selectedDefinitionId) {
      return;
    }
    setSavingDraft(true);
    setActionError(null);
    try {
      const defaultFilters =
        versionForm.defaultFilters.trim().length > 0
          ? JSON.parse(versionForm.defaultFilters)
          : undefined;

      const payload = await fetchGraphQLWithAuth<CreateVersionResponse>(CREATE_VERSION_MUTATION, {
        input: {
          definitionId: selectedDefinitionId,
          status: "DRAFT",
          queryTemplate: versionForm.queryTemplate || null,
          defaultFilters,
          notes: versionForm.notes || null,
        },
      });

      const createdVersion = payload.createReportVersion;

      setDefinitions((prev) =>
        prev.map((definition) =>
          definition.id === selectedDefinitionId
            ? {
                ...definition,
                versions: [createdVersion, ...(definition.versions ?? [])],
              }
            : definition,
        ),
      );

      setSelectedVersionId(createdVersion.id);
      setIsDrafting(false);
      setStatusMessage("Draft saved.");
      void refreshRuns(createdVersion.id);
    } catch (error) {
      if (error instanceof SyntaxError) {
        setActionError("Default filters must be valid JSON.");
      } else {
        const normalized = normalizeActionErrorMessage(error);
        if (normalized) {
          setActionError(normalized);
        }
      }
    } finally {
      setSavingDraft(false);
    }
  };

  const handlePublish = async () => {
    if (!selectedDefinitionId || !selectedVersionId) {
      return;
    }
    setPublishing(true);
    setActionError(null);
    try {
      const payload = await fetchGraphQLWithAuth<PublishVersionResponse>(PUBLISH_VERSION_MUTATION, {
        id: selectedVersionId,
      });
      const updatedDefinition = payload.publishReportVersion;
      setDefinitions((prev) =>
        prev.map((definition) => (definition.id === updatedDefinition.id ? updatedDefinition : definition)),
      );
      setSelectedVersionId(updatedDefinition.currentVersion?.id ?? selectedVersionId);
      setIsDrafting(false);
      setStatusMessage("Version published.");
    } catch (error) {
      const normalized = normalizeActionErrorMessage(error);
      if (normalized) {
        setActionError(normalized);
      }
    } finally {
      setPublishing(false);
    }
  };

  const handleRunPreview = async () => {
    if (!selectedVersionId) {
      setActionError("Save a draft before running a preview.");
      return;
    }
    setRunningReport(true);
    setActionError(null);
    try {
      const run = await registryClient.runReport({ reportVersionId: selectedVersionId });
      setStatusMessage(`Preview run queued (run id ${run.metadata?.runId ?? "unknown"}).`);
      void refreshRuns(selectedVersionId);
    } catch (error) {
      const normalized = normalizeActionErrorMessage(error);
      if (normalized) {
        setActionError(normalized);
      }
    } finally {
      setRunningReport(false);
    }
  };

  const handleFormatEditor = () => {
    const formatted = formatEditorContent(versionForm.queryTemplate, editorContext);
    if (formatted === versionForm.queryTemplate) {
      setStatusMessage("Editor already formatted.");
      return;
    }
    setVersionForm((prev) => ({ ...prev, queryTemplate: formatted }));
    setStatusMessage(`Formatted ${editorContext.language.toUpperCase()} definition.`);
  };

  const handleStartDraft = () => {
    setIsDrafting(true);
    setSelectedVersionId(null);
    setVersionForm(emptyVersionForm());
    setRuns([]);
    setStatusMessage("Drafting new version.");
  };

  const handleAgentSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!agentInput.trim()) {
      return;
    }
    if (!activeConversationId) {
      setActionError("Start a conversation before sending prompts.");
      return;
    }
    const content = agentInput.trim();
    setAgentInput("");
    setAgentProcessing(true);
    setActionError(null);
    try {
      await fetchGraphQLWithAuth<AgentDesignResponse>(AGENT_DESIGN_MUTATION, {
        input: {
          prompt: content,
          datasetIds: resolvedAgentDatasetIds.length > 0 ? resolvedAgentDatasetIds : undefined,
          persona: dashboardPersona || undefined,
          conversationId: activeConversationId,
        },
      });
      await loadConversation(activeConversationId);
    } catch (error) {
      const fallback = createSuggestionForPrompt(content);
      if (fallback) {
        const fallbackMessage: AgentMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: `I fell back to the catalog—${fallback.summary}`,
          suggestions: [fallback],
        };
        setConversationMessages((prev) => [...prev, fallbackMessage]);
      }
      const normalized = normalizeActionErrorMessage(error);
      if (normalized) {
        setActionError(normalized);
      }
    } finally {
      setAgentProcessing(false);
    }
  };

  const handleApplySuggestion = (suggestion: AgentSuggestion) => {
    if (!selectedDefinitionId) {
      setActionError("Select or create a definition before applying a suggestion.");
      setActiveTab("editor");
      return;
    }
    const datasetName = suggestion.datasetId
      ? catalogDatasetMap.get(suggestion.datasetId)?.displayName ?? null
      : null;
    if (suggestion.datasetId) {
      const datasetId = suggestion.datasetId;
      setSelectedDatasetIds((prev) => (prev.includes(datasetId) ? prev : [...prev, datasetId]));
    }
    setVersionForm({
      queryTemplate: suggestion.query,
      defaultFilters: suggestion.filters ? JSON.stringify(suggestion.filters, null, 2) : "",
      notes: suggestion.summary,
    });
    setIsDrafting(true);
    setStatusMessage(
      `Applied suggestion “${suggestion.title}”${datasetName ? ` from ${datasetName}` : ""} to the draft.`,
    );
    handleDismissSuggestion(suggestion.id);
    setActiveTab("editor");
  };

  const handleSelectRunPreview = (run: ReportRunSummary) => {
    setPreviewRun(run);
  };

  const handleAddDashboardTile = () => {
    if (!dashboardSelectedDefinition) {
      setActionError("Choose a report definition to add to the dashboard.");
      return;
    }
    const definition = definitions.find((entry) => entry.id === dashboardSelectedDefinition);
    if (!definition) {
      setActionError("Selected definition is unavailable.");
      return;
    }
    const resolvedVersionId =
      dashboardSelectedVersion ||
      definition.currentVersion?.id ||
      (definition.versions?.[0]?.id ?? null);
    const tile: DashboardTileDraft = {
      id: `tile-${Date.now()}`,
      definitionId: definition.id,
      versionId: resolvedVersionId,
      title: dashboardTileTitle || definition.name,
      subtitle: dashboardTileSubtitle || undefined,
      note: dashboardTileNote || undefined,
    };
    setDashboardTiles((prev) => [...prev, tile]);
    setDashboardTileTitle("Team Health");
    setDashboardTileSubtitle("");
    setDashboardTileNote("");
    setStatusMessage(`Added “${tile.title}” to ${dashboardName}.`);
  };

  const handleRemoveDashboardTile = (id: string) => {
    setDashboardTiles((prev) => prev.filter((tile) => tile.id !== id));
  };

  const handleResetDashboard = () => {
    setDashboardTiles([]);
    setDashboardDescription("");
    setDashboardName("Persona Overview");
    setDashboardPersona(DEFAULT_PERSONA_TAG);
    setStatusMessage("Dashboard draft reset.");
  };

  const handleSelectDashboard = (dashboardId: string | null) => {
    setSelectedDashboardId(dashboardId);
    setSelectedDashboardVersionId(null);
    setStatusMessage(null);
    setActionError(null);
    if (!dashboardId) {
      setDashboardName("Persona Overview");
      setDashboardDescription("");
      setDashboardPersona(DEFAULT_PERSONA_TAG);
      setDashboardTiles([]);
    }
  };

  const handleStartConversation = async () => {
    setStartingConversation(true);
    setActionError(null);
    try {
      const personaInput = newConversationPersona.trim();
      const payload = await fetchGraphQLWithAuth<StartConversationResponse>(START_CONVERSATION_MUTATION, {
        input: personaInput ? { persona: personaInput } : undefined,
      });
      const reflectionId = payload.startAgentConversation.reflectionId;
      const stub: AgentConversationSummary = {
        id: reflectionId,
        persona: personaInput || null,
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastMessageAt: null,
      };
      setConversations((prev) => [stub, ...prev]);
      setActiveConversationId(reflectionId);
      setConversationMessages([]);
      setNewConversationPersona("");
    } catch (error) {
      const normalized = normalizeActionErrorMessage(error);
      if (normalized) {
        setActionError(normalized);
      }
    } finally {
      setStartingConversation(false);
    }
  };

  const handleSelectConversation = (conversationId: string) => {
    setActiveConversationId(conversationId);
    void loadConversation(conversationId);
  };

  const persistDashboardStructure = async (options: { publish: boolean }) => {
    if (!selectedDashboardId && !dashboardName.trim()) {
      setActionError("Dashboard name is required.");
      return;
    }
    if (dashboardTiles.length === 0) {
      setActionError("Add at least one tile before saving.");
      return;
    }
    setActionError(null);
    if (options.publish) {
      setPublishingDashboard(true);
    } else {
      setSavingDashboard(true);
    }
    try {
      const personaTagsInput = normalisePersonaTags(dashboardPersona);
      const personaTags =
        selectedDashboardId || personaTagsInput.length > 0 ? personaTagsInput : [DEFAULT_PERSONA_TAG];

      let dashboardId = selectedDashboardId;
      let dashboardRecord = dashboardId
        ? dashboards.find((entry) => entry.id === dashboardId) ?? null
        : null;

      if (!dashboardId) {
        const payload = await fetchGraphQLWithAuth<CreateDashboardResponse>(CREATE_DASHBOARD_MUTATION, {
          input: {
            name: dashboardName.trim(),
            description: dashboardDescription.trim() || undefined,
            personaTags,
          },
        });
        dashboardRecord = payload.createReportDashboard;
        dashboardId = dashboardRecord.id;
      }

      if (!dashboardId || !dashboardRecord) {
        throw new Error("Unable to resolve dashboard record.");
      }

      const layoutStructure = {
        kind: "grid",
        tiles: dashboardTiles.map((tile, index) => ({
          key: tile.id,
          order: index,
        })),
      };

      const versionPayload = await fetchGraphQLWithAuth<CreateDashboardVersionResponse>(
        CREATE_DASHBOARD_VERSION_MUTATION,
        {
          input: {
            dashboardId,
            layout: layoutStructure,
            status: options.publish ? "REVIEW" : "DRAFT",
          },
        },
      );

      const dashboardVersion = versionPayload.createDashboardVersion;

      const addedTiles = await Promise.all(
        dashboardTiles.map(async (tile, index) => {
          const definition = definitions.find((entry) => entry.id === tile.definitionId) ?? null;
          const resolvedVersionId = resolveDraftVersion(tile, definition) ?? undefined;
          const overrides = tileOverridesFromDraft(tile);
          return fetchGraphQLWithAuth<AddDashboardTileResponse>(ADD_DASHBOARD_TILE_MUTATION, {
            input: {
              dashboardVersionId: dashboardVersion.id,
              reportDefinitionId: tile.definitionId,
              reportVersionId: resolvedVersionId,
              position: {
                x: (index % 2) * 6,
                y: Math.floor(index / 2) * 6,
              },
              size: {
                w: 6,
                h: 6,
              },
              tileOverrides: Object.keys(overrides).length ? overrides : undefined,
            },
          });
        }),
      );

      let updatedDashboard: DashboardDefinition;

      if (options.publish) {
        const publishPayload = await fetchGraphQLWithAuth<PublishDashboardVersionResponse>(
          PUBLISH_DASHBOARD_VERSION_MUTATION,
          { id: dashboardVersion.id },
        );
        updatedDashboard = publishPayload.publishDashboardVersion;
      } else {
        const versionData = await fetchGraphQLWithAuth<DashboardVersionResponse>(DASHBOARD_VERSION_QUERY, {
          id: dashboardVersion.id,
        });
        const hydratedVersion =
          versionData.dashboardVersion ??
          ({
            ...dashboardVersion,
            tiles: addedTiles.map((entry) => entry.addDashboardTile),
          } as DashboardVersion);

        updatedDashboard = {
          ...dashboardRecord,
          versions: [
            hydratedVersion,
            ...(dashboardRecord.versions?.filter((version) => version.id !== hydratedVersion.id) ?? []),
          ],
        };
      }

      setDashboards((prev) => {
        const remaining = prev.filter((entry) => entry.id !== updatedDashboard.id);
        return [updatedDashboard, ...remaining];
      });

      setSelectedDashboardId(updatedDashboard.id);

      const resolvedVersionId = options.publish
        ? updatedDashboard.currentVersion?.id ?? null
        : dashboardVersion.id;
      setSelectedDashboardVersionId(resolvedVersionId);

      const targetVersionId = resolvedVersionId ?? dashboardVersion.id;
      const activeVersion =
        updatedDashboard.versions?.find((entry) => entry.id === targetVersionId) ?? null;

      if (activeVersion?.tiles?.length) {
        setDashboardTiles(activeVersion.tiles.map((tile) => draftFromTile(tile, definitions)));
      }

      const versionFragment = targetVersionId ? targetVersionId.slice(0, 8) : "unknown";
      setStatusMessage(
        options.publish
          ? `Published dashboard “${updatedDashboard.name}” (v${versionFragment}).`
          : `Saved dashboard draft (v${versionFragment}).`,
      );
    } catch (error) {
      const normalized = normalizeActionErrorMessage(error);
      if (normalized) {
        setActionError(normalized);
      }
    } finally {
      if (options.publish) {
        setPublishingDashboard(false);
      } else {
        setSavingDashboard(false);
      }
    }
  };

  const handleSaveDashboardDraft = () => {
    void persistDashboardStructure({ publish: false });
  };

  const handlePublishDashboard = () => {
    void persistDashboardStructure({ publish: true });
  };

  const currentDefinition = selectedDefinitionId
    ? definitions.find((definition) => definition.id === selectedDefinitionId) ?? null
    : null;
  const versions = currentDefinition?.versions ?? [];

  const currentDashboard = selectedDashboardId
    ? dashboards.find((dashboard) => dashboard.id === selectedDashboardId) ?? null
    : null;
  const dashboardVersions = currentDashboard?.versions ?? [];
  const editingExistingDashboard = Boolean(selectedDashboardId);
  const selectedDashboardVersion =
    selectedDashboardVersionId && currentDashboard
      ? currentDashboard.versions?.find((entry) => entry.id === selectedDashboardVersionId) ?? null
      : null;

  const iconRailItems = [
    {
      id: "metadata",
      icon: "🧭",
      label: "Metadata",
      active: activeWorkspace === "metadata",
      disabled: false,
      onSelect: () => setActiveWorkspace("metadata"),
    },
    { id: "ingestion", icon: "⚡", label: "Ingestion", active: false, disabled: true },
    { id: "recon", icon: "🛰", label: "Recon", active: false, disabled: true },
  ];

  const userInitials = useMemo(() => {
    if (!auth.user) {
      return "??";
    }
    const source = auth.user.username ?? auth.user.displayName ?? auth.user.email ?? "??";
    const tokens = source
      .replace(/@.*/, "")
      .split(/[\s._-]+/)
      .filter((token) => token.length > 0);
    if (!tokens.length) {
      return "??";
    }
    return tokens
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }, [auth.user]);

  const renderPrimaryNav = () => {
    const widthClass = navExpanded ? "w-64" : "w-20";
    const navItemClass = navExpanded
      ? "w-full justify-start gap-3 px-4 py-2"
      : "h-11 w-11 justify-center";
    return (
      <nav className={`flex ${widthClass} flex-col border-r border-slate-200 bg-slate-950/95 text-slate-300 transition-[width] duration-200 dark:border-slate-800`}>
        <div className={`flex h-[88px] items-center ${navExpanded ? "justify-between px-4" : "justify-center"} border-b border-white/10`}>
          <div className="flex items-center gap-2">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-xl text-white shadow-inner shadow-black/40">
              ✦
            </div>
            {navExpanded ? <span className="text-sm font-semibold text-white">Nucleus</span> : null}
          </div>
          {navExpanded ? (
            <button
              type="button"
              onClick={() => setNavExpanded(false)}
              className="rounded-full border border-white/20 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/40"
            >
              Collapse
            </button>
          ) : null}
        </div>
        <div className={`flex flex-1 flex-col ${navExpanded ? "items-stretch px-3" : "items-center"} gap-3 py-6`}>
          {iconRailItems.map((item) => (
            <button
              key={item.id}
              type="button"
              title={item.label}
              aria-label={item.label}
              aria-current={item.active ? "page" : undefined}
              disabled={item.disabled}
              onClick={() => {
                if (!item.disabled) {
                  item.onSelect?.();
                }
              }}
              className={`flex items-center rounded-2xl text-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${navItemClass} ${
                item.active
                  ? "bg-white text-slate-900 shadow-lg"
                  : "border border-white/10 text-slate-500 hover:border-white/40 hover:text-white disabled:cursor-not-allowed"
              }`}
            >
              <span>{item.icon}</span>
              {navExpanded ? <span className="text-sm font-semibold uppercase tracking-[0.25em]">{item.label}</span> : null}
            </button>
          ))}
        </div>
        {navExpanded ? (
          <div className="space-y-3 border-t border-white/10 px-4 py-4 text-[11px] text-white">
            <div className="rounded-2xl border border-white/10 px-3 py-2">
              <p className="uppercase tracking-[0.35em] text-slate-400">Milestone</p>
              <p className="text-white">Milestone B</p>
            </div>
            <div className="rounded-2xl border border-white/10 px-3 py-2">
              <p className="uppercase tracking-[0.35em] text-slate-400">API</p>
              <p className="text-white">{health ? health.status : "Syncing…"}</p>
            </div>
            <div className="rounded-2xl border border-white/10 px-3 py-2">
              <p className="uppercase tracking-[0.35em] text-slate-400">Theme</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={`flex flex-1 items-center justify-center rounded-full border px-2 py-1 ${
                    theme === "light" ? "border-white text-white" : "border-white/20 text-slate-400"
                  }`}
                >
                  ☀️ Light
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={`flex flex-1 items-center justify-center rounded-full border px-2 py-1 ${
                    theme === "dark" ? "border-white text-white" : "border-white/20 text-slate-400"
                  }`}
                >
                  🌙 Dark
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <div className="flex flex-col items-center gap-3 border-t border-white/10 px-3 py-4">
          <button
            type="button"
            onClick={() => setShowSessions(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white transition hover:border-white/40"
            title="Threads"
          >
            <LuMessagesSquare className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setNavExpanded((prev) => !prev)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white transition hover:border-white/40"
            title={navExpanded ? "Collapse sidebar" : "Expand sidebar"}
          >
            {navExpanded ? <LuPanelLeftClose className="h-4 w-4" /> : <LuPanelLeftOpen className="h-4 w-4" />}
          </button>
          {auth.user ? (
            navExpanded ? (
              <div className="w-full space-y-2 border-t border-white/10 pt-4" data-testid="metadata-user-chip">
                <p className="text-sm font-semibold text-white">
                  {auth.user.displayName === auth.user.email && auth.user.username ? auth.user.username : auth.user.displayName}
                </p>
                <p className="text-xs text-slate-400">{auth.user.email ?? auth.user.username}</p>
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500" data-testid="metadata-user-role">
                  {auth.user.role}
                </p>
                <button
                  type="button"
                  onClick={() => void auth.logout()}
                  className="w-full rounded-2xl border border-white/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-100 transition hover:border-white/40"
                  data-testid="metadata-logout-button"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/40 text-sm font-semibold text-white"
                onClick={() => void auth.logout()}
                title={`${auth.user.displayName} — Sign out`}
              >
                {userInitials}
              </button>
            )
          ) : null}
        </div>
      </nav>
    );
  };

  const renderSessionSidebar = () => (
    <aside className="flex h-full flex-col bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-400">Designer sessions</p>
          <h2 className="text-lg font-semibold text-white">{conversations.length || "No"} active</h2>
        </div>
        <button
          type="button"
          onClick={handleStartConversation}
          disabled={startingConversation}
          className="rounded-full border border-white/20 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.3em] text-white transition hover:border-white/60 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-slate-500"
        >
          {startingConversation ? "Spawning" : "New"}
        </button>
      </header>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-5">
        {conversations.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/20 px-4 py-4 text-sm text-slate-400">
            No sessions yet. Launch one to collaborate with the designer agent.
          </p>
        ) : (
          <div className="space-y-2">
            {conversations.map((conversation) => {
              const isActive = activeConversationId === conversation.id;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => {
                    handleSelectConversation(conversation.id);
                    setShowSessions(false);
                  }}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                    isActive
                      ? "border-white/60 bg-white/10 text-white"
                      : "border-white/10 text-slate-300 hover:border-white/40 hover:text-white"
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.3em]">
                    <span>{conversation.persona ?? "Untitled"}</span>
                    <span>{formatDateTime(conversation.updatedAt)}</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    {conversation.status} · {conversation.lastMessageAt ? formatRelativeTime(conversation.lastMessageAt) : "Idle"}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <footer className="space-y-4 border-t border-white/10 px-5 py-5 text-xs">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-slate-500">Workspace</p>
          <div className="mt-2 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setActiveTab("editor");
                setShowSessions(false);
              }}
              className={`w-full rounded-2xl border px-3 py-2 text-left text-[11px] uppercase tracking-[0.25em] transition ${
                activeTab === "editor"
                  ? "border-white/40 bg-white/10 text-white"
                  : "border-white/10 text-slate-300 hover:border-white/30 hover:text-white"
              }`}
            >
              Manual editor
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("dashboards");
                setShowSessions(false);
              }}
              className={`w-full rounded-2xl border px-3 py-2 text-left text-[11px] uppercase tracking-[0.25em] transition ${
                activeTab === "dashboards"
                  ? "border-white/40 bg-white/10 text-white"
                  : "border-white/10 text-slate-300 hover:border-white/30 hover:text-white"
              }`}
            >
              Dashboards
            </button>
          </div>
        </div>
        <label className="text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-400">
          Persona focus
          <input
            value={newConversationPersona}
            onChange={(event) => setNewConversationPersona(event.target.value)}
            placeholder="EXEC · DEV · OPS"
            className="mt-2 w-full rounded-2xl border border-white/20 bg-white/5 px-3 py-2 text-xs text-white placeholder:text-white/40 focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300/40"
          />
        </label>
        <button
          type="button"
          onClick={handleStartConversation}
          disabled={startingConversation}
          className="w-full rounded-2xl border border-emerald-300/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-200 transition hover:border-emerald-200 hover:text-white disabled:cursor-not-allowed disabled:border-white/10 disabled:text-slate-500"
        >
          {startingConversation ? "Starting…" : "Start session"}
        </button>
      </footer>
    </aside>
  );


  const renderConversationCanvas = () => (
    <section className="flex h-full flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="flex items-center justify-between border-b border-slate-200 px-8 py-4 dark:border-slate-800">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-500">Conversation</p>
          {activeConversationId ? (
            <p className="text-xs text-slate-500">
              Workflow {activeConversationId.slice(0, 8)} · {conversationLoading ? "Syncing…" : `${conversationMessages.length} turn(s)`}
            </p>
          ) : (
            <p className="text-xs text-rose-500">Start a session to unlock the canvas.</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSessions(true)}
            className="rounded-full border border-slate-300 px-3 py-1 text-[11px] uppercase tracking-[0.25em] text-slate-500 transition hover:border-slate-400 hover:text-slate-900"
          >
            Threads
          </button>
          {agentProcessing ? (
            <span className="rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-700">
              Thinking…
            </span>
          ) : null}
        </div>
      </div>
      <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-8 py-6">
        {(() => {
          if (!activeConversationId) {
            return (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No active session. Spin one up above to begin co-designing a report.
              </div>
            );
          }
          if (conversationLoading && conversationMessages.length === 0) {
            return (
              <div className="rounded-3xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
                Loading conversation history…
              </div>
            );
          }
          if (conversationMessages.length === 0) {
            return (
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                Say hello—describe the outcome you want and the agent will draft a plan.
              </div>
            );
          }
          return conversationMessages.map((message) => {
            const isHighlighted = highlightedMessageId === message.id;
            return (
              <div
                key={message.id}
                id={`message-${message.id}`}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"} text-sm`}
              >
                <div
                  className={`max-w-2xl rounded-3xl border px-5 py-4 shadow-sm transition ${
                    message.role === "user" ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50"
                  } ${isHighlighted ? "ring-2 ring-emerald-300" : ""}`}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
                    {message.role === "user" ? "You" : "Designer Agent"}
                  </div>
                  <p className="mt-2 whitespace-pre-line leading-relaxed">{message.content}</p>
                  {message.suggestions?.length ? (
                    <div className="mt-4 space-y-3">
                    {message.suggestions.map((suggestion) => {
                      const dataset = suggestion.datasetId ? catalogDatasetMap.get(suggestion.datasetId) : null;
                      return (
                        <div
                          key={suggestion.id}
                          className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900 shadow-inner"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="space-y-1">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-700">
                                {suggestion.title}
                              </div>
                              {dataset ? (
                                <p className="text-xs text-slate-500">
                                  {dataset.displayName} · {dataset.id}
                                </p>
                              ) : null}
                              <p className="text-xs text-emerald-700/90">{suggestion.summary}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleApplySuggestion(suggestion)}
                              className="rounded-full border border-emerald-400 bg-white px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-emerald-700 transition hover:bg-emerald-50"
                            >
                              Apply
                            </button>
                          </div>
                          <pre className="scrollbar-thin mt-3 max-h-56 overflow-x-auto overflow-y-auto rounded-2xl border border-emerald-200 bg-slate-900 px-4 py-3 text-xs text-emerald-200">
                            {suggestion.query}
                          </pre>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                </div>
              </div>
            );
          });
        })()}
      </div>

      <div className="border-t border-slate-200 px-8 py-4 dark:border-slate-800">
        <form onSubmit={handleAgentSubmit} className="space-y-3">
          <textarea
            value={agentInput}
            onChange={(event) => setAgentInput(event.target.value)}
            rows={3}
            placeholder="Ask the designer to draft or refine a report…"
            disabled={!activeConversationId || agentProcessing}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30 disabled:cursor-not-allowed disabled:border-dashed disabled:bg-slate-100"
          />
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
            <div className="flex flex-wrap items-center gap-2">
              <span className="uppercase tracking-[0.3em]">Scope</span>
              {selectedDatasetIds.length ? (
                selectedDatasetIds.map((datasetId) => {
                  const dataset = catalogDatasetMap.get(datasetId);
                  if (!dataset) {
                    return null;
                  }
                  return (
                    <button
                      key={dataset.id}
                      type="button"
                      onClick={() => toggleDatasetSelection(dataset.id)}
                      className="group flex items-center gap-1 rounded-full border border-emerald-400/60 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-400/20"
                    >
                      {dataset.displayName}
                      <span className="text-[12px] font-bold text-emerald-600 group-hover:text-emerald-800">×</span>
                    </button>
                  );
                })
              ) : (
                <span className="text-[11px] uppercase tracking-[0.3em] text-slate-400">All datasets</span>
              )}
            </div>
            <button
              type="submit"
              disabled={agentProcessing || !activeConversationId}
              className="rounded-full bg-slate-900 px-5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.3em] text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {agentProcessing ? "Thinking…" : "Send"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );

const renderManualEditor = () => {
    if (!currentDefinition) {
      if (loading) {
        return <p className="text-sm text-slate-500">Loading definitions…</p>;
      }
      return (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
          Create a definition to get started. The designer workspace will unlock when a report definition is selected.
        </p>
      );
    }
    const modeOptions: Array<{ id: EditorMode; label: string }> = [
      { id: "auto", label: "Auto" },
      { id: "sql", label: "SQL" },
      { id: "python", label: "Python" },
      { id: "markdown", label: "Markdown" },
      { id: "text", label: "Plain" },
    ];
    return (
      <div className="flex h-full flex-col">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="uppercase tracking-[0.3em]">Mode</span>
            {modeOptions.map((option) => {
              const isActive = editorMode === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setEditorMode(option.id)}
                  className={`rounded-full px-3 py-1 font-semibold transition ${
                    isActive ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-500 hover:border-slate-400"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-slate-500">
            <span>
              Detected:
              <span className="ml-1 font-semibold text-slate-900">{editorContext.language.toUpperCase()}</span>
            </span>
            {editorContext.dialect ? (
              <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                {editorContext.dialect}
              </span>
            ) : null}
            {editorContext.isDbt ? (
              <span className="rounded-full border border-emerald-300 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-emerald-600">
                dbt macros
              </span>
            ) : null}
          </div>
        </div>
        {editorContext.compatibility ? (
          <p className="mb-2 text-[11px] uppercase tracking-[0.3em] text-slate-400">
            Compatibility: <span className="text-slate-700">{editorContext.compatibility}</span>
          </p>
        ) : null}
        <div ref={manualEditorRef} className="relative flex-1">
          <SmartEditor
            value={versionForm.queryTemplate}
            onChange={(next) => setVersionForm((prev) => ({ ...prev, queryTemplate: next }))}
            language={editorContext.language}
            theme={theme}
            className="h-full"
            onEditorMount={(editor, monaco) => {
              editorRef.current = editor;
              monacoRef.current = monaco as typeof Monaco;
            }}
          />
          {refAssistantState ? (
            <div
              className="pointer-events-auto absolute z-30 w-72 rounded-2xl border border-slate-200 bg-white/95 p-3 text-xs text-slate-600 shadow-xl backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200"
              style={{ top: refAssistantState.position.top, left: refAssistantState.position.left }}
            >
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500">
                ref suggestions
                <span>{refAssistantState.slugInput || "all"}</span>
              </div>
              <div className="mt-2 flex flex-col gap-1">
                {refAssistantState.suggestions.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleApplyRefSuggestion(suggestion.slug)}
                    className="rounded-xl border border-transparent px-3 py-2 text-left text-xs font-medium text-slate-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 dark:text-slate-200 dark:hover:border-emerald-400/40 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-200"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-slate-800 dark:text-white">{suggestion.name}</span>
                      <span className="text-[10px] uppercase tracking-[0.3em] text-slate-400">{suggestion.slug}</span>
                    </div>
                    {suggestion.description ? (
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{suggestion.description}</p>
                    ) : null}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] uppercase tracking-[0.3em] text-slate-400">Click a definition · Esc to dismiss</p>
            </div>
          ) : null}
          {inlineSuggestionOverlays.map((overlay) => (
            <div
              key={overlay.id}
              className="pointer-events-auto absolute right-4 z-20 w-60 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 text-xs shadow-lg backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95"
              style={{ top: overlay.top }}
            >
              <div className="text-[10px] uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500">Agent hint</div>
              <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-white">{overlay.suggestion.title}</p>
              {overlay.suggestion.summary ? (
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-300">{overlay.suggestion.summary}</p>
              ) : null}
              <button
                type="button"
                onClick={() => handleApplySuggestion(overlay.suggestion)}
                className="mt-2 inline-flex w-full items-center justify-center rounded-full border border-emerald-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-600 transition hover:border-emerald-400 hover:text-emerald-700 dark:border-emerald-500/60 dark:text-emerald-200"
              >
                Apply suggestion
              </button>
              <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500">
                <button
                  type="button"
                  onClick={() => setHighlightedMessageId(overlay.messageId)}
                  className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500 transition hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                >
                  Open thread
                </button>
                <button
                  type="button"
                  onClick={() => handleDismissSuggestion(overlay.suggestion.id)}
                  className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-400 transition hover:text-rose-500"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  type ToolbarAction = {
    id: string;
    icon: ReactNode;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    active?: boolean;
  };

  type PaletteCommandAction = {
    id: string;
    label: string;
    shortcut?: string;
    group: string;
    disabled?: boolean;
    run: () => void;
  };

  const renderWorkspaceToolbar = () => {
    const primaryActions: ToolbarAction[] = [
      { id: "newDraft", icon: <LuSquarePlus className="h-4 w-4" />, label: "Start draft", onClick: handleStartDraft, disabled: isDrafting },
      {
        id: "run",
        icon: <LuPlay className="h-4 w-4" />,
        label: "Run preview",
        onClick: () => void handleRunPreview(),
        disabled: runningReport || !selectedVersionId,
      },
      {
        id: "publish",
        icon: <LuUpload className="h-4 w-4" />,
        label: "Publish version",
        onClick: () => void handlePublish(),
        disabled: publishing || isDrafting,
      },
    ];

    const overflowActions: ToolbarAction[] = [
      {
        id: "format",
        icon: <LuSparkles className="h-4 w-4" />,
        label: editorContext.language === "sql" ? "Format SQL" : editorContext.language === "markdown" ? "Format Markdown" : "Format",
        onClick: handleFormatEditor,
        disabled: editorContext.language === "text",
      },
      { id: "save", icon: <LuSave className="h-4 w-4" />, label: "Save draft", onClick: () => void handleSaveDraft(), disabled: savingDraft },
      { id: "versions", icon: <LuLayers className="h-4 w-4" />, label: "Manage versions", onClick: () => setShowVersionsPanel(true) },
      { id: "runs", icon: <LuHistory className="h-4 w-4" />, label: "Run history", onClick: () => setShowRunPanel(true) },
      {
        id: "filters",
        icon: <LuSlidersHorizontal className="h-4 w-4" />,
        label: showFiltersEditor ? "Hide filters" : "Show filters",
        onClick: () => setShowFiltersEditor((prev) => !prev),
        active: showFiltersEditor,
      },
      {
        id: "notes",
        icon: <LuStickyNote className="h-4 w-4" />,
        label: showNotesEditor ? "Hide notes" : "Show notes",
        onClick: () => setShowNotesEditor((prev) => !prev),
        active: showNotesEditor,
      },
      { id: "schema", icon: <LuBookMarked className="h-4 w-4" />, label: "Schema palette", onClick: () => setSchemaDrawerOpen(true) },
    ];

    return (
      <div className="flex items-center gap-2">
        {primaryActions.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            title={action.label}
            className={`flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:border-slate-400 hover:text-slate-900 ${
              action.disabled ? "opacity-40" : ""
            }`}
          >
            {action.icon}
          </button>
        ))}
        <div className="relative" ref={toolbarMenuRef}>
          <button
            type="button"
            onClick={() => setToolbarMenuOpen((prev) => !prev)}
            className={`flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:border-slate-400 hover:text-slate-900 ${
              toolbarMenuOpen ? "bg-slate-100" : ""
            }`}
            title="More actions"
          >
            <LuEllipsis className="h-5 w-5" />
          </button>
          {toolbarMenuOpen ? (
            <div className="absolute right-0 top-12 z-20 w-60 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
              {overflowActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => {
                    action.onClick();
                    setToolbarMenuOpen(false);
                  }}
                  disabled={action.disabled}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-slate-50 ${
                    action.active ? "text-slate-900" : "text-slate-600"
                  } ${action.disabled ? "opacity-40" : ""}`}
                >
                  <span className="text-base">{action.icon}</span>
                  <span className="flex-1 truncate">{action.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  };



  const renderSchemaDrawer = () => (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/50 backdrop-blur-sm md:items-center">
      <div className="absolute inset-0" onClick={() => setSchemaDrawerOpen(false)} />
      <section className="relative m-4 max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-2xl dark:border-white/10 dark:bg-slate-900/95">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/60 pb-4 dark:border-white/5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-500">Schema palette</p>
            <p className="text-sm text-slate-500">
              Browse catalog datasets, scope them for the agent, or inject context into your prompt.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSchemaDrawerOpen(false)}
            className="rounded-full border border-slate-300/70 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400 transition hover:border-slate-400 hover:text-slate-900 dark:border-slate-600 dark:text-slate-700"
          >
            Close
          </button>
        </header>

        <div className="scrollbar-thin mt-4 flex gap-2 overflow-x-auto pb-1">
          {catalogDatasets.length === 0 ? (
            <p className="text-xs text-slate-500">Connect a catalog provider to browse schemas.</p>
          ) : (
            catalogDatasets.map((dataset) => {
              const isFocused = focusedDataset?.id === dataset.id;
              return (
                <button
                  key={dataset.id}
                  type="button"
                  onClick={() => setFocusedDatasetId(dataset.id)}
                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] transition ${
                    isFocused
                      ? "border-slate-200 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900"
                      : "border-slate-300 text-slate-400 hover:border-slate-500 hover:text-slate-800 dark:border-slate-700 dark:text-slate-700 dark:hover:border-slate-500"
                  }`}
                >
                  {dataset.displayName}
                </button>
              );
            })
          )}
        </div>

        {focusedDataset ? (
          <div className="scrollbar-thin mt-4 max-h-[60vh] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/70">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-slate-900 dark:text-slate-900">{focusedDataset.displayName}</p>
                <p className="text-[11px] text-slate-500">
                  {focusedDataset.source ?? "CDM"} · {focusedDataset.id}
                </p>
              </div>
              <div className="flex gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => toggleDatasetSelection(focusedDataset.id)}
                  className={`rounded-full border px-3 py-1 font-semibold uppercase tracking-[0.25em] transition ${
                    selectedDatasetIds.includes(focusedDataset.id)
                      ? "border-rose-300 text-rose-600 hover:border-rose-400 hover:text-rose-700 dark:border-rose-400/60 dark:text-rose-200"
                      : "border-emerald-400 text-emerald-600 hover:border-emerald-500 hover:text-emerald-700 dark:border-emerald-400/60 dark:text-emerald-200"
                  }`}
                >
                  {selectedDatasetIds.includes(focusedDataset.id) ? "Unscope" : "Scope dataset"}
                </button>
                <button
                  type="button"
                  onClick={() => appendDatasetToPrompt(focusedDataset)}
                  className="rounded-full border border-slate-200 px-3 py-1 font-semibold uppercase tracking-[0.25em] text-slate-400 transition hover:border-slate-400 hover:text-slate-800 dark:border-slate-600 dark:text-slate-700"
                >
                  Inject context
                </button>
                <button
                  type="button"
                  onClick={() => insertDatasetSnippet(focusedDataset)}
                  title="Insert query snippet"
                  className="rounded-full border border-slate-200 p-2 text-slate-400 transition hover:border-slate-400 hover:text-slate-800 dark:border-slate-600 dark:text-slate-700"
                >
                  <LuCode className="h-4 w-4" />
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {focusedDataset.description ?? "No description provided yet."}
            </p>
            <div className="mt-4 space-y-2 text-sm text-slate-700 dark:text-slate-700">
              {focusedDataset.fields.map((field) => (
                <div
                  key={field.name}
                  className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 dark:border-slate-700/60"
                >
                  <div>
                    <p className="font-medium">{field.name}</p>
                    {field.description ? (
                      <p className="text-xs text-slate-500">{field.description}</p>
                    ) : null}
                  </div>
                  <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{field.type}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-4 rounded-2xl border border-dashed border-slate-300/70 px-4 py-4 text-xs text-slate-500 dark:border-slate-200">
            Select a dataset chip to inspect its schema.
          </p>
        )}
      </section>
    </div>
  );

  const handleResizeStart = () => setIsResizing(true);

  const renderCanvasWorkspace = () => (
    <section ref={canvasRef} className="flex flex-1 bg-white dark:bg-slate-950">
      <div style={{ width: `${splitRatio * 100}%` }} className="overflow-hidden">
        {renderConversationCanvas()}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={handleResizeStart}
        className="mx-1 w-1 cursor-col-resize rounded-full bg-slate-200 hover:bg-slate-400"
      />
      <div style={{ width: `${(1 - splitRatio) * 100}%` }} className="overflow-hidden border-l border-slate-200 dark:border-slate-800">
        <DocumentPanelComponent
          activeTab={activeTab}
          currentDefinition={currentDefinition}
          currentDashboard={currentDashboard}
          isDrafting={isDrafting}
          selectedVersionId={selectedVersionId}
          selectedDashboardVersionId={selectedDashboardVersionId}
          renderManualEditor={renderManualEditor}
          renderDashboardComposer={renderDashboardComposer}
          editorContext={editorContext}
          previewPayload={previewPayload}
          toolbar={renderWorkspaceToolbar()}
        />
      </div>
    </section>
  );

  const renderMetadataWorkspace = () => (
    <MetadataWorkspace
      metadataEndpoint={METADATA_ENDPOINT}
      catalogDatasets={catalogDatasets}
      selectedDatasetIds={selectedDatasetIds}
      toggleDatasetSelection={toggleDatasetSelection}
      authToken={auth.token}
      projectSlug={auth.user?.projectId ?? null}
      userRole={auth.user?.role ?? "USER"}
      onEndpointDeleted={handleEndpointDeleted}
    />
  );

  const renderRunPanelContent = () => (
    <section className="flex h-full flex-col">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-500">Run history</p>
          <p className="text-xs text-slate-500">
            {selectedVersionId
              ? "Recent executions for the selected version."
              : "Select or publish a version to inspect run metrics."}
          </p>
        </div>
      </header>
      <div className="scrollbar-thin mt-3 flex-1 space-y-3 overflow-y-auto pr-1">
        {isDrafting || !selectedVersionId ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-xs text-slate-500">
            Save a draft and select it to view execution history.
          </p>
        ) : runsLoading ? (
          <p className="text-xs text-slate-500">Loading runs…</p>
        ) : runsError ? (
          <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-4 text-xs text-rose-500">
            {runsError}
          </p>
        ) : runs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-xs text-slate-500">
            No runs recorded yet. Trigger a preview to generate one.
          </p>
        ) : (
          runs.map((run) => {
            const isActive = previewRun?.id === run.id;
            return (
              <button
                key={run.id}
                type="button"
                onClick={() => handleSelectRunPreview(run)}
                className={`w-full rounded-2xl border px-4 py-3 text-left text-xs transition ${
                  isActive
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-800"
                }`}
              >
                <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.25em]">
                  <span>{run.status}</span>
                  <span>{formatDateTime(run.executedAt)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span>Duration</span>
                  <span>{run.durationMs} ms</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span>Cache</span>
                  <span>{run.cacheHit ? "Hit" : "Miss"}</span>
                </div>
                {run.error ? (
                  <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-600">
                    {run.error}
                  </div>
                ) : null}
              </button>
            );
          })
        )}
      </div>
      <div className="mt-4">{renderRunPreview()}</div>
    </section>
  );

  const renderRunPanel = () => {
    if (!showRunPanel) {
      return null;
    }
    return (
      <div className="fixed inset-0 z-40 flex justify-end">
        <div className="absolute inset-0 bg-slate-900/40" onClick={() => setShowRunPanel(false)} />
        <section className="relative flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white px-6 py-6 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-500">Execution inspector</p>
              <p className="text-xs text-slate-500">Preview payloads and workflow metadata.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowRunPanel(false)}
              className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500"
            >
              Close
            </button>
          </div>
          <div className="flex-1 overflow-y-auto py-4">{renderRunPanelContent()}</div>
        </section>
      </div>
    );
  };

  const renderCommandPalette = () => {
    if (!commandPaletteOpen) {
      return null;
    }
    const paletteCommands: PaletteCommandAction[] = [
      {
        id: "start-draft",
        label: "Start new draft",
        shortcut: "Shift+D",
        group: "Versions",
        disabled: isDrafting,
        run: handleStartDraft,
      },
      {
        id: "run-preview",
        label: runningReport ? "Running preview…" : "Run preview",
        shortcut: "⌘↵",
        group: "Execution",
        disabled: runningReport || !selectedVersionId,
        run: () => {
          void handleRunPreview();
        },
      },
      {
        id: "publish-version",
        label: "Publish current version",
        shortcut: "Shift+P",
        group: "Versions",
        disabled: publishing || !selectedVersionId || isDrafting,
        run: () => {
          void handlePublish();
        },
      },
      {
        id: "format-editor",
        label: editorContext.language === "sql" ? "Format SQL" : "Format document",
        shortcut: "⌘⇧F",
        group: "Editor",
        disabled: editorContext.language === "text",
        run: handleFormatEditor,
      },
      {
        id: "toggle-filters",
        label: showFiltersEditor ? "Hide filters panel" : "Show filters panel",
        shortcut: "F",
        group: "Workspace",
        run: () => setShowFiltersEditor((prev) => !prev),
      },
      {
        id: "toggle-notes",
        label: showNotesEditor ? "Hide notes panel" : "Show notes panel",
        shortcut: "N",
        group: "Workspace",
        run: () => setShowNotesEditor((prev) => !prev),
      },
      {
        id: "schema-palette",
        label: "Open schema palette",
        shortcut: "⇧S",
        group: "Workspace",
        run: () => setSchemaDrawerOpen(true),
      },
      {
        id: "open-run-panel",
        label: "Open run inspector",
        shortcut: "R",
        group: "Navigation",
        run: () => setShowRunPanel(true),
      },
      {
        id: "open-sessions",
        label: "Show conversations",
        shortcut: "C",
        group: "Navigation",
        run: () => setShowSessions(true),
      },
      {
        id: "toggle-theme",
        label: theme === "dark" ? "Switch to light mode" : "Switch to dark mode",
        shortcut: "⇧T",
        group: "Appearance",
        run: () => setTheme((prev) => (prev === "dark" ? "light" : "dark")),
      },
    ];
    const normalizedQuery = commandQuery.trim().toLowerCase();
    const visibleCommands = normalizedQuery
      ? paletteCommands.filter((command) => command.label.toLowerCase().includes(normalizedQuery))
      : paletteCommands;
    const groupedCommands = visibleCommands.reduce<Array<{ group: string; items: PaletteCommandAction[] }>>(
      (acc, command) => {
        const existing = acc.find((entry) => entry.group === command.group);
        if (existing) {
          existing.items.push(command);
        } else {
          acc.push({ group: command.group, items: [command] });
        }
        return acc;
      },
      [],
    );
    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 px-4 py-12" onClick={() => setCommandPaletteOpen(false)}>
        <div
          className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-2xl backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/95"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            <LuSearch className="h-4 w-4 text-slate-400" />
            <input
              ref={commandPaletteInputRef}
              type="text"
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.target.value)}
              placeholder="Search commands"
              className="flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
            />
            <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-slate-400 dark:border-slate-600 dark:text-slate-500">
              ⌘K
            </span>
          </div>
          <div className="scrollbar-thin mt-3 max-h-80 space-y-3 overflow-y-auto pr-1">
            {groupedCommands.length ? (
              groupedCommands.map((section) => (
                <div key={section.group}>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">{section.group}</p>
                  <div className="mt-1 flex flex-col gap-1">
                    {section.items.map((command) => (
                      <button
                        key={command.id}
                        type="button"
                        disabled={command.disabled}
                        onClick={() => {
                          if (command.disabled) {
                            return;
                          }
                          setCommandPaletteOpen(false);
                          setCommandQuery("");
                          command.run();
                        }}
                        className={`flex items-center justify-between rounded-2xl border border-transparent px-4 py-2 text-left text-sm transition ${
                          command.disabled
                            ? "cursor-not-allowed text-slate-400"
                            : "text-slate-700 hover:border-slate-200 hover:bg-slate-100 dark:text-slate-100 dark:hover:border-slate-700 dark:hover:bg-slate-800/80"
                        }`}
                      >
                        <span>{command.label}</span>
                        {command.shortcut ? (
                          <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-slate-400 dark:border-slate-600 dark:text-slate-500">
                            {command.shortcut}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                No matching commands. Try a different keyword.
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-[0.35em] text-slate-400">
            <span>Enter to run</span>
            <span>Esc to close</span>
          </div>
        </div>
      </div>
    );
  };

  const renderFiltersPanel = () => {
    if (!showFiltersEditor) {
      return null;
    }
    return (
      <div className="fixed inset-0 z-40 flex justify-end">
        <div className="absolute inset-0 bg-slate-900/40" onClick={() => setShowFiltersEditor(false)} />
        <section className="relative flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white px-6 py-6 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-500">Default filters</p>
              <p className="text-xs text-slate-500">Provide JSON applied to every run of this definition.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowFiltersEditor(false)}
              className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500"
            >
              Close
            </button>
          </div>
          <textarea
            value={versionForm.defaultFilters}
            onChange={(event) => setVersionForm((prev) => ({ ...prev, defaultFilters: event.target.value }))}
            className="mt-4 flex-1 resize-none rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
            placeholder='{"projects": ["JIRA"], "days": 30}'
          />
        </section>
      </div>
    );
  };

  const renderNotesPanel = () => {
    if (!showNotesEditor) {
      return null;
    }
    return (
      <div className="fixed inset-0 z-40 flex justify-end">
        <div className="absolute inset-0 bg-slate-900/40" onClick={() => setShowNotesEditor(false)} />
        <section className="relative flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white px-6 py-6 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-500">Design notes</p>
              <p className="text-xs text-slate-500">Capture reasoning, persona context, or TODOs.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowNotesEditor(false)}
              className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500"
            >
              Close
            </button>
          </div>
          <textarea
            value={versionForm.notes}
            onChange={(event) => setVersionForm((prev) => ({ ...prev, notes: event.target.value }))}
            className="mt-4 flex-1 resize-none rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
            placeholder="Track backlog volume and freshness."
          />
        </section>
      </div>
    );
  };

  const renderVersionsPanel = () => {
    if (!showVersionsPanel) {
      return null;
    }
    return (
      <div className="fixed inset-0 z-40 flex justify-end">
        <div className="absolute inset-0 bg-slate-900/40" onClick={() => setShowVersionsPanel(false)} />
        <section className="relative flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white px-6 py-6 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-500">Versions</p>
              <p className="text-xs text-slate-500">Switch between drafts or published iterations.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsDrafting(true);
                  setSelectedVersionId(null);
                  setVersionForm(emptyVersionForm());
                  setRuns([]);
                  setShowVersionsPanel(false);
                }}
                className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500"
              >
                Draft
              </button>
              <button
                type="button"
                onClick={() => setShowVersionsPanel(false)}
                className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500"
              >
                Close
              </button>
            </div>
          </div>
          <div className="scrollbar-thin mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
            {versions.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-500">
                No versions yet. Start a draft to generate the first iteration.
              </p>
            ) : (
              versions.map((version) => {
                const isActive = !isDrafting && version.id === selectedVersionId;
                return (
                  <button
                    key={version.id}
                    type="button"
                    onClick={() => {
                      setIsDrafting(false);
                      setSelectedVersionId(version.id);
                      setShowVersionsPanel(false);
                      setStatusMessage(null);
                    }}
                    className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
                      isActive
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-800"
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.3em]">
                      <span>{version.status}</span>
                      <span>{formatDateTime(version.createdAt)}</span>
                    </div>
                    {version.notes ? (
                      <p className="mt-2 text-xs text-slate-500">{version.notes}</p>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </section>
      </div>
    );
  };

  const renderRunPreview = () => {
    if (!previewRun) {
      return (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-4 text-xs text-slate-500">
          Select a run to inspect the preview payload generated by the execution workflow.
        </div>
      );
    }

    const payload =
      previewRun.payload && typeof previewRun.payload === "object"
        ? (previewRun.payload as Record<string, unknown>)
        : null;
    const table =
      payload && typeof payload.table === "object" && payload.table !== null
        ? (payload.table as Record<string, unknown>)
        : null;
    const columns = Array.isArray(table?.columns)
      ? (table!.columns as unknown[]).map((column) => String(column))
      : [];
    const rawRows = Array.isArray(table?.rows) ? (table!.rows as unknown[][]) : [];
    const rows = rawRows
      .filter((row): row is unknown[] => Array.isArray(row))
      .map((row) =>
        columns.map((_, columnIndex) => formatPreviewValue(columnIndex < row.length ? row[columnIndex] : undefined)),
      );
    const metadata =
      payload && typeof payload.metadata === "object" && payload.metadata !== null
        ? (payload.metadata as Record<string, unknown>)
        : {};
    const datasetName = typeof metadata.datasetName === "string" ? metadata.datasetName : null;
    const datasetId = typeof metadata.datasetId === "string" ? metadata.datasetId : null;
    const generatedAt = typeof metadata.generatedAt === "string" ? metadata.generatedAt : null;
    const querySnippet = typeof metadata.queryTemplate === "string" ? metadata.queryTemplate : null;
    const filtersMeta =
      metadata.filters && typeof metadata.filters === "object" && metadata.filters !== null
        ? (metadata.filters as Record<string, unknown>)
        : null;

    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-700 shadow-inner">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Preview output</h3>
            <p className="text-[11px] text-slate-400">
              {datasetName ? `${datasetName}${datasetId ? ` · ${datasetId}` : ""}` : "Synthetic preview dataset"}
            </p>
            <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500">
              {previewRun.status} · {previewRun.durationMs} ms · Cache {previewRun.cacheHit ? "hit" : "miss"}
              {generatedAt ? ` · Generated ${formatDateTime(generatedAt)}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPreviewRun(null)}
            className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500 transition hover:border-slate-400 hover:text-slate-900"
          >
            Clear
          </button>
        </div>

        {columns.length ? (
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-xs text-slate-600">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.3em] text-slate-500">
                <tr>
                  {columns.map((column) => (
                    <th key={column} className="px-3 py-2 text-left font-semibold">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length ? (
                  rows.map((row, rowIndex) => (
                    <tr key={`${previewRun.id}-row-${rowIndex}`} className="odd:bg-white even:bg-slate-50">
                      {row.map((cell, columnIndex) => (
                        <td key={`${previewRun.id}-${columnIndex}-${rowIndex}`} className="px-3 py-2">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-2 text-slate-500" colSpan={columns.length || 1}>
                      No rows returned yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-slate-200 px-3 py-3 text-center text-[11px] text-slate-500">
            No tabular data found in the preview payload.
          </p>
        )}

        {querySnippet ? (
          <section className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">Query template</h4>
            <pre className="scrollbar-thin mt-2 max-h-48 overflow-auto rounded-xl bg-white px-3 py-2 text-[11px] text-slate-700">
              {querySnippet}
            </pre>
          </section>
        ) : null}
        {filtersMeta ? (
          <section className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-500">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500">Filters</h4>
            <pre className="scrollbar-thin mt-2 max-h-32 overflow-auto rounded-xl bg-white px-3 py-2 text-[11px] text-slate-600">
              {JSON.stringify(filtersMeta, null, 2)}
            </pre>
          </section>
        ) : null}
      </div>
    );
  };

  const renderDashboardComposer = () => {
    const canPersistDashboard =
      dashboardTiles.length > 0 && (Boolean(selectedDashboardId) || dashboardName.trim().length > 0);
    return (
      <section className="flex flex-col gap-6 rounded-3xl border border-slate-200 bg-white p-6">
      <header className="flex flex-col gap-2 border-b border-slate-200/60 pb-4 text-slate-400 transition-colors duration-300 dark:border-white/5 dark:text-slate-400">
        <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
          Dashboard Composer
        </div>
        <p className="text-sm text-slate-500">
          Assemble a persona landing page by combining published report definitions. Publish through the registry when
          you are ready.
        </p>
      </header>

      <div className="scrollbar-thin flex-1 space-y-6 overflow-y-auto pr-2">
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-inner shadow-black/10 transition dark:border-slate-700 dark:bg-slate-900/70 dark:shadow-black/20">
          <label className="flex flex-col gap-2 text-xs font-medium text-slate-400 dark:text-slate-300">
            Working dashboard
            <select
              value={selectedDashboardId ?? NEW_DASHBOARD_KEY}
              onChange={(event) => {
                if (event.target.value === NEW_DASHBOARD_KEY) {
                  handleSelectDashboard(null);
                } else {
                  handleSelectDashboard(event.target.value);
                }
              }}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-900"
            >
              <option value={NEW_DASHBOARD_KEY}>New dashboard draft</option>
              {dashboards.map((dashboard) => (
                <option key={dashboard.id} value={dashboard.id}>
                  {dashboard.name}
                  {dashboard.personaTags.length ? ` · ${dashboard.personaTags.join(", ")}` : ""}
                </option>
              ))}
            </select>
          </label>
          {editingExistingDashboard ? (
            <p className="mt-2 text-[11px] text-slate-500">
              Metadata (name, persona, description) is managed in the registry. Publishing here creates a new version.
            </p>
          ) : null}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-xs font-medium text-slate-400 dark:text-slate-300">
              Dashboard name
              <input
                value={dashboardName}
                onChange={(event) => setDashboardName(event.target.value)}
                disabled={editingExistingDashboard}
                placeholder="Persona Overview"
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500/30 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-900 dark:placeholder:text-slate-500 dark:disabled:bg-slate-800"
              />
            </label>
            <label className="flex flex-col gap-2 text-xs font-medium text-slate-400 dark:text-slate-300">
              Persona tags
              <input
                value={dashboardPersona}
                onChange={(event) => setDashboardPersona(event.target.value)}
                disabled={editingExistingDashboard}
                placeholder="EXEC, MANAGER"
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500/30 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-900 dark:placeholder:text-slate-500 dark:disabled:bg-slate-800"
              />
            </label>
          </div>
          <label className="mt-4 flex flex-col gap-2 text-xs font-medium text-slate-400 dark:text-slate-300">
            Description
            <textarea
              value={dashboardDescription}
              onChange={(event) => setDashboardDescription(event.target.value)}
              disabled={editingExistingDashboard}
              rows={3}
              placeholder="Surface health metrics and at-risk work across the portfolio."
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500/30 disabled:cursor-not-allowed disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-900 dark:placeholder:text-slate-500 dark:disabled:bg-slate-800"
            />
          </label>
          {dashboardVersions.length ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">
                Versions
              </span>
              {dashboardVersions.map((version) => {
                const isActive = version.id === selectedDashboardVersionId;
                return (
                  <button
                    key={version.id}
                    type="button"
                    onClick={() => {
                      setSelectedDashboardVersionId(version.id);
                      setStatusMessage(null);
                    }}
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] transition ${
                      isActive
                        ? "bg-slate-900 text-white shadow-sm dark:bg-slate-100 dark:text-slate-900"
                        : "border border-slate-300 text-slate-400 hover:border-slate-400 hover:text-slate-700 dark:border-slate-600 dark:text-slate-700 dark:hover:border-slate-400 dark:hover:text-slate-50"
                    }`}
                  >
                    {version.status.toLowerCase()} · {formatDateTime(version.createdAt)}
                  </button>
                );
              })}
            </div>
          ) : editingExistingDashboard ? (
            <p className="mt-4 rounded-xl border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-500 dark:border-slate-200">
              No versions yet. Build tiles below and publish one.
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-inner shadow-black/10 transition dark:border-slate-700 dark:bg-slate-900/70 dark:shadow-black/20">
          <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            Add dashboard tile
          </h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-xs font-medium text-slate-400 dark:text-slate-300">
              Definition
              <select
                value={dashboardSelectedDefinition}
                onChange={(event) => {
                  setDashboardSelectedDefinition(event.target.value);
                  setDashboardSelectedVersion("");
                }}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-900"
              >
                <option value="">Select definition</option>
                {definitions.map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {definition.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-xs font-medium text-slate-400 dark:text-slate-300">
              Version
              <select
                value={dashboardSelectedVersion}
                onChange={(event) => setDashboardSelectedVersion(event.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-900"
              >
                <option value="">Latest published</option>
                {(definitions
                  .find((definition) => definition.id === dashboardSelectedDefinition)
                  ?.versions ?? []
                ).map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.status} · {formatDateTime(version.createdAt)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-xs font-medium text-slate-400 dark:text-slate-300">
              Tile title
              <input
                value={dashboardTileTitle}
                onChange={(event) => setDashboardTileTitle(event.target.value)}
                placeholder="Team Health"
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-900 dark:placeholder:text-slate-500"
              />
            </label>
            <label className="flex flex-col gap-2 text-xs font-medium text-slate-400 dark:text-slate-300">
              Subtitle
              <input
                value={dashboardTileSubtitle}
                onChange={(event) => setDashboardTileSubtitle(event.target.value)}
                placeholder="Velocity vs. goal"
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-900 dark:placeholder:text-slate-500"
              />
            </label>
          </div>
          <label className="mt-4 flex flex-col gap-2 text-xs font-medium text-slate-400 dark:text-slate-300">
            Notes
            <textarea
              value={dashboardTileNote}
              onChange={(event) => setDashboardTileNote(event.target.value)}
              rows={3}
              placeholder="Highlight focus areas or filters this tile should default to."
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 transition focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-900 dark:placeholder:text-slate-500"
            />
          </label>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleAddDashboardTile}
              className="rounded-full bg-slate-900 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.25em] text-white transition hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white/90"
            >
              Add tile
            </button>
            <button
              type="button"
              onClick={handleResetDashboard}
              className="rounded-full border border-slate-300 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.25em] text-slate-400 transition hover:border-slate-400 hover:text-slate-700 dark:border-slate-700 dark:text-slate-700 dark:hover:border-slate-500 dark:hover:text-slate-50"
            >
              Reset
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-inner shadow-black/10 transition dark:border-slate-700 dark:bg-slate-900/70 dark:shadow-black/20">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              Tiles ({dashboardTiles.length})
            </h3>
            <span className="text-xs text-slate-400">Use drag-and-drop later to arrange</span>
          </div>
          {dashboardTiles.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500 dark:border-slate-200">
              Add tiles from the registry to build your dashboard layout.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {dashboardTiles.map((tile) => {
                const definition = definitions.find((entry) => entry.id === tile.definitionId);
                const versionLabel =
                  definition?.versions?.find((version) => version.id === tile.versionId)?.status ??
                  definition?.currentVersion?.status ??
                  "Latest";
                return (
                  <div
                    key={tile.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 shadow-sm transition dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-700"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs uppercase tracking-[0.3em] text-slate-500">
                          {definition?.name ?? "Unknown"}
                        </div>
                          </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveDashboardTile(tile.id)}
                        className="rounded-full border border-rose-300 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-rose-500 transition hover:border-rose-400 hover:text-rose-600 dark:border-rose-400/60 dark:text-rose-300"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="text-sm font-semibold text-slate-700 dark:text-slate-900">{tile.title}</div>
                    {tile.subtitle ? (
                      <div className="text-xs text-slate-500">{tile.subtitle}</div>
                    ) : null}
                    <div className="mt-2 text-xs text-slate-500">
                      {versionLabel} · Definition ID {tile.definitionId.slice(0, 8)}
                    </div>
                    {tile.note ? (
                      <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-500 dark:border-slate-200 dark:bg-slate-800/60 dark:text-slate-300">
                        {tile.note}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-inner shadow-black/10 transition dark:border-slate-700 dark:bg-slate-900/70 dark:shadow-black/20">
          <h3 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            Registry actions
          </h3>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSaveDashboardDraft}
              disabled={!canPersistDashboard || savingDashboard}
              className="rounded-full bg-slate-900 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.25em] text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white/90 dark:disabled:bg-slate-700/60 dark:disabled:text-slate-300"
            >
              {savingDashboard ? "Saving draft…" : "Save draft"}
            </button>
            <button
              type="button"
              onClick={handlePublishDashboard}
              disabled={!canPersistDashboard || publishingDashboard}
              className="rounded-full border border-emerald-400 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.25em] text-emerald-700 transition hover:border-emerald-500 hover:text-emerald-800 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400 dark:border-emerald-400/60 dark:text-emerald-200 dark:hover:border-emerald-300 dark:hover:text-emerald-100 dark:disabled:border-slate-700 dark:disabled:text-slate-500"
            >
              {publishingDashboard ? "Publishing…" : "Publish dashboard"}
            </button>
            <span className="text-xs text-slate-500">
              Publishing creates a new dashboard version available in the Admin Console and SDK.
            </span>
          </div>
        </section>
      </div>
      </section>
    );
  };

  const renderStatusToasts = () => {
    if (!statusMessage && !actionError) {
      return null;
    }
    return (
      <div className="pointer-events-auto space-y-3">
        {statusMessage ? (
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="flex items-center justify-between rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-left text-sm text-emerald-700 shadow-lg transition hover:border-emerald-500"
          >
            {statusMessage}
            <span className="pl-4 text-[11px] font-semibold uppercase tracking-[0.3em] text-emerald-600">Dismiss</span>
          </button>
        ) : null}
        {actionError ? (
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="flex items-center justify-between rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-left text-sm text-rose-600 shadow-lg transition hover:border-rose-500"
          >
            {actionError}
            <span className="pl-4 text-[11px] font-semibold uppercase tracking-[0.3em] text-rose-600">Dismiss</span>
          </button>
        ) : null}
      </div>
    );
  };

  const renderTopControls = () => null;

const metadataPersona = newConversationPersona.trim() || dashboardPersona || currentDefinition?.personaTags?.[0] || null;
  const metadataDefinitions = useMemo(
    () => definitions.map((definition) => ({ id: definition.id, name: definition.name, personaTags: definition.personaTags })),
    [definitions],
  );
  const metadataDashboards = useMemo(
    () => dashboards.map((dashboard) => ({ id: dashboard.id, name: dashboard.name, personaTags: dashboard.personaTags })),
    [dashboards],
  );
  const metadataScopeValue = useMemo(
    () => ({
      selectedDatasetIds,
      toggleDatasetSelection,
      clearScope: () => setSelectedDatasetIds([]),
    }),
    [selectedDatasetIds, toggleDatasetSelection],
  );
  const appContent = (
    <MetadataProvider datasets={catalogDatasets} definitions={metadataDefinitions} dashboards={metadataDashboards} persona={metadataPersona} scope={metadataScopeValue}>
      <main className="flex h-screen overflow-hidden bg-slate-100 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
        {renderPrimaryNav()}
        <div className="relative flex flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-10">
            {renderStatusToasts()}
          </div>
          <div className="absolute top-4 right-6 flex items-center gap-3">
            {renderTopControls()}
          </div>
          <section className="flex flex-1 overflow-hidden border-l border-slate-200 bg-white shadow-[0_25px_80px_-40px_rgba(15,23,42,0.35)] dark:border-slate-800 dark:bg-slate-950">
            {activeWorkspace === "designer" ? renderCanvasWorkspace() : renderMetadataWorkspace()}
          </section>
        </div>
      </main>
      {showSessions ? (
        <div className="fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowSessions(false)} />
          <div className="relative ml-20 h-full w-80 border-r border-slate-200 bg-slate-950/95 shadow-[0_25px_80px_-40px_rgba(0,0,0,0.9)]">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 text-sm uppercase tracking-[0.3em] text-slate-400">
              Sessions
              <button onClick={() => setShowSessions(false)} className="text-lg">×</button>
            </div>
            <div className="flex-1 overflow-y-auto">{renderSessionSidebar()}</div>
          </div>
        </div>
      ) : null}
      {schemaDrawerOpen ? renderSchemaDrawer() : null}
      {renderVersionsPanel()}
      {renderRunPanel()}
      {renderFiltersPanel()}
      {renderNotesPanel()}
      {renderCommandPalette()}
    </MetadataProvider>
  );

  return <MetadataAuthBoundary>{appContent}</MetadataAuthBoundary>;
}

export default App;

function normalizeActionErrorMessage(error: unknown): string | null {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : null;
  if (!message) {
    return null;
  }
  if (/authentication required/i.test(message)) {
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.info("[Designer] Suppressing upstream auth error", message);
    }
    return null;
  }
  return message;
}

function DocumentPanelComponent({
  activeTab,
  currentDefinition,
  currentDashboard,
  isDrafting,
  selectedVersionId,
  selectedDashboardVersionId,
  renderManualEditor,
  renderDashboardComposer,
  editorContext,
  previewPayload,
  toolbar,
}: DocumentPanelProps) {
  const { selectedDatasets, selectedDatasetIds } = useMetadataScope();
  const isDashboardMode = activeTab === "dashboards";
  const workspaceTitle = isDashboardMode
    ? currentDashboard?.name ?? "Dashboards"
    : currentDefinition?.name ?? "Workspace";
  const workspaceDescription = isDashboardMode
    ? currentDashboard?.description ?? "Compose persona views"
    : currentDefinition?.description ?? "Query builder · filters · previews";
  const personaTags = isDashboardMode
    ? currentDashboard?.personaTags ?? []
    : currentDefinition?.personaTags ?? [];
  const activeVersion = !isDashboardMode && currentDefinition && !isDrafting
    ? currentDefinition.versions?.find((version) => version.id === selectedVersionId) ?? null
    : null;
  const activeVersionLabel = isDashboardMode
    ? selectedDashboardVersionId
      ? `Dashboard v${selectedDashboardVersionId.slice(0, 4)}`
      : "Draft"
    : activeVersion
      ? `${activeVersion.status} · ${formatDateTime(activeVersion.createdAt)}`
      : isDrafting
        ? "Draft in progress"
        : "Draft";
  const scopeLabels = selectedDatasetIds.length
    ? selectedDatasetIds
        .map((datasetId) => selectedDatasets.find((dataset) => dataset.id === datasetId)?.displayName)
        .filter((value): value is string => Boolean(value))
    : [];

  return (
    <section className="flex h-full flex-col bg-white dark:bg-slate-950 dark:text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3 dark:border-slate-800">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-900 dark:text-white">{workspaceTitle}</span>
            <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-200">
              {activeVersionLabel}
            </span>
            {!isDashboardMode ? (
              scopeLabels.length ? (
                <span className="truncate text-[10px] text-slate-400 dark:text-slate-500">Scope: {scopeLabels.join(", ")}</span>
              ) : (
                <span className="text-[10px] text-slate-400 dark:text-slate-500">Scope: All datasets</span>
              )
            ) : null}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{workspaceDescription}</p>
          {personaTags.length ? (
            <div className="flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500">
              {personaTags.map((tag) => (
                <span key={tag} className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-500 dark:border-slate-700 dark:text-slate-300">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="shrink-0">{toolbar}</div>
      </header>
      <div className="flex-1 overflow-hidden px-6 py-4">
        <div className="grid h-full gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="h-full">{activeTab === "dashboards" ? renderDashboardComposer() : renderManualEditor()}</div>
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
            <PreviewPane payload={previewPayload} language={editorContext.language} />
          </div>
        </div>
      </div>
    </section>
  );
}
