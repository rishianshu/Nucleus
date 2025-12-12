import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LuActivity, LuArrowUpRight, LuFilter, LuRefreshCcw, LuTriangle } from "react-icons/lu";
import { fetchMetadataGraphQL } from "../metadata/api";
import { SIGNAL_DEFINITIONS_QUERY, SIGNAL_INSTANCES_PAGE_QUERY, CDM_ENTITY_QUERY } from "../metadata/queries";
import type { SignalDefinitionSummary, SignalInstancePage, SignalInstanceRow } from "../metadata/types";
import { useDebouncedValue } from "../metadata/hooks";
import { formatDateTime, formatRelativeTime } from "../lib/format";

type SignalsConsoleProps = {
  metadataEndpoint: string | null;
  authToken?: string | null;
};

const PAGE_SIZE = 25;
const SEVERITY_OPTIONS = ["CRITICAL", "ERROR", "WARNING", "INFO"];
const STATUS_OPTIONS = ["OPEN", "RESOLVED", "SUPPRESSED"];

function resolveDomainFromModel(modelId?: string | null): "WORK_ITEM" | "DOC_ITEM" | null {
  if (!modelId) return null;
  if (modelId.startsWith("cdm.work.item")) return "WORK_ITEM";
  if (modelId.startsWith("cdm.doc.item")) return "DOC_ITEM";
  return null;
}

