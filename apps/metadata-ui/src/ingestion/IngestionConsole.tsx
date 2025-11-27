import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  LuArrowRight,
  LuCircle,
  LuCircleCheck,
  LuCircleDashed,
  LuCirclePause,
  LuCirclePlay,
  LuCircleSlash,
  LuCircleX,
  LuClock3,
  LuInfo,
  LuRefreshCcw,
  LuSlidersHorizontal,
  LuSearch,
  LuTriangleAlert,
  LuX,
} from "react-icons/lu";
import { formatRelativeTime } from "../lib/format";
import { fetchMetadataGraphQL } from "../metadata/api";
import {
  INGESTION_ENDPOINTS_QUERY,
  INGESTION_UNITS_WITH_STATUS_QUERY,
  START_INGESTION_MUTATION,
  PAUSE_INGESTION_MUTATION,
  RESET_INGESTION_CHECKPOINT_MUTATION,
  CONFIGURE_INGESTION_UNIT_MUTATION,
  JIRA_FILTER_OPTIONS_QUERY,
} from "../metadata/queries";
import {
  IngestionStatusSummary,
  IngestionState,
  IngestionUnitSummary,
  IngestionUnitConfigSummary,
  IngestionSinkDescriptor,
  MetadataEndpointSummary,
  JiraIngestionFilterSummary,
  JiraFilterOptions,
} from "../metadata/types";
import { useDebouncedValue, useToastQueue } from "../metadata/hooks";
import type { Role } from "../auth/AuthProvider";
import {
  formatIngestionMode,
  formatIngestionSchedule,
  formatIngestionSink,
  ingestionStateTone,
  summarizePolicy,
} from "./stateTone";

type IngestionConsoleProps = {
  metadataEndpoint: string | null;
  authToken?: string | null;
  projectSlug?: string | null;
  userRole: Role;
};

type EndpointQueryResult = {
  endpoints: MetadataEndpointSummary[];
};

type UnitsQueryResult = {
  ingestionUnits: IngestionUnitSummary[];
  ingestionStatuses: IngestionStatusSummary[];
  ingestionUnitConfigs: IngestionUnitConfigSummary[];
  ingestionSinks?: IngestionSinkDescriptor[];
};

type IngestionActionResult = {
  ok: boolean;
  runId?: string | null;
  state?: IngestionState | null;
  message?: string | null;
};

type JiraFilterQueryResult = {
  jiraIngestionFilterOptions: JiraFilterOptions;
};

type ActionMutationResult = {
  startIngestion?: IngestionActionResult;
  pauseIngestion?: IngestionActionResult;
  resetIngestionCheckpoint?: IngestionActionResult;
};

type IngestionUnitRow = IngestionUnitSummary & {
  state: IngestionState;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastError: string | null;
  stats: Record<string, unknown> | null;
  checkpoint: Record<string, unknown> | null;
  config: IngestionUnitConfigSummary | null;
};

type JiraFilterFormState = {
  projectKeys: string[];
  statuses: string[];
  assigneeIds: string[];
  updatedFrom: string | null;
};

type ConfigFormState = {
  enabled: boolean;
  runMode: string;
  mode: string;
  scheduleKind: string;
  scheduleIntervalMinutes: number;
  sinkId: string;
  sinkEndpointId: string | null;
  policyText: string;
  jiraFilter: JiraFilterFormState;
};

type ConfigOverrides = {
  enabled?: boolean;
  runMode?: string;
  mode?: string;
  sinkId?: string;
  sinkEndpointId?: string | null;
  scheduleKind?: string;
  scheduleIntervalMinutes?: number | null;
  policy?: Record<string, unknown> | null;
  jiraFilter?: JiraFilterFormState | null;
};

const endpointSidebarWidth = 320;

const DEFAULT_JIRA_FILTER_FORM: JiraFilterFormState = {
  projectKeys: [],
  statuses: [],
  assigneeIds: [],
  updatedFrom: null,
};

