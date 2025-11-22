import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
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
  LuSearch,
  LuTriangleAlert,
} from "react-icons/lu";
import { formatRelativeTime } from "../lib/format";
import { fetchMetadataGraphQL } from "../metadata/api";
import {
  INGESTION_ENDPOINTS_QUERY,
  INGESTION_UNITS_WITH_STATUS_QUERY,
  START_INGESTION_MUTATION,
  PAUSE_INGESTION_MUTATION,
  RESET_INGESTION_CHECKPOINT_MUTATION,
} from "../metadata/queries";
import {
  IngestionStatusSummary,
  IngestionState,
  IngestionUnitSummary,
  MetadataEndpointSummary,
} from "../metadata/types";
import { useDebouncedValue, useToastQueue } from "../metadata/hooks";
import type { Role } from "../auth/AuthProvider";

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
};

type IngestionActionResult = {
  ok: boolean;
  runId?: string | null;
  state?: IngestionState | null;
  message?: string | null;
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
};

const ingestStateTone: Record<
  IngestionState,
  {
    label: string;
    badge: string;
    dot: string;
    icon: ComponentType<{ className?: string }>;
  }
> = {
  RUNNING: {
    label: "Running",
    badge: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/60 dark:bg-sky-500/10 dark:text-sky-100",
    dot: "bg-sky-500 animate-pulse",
    icon: LuCircle,
  },
  SUCCEEDED: {
    label: "Healthy",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/60 dark:bg-emerald-500/10 dark:text-emerald-100",
    dot: "bg-emerald-500",
    icon: LuCircleCheck,
  },
  FAILED: {
    label: "Failed",
    badge: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100",
    dot: "bg-rose-500 animate-pulse",
    icon: LuCircleX,
  },
  PAUSED: {
    label: "Paused",
    badge: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-50",
    dot: "bg-amber-500",
    icon: LuCirclePause,
  },
  IDLE: {
    label: "Idle",
    badge: "border-slate-200 bg-white text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100",
    dot: "bg-slate-400",
    icon: LuCircleDashed,
  },
};

const endpointSidebarWidth = 320;

export function IngestionConsole({ metadataEndpoint, authToken, projectSlug, userRole }: IngestionConsoleProps) {
  const [endpointSearch, setEndpointSearch] = useState("");
  const debouncedSearch = useDebouncedValue(endpointSearch, 350);
  const [endpoints, setEndpoints] = useState<MetadataEndpointSummary[]>([]);
  const [endpointLoading, setEndpointLoading] = useState(false);
  const [endpointError, setEndpointError] = useState<string | null>(null);
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [units, setUnits] = useState<IngestionUnitRow[]>([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [unitsRefetching, setUnitsRefetching] = useState(false);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [unitsVersion, setUnitsVersion] = useState(0);
  const [actionState, setActionState] = useState<Record<string, "start" | "pause" | "reset">>({});
  const toastQueue = useToastQueue();
  const isAdmin = userRole === "ADMIN";
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!metadataEndpoint || !authToken) {
      setEndpoints([]);
      setEndpointLoading(false);
      setEndpointError(null);
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
        if (!selectedEndpointId && data.endpoints?.length) {
          setSelectedEndpointId(data.endpoints[0]?.id ?? null);
        } else if (selectedEndpointId && !data.endpoints?.some((endpoint) => endpoint.id === selectedEndpointId)) {
          setSelectedEndpointId(data.endpoints?.[0]?.id ?? null);
        }
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
  }, [metadataEndpoint, authToken, projectSlug, debouncedSearch, selectedEndpointId]);

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
        const combined: IngestionUnitRow[] = (payload.ingestionUnits ?? []).map((unit) => {
          const status = statuses.get(unit.unitId);
          return {
            ...unit,
            state: status?.state ?? "IDLE",
            lastRunAt: status?.lastRunAt ?? null,
            lastRunId: status?.lastRunId ?? null,
            lastError: status?.lastError ?? null,
            stats: (status?.stats ?? unit.stats ?? null) as Record<string, unknown> | null,
            checkpoint: (status?.checkpoint ?? null) as Record<string, unknown> | null,
          };
        });
        combined.sort((a, b) => a.displayName.localeCompare(b.displayName));
        setUnits(combined);
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
      setUnitsError(null);
      return;
    }
    void loadUnits(selectedEndpointId, { silent: Boolean(units.length) });
  }, [selectedEndpointId, loadUnits, unitsVersion]);

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

  const handleRunUnit = useCallback(
    (unitId: string) =>
      handleAction(START_INGESTION_MUTATION, unitId, "start", "Ingestion run started", "Unable to start ingestion"),
    [handleAction],
  );

  const handlePauseUnit = useCallback(
    (unitId: string) =>
      handleAction(PAUSE_INGESTION_MUTATION, unitId, "pause", "Ingestion paused", "Unable to pause ingestion"),
    [handleAction],
  );

  const handleResetUnit = useCallback(
    (unitId: string) =>
      handleAction(
        RESET_INGESTION_CHECKPOINT_MUTATION,
        unitId,
        "reset",
        "Checkpoint reset",
        "Unable to reset checkpoint",
      ),
    [handleAction],
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
                      onClick={() => setSelectedEndpointId(endpoint.id)}
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
                      <th className="px-6 py-4">Last Run</th>
                      <th className="px-6 py-4">Stats</th>
                      <th className="px-6 py-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {units.map((unit) => {
                      const tone = ingestStateTone[unit.state];
                      const relativeRun = unit.lastRunAt ? formatRelativeTime(unit.lastRunAt) : "Never";
                      const isBusy = Boolean(actionState[unit.unitId]);
                      const localIntent = actionState[unit.unitId];
                      const statsSummary = summarizeStats(unit.stats);
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
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => handleRunUnit(unit.unitId)}
                                disabled={isBusy || !isAdmin}
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
                                onClick={() => handlePauseUnit(unit.unitId)}
                                disabled={isBusy || !isAdmin}
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
                                onClick={() => handleResetUnit(unit.unitId)}
                                disabled={isBusy || !isAdmin}
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