export function SignalsConsole({ metadataEndpoint, authToken }: SignalsConsoleProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialEntityRef = searchParams.get("entityRef") ?? "";
  const headers = useMemo(() => ({ token: authToken ?? undefined }), [authToken]);

  const [definitions, setDefinitions] = useState<SignalDefinitionSummary[]>([]);
  const [rows, setRows] = useState<SignalInstanceRow[]>([]);
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedSeverities, setSelectedSeverities] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["OPEN"]);
  const [selectedSourceFamilies, setSelectedSourceFamilies] = useState<string[]>([]);
  const [selectedEntityKinds, setSelectedEntityKinds] = useState<string[]>([]);
  const [selectedPolicyKinds, setSelectedPolicyKinds] = useState<string[]>([]);
  const [definitionSearch, setDefinitionSearch] = useState("");
  const [entityRefFilter, setEntityRefFilter] = useState(initialEntityRef);
  const [timeWindow, setTimeWindow] = useState<string>("any");
  const [entityDetails, setEntityDetails] = useState<Record<string, { title?: string | null; sourceUrl?: string | null }>>({});
  const entityDetailsRef = useRef<Record<string, { title?: string | null; sourceUrl?: string | null }>>({});

  const debouncedDefinitionSearch = useDebouncedValue(definitionSearch, 300);
  const debouncedEntityRef = useDebouncedValue(entityRefFilter, 300);

  const sourceFamilyOptions = useMemo(() => {
    const values = new Set<string>();
    definitions.forEach((def) => {
      if (def.sourceFamily) values.add(def.sourceFamily);
    });
    rows.forEach((row) => {
      if (row.sourceFamily) values.add(row.sourceFamily);
    });
    return Array.from(values).sort();
  }, [definitions, rows]);

  const entityKindOptions = useMemo(() => {
    const values = new Set<string>();
    definitions.forEach((def) => {
      if (def.entityKind) values.add(def.entityKind);
    });
    rows.forEach((row) => values.add(row.entityKind));
    return Array.from(values).sort();
  }, [definitions, rows]);

  const policyKindOptions = useMemo(() => {
    const values = new Set<string>();
    definitions.forEach((def) => {
      if (def.policyKind) values.add(def.policyKind);
    });
    rows.forEach((row) => {
      if (row.policyKind) values.add(row.policyKind);
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
    if (!metadataEndpoint) return;
    try {
      const data = await fetchMetadataGraphQL<{ signalDefinitions: SignalDefinitionSummary[] }>(
        metadataEndpoint,
        SIGNAL_DEFINITIONS_QUERY,
        undefined,
        undefined,
        headers,
      );
      setDefinitions(data.signalDefinitions ?? []);
    } catch (err) {
      console.error(err);
    }
  }, [metadataEndpoint, headers]);

  const enrichEntities = useCallback(
    async (records: SignalInstanceRow[], reset: boolean) => {
      if (!metadataEndpoint) return;
      const pending: Record<string, { title?: string | null; sourceUrl?: string | null }> = {};
      for (const row of records) {
        if (entityDetailsRef.current[row.entityRef]) {
          continue;
        }
        const domain = resolveDomainFromModel(row.entityCdmModelId);
        if (!domain || !row.entityCdmId) {
          continue;
        }
        try {
          const detail = await fetchMetadataGraphQL<{ cdmEntity: { title?: string | null; docTitle?: string | null; sourceUrl?: string | null; docUrl?: string | null } | null }>(
            metadataEndpoint,
            CDM_ENTITY_QUERY,
            { id: row.entityCdmId, domain },
            undefined,
            headers,
          );
          const entity = detail.cdmEntity;
          if (entity) {
            pending[row.entityRef] = {
              title: entity.title ?? entity.docTitle ?? null,
              sourceUrl: entity.sourceUrl ?? entity.docUrl ?? null,
            };
          }
        } catch (err) {
          console.warn("[signals] failed to enrich entity", row.entityRef, err);
        }
      }
      if (Object.keys(pending).length > 0) {
        setEntityDetails((prev) => (reset ? { ...pending } : { ...prev, ...pending }));
      }
    },
    [metadataEndpoint, headers],
  );

  const buildFilter = useCallback(() => {
    const filter: Record<string, unknown> = {};
    if (selectedSeverities.length) filter.severity = selectedSeverities;
    if (selectedStatuses.length) filter.status = selectedStatuses;
    if (selectedSourceFamilies.length) filter.sourceFamily = selectedSourceFamilies;
    if (selectedEntityKinds.length) filter.entityKinds = selectedEntityKinds;
    if (selectedPolicyKinds.length) filter.policyKind = selectedPolicyKinds;
    if (debouncedDefinitionSearch.trim().length) filter.definitionSearch = debouncedDefinitionSearch.trim();
    if (debouncedEntityRef.trim().length) filter.entityRef = debouncedEntityRef.trim();
    if (timeWindowFromIso) filter.from = timeWindowFromIso;
    return Object.keys(filter).length ? filter : undefined;
  }, [selectedSeverities, selectedStatuses, selectedSourceFamilies, selectedEntityKinds, selectedPolicyKinds, debouncedDefinitionSearch, debouncedEntityRef, timeWindowFromIso]);

  const loadSignals = useCallback(
    async (cursor: string | null, reset: boolean) => {
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
        const data = await fetchMetadataGraphQL<{ signalInstancesPage: SignalInstancePage }>(
          metadataEndpoint,
          SIGNAL_INSTANCES_PAGE_QUERY,
          variables,
          undefined,
          headers,
        );
        const nextRows = data.signalInstancesPage?.rows ?? [];
        setRows((prev) => (reset ? nextRows : [...prev, ...nextRows]));
        setHasNextPage(Boolean(data.signalInstancesPage?.hasNextPage));
        setPageCursor(data.signalInstancesPage?.cursor ?? null);
        await enrichEntities(nextRows, reset);
      } catch (err) {
        console.error(err);
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [metadataEndpoint, headers, buildFilter, enrichEntities],
  );

  useEffect(() => {
    loadDefinitions();
  }, [loadDefinitions]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    if (entityRefFilter) {
      nextParams.set("entityRef", entityRefFilter);
    } else {
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

  const toggleSelection = useCallback((value: string, list: string[], setter: (next: string[]) => void) => {
    setter(list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);
  }, []);

  const handleViewEntity = useCallback(
    (row: SignalInstanceRow) => {
      const domain = resolveDomainFromModel(row.entityCdmModelId);
      if (!domain || !row.entityCdmId) {
        return;
      }
      if (domain === "WORK_ITEM") {
        navigate(`/cdm/work?selected=${encodeURIComponent(row.entityCdmId)}`);
      } else if (domain === "DOC_ITEM") {
        navigate(`/cdm/docs/${encodeURIComponent(row.entityCdmId)}`);
      }
    },
    [navigate],
  );

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
    return (
      <div className="p-6 text-sm text-slate-500" data-testid="signals-view">
        Signals view unavailable: metadata endpoint not configured.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6" data-testid="signals-view">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500">Signals</p>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Signals Explorer</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            List, filter, and navigate SignalInstances across CDM entities.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
            onClick={() => loadSignals(null, true)}
            data-testid="signals-refresh"
          >
            <LuRefreshCcw className="h-4 w-4" /> Refresh
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
            onClick={clearFilters}
          >
            <LuFilter className="h-4 w-4" /> Clear filters
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <div className="grid gap-4 md:grid-cols-4">
          <FilterBlock label="Definition search">
            <input
              value={definitionSearch}
              onChange={(event) => setDefinitionSearch(event.target.value)}
              placeholder="Search slug or title"
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </FilterBlock>
          <FilterBlock label="Entity reference">
            <input
              value={entityRefFilter}
              onChange={(event) => setEntityRefFilter(event.target.value)}
              placeholder="cdm.work.item:…"
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              data-testid="signal-filter-entity-ref"
            />
          </FilterBlock>
          <FilterBlock label="Time window">
            <select
              value={timeWindow}
              onChange={(event) => setTimeWindow(event.target.value)}
              className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="any">Any time</option>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
            </select>
          </FilterBlock>
          <FilterBlock label="Source family">
            <div className="flex flex-wrap gap-2">
              {sourceFamilyOptions.length === 0 ? (
                <span className="text-xs text-slate-500">No source families yet.</span>
              ) : (
                sourceFamilyOptions.map((option) => (
                  <TogglePill
                    key={option}
                    label={option}
                    active={selectedSourceFamilies.includes(option)}
                    onClick={() => toggleSelection(option, selectedSourceFamilies, setSelectedSourceFamilies)}
                    dataTestId={`signal-filter-source-${option}`}
                  />
                ))
              )}
            </div>
          </FilterBlock>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <FilterGroup
            title="Severity"
            options={SEVERITY_OPTIONS}
            selected={selectedSeverities}
            onToggle={(value) => toggleSelection(value, selectedSeverities, setSelectedSeverities)}
            dataPrefix="signal-filter-severity"
          />
          <FilterGroup
            title="Status"
            options={STATUS_OPTIONS}
            selected={selectedStatuses}
            onToggle={(value) => toggleSelection(value, selectedStatuses, setSelectedStatuses)}
            dataPrefix="signal-filter-status"
          />
          <FilterGroup
            title="Entity kind"
            options={entityKindOptions}
            selected={selectedEntityKinds}
            onToggle={(value) => toggleSelection(value, selectedEntityKinds, setSelectedEntityKinds)}
            dataPrefix="signal-filter-entity"
          />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <FilterGroup
            title="Policy"
            options={policyKindOptions}
            selected={selectedPolicyKinds}
            onToggle={(value) => toggleSelection(value, selectedPolicyKinds, setSelectedPolicyKinds)}
            dataPrefix="signal-filter-policy"
          />
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        {error ? (
          <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100">
            {error}
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
            <thead className="bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:bg-slate-900/60">
              <tr>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Summary</th>
                <th className="px-4 py-3">Definition</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                    No signals match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} data-testid="signal-row" className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <SeverityPill severity={row.severity} />
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 dark:text-slate-300">
                      {row.status}
                    </td>
                    <td className="px-4 py-3 text-slate-800 dark:text-slate-100">{row.summary}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900 dark:text-white">{row.definitionTitle}</p>
                      <p className="text-xs text-slate-500">{row.definitionSlug}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                      <div className="flex flex-col">
                        <span>{row.sourceFamily ?? "—"}</span>
                        <span className="text-[11px] uppercase tracking-[0.3em] text-slate-500">{row.entityKind}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-800 dark:text-slate-100">
                      <p className="font-semibold">{entityDetails[row.entityRef]?.title ?? row.entityCdmId ?? row.entityRef}</p>
                      <p className="text-xs text-slate-500">{row.entityCdmModelId ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                      {row.lastSeenAt ? (
                        <span title={formatDateTime(row.lastSeenAt)}>{formatRelativeTime(row.lastSeenAt)}</span>
                      ) : (
                        row.updatedAt ? <span title={formatDateTime(row.updatedAt)}>{formatRelativeTime(row.updatedAt)}</span> : "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleViewEntity(row)}
                          className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                          disabled={!row.entityCdmId}
                          data-testid="signal-view-entity"
                        >
                          <LuArrowUpRight className="h-4 w-4" /> View entity
                        </button>
                        {entityDetails[row.entityRef]?.sourceUrl ? (
                          <a
                            href={entityDetails[row.entityRef]?.sourceUrl ?? undefined}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                            data-testid="signal-open-source"
                          >
                            <LuActivity className="h-4 w-4" /> Open in source
                          </a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {loading ? (
          <div className="border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-500 dark:border-slate-800">
            Loading signals…
          </div>
        ) : null}
        {!loading && hasNextPage ? (
          <div className="border-t border-slate-100 px-4 py-3 text-center dark:border-slate-800">
            <button
              type="button"
              onClick={() => loadSignals(pageCursor, false)}
              className="rounded-full border border-slate-300 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
              data-testid="signals-load-more"
            >
              Load more
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FilterBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function FilterGroup({
  title,
  options,
  selected,
  onToggle,
  dataPrefix,
}: {
  title: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  dataPrefix: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500">{title}</p>
      <div className="flex flex-wrap gap-2">
        {options.length === 0 ? (
          <span className="text-xs text-slate-500">No options detected yet.</span>
        ) : (
          options.map((option) => (
            <TogglePill
              key={option}
              label={option}
              active={selected.includes(option)}
              onClick={() => onToggle(option)}
              dataTestId={`${dataPrefix}-${option}`}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TogglePill({
  label,
  active,
  onClick,
  dataTestId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  dataTestId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={dataTestId}
      className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] transition ${
        active
          ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
          : "border-slate-200 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

function SeverityPill({ severity }: { severity: string }) {
  const tone = severityTone(severity);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] ${tone.bg} ${tone.text}`}
    >
      <LuTriangle className="h-4 w-4" />
      {severity}
    </span>
  );
}

function severityTone(severity: string): { bg: string; text: string } {
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