export function IngestionConsole({ metadataEndpoint, authToken, projectSlug, userRole }: IngestionConsoleProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const endpointQueryParam = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const requested = params.get("endpointId");
    return requested && requested.length > 0 ? requested : null;
  }, [location.search]);
  const [endpointSearch, setEndpointSearch] = useState("");
  const debouncedSearch = useDebouncedValue(endpointSearch, 350);
  const [endpoints, setEndpoints] = useState<MetadataEndpointSummary[]>([]);
  const [endpointLoading, setEndpointLoading] = useState(false);
  const [endpointError, setEndpointError] = useState<string | null>(null);
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(endpointQueryParam);
  const [units, setUnits] = useState<IngestionUnitRow[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [unitsRefetching, setUnitsRefetching] = useState(false);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [unitsVersion, setUnitsVersion] = useState(0);
  const [actionState, setActionState] = useState<Record<string, "start" | "pause" | "reset" | "configure" | "toggle">>({});
  const [configuringUnit, setConfiguringUnit] = useState<IngestionUnitRow | null>(null);
  const [configForm, setConfigForm] = useState<ConfigFormState | null>(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [sinkDescriptors, setSinkDescriptors] = useState<IngestionSinkDescriptor[]>([]);
  const [jiraFilterOptions, setJiraFilterOptions] = useState<JiraFilterOptions | null>(null);
  const [jiraFilterLoading, setJiraFilterLoading] = useState(false);
  const [jiraFilterError, setJiraFilterError] = useState<string | null>(null);
  const sinkDescriptorMap = useMemo(() => new Map(sinkDescriptors.map((sink) => [sink.id, sink])), [sinkDescriptors]);
  const cdmSinkEndpoints = useMemo(
    () =>
      endpoints.filter((endpoint) => {
        const labels = endpoint.labels ?? [];
        return labels.includes("sink:cdm") || labels.includes("cdm-sink");
      }),
    [endpoints],
  );
  const sinkSupportsCdm = useCallback(
    (sinkId: string, modelId: string) => {
      const descriptor = sinkDescriptorMap.get(sinkId);
      if (!descriptor?.supportedCdmModels || descriptor.supportedCdmModels.length === 0) {
        return false;
      }
      return descriptor.supportedCdmModels.some((pattern) => matchesCdmPattern(pattern, modelId));
    },
    [sinkDescriptorMap],
  );
  const drawerSinkOptions = useMemo(() => {
    if (!configuringUnit || !configForm) {
      return [];
    }
    const baseOptions = sinkDescriptors.map((sink) => sink.id);
    const extras = [configForm.sinkId, configuringUnit.sinkId, "kb"].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    let merged = Array.from(new Set([...baseOptions, ...extras]));
    if (configForm.mode === "cdm" && configuringUnit.cdmModelId) {
      const compatible = merged.filter((sinkId) => sinkSupportsCdm(sinkId, configuringUnit.cdmModelId!));
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
      .filter((sink) => sinkSupportsCdm(sink.id, configuringUnit.cdmModelId!))
      .map((sink) => sink.id);
  }, [configuringUnit, sinkDescriptors, sinkSupportsCdm]);
  const cdmModeActive =
    Boolean(configForm && configuringUnit?.cdmModelId && configForm.mode === "cdm");
  const selectedSinkSupportsCdm =
    !cdmModeActive || !configForm || !configuringUnit?.cdmModelId
      ? true
      : sinkSupportsCdm(configForm.sinkId, configuringUnit.cdmModelId);
  const supportsJiraFilters = Boolean(configuringUnit && isJiraUnitId(configuringUnit.unitId));
  const saveDisabled = !configForm || configSaving || (cdmModeActive && !selectedSinkSupportsCdm);
  const toastQueue = useToastQueue();
  const isAdmin = userRole === "ADMIN";
  const abortRef = useRef<AbortController | null>(null);
  const updateEndpointQuery = useCallback(
    (nextId: string | null) => {
      const params = new URLSearchParams(location.search);
      if (nextId) {
        params.set("endpointId", nextId);
      } else {
        params.delete("endpointId");
      }
      const searchString = params.toString();
      navigate(
        {
          pathname: location.pathname,
          search: searchString.length ? `?${searchString}` : "",
        },
        { replace: true },
      );
    },
    [location.pathname, location.search, navigate],
  );
  const applySelectedEndpoint = useCallback(
    (nextId: string | null, options?: { syncUrl?: boolean }) => {
      setSelectedEndpointId(nextId);
      if (options?.syncUrl === false) {
        return;
      }
      updateEndpointQuery(nextId);
    },
    [updateEndpointQuery],
  );

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
    fetchMetadataGraphQL<EndpointQueryResult>(
      metadataEndpoint,
      INGESTION_ENDPOINTS_QUERY,
      {
        projectSlug: projectSlug ?? undefined,
        search: debouncedSearch || undefined,
        first: 200,
      },
      undefined,
      { token: authToken ?? undefined },
    )
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

  const loadUnits = useCallback(
    async (endpointId: string, { silent }: { silent?: boolean } = {}) => {
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
      } else {
        setUnitsRefetching(true);
      }
      setUnitsError(null);
      try {
        const payload = await fetchMetadataGraphQL<UnitsQueryResult>(
          metadataEndpoint,
          INGESTION_UNITS_WITH_STATUS_QUERY,
          { endpointId },
          controller.signal,
          { token: authToken ?? undefined },
        );
        const statuses = new Map(payload.ingestionStatuses?.map((status) => [status.unitId, status]));
        const configMap = new Map((payload.ingestionUnitConfigs ?? []).map((config) => [config.unitId, config]));
        const combined: IngestionUnitRow[] = (payload.ingestionUnits ?? []).map((unit) => {
          const status = statuses.get(unit.unitId);
          const config = configMap.get(unit.unitId) ?? null;
          return {
            ...unit,
            datasetId: unit.datasetId ?? unit.unitId,
            state: status?.state ?? "IDLE",
            lastRunAt: status?.lastRunAt ?? null,
            lastRunId: status?.lastRunId ?? null,
            lastError: status?.lastError ?? null,
            stats: (status?.stats ?? unit.stats ?? null) as Record<string, unknown> | null,
            checkpoint: (status?.checkpoint ?? null) as Record<string, unknown> | null,
            config,
          };
        });
        combined.sort((a, b) => a.displayName.localeCompare(b.displayName));
        setUnits(combined);
        setSinkDescriptors(payload.ingestionSinks ?? []);
        setUnitsError(null);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setUnitsError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!controller.signal.aborted) {
          setUnitsLoading(false);
          setUnitsRefetching(false);
        }
      }
    },
    [metadataEndpoint, authToken],
  );

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
    const hasSelection =
      selectedEndpointId && endpoints.some((endpoint) => endpoint.id === selectedEndpointId);
    if (hasSelection) {
      return;
    }
    const desired =
      (endpointQueryParam &&
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
    fetchMetadataGraphQL<JiraFilterQueryResult>(
      metadataEndpoint,
      JIRA_FILTER_OPTIONS_QUERY,
      { endpointId: configuringUnit.endpointId },
      undefined,
      { token: authToken ?? undefined },
    )
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

  const endpointOptions = useMemo(
    () =>
      endpoints.map((endpoint) => ({
        id: endpoint.id,
        name: endpoint.name,
        description: endpoint.description ?? endpoint.domain ?? "—",
        disabled: Boolean(endpoint.deletedAt),
      })),
    [endpoints],
  );

  const selectedEndpoint = useMemo(
    () => endpoints.find((endpoint) => endpoint.id === selectedEndpointId) ?? null,
    [endpoints, selectedEndpointId],
  );

  const handleAction = useCallback(
    async (
      mutation: string,
      unitId: string,
      intent: "start" | "pause" | "reset",
      successMessage: string,
      errorMessage: string,
    ) => {
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
        const payload = await fetchMetadataGraphQL<ActionMutationResult>(
          metadataEndpoint,
          mutation,
          { endpointId: selectedEndpointId, unitId },
          undefined,
          { token: authToken ?? undefined },
        );
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
      } catch (error) {
        toastQueue.pushToast({
          title: errorMessage,
          description: error instanceof Error ? error.message : String(error),
          intent: "error",
        });
      } finally {
        setActionState((prev) => {
          const next = { ...prev };
          delete next[unitId];
          return next;
        });
      }
    },
    [metadataEndpoint, authToken, selectedEndpointId, toastQueue, refreshUnits],
  );

  const ensureUnitConfigured = useCallback(
    (unit: IngestionUnitRow, actionLabel: string) => {
      if (!unit.config || !unit.config.enabled) {
        toastQueue.pushToast({
          title: `${actionLabel} unavailable`,
          description: "Configure and enable this unit first.",
          intent: "info",
        });
        return false;
      }
      return true;
    },
    [toastQueue],
  );

  const persistConfig = useCallback(
    async (unit: IngestionUnitRow, overrides: ConfigOverrides, intent: "configure" | "toggle") => {
      if (!metadataEndpoint || !authToken) {
        return;
      }
      setActionState((prev) => ({ ...prev, [unit.unitId]: intent }));
      const input = buildConfigInput(unit, overrides);
      try {
        await fetchMetadataGraphQL(
          metadataEndpoint,
          CONFIGURE_INGESTION_UNIT_MUTATION,
          { input },
          undefined,
          { token: authToken ?? undefined },
        );
        toastQueue.pushToast({
          title: overrides.enabled === undefined ? "Configuration saved" : overrides.enabled ? "Ingestion enabled" : "Ingestion disabled",
          description: `${unit.displayName} updated.`,
          intent: "success",
        });
        refreshUnits();
      } catch (error) {
        toastQueue.pushToast({
          title: `Unable to update ${unit.displayName}`,
          description: error instanceof Error ? error.message : String(error),
          intent: "error",
        });
        throw error;
      } finally {
        setActionState((prev) => {
          const next = { ...prev };
          delete next[unit.unitId];
          return next;
        });
      }
    },
    [metadataEndpoint, authToken, toastQueue, refreshUnits],
  );

  const handleToggleUnit = useCallback(
    (unit: IngestionUnitRow, nextEnabled: boolean) => {
      void persistConfig(unit, { enabled: nextEnabled }, "toggle");
    },
    [persistConfig],
  );

  const openConfigureDrawer = useCallback((unit: IngestionUnitRow) => {
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
  }, []);

  const updateConfigForm = useCallback((patch: Partial<ConfigFormState>) => {
    setConfigForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const updateJiraFilterForm = useCallback((patch: Partial<JiraFilterFormState>) => {
    setConfigForm((prev) => (prev ? { ...prev, jiraFilter: { ...prev.jiraFilter, ...patch } } : prev));
  }, []);

  const resetJiraFilterForm = useCallback(() => {
    setConfigForm((prev) => (prev ? { ...prev, jiraFilter: { ...DEFAULT_JIRA_FILTER_FORM } } : prev));
  }, []);

  const handleFilterMultiSelect = useCallback(
    (event: ChangeEvent<HTMLSelectElement>, field: keyof Pick<JiraFilterFormState, "projectKeys" | "statuses" | "assigneeIds">) => {
      const values = Array.from(event.target.selectedOptions).map((option) => option.value);
      updateJiraFilterForm({ [field]: values } as Partial<JiraFilterFormState>);
    },
    [updateJiraFilterForm],
  );

  const handleSaveConfig = useCallback(async () => {
    if (!configuringUnit || !configForm) {
      return;
    }
    let parsedPolicy: Record<string, unknown> | null = null;
    if (configForm.policyText.trim().length) {
      try {
        parsedPolicy = JSON.parse(configForm.policyText);
      } catch (error) {
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
      await persistConfig(
        configuringUnit,
        {
          enabled: configForm.enabled,
          runMode: configForm.runMode,
          mode: configForm.mode ?? "raw",
          sinkId: configForm.sinkId,
          sinkEndpointId: configForm.sinkEndpointId ?? null,
          scheduleKind: configForm.scheduleKind,
          scheduleIntervalMinutes: configForm.scheduleKind === "INTERVAL" ? configForm.scheduleIntervalMinutes : null,
          policy: parsedPolicy,
          jiraFilter: configForm.jiraFilter,
        },
        "configure",
      );
      closeConfigureDrawer();
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : String(error));
    } finally {
      setConfigSaving(false);
    }
  }, [configuringUnit, configForm, persistConfig, closeConfigureDrawer]);

  const handleRunUnit = useCallback(
    (unit: IngestionUnitRow) => {
      if (!ensureUnitConfigured(unit, "Run ingestion")) {
        return;
      }
      handleAction(START_INGESTION_MUTATION, unit.unitId, "start", "Ingestion run started", "Unable to start ingestion");
    },
    [handleAction, ensureUnitConfigured],
  );

  const handlePauseUnit = useCallback(
    (unit: IngestionUnitRow) => {
      if (!ensureUnitConfigured(unit, "Pause ingestion")) {
        return;
      }
      handleAction(PAUSE_INGESTION_MUTATION, unit.unitId, "pause", "Ingestion paused", "Unable to pause ingestion");
    },
    [handleAction, ensureUnitConfigured],
  );

  const handleResetUnit = useCallback(
    (unit: IngestionUnitRow) => {
      if (!ensureUnitConfigured(unit, "Reset checkpoint")) {
        return;
      }
      handleAction(
        RESET_INGESTION_CHECKPOINT_MUTATION,
        unit.unitId,
        "reset",
        "Checkpoint reset",
        "Unable to reset checkpoint",
      );
    },
    [handleAction, ensureUnitConfigured],
  );

  const toastPortal = toastQueue.toasts.length ? (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-40 flex justify-end px-4 sm:px-6">
      <div className="flex w-full max-w-sm flex-col gap-2">
        {toastQueue.toasts.map((toast) => {
          const tone = toast.intent === "success" ? "text-emerald-200" : toast.intent === "error" ? "text-rose-200" : "text-white";
          return (
            <div
              key={toast.id}
              className={`pointer-events-auto rounded-2xl border border-white/10 bg-slate-900/90 px-4 py-3 text-sm text-white shadow-2xl backdrop-blur ${toast.intent === "success" ? "border-emerald-400/40" : toast.intent === "error" ? "border-rose-400/50" : ""}`}
            >
              <div className="flex items-start gap-3">
                <LuInfo className={`mt-0.5 h-4 w-4 ${tone}`} aria-hidden="true" />
                <div className="flex-1">
                  <p className="font-semibold">{toast.title}</p>
                  {toast.description ? <p className="mt-1 text-xs text-slate-200">{toast.description}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => toastQueue.dismissToast(toast.id)}
                  className="text-xs font-semibold uppercase tracking-[0.3em] text-white/70 transition hover:text-white"
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
    <div
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-950 text-slate-100"
      data-testid="ingestion-console"
    >
      {toastPortal}
      <div className="flex flex-none flex-col gap-3 border-b border-white/5 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-slate-400">Control Plane</p>
            <h1 className="text-2xl font-semibold text-white">Ingestion</h1>
            <p className="text-sm text-slate-400">
              Discover units, trigger runs, and keep Temporal workflows in sync. Updates stream directly from Metadata API.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => selectedEndpointId && loadUnits(selectedEndpointId, { silent: Boolean(units.length) })}
              disabled={!selectedEndpointId || unitsLoading}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:border-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <LuRefreshCcw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </button>
          </div>
        </div>
        {unitsRefetching ? (
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            <LuRefreshCcw className="h-3 w-3 animate-spin" aria-hidden="true" />
            Updating latest status…
          </div>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className="flex h-full flex-col border-r border-white/5 bg-slate-950/60 px-5 py-5 backdrop-blur"
          style={{ width: endpointSidebarWidth }}
        >
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Endpoints</label>
            <div className="relative">
              <LuSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="search"
                placeholder="Search by name or domain"
                value={endpointSearch}
                onChange={(event) => setEndpointSearch(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 py-2 pl-9 pr-4 text-sm text-white placeholder:text-slate-500 focus:border-white focus:outline-none"
              />
            </div>
          </div>
          <div className="mt-4 flex-1 overflow-y-auto pr-2">
            {endpointLoading && !endpoints.length ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-16 rounded-2xl bg-white/5 animate-pulse" />
                ))}
              </div>
            ) : endpointError ? (
              <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 py-4 text-sm text-rose-100">
                Unable to load endpoints.
                <br />
                {endpointError}
              </div>
            ) : endpointOptions.length ? (
              <div className="space-y-2">
                {endpointOptions.map((endpoint) => {
                  const isActive = endpoint.id === selectedEndpointId;
                  return (
                    <button
                      key={endpoint.id}
                      type="button"
                      disabled={endpoint.disabled}
                      onClick={() => applySelectedEndpoint(endpoint.id)}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                        isActive
                          ? "border-white bg-white/5 shadow-lg"
                          : "border-white/5 bg-white/5 hover:border-white/40"
                      } ${endpoint.disabled ? "opacity-50" : ""}`}
                    >
                      <p className="text-sm font-semibold text-white">{endpoint.name}</p>
                      <p className="text-xs text-slate-400">{endpoint.description}</p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 px-4 py-6 text-center text-sm text-slate-400">
                No endpoints match this filter.
              </div>
            )}
          </div>
        </aside>
        <main className="flex min-h-0 flex-1 flex-col px-6 py-5">
          {!selectedEndpoint ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
              <LuCircleSlash className="mb-3 h-10 w-10 text-slate-500" />
              <p className="text-lg font-semibold text-white">Select an endpoint to inspect ingestion</p>
              <p className="mt-1 text-sm">Use the sidebar to choose a source. Units, checkpoints, and actions will show here.</p>
            </div>
          ) : unitsLoading && !units.length ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-slate-400">
                <LuRefreshCcw className="h-8 w-8 animate-spin text-slate-300" />
                <p>Loading ingestion units…</p>
              </div>
            </div>
          ) : unitsError ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center text-rose-100">
              <LuTriangleAlert className="mb-3 h-10 w-10" />
              <p className="text-lg font-semibold">Unable to load ingestion units</p>
              <p className="mt-1 text-sm text-rose-200">{unitsError}</p>
              <button
                type="button"
                onClick={() => selectedEndpointId && loadUnits(selectedEndpointId)}
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/40 px-4 py-2 text-sm font-semibold text-white transition hover:border-white"
              >
                <LuRefreshCcw className="h-4 w-4" />
                Retry
              </button>
            </div>
          ) : units.length === 0 ? (
            <div
              className="flex flex-1 flex-col items-center justify-center text-center text-slate-400"
              data-testid="ingestion-empty-state"
            >
              <LuCircleDashed className="mb-3 h-10 w-10 text-slate-500" />
              <p className="text-lg font-semibold text-white">No ingestion units yet</p>
              <p className="mt-1 text-sm">
                The selected endpoint has not registered any units. Configure a driver or re-register the source.
              </p>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="flex flex-col gap-2 rounded-3xl border border-white/10 bg-white/5 px-5 py-4">
                <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.3em] text-slate-400">
                  <span className="font-semibold text-white">{selectedEndpoint.name}</span>
                  <LuArrowRight className="h-3 w-3 text-slate-500" aria-hidden="true" />
                  <span>{selectedEndpoint.domain ?? "custom"}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                  {selectedEndpoint.capabilities?.slice(0, 4).map((capability) => (
                    <span key={capability} className="rounded-full border border-white/10 px-2 py-0.5 text-xs uppercase tracking-[0.2em]">
                      {capability}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-6 flex-1 overflow-auto rounded-3xl border border-white/5 bg-slate-950/40">
                <table className="min-w-full divide-y divide-white/5 text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.35em] text-slate-400">
                      <th className="px-6 py-4">Unit</th>
                      <th className="px-6 py-4">State</th>
                      <th className="px-6 py-4">Mode</th>
                      <th className="px-6 py-4">Schedule</th>
                      <th className="px-6 py-4">Sink</th>
                      <th className="px-6 py-4">Last Run</th>
                      <th className="px-6 py-4">Stats</th>
                      <th className="px-6 py-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {units.map((unit) => {
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
                      const scheduleInterval =
                        scheduleKind === "INTERVAL"
                          ? config?.scheduleIntervalMinutes ?? unit.defaultScheduleIntervalMinutes ?? 15
                          : null;
                      const scheduleLabel = formatIngestionSchedule(scheduleKind, scheduleInterval);
                      const sinkLabel = formatIngestionSink(config?.sinkId ?? unit.sinkId);
                      const policySummary = summarizePolicy(config?.policy ?? unit.defaultPolicy ?? null);
                      const canMutate = isAdmin;
                      const canControl = canMutate && isEnabled;
                      return (
                        <tr key={unit.unitId} className="align-top text-slate-200" data-testid="ingestion-unit-row">
                          <td className="px-6 py-4">
                            <div className="font-semibold text-white">{unit.displayName}</div>
                            <p className="text-xs text-slate-400">{unit.unitId}</p>
                          </td>
                          <td className="px-6 py-4">
                            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${tone.badge}`}>
                              <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                              {tone.label}
                            </div>
                            {unit.lastError ? (
                              <p className="mt-2 flex items-center gap-2 text-xs text-rose-200">
                                <LuTriangleAlert className="h-3 w-3" /> {unit.lastError}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-6 py-4">
                            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em]">
                              {effectiveMode}
                            </div>
                            {policySummary.length ? (
                              <div className="mt-2 text-[11px] uppercase tracking-[0.3em] text-slate-400">
                                {policySummary.join(" · ")}
                              </div>
                            ) : (
                              <p className="mt-2 text-xs text-slate-500">No policy overrides.</p>
                            )}
                            {!isConfigured ? (
                              <p className="mt-2 text-xs text-amber-200">Configure this unit to enable ingestion.</p>
                            ) : null}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2 text-slate-300">
                              <LuClock3 className="h-4 w-4" /> {scheduleLabel}
                            </div>
                            {scheduleKind === "INTERVAL" && scheduleInterval ? (
                              <p className="text-xs text-slate-500">Interval · every {scheduleInterval} minutes</p>
                            ) : (
                              <p className="text-xs text-slate-500">Manual runs only.</p>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em]">
                              {sinkLabel}
                            </div>
                            <p className="mt-2 text-xs text-slate-500">
                              {isEnabled ? "Enabled" : isConfigured ? "Configured but disabled" : "Not configured"}
                            </p>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2 text-slate-300">
                              <LuClock3 className="h-4 w-4" /> {relativeRun}
                            </div>
                            {unit.lastRunId ? <p className="text-xs text-slate-500">{unit.lastRunId}</p> : null}
                          </td>
                          <td className="px-6 py-4">
                            {statsSummary ? (
                              <div className="flex flex-wrap gap-2 text-xs">
                                {statsSummary.map((entry) => (
                                  <span key={entry.label} className="rounded-full border border-white/10 px-2 py-0.5 text-slate-300">
                                    {entry.label}: <span className="font-semibold text-white">{entry.value}</span>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-slate-500">No stats</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col gap-3">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => openConfigureDrawer(unit)}
                                  disabled={!canMutate}
                                  className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-slate-200 transition hover:border-white disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  <LuSlidersHorizontal className="h-3 w-3" />
                                  Configure
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleUnit(unit, !isEnabled)}
                                  disabled={!canMutate || isBusy}
                                  className={`inline-flex items-center gap-3 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] transition ${
                                    isEnabled
                                      ? "border-emerald-400/30 text-emerald-100"
                                      : "border-slate-400/40 text-slate-200"
                                  } disabled:cursor-not-allowed disabled:opacity-40`}
                                >
                                  <span
                                    className={`flex h-5 w-10 items-center rounded-full ${isEnabled ? "bg-emerald-500/70" : "bg-slate-600/80"}`}
                                  >
                                    <span
                                      className={`h-4 w-4 rounded-full bg-white transition ${
                                        isEnabled ? "translate-x-5" : "translate-x-1"
                                      }`}
                                    />
                                  </span>
                                  {isEnabled ? "Disable" : "Enable"}
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleRunUnit(unit)}
                                  disabled={isBusy || !canControl}
                                  className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-100 transition hover:border-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {localIntent === "start" ? (
                                    <LuRefreshCcw className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <LuCirclePlay className="h-3 w-3" />
                                  )}
                                  Run
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handlePauseUnit(unit)}
                                  disabled={isBusy || !canControl}
                                  className="inline-flex items-center gap-2 rounded-full border border-amber-400/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-amber-100 transition hover:border-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {localIntent === "pause" ? (
                                    <LuRefreshCcw className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <LuCirclePause className="h-3 w-3" />
                                  )}
                                  Pause
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleResetUnit(unit)}
                                  disabled={isBusy || !canControl}
                                  className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-slate-200 transition hover:border-white disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {localIntent === "reset" ? (
                                    <LuRefreshCcw className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <LuCircleSlash className="h-3 w-3" />
                                  )}
                                  Reset
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>
      {configuringUnit && configForm ? (
        <div className="pointer-events-auto fixed inset-0 z-40 flex">
          <div
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
            aria-hidden="true"
            onClick={() => {
              if (!configSaving) {
                closeConfigureDrawer();
              }
            }}
          />
          <div className="relative ml-auto flex h-full w-full max-w-md flex-col bg-slate-950/95 p-6 text-slate-100 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-slate-400">Configure ingestion</p>
                <h2 className="text-xl font-semibold text-white">{configuringUnit.displayName}</h2>
                <p className="text-xs text-slate-400">{configuringUnit.datasetId ?? configuringUnit.unitId}</p>
              </div>
              <button
                type="button"
                onClick={closeConfigureDrawer}
                disabled={configSaving}
                className="rounded-full border border-white/20 p-2 text-slate-200 transition hover:border-white disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Close configure drawer"
              >
                <LuX className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {configError ? (
              <div className="mt-4 rounded-2xl border border-rose-500/50 bg-rose-500/20 px-4 py-3 text-sm text-rose-100" role="alert">
                {configError}
              </div>
            ) : null}
            <div className="mt-5 flex-1 space-y-5 overflow-y-auto">
              <section className="rounded-2xl border border-white/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Enable ingestion</p>
                    <p className="text-[13px] text-slate-400">Toggle to allow schedules and manual runs.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateConfigForm({ enabled: !configForm.enabled })}
                    className={`inline-flex items-center gap-3 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] transition ${
                      configForm.enabled ? "border-emerald-400/40 text-emerald-100" : "border-slate-500/50 text-slate-200"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-10 items-center rounded-full ${configForm.enabled ? "bg-emerald-500/70" : "bg-slate-600/80"}`}
                    >
                      <span
                        className={`h-4 w-4 rounded-full bg-white transition ${
                          configForm.enabled ? "translate-x-5" : "translate-x-1"
                        }`}
                      />
                    </span>
                    {configForm.enabled ? "Enabled" : "Disabled"}
                  </button>
                </div>
              </section>
              <section className="rounded-2xl border border-white/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Mode &amp; policy</p>
                <div className="mt-3 space-y-3">
                  <label className="block text-sm text-slate-200">
                    Mode
                    <select
                      value={configForm.runMode}
                      onChange={(event) => updateConfigForm({ runMode: event.target.value.toUpperCase() })}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white"
                    >
                      {Array.from(
                        new Set(
                          (configuringUnit.supportedModes ?? [configuringUnit.defaultMode ?? "FULL"]).map((mode) =>
                            (mode ?? "FULL").toUpperCase(),
                          ),
                        ),
                      ).map((mode) => (
                        <option key={mode} value={mode}>
                          {mode === "INCREMENTAL" ? "Incremental (cursor)" : mode === "FULL" ? "Full refresh" : mode}
                        </option>
                      ))}
                    </select>
                  </label>
                  {configuringUnit.cdmModelId ? (
                    <label className="block text-sm text-slate-200">
                      Data format
                      <select
                        value={configForm.mode}
                        onChange={(event) => {
                          const nextMode = event.target.value;
                          if (
                            nextMode === "cdm" &&
                            configuringUnit.cdmModelId &&
                            cdmCompatibleSinkIds.length > 0 &&
                            !sinkSupportsCdm(configForm.sinkId, configuringUnit.cdmModelId)
                          ) {
                            updateConfigForm({ mode: nextMode, sinkId: cdmCompatibleSinkIds[0] });
                            return;
                          }
                          updateConfigForm({ mode: nextMode });
                        }}
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white"
                      >
                        <option value="raw">Store raw source data</option>
                        <option value="cdm" disabled={cdmCompatibleSinkIds.length === 0}>
                          Apply CDM ({configuringUnit.cdmModelId})
                        </option>
                      </select>
                      {configForm.mode === "cdm" && cdmCompatibleSinkIds.length === 0 ? (
                        <span className="mt-1 block text-xs text-amber-300">
                          No sinks currently support this CDM model.
                        </span>
                      ) : null}
                    </label>
                  ) : null}
                  <label className="block text-sm text-slate-200">
                    Policy (JSON)
                    <textarea
                      value={configForm.policyText}
                      onChange={(event) => updateConfigForm({ policyText: event.target.value })}
                      rows={4}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white"
                      placeholder='{"cursorField":"updated","primaryKeys":["id"]}'
                    />
                    <span className="mt-1 block text-xs text-slate-400">
                      Leave empty to use the endpoint defaults ({summarizePolicy(configuringUnit.defaultPolicy ?? null).join(" · ") || "no cursor"}).
                    </span>
                  </label>
                </div>
              </section>
              {supportsJiraFilters && configForm ? (
                <section className="rounded-2xl border border-white/10 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Filters</p>
                    <button
                      type="button"
                      onClick={resetJiraFilterForm}
                      className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-300/80 transition hover:text-white"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="mt-3 grid gap-3">
                    <label className="block text-sm text-slate-200">
                      Projects
                      <select
                        multiple
                        value={configForm.jiraFilter.projectKeys}
                        onChange={(event) => handleFilterMultiSelect(event, "projectKeys")}
                        disabled={jiraFilterLoading}
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white"
                      >
                        {(jiraFilterOptions?.projects ?? []).map((project) => (
                          <option key={project.key} value={project.key} className="bg-slate-900 text-slate-100">
                            {project.name ?? project.key}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm text-slate-200">
                      Statuses
                      <select
                        multiple
                        value={configForm.jiraFilter.statuses}
                        onChange={(event) => handleFilterMultiSelect(event, "statuses")}
                        disabled={jiraFilterLoading}
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white"
                      >
                        {(jiraFilterOptions?.statuses ?? []).map((status) => (
                          <option key={status.id} value={status.name} className="bg-slate-900 text-slate-100">
                            {status.name}
                            {status.category ? ` · ${status.category}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm text-slate-200">
                      Assignees
                      <select
                        multiple
                        value={configForm.jiraFilter.assigneeIds}
                        onChange={(event) => handleFilterMultiSelect(event, "assigneeIds")}
                        disabled={jiraFilterLoading}
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white"
                      >
                        {(jiraFilterOptions?.users ?? []).map((user) => (
                          <option key={user.accountId} value={user.accountId} className="bg-slate-900 text-slate-100">
                            {user.displayName ?? user.accountId}
                            {user.email ? ` · ${user.email}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm text-slate-200">
                      Updated from
                      <input
                        type="datetime-local"
                        value={formatDateInputValue(configForm.jiraFilter.updatedFrom)}
                        onChange={(event) => {
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
                        }}
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white"
                      />
                      <span className="mt-1 block text-xs text-slate-400">Leave blank to sync full history for new projects.</span>
                    </label>
                  </div>
                  {jiraFilterLoading ? (
                    <p className="mt-2 text-xs text-slate-400">Loading filter options…</p>
                  ) : jiraFilterError ? (
                    <p className="mt-2 text-xs text-amber-300">{jiraFilterError}</p>
                  ) : null}
                  <p className="mt-3 text-xs text-slate-400">
                    Filter changes keep existing project cursors. Newly added projects use the Updated From timestamp (or all history if not set).
                  </p>
                </section>
              ) : null}
              <section className="rounded-2xl border border-white/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Schedule</p>
                <div className="mt-3 space-y-3">
                  <label className="block text-sm text-slate-200">
                    Trigger
                    <select
                      value={configForm.scheduleKind}
                      onChange={(event) => updateConfigForm({ scheduleKind: event.target.value.toUpperCase() })}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white"
                    >
                      <option value="MANUAL">Manual only</option>
                      <option value="INTERVAL">Fixed interval</option>
                    </select>
                  </label>
                  {configForm.scheduleKind === "INTERVAL" ? (
                    <label className="block text-sm text-slate-200">
                      Interval (minutes)
                      <input
                        type="number"
                        min={1}
                        value={configForm.scheduleIntervalMinutes}
                        onChange={(event) =>
                          updateConfigForm({
                            scheduleIntervalMinutes: Math.max(1, Number(event.target.value) || 1),
                          })
                        }
                        className="mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white"
                      />
                    </label>
                  ) : null}
                </div>
              </section>
              <section className="rounded-2xl border border-white/10 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Sink</p>
                <label className="mt-3 block text-sm text-slate-200">
                  Destination
                  <select
                    value={configForm.sinkId}
                    onChange={(event) => updateConfigForm({ sinkId: event.target.value })}
                    className="mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white"
                  >
                    {drawerSinkOptions.map((sink) => {
                      const disabled =
                        configForm.mode === "cdm" && configuringUnit.cdmModelId
                          ? !sinkSupportsCdm(sink, configuringUnit.cdmModelId)
                          : false;
                      return (
                        <option key={sink} value={sink} disabled={disabled}>
                          {formatIngestionSink(sink)}
                        </option>
                      );
                    })}
                  </select>
                  <span className="mt-1 block text-xs text-slate-400">
                    Registered sinks determine where normalized records land (Knowledge Base is the default).
                  </span>
                  {configForm.mode === "cdm" && configuringUnit.cdmModelId && !sinkSupportsCdm(configForm.sinkId, configuringUnit.cdmModelId) ? (
                    <span className="mt-1 block text-xs text-amber-300">
                      Select a sink that supports {configuringUnit.cdmModelId} to enable CDM mode.
                    </span>
                  ) : null}
                  {configForm.mode === "cdm" ? (
                    <div className="mt-4">
                      <label className="block text-sm text-slate-200">
                        Sink endpoint
                        {cdmSinkEndpoints.length > 0 ? (
                          <select
                            value={configForm.sinkEndpointId ?? ""}
                            onChange={(event) => updateConfigForm({ sinkEndpointId: event.target.value || null })}
                            className="mt-2 w-full rounded-2xl border border-white/10 bg-transparent px-3 py-2 text-sm text-white outline-none focus:border-white"
                          >
                            <option value="">Select CDM sink endpoint</option>
                            {cdmSinkEndpoints.map((endpoint) => (
                              <option key={endpoint.id} value={endpoint.id}>
                                {endpoint.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <p className="mt-2 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                            No CDM sink endpoints found. Register a <code className="font-mono text-amber-100">cdm.jdbc</code> endpoint to enable CDM mode.
                          </p>
                        )}
                      </label>
                    </div>
                  ) : null}
                </label>
              </section>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeConfigureDrawer}
                disabled={configSaving}
                className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveConfig}
                disabled={saveDisabled}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-400/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {configSaving ? <LuRefreshCcw className="h-4 w-4 animate-spin" /> : null}
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function summarizeStats(stats?: Record<string, unknown> | null) {
  if (!stats) {
    return null;
  }
  const entries: Array<{ label: string; value: string }> = [];
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

function getNumeric(stats: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = extractNested(stats, key);
    if (typeof value === "number") {
      return value;
    }
  }
  return null;
}

function extractNested(payload: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === "object" && segment in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, payload);
}

function buildConfigInput(unit: IngestionUnitRow, overrides: ConfigOverrides) {
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
  };
  const nextScheduleKind = normalizeScheduleKind(overrides.scheduleKind ?? fallback.scheduleKind);
  const intervalValue =
    nextScheduleKind === "INTERVAL"
      ? overrides.scheduleIntervalMinutes ?? fallback.scheduleIntervalMinutes ?? 15
      : null;
  const nextFilter =
    overrides.jiraFilter === undefined
      ? fallback.jiraFilter
      : overrides.jiraFilter ?? DEFAULT_JIRA_FILTER_FORM;
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
    scheduleIntervalMinutes:
      nextScheduleKind === "INTERVAL"
        ? Math.max(1, Math.trunc(typeof intervalValue === "number" && !Number.isNaN(intervalValue) ? intervalValue : 15))
        : null,
    policy: overrides.policy === undefined ? fallback.policy : overrides.policy,
    jiraFilter: formatJiraFilterInputFromForm(nextFilter),
  };
}

function matchesCdmPattern(pattern: string, target: string) {
  if (pattern === "*" || pattern === target) {
    return true;
  }
  if (pattern.endsWith("*")) {
    return target.startsWith(pattern.slice(0, -1));
  }
  return pattern === target;
}

function normalizeScheduleKind(kind?: string | null) {
  return (kind ?? "MANUAL").toUpperCase() === "INTERVAL" ? "INTERVAL" : "MANUAL";
}

function stringifyPolicy(policy?: Record<string, unknown> | null) {
  if (!policy) {
    return "";
  }
  try {
    return JSON.stringify(policy, null, 2);
  } catch {
    return "";
  }
}

function reduceJiraFilterToFormValue(source?: JiraIngestionFilterSummary | JiraFilterFormState | null): JiraFilterFormState {
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

function coerceFilterArray(value?: string[] | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0),
    ),
  );
}

function formatJiraFilterInputFromForm(filter?: JiraFilterFormState | null): JiraIngestionFilterSummary | null {
  if (!filter) {
    return null;
  }
  const payload: JiraIngestionFilterSummary = {};
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

function formatDateInputValue(value: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 16);
}

function isJiraUnitId(unitId?: string | null) {
  if (!unitId) {
    return false;
  }
  return unitId.toLowerCase().startsWith("jira.");
}
