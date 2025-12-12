import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Role } from "../auth/AuthProvider";
import { fetchMetadataGraphQL } from "../metadata/api";
import {
  CDM_WORK_COMMENTS_QUERY,
  CDM_WORK_DATASETS_QUERY,
  CDM_WORK_ITEM_DETAIL_QUERY,
  CDM_WORK_ITEMS_QUERY,
  CDM_WORK_LOGS_QUERY,
  CDM_WORK_PROJECTS_QUERY,
  CDM_WORK_PROJECT_CONNECTION_QUERY,
  CDM_WORK_USERS_QUERY,
  SIGNALS_FOR_ENTITY_QUERY,
} from "../metadata/queries";
import type {
  CdmWorkComment,
  CdmWorkCommentConnection,
  CdmWorkDataset,
  CdmWorkEntityKind,
  CdmWorkItem,
  CdmWorkItemConnection,
  CdmWorkItemDetail,
  CdmWorkLog,
  CdmWorkLogConnection,
  CdmWorkProject,
  CdmWorkProjectConnection,
  CdmWorkUser,
  CdmWorkUserConnection,
  GraphPageInfo,
  SignalInstanceRow,
} from "../metadata/types";
import { useDebouncedValue } from "../metadata/hooks";

const DEFAULT_PAGE_SIZE = 25;

type CdmWorkListViewProps = {
  metadataEndpoint: string | null;
  authToken?: string | null;
  userRole: Role;
};

type WorkItemsResponse = {
  cdmWorkItems: CdmWorkItemConnection;
};

type WorkCommentsResponse = {
  cdmWorkComments: CdmWorkCommentConnection;
};

type WorkLogsResponse = {
  cdmWorkLogs: CdmWorkLogConnection;
};

type WorkItemDetailResponse = {
  cdmWorkItem: CdmWorkItemDetail | null;
};

type ProjectsResponse = {
  cdmWorkProjects: CdmWorkProject[];
};

type WorkProjectsConnectionResponse = {
  cdmWorkProjectConnection: CdmWorkProjectConnection;
};

type WorkUsersResponse = {
  cdmWorkUsers: CdmWorkUserConnection;
};

type WorkDatasetsResponse = {
  cdmWorkDatasets: CdmWorkDataset[];
};

type WorkItemRow = CdmWorkItem & { kind: "ITEM" };
type WorkCommentRow = CdmWorkComment & { kind: "COMMENT" };
type WorkLogRow = CdmWorkLog & { kind: "WORKLOG" };
type WorkProjectRow = CdmWorkProject & { kind: "PROJECT" };
type WorkUserRow = CdmWorkUser & { kind: "USER" };
type WorkRow = WorkItemRow | WorkCommentRow | WorkLogRow | WorkProjectRow | WorkUserRow;

const ENTITY_OPTIONS: Array<{ id: CdmWorkEntityKind; label: string }> = [
  { id: "ITEM", label: "Issues" },
  { id: "COMMENT", label: "Comments" },
  { id: "WORKLOG", label: "Worklogs" },
  { id: "PROJECT", label: "Projects" },
  { id: "USER", label: "Users" },
];

const ENTITY_SEARCH_PLACEHOLDER: Record<CdmWorkEntityKind, string> = {
  ITEM: "Search summaries or keys…",
  COMMENT: "Search comment body…",
  WORKLOG: "Search worklog notes…",
  PROJECT: "Search project names or keys…",
  USER: "Search display names or emails…",
};

export function CdmWorkListView({ metadataEndpoint, authToken }: CdmWorkListViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<CdmWorkProject[]>([]);
  const [datasets, setDatasets] = useState<CdmWorkDataset[]>([]);
  const [records, setRecords] = useState<WorkRow[]>([]);
  const [pageInfo, setPageInfo] = useState<{ endCursor: string | null; hasNextPage: boolean }>({ endCursor: null, hasNextPage: false });
  const [entityKind, setEntityKind] = useState<CdmWorkEntityKind>("ITEM");
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [datasetFilter, setDatasetFilter] = useState<string>("");
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 350);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<WorkRow | null>(null);
  const [detail, setDetail] = useState<CdmWorkItemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const headers = useMemo(() => ({ token: authToken ?? undefined }), [authToken]);

  const datasetLookup = useMemo(() => {
    const map = new Map<string, CdmWorkDataset>();
    datasets.forEach((entry) => map.set(entry.datasetId, entry));
    return map;
  }, [datasets]);

  const entityDatasetOptions = useMemo(
    () => datasets.filter((entry) => entry.entityKind === entityKind),
    [datasets, entityKind],
  );

  const uniqueStatuses = useMemo(() => {
    if (entityKind !== "ITEM") {
      return [];
    }
    const statusSet = new Set<string>();
    records.forEach((row) => {
      if (row.kind === "ITEM" && row.status) {
        statusSet.add(row.status);
      }
    });
    selectedStatuses.forEach((status) => statusSet.add(status));
    return Array.from(statusSet).sort();
  }, [entityKind, records, selectedStatuses]);

  const loadProjects = useCallback(async () => {
    if (!metadataEndpoint) {
      return;
    }
    try {
      const data = await fetchMetadataGraphQL<ProjectsResponse>(metadataEndpoint, CDM_WORK_PROJECTS_QUERY, undefined, undefined, headers);
      setProjects(data.cdmWorkProjects);
    } catch (err) {
      console.error(err);
      setError((err as Error).message);
    }
  }, [metadataEndpoint, headers]);

  const loadDatasets = useCallback(async () => {
    if (!metadataEndpoint) {
      return;
    }
    try {
      const data = await fetchMetadataGraphQL<WorkDatasetsResponse>(metadataEndpoint, CDM_WORK_DATASETS_QUERY, undefined, undefined, headers);
      setDatasets(data.cdmWorkDatasets);
    } catch (err) {
      console.error(err);
      setError((err as Error).message);
    }
  }, [metadataEndpoint, headers]);

  const loadRecords = useCallback(
    async (cursor: string | null, reset: boolean) => {
      if (!metadataEndpoint) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const variables = {
          filter: buildEntityFilter(entityKind, {
            projectCdmId: projectFilter,
            statuses: selectedStatuses,
            datasetId: datasetFilter,
            search: debouncedSearch,
          }),
          first: DEFAULT_PAGE_SIZE,
          after: cursor,
        };
        const { query, extractor } = resolveEntityQuery(entityKind);
        const data = await fetchMetadataGraphQL<
          WorkItemsResponse | WorkCommentsResponse | WorkLogsResponse | WorkProjectsConnectionResponse | WorkUsersResponse
        >(metadataEndpoint, query, variables, undefined, headers);
        const connection = extractor(data);
        const nextRows = connection.edges.map((edge) => ({ ...edge.node, kind: entityKind } as WorkRow));
        setRecords((prev) => (reset ? nextRows : [...prev, ...nextRows]));
        setPageInfo({
          endCursor: connection.pageInfo.endCursor ?? null,
          hasNextPage: connection.pageInfo.hasNextPage,
        });
      } catch (err) {
        console.error(err);
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [metadataEndpoint, headers, entityKind, projectFilter, selectedStatuses, datasetFilter, debouncedSearch],
  );

  const loadItemDetail = useCallback(
    async (row: WorkItemRow | null) => {
      if (!metadataEndpoint || !row) {
        setDetail(null);
        return;
      }
      setDetailLoading(true);
      try {
        const data = await fetchMetadataGraphQL<WorkItemDetailResponse>(
          metadataEndpoint,
          CDM_WORK_ITEM_DETAIL_QUERY,
          { cdmId: row.cdmId },
          undefined,
          headers,
        );
        setDetail(data.cdmWorkItem);
      } catch (err) {
        console.error(err);
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [metadataEndpoint, headers],
  );

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    loadDatasets();
  }, [loadDatasets]);

  useEffect(() => {
    loadRecords(null, true);
  }, [loadRecords]);

  useEffect(() => {
    if (entityKind !== "ITEM" && selectedStatuses.length) {
      setSelectedStatuses([]);
    }
    setSelectedRow(null);
    setDetail(null);
  }, [entityKind, selectedStatuses.length]);

  useEffect(() => {
    loadItemDetail(selectedRow && selectedRow.kind === "ITEM" ? selectedRow : null);
  }, [selectedRow, loadItemDetail]);

  useEffect(() => {
    const selectedId = searchParams.get("selected");
    if (!selectedId) {
      return;
    }
    const match = records.find((row) => row.cdmId === selectedId);
    if (match && (selectedRow?.cdmId !== match.cdmId || selectedRow.kind !== match.kind)) {
      setSelectedRow(match);
    }
  }, [records, searchParams, selectedRow]);

  useEffect(() => {
    const current = searchParams.get("selected");
    if (selectedRow?.kind === "ITEM" && selectedRow.cdmId) {
      if (current !== selectedRow.cdmId) {
        const next = new URLSearchParams(searchParams);
        next.set("selected", selectedRow.cdmId);
        setSearchParams(next, { replace: true });
      }
    } else if (current) {
      const next = new URLSearchParams(searchParams);
      next.delete("selected");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, selectedRow, setSearchParams]);

  if (!metadataEndpoint) {
    return <EmptyState title="Metadata endpoint not configured" description="Cannot load CDM Work data." />;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <Filters
          entityKind={entityKind}
          onEntityChange={setEntityKind}
          projects={projects}
          projectFilter={projectFilter}
          onProjectFilterChange={setProjectFilter}
          statuses={uniqueStatuses}
          selectedStatuses={selectedStatuses}
          onStatusToggle={(status) => toggleStatusFilter(status, selectedStatuses, setSelectedStatuses)}
          datasetOptions={entityDatasetOptions}
          datasetFilter={datasetFilter}
          onDatasetFilterChange={setDatasetFilter}
          searchInput={searchInput}
          onSearchInputChange={setSearchInput}
          searchPlaceholder={ENTITY_SEARCH_PLACEHOLDER[entityKind]}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          {error ? (
            <div className="p-6 text-sm text-rose-500">{error}</div>
          ) : (
            <div className="overflow-x-auto">
              <table data-testid="cdm-work-table" className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
                <thead className="bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:bg-slate-900/60">
                  <tr>{renderTableHeaders(entityKind)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {records.length === 0 && !loading ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                        No CDM {entityKind === "ITEM" ? "issues" : entityKind === "COMMENT" ? "comments" : "worklogs"} found. Adjust
                        filters or run CDM ingestion.
                      </td>
                    </tr>
                  ) : (
                    records.map((row) => (
                      <tr
                        key={`${row.kind}-${row.cdmId}`}
                        data-testid="cdm-work-row"
                        className={`cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
                          selectedRow?.cdmId === row.cdmId && selectedRow.kind === row.kind
                            ? "bg-slate-100/70 dark:bg-slate-800/60"
                            : ""
                        }`}
                        onClick={() => setSelectedRow(row)}
                      >
                        {renderRowCells(row, projects, datasetLookup)}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {loading && (
                <div className="border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-500 dark:border-slate-800">
                  Loading…
                </div>
              )}
              {!loading && pageInfo.hasNextPage && (
                <div className="border-t border-slate-100 px-4 py-3 text-center dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => loadRecords(pageInfo.endCursor, false)}
                    className="rounded-full border border-slate-300 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                  >
                    Load more
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <WorkDetailPanel
          row={selectedRow}
          detail={selectedRow?.kind === "ITEM" ? detail : null}
          detailLoading={detailLoading}
          datasetLookup={datasetLookup}
          projects={projects}
          metadataEndpoint={metadataEndpoint}
          headers={headers}
        />
      </div>
    </div>
  );
}

function renderTableHeaders(entityKind: CdmWorkEntityKind) {
  if (entityKind === "ITEM") {
    return (
      <>
        <th className="px-4 py-3">Project</th>
        <th className="px-4 py-3">Key</th>
        <th className="px-4 py-3">Summary</th>
        <th className="px-4 py-3">Status</th>
        <th className="px-4 py-3">Priority</th>
        <th className="px-4 py-3">Assignee</th>
        <th className="px-4 py-3">Updated</th>
        <th className="px-4 py-3">Dataset</th>
      </>
    );
  }
  if (entityKind === "COMMENT") {
    return (
      <>
        <th className="px-4 py-3">Project</th>
        <th className="px-4 py-3">Parent key</th>
        <th className="px-4 py-3">Author</th>
        <th className="px-4 py-3">Created</th>
        <th className="px-4 py-3">Excerpt</th>
        <th className="px-4 py-3">Dataset</th>
      </>
    );
  }
  if (entityKind === "WORKLOG") {
    return (
      <>
        <th className="px-4 py-3">Project</th>
        <th className="px-4 py-3">Parent key</th>
        <th className="px-4 py-3">Author</th>
        <th className="px-4 py-3">Time spent</th>
        <th className="px-4 py-3">Started</th>
        <th className="px-4 py-3">Updated</th>
        <th className="px-4 py-3">Dataset</th>
      </>
    );
  }
  if (entityKind === "PROJECT") {
    return (
      <>
        <th className="px-4 py-3">System</th>
        <th className="px-4 py-3">Key</th>
        <th className="px-4 py-3">Name</th>
        <th className="px-4 py-3">Dataset</th>
      </>
    );
  }
  return (
    <>
      <th className="px-4 py-3">Name</th>
      <th className="px-4 py-3">Email</th>
      <th className="px-4 py-3">Status</th>
      <th className="px-4 py-3">Dataset</th>
    </>
  );
}

function renderRowCells(row: WorkRow, projects: CdmWorkProject[], datasetLookup: Map<string, CdmWorkDataset>) {
  const datasetLabel = formatDatasetLabel(row.datasetId, datasetLookup);
  if (row.kind === "ITEM") {
    return (
      <>
        <td className="px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-500">
          {resolveProjectName(row.projectCdmId, projects)}
        </td>
        <td className="px-4 py-3 text-xs font-semibold text-slate-500">{row.sourceIssueKey}</td>
        <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
          {row.summary}
          <div className="text-xs text-slate-500">{row.sourceSystem}</div>
        </td>
        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{row.status ?? "—"}</td>
        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{row.priority ?? "—"}</td>
        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{row.assignee?.displayName ?? "—"}</td>
        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">{formatTimestamp(row.updatedAt)}</td>
        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-300">{datasetLabel}</td>
      </>
    );
  }
  if (row.kind === "COMMENT") {
    return (
      <>
        <td className="px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-500">
          {resolveProjectName(row.projectCdmId ?? "", projects)}
        </td>
        <td className="px-4 py-3 text-xs font-semibold text-slate-500">{row.parentIssueKey ?? "—"}</td>
        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{row.author?.displayName ?? "—"}</td>
        <td className="px-4 py-3 text-xs text-slate-500">{formatTimestamp(row.createdAt)}</td>
        <td className="px-4 py-3 text-sm text-slate-900 dark:text-slate-100">{truncateText(row.body, 140)}</td>
        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-300">{datasetLabel}</td>
      </>
    );
  }
  if (row.kind === "WORKLOG") {
    return (
      <>
        <td className="px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-500">
          {resolveProjectName(row.projectCdmId ?? "", projects)}
        </td>
        <td className="px-4 py-3 text-xs font-semibold text-slate-500">{row.parentIssueKey ?? "—"}</td>
        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{row.author?.displayName ?? "—"}</td>
        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{formatDuration(row.timeSpentSeconds)}</td>
        <td className="px-4 py-3 text-xs text-slate-500">{formatTimestamp(row.startedAt)}</td>
        <td className="px-4 py-3 text-xs text-slate-500">{formatTimestamp(extractRawTimestamp(row.raw, ["raw", "updated"]))}</td>
        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-300">{datasetLabel}</td>
      </>
    );
  }
  if (row.kind === "PROJECT") {
    return (
      <>
        <td className="px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-500">{row.sourceSystem}</td>
        <td className="px-4 py-3 text-xs font-semibold text-slate-500">{row.sourceProjectKey}</td>
        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{row.name}</td>
        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-300">{datasetLabel}</td>
      </>
    );
  }
  return (
    <>
      <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{row.displayName ?? "Unknown user"}</td>
      <td className="px-4 py-3 text-xs text-slate-500">{row.email ?? "—"}</td>
      <td className="px-4 py-3 text-xs text-slate-500">{row.active ? "Active" : "Inactive"}</td>
      <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-300">{datasetLabel}</td>
    </>
  );
}

function WorkDetailPanel({
  row,
  detail,
  detailLoading,
  datasetLookup,
  projects,
  metadataEndpoint,
  headers,
}: {
  row: WorkRow | null;
  detail: CdmWorkItemDetail | null;
  detailLoading: boolean;
  datasetLookup: Map<string, CdmWorkDataset>;
  projects: CdmWorkProject[];
  metadataEndpoint: string | null;
  headers: { token?: string };
}) {
  const [signals, setSignals] = useState<SignalInstanceRow[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadSignals = async () => {
      if (!metadataEndpoint || !row || row.kind !== "ITEM" || !row.cdmId) {
        setSignals([]);
        return;
      }
      setSignalsLoading(true);
      try {
        const entityRef = `cdm.work.item:${row.cdmId}`;
        const resp = await fetchMetadataGraphQL<{ signalInstancesPage: { rows: SignalInstanceRow[] } }>(
          metadataEndpoint,
          SIGNALS_FOR_ENTITY_QUERY,
          { entityRef, first: 5 },
          undefined,
          headers,
        );
        if (!cancelled) {
          setSignals(resp.signalInstancesPage?.rows ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setSignals([]);
        }
      } finally {
        if (!cancelled) {
          setSignalsLoading(false);
        }
      }
    };
    loadSignals();
    return () => {
      cancelled = true;
    };
  }, [metadataEndpoint, headers, row]);

  if (!row) {
    return (
      <aside
        data-testid="cdm-work-detail-panel"
        className="rounded-3xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400"
      >
        Select a row to inspect its CDM payload.
      </aside>
    );
  }
  const dataset = row.datasetId ? datasetLookup.get(row.datasetId) : null;
  const datasetLabel = dataset?.label ?? row.datasetId ?? "—";
  const endpointLabel = dataset?.endpointName ?? "Source endpoint";
  const rawPayload =
    (row as { rawSource?: Record<string, unknown> | null; raw?: Record<string, unknown> | null }).rawSource ??
    (row as { raw?: Record<string, unknown> | null }).raw ??
    {};
  const projectLabel =
    row.kind === "ITEM"
      ? resolveProjectName(row.projectCdmId, projects)
      : row.kind === "COMMENT" || row.kind === "WORKLOG"
        ? resolveProjectName(row.projectCdmId ?? "", projects)
        : row.kind === "PROJECT"
          ? row.name
          : "";
  const sourceUrl =
    row.kind === "PROJECT" && row.url
      ? row.url
      : row.kind === "ITEM"
        ? row.sourceUrl ?? resolveSourceUrl(rawPayload)
        : resolveSourceUrl(rawPayload);

  return (
    <aside
      data-testid="cdm-work-detail-panel"
      className="flex h-fit flex-col rounded-3xl border border-slate-200 bg-white/95 p-4 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900/70"
    >
      <div className="mb-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500">
          {row.kind === "ITEM" ? "Issue" : row.kind === "COMMENT" ? "Comment" : "Worklog"}
        </p>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{projectLabel || "Unknown project"}</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Dataset: {datasetLabel} · {endpointLabel}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {row.datasetId ? (
          <Link
            to={`/catalog/datasets/${encodeURIComponent(row.datasetId)}`}
            className="rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200"
          >
            Open dataset
          </Link>
        ) : null}
        <a
          href={sourceUrl ?? undefined}
          target="_blank"
          rel="noreferrer"
          className={`rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] transition dark:border-slate-700 ${
            sourceUrl
              ? "text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:text-slate-200"
              : "cursor-not-allowed text-slate-400 dark:text-slate-600"
          }`}
        >
          Open in source
        </a>
      </div>
      <div className="mt-4 space-y-3 text-slate-700 dark:text-slate-200">
        {row.kind === "ITEM" ? (
          <>
            <DetailField label="Key" value={row.sourceIssueKey} />
            <DetailField label="Source id" value={row.sourceId ?? row.sourceIssueKey} />
            <DetailField label="Summary" value={row.summary} />
            <DetailField label="Status" value={row.status ?? "—"} />
            <DetailField label="Priority" value={row.priority ?? "—"} />
            <DetailField label="Assignee" value={row.assignee?.displayName ?? "Unassigned"} />
            <DetailField label="Reporter" value={row.reporter?.displayName ?? "Unknown"} />
            <DetailField label="Created" value={formatTimestamp(row.createdAt)} />
            <DetailField label="Updated" value={formatTimestamp(row.updatedAt)} />
            <DetailField label="Closed" value={formatTimestamp(row.closedAt)} />
            {detailLoading ? (
              <p className="text-xs text-slate-500">Loading comments and worklogs…</p>
            ) : (
              <>
                <SectionHeading label="Comments" />
                {detail?.comments?.length ? (
                  <ul className="space-y-2">
                    {detail.comments.map((comment) => (
                      <li key={comment.cdmId} className="rounded-xl border border-slate-200 p-2 dark:border-slate-800">
                        <p className="text-xs text-slate-500">
                          {comment.author?.displayName ?? "Unknown"} · {formatTimestamp(comment.createdAt)}
                        </p>
                        <p className="text-sm text-slate-900 dark:text-slate-100">{comment.body}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">No comments ingested.</p>
                )}
                <SectionHeading label="Worklogs" />
                {detail?.worklogs?.length ? (
                  <ul className="space-y-2">
                    {detail.worklogs.map((log) => (
                      <li key={log.cdmId} className="rounded-xl border border-slate-200 p-2 dark:border-slate-800">
                        <p className="text-xs text-slate-500">
                          {log.author?.displayName ?? "Unknown"} · {formatDuration(log.timeSpentSeconds)}
                        </p>
                        <p className="text-xs text-slate-500">{formatTimestamp(log.startedAt)}</p>
                        {log.comment ? <p className="text-sm text-slate-900 dark:text-slate-100">{log.comment}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">No worklogs ingested.</p>
                )}
              </>
            )}
          </>
        ) : row.kind === "COMMENT" ? (
          <>
            <DetailField label="Parent key" value={row.parentIssueKey ?? "—"} />
            <DetailField label="Author" value={row.author?.displayName ?? "Unknown"} />
            <DetailField label="Created" value={formatTimestamp(row.createdAt)} />
            <DetailField label="Updated" value={formatTimestamp(row.updatedAt)} />
            <SectionHeading label="Body" />
            <p className="text-sm text-slate-900 dark:text-slate-100">{row.body || "—"}</p>
          </>
        ) : row.kind === "WORKLOG" ? (
          <>
            <DetailField label="Parent key" value={row.parentIssueKey ?? "—"} />
            <DetailField label="Author" value={row.author?.displayName ?? "Unknown"} />
            <DetailField label="Time spent" value={formatDuration(row.timeSpentSeconds)} />
            <DetailField label="Started" value={formatTimestamp(row.startedAt)} />
            <DetailField label="Updated" value={formatTimestamp(extractRawTimestamp(row.raw, ["raw", "updated"]))} />
            <SectionHeading label="Comment" />
            <p className="text-sm text-slate-900 dark:text-slate-100">{row.comment || "—"}</p>
          </>
        ) : row.kind === "PROJECT" ? (
          <>
            <DetailField label="Source system" value={row.sourceSystem} />
            <DetailField label="Project key" value={row.sourceProjectKey} />
            <DetailField label="Name" value={row.name} />
            <DetailField label="Description" value={row.description ?? "—"} />
            {row.url ? (
              <DetailField label="URL" value={row.url} />
            ) : null}
            <SectionHeading label="Raw payload" />
            <pre className="rounded-2xl bg-slate-900/90 p-3 text-xs text-emerald-100">{JSON.stringify(rawPayload, null, 2)}</pre>
          </>
        ) : row.kind === "USER" ? (
          <>
            <DetailField label="Source system" value={row.sourceSystem ?? "—"} />
            <DetailField label="User id" value={row.sourceUserId ?? "—"} />
            <DetailField label="Name" value={row.displayName ?? "—"} />
            <DetailField label="Email" value={row.email ?? "—"} />
            <DetailField label="Status" value={row.active ? "Active" : "Inactive"} />
            <SectionHeading label="Raw payload" />
            <pre className="rounded-2xl bg-slate-900/90 p-3 text-xs text-emerald-100">{JSON.stringify(rawPayload, null, 2)}</pre>
          </>
        ) : (
          <>
            <SectionHeading label="Details" />
            <pre className="rounded-2xl bg-slate-900/90 p-3 text-xs text-emerald-100">{JSON.stringify(rawPayload, null, 2)}</pre>
          </>
        )}
      </div>
      {row.kind === "ITEM" || row.kind === "COMMENT" || row.kind === "WORKLOG" ? (
        <>
          {row.kind === "ITEM" && row.cdmId ? (
            <SignalsSummaryCard
              entityRef={`cdm.work.item:${row.cdmId}`}
              signals={signals}
              loading={signalsLoading}
            />
          ) : null}
          <SectionHeading label="Raw CDM record" className="mt-6" />
          <pre className="mt-2 max-h-72 overflow-auto rounded-2xl bg-slate-900/90 p-3 text-xs text-emerald-100">
            {JSON.stringify(rawPayload, null, 2)}
          </pre>
        </>
      ) : null}
    </aside>
  );
}

function DetailField({ label, value }: { label: string; value?: string | null }) {
  return (
    <p>
      <span className="font-semibold text-slate-600 dark:text-slate-300">{label}: </span>
      <span className="text-slate-800 dark:text-slate-100">{value ?? "—"}</span>
    </p>
  );
}

function SectionHeading({ label, className }: { label: string; className?: string }) {
  return (
    <p className={`text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 ${className ?? ""}`}>
      {label}
    </p>
  );
}

function SignalsSummaryCard({
  entityRef,
  signals,
  loading,
}: {
  entityRef: string;
  signals: SignalInstanceRow[];
  loading: boolean;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/40" data-testid="cdm-work-signals">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500">Signals</p>
          <p className="text-sm text-slate-600 dark:text-slate-200">Recent signals for this work item</p>
        </div>
        <Link
          to={`/signals?entityRef=${encodeURIComponent(entityRef)}`}
          className="rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
        >
          View all
        </Link>
      </div>
      {loading ? (
        <p className="mt-3 text-xs text-slate-500">Loading signals…</p>
      ) : signals.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">No signals found for this entity.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {signals.slice(0, 3).map((signal) => (
            <li key={signal.id} className="flex items-center justify-between gap-3 py-2" data-testid="cdm-work-signal-row">
              <div>
                <p className="font-semibold text-slate-900 dark:text-slate-100">{signal.summary}</p>
                <p className="text-xs text-slate-500">{signal.definitionSlug}</p>
              </div>
              <span className="rounded-full border border-slate-300 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 dark:border-slate-600 dark:text-slate-200">
                {signal.severity}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function resolveEntityQuery(
  entity: CdmWorkEntityKind,
): {
  query: string;
  extractor: (data: any) => { edges: Array<{ cursor: string; node: WorkRow }>; pageInfo: GraphPageInfo };
} {
  switch (entity) {
    case "ITEM":
      return { query: CDM_WORK_ITEMS_QUERY, extractor: (data) => data.cdmWorkItems };
    case "COMMENT":
      return { query: CDM_WORK_COMMENTS_QUERY, extractor: (data) => data.cdmWorkComments };
    case "WORKLOG":
      return { query: CDM_WORK_LOGS_QUERY, extractor: (data) => data.cdmWorkLogs };
    case "PROJECT":
      return { query: CDM_WORK_PROJECT_CONNECTION_QUERY, extractor: (data) => data.cdmWorkProjectConnection };
    case "USER":
      return { query: CDM_WORK_USERS_QUERY, extractor: (data) => data.cdmWorkUsers };
    default:
      return { query: CDM_WORK_ITEMS_QUERY, extractor: (data) => data.cdmWorkItems };
  }
}

function buildEntityFilter(
  entity: CdmWorkEntityKind,
  args: { projectCdmId?: string; statuses: string[]; datasetId?: string; search: string },
) {
  const filter: Record<string, unknown> = {};
  const trimmedSearch = args.search.trim();
  if (entity === "ITEM") {
    if (args.projectCdmId) {
      filter.projectCdmId = args.projectCdmId;
    }
    if (args.datasetId) {
      filter.datasetIds = [args.datasetId];
    }
    if (trimmedSearch.length > 0) {
      filter.search = trimmedSearch;
    }
    if (args.statuses.length > 0) {
      filter.statusIn = args.statuses;
    }
  } else if (entity === "COMMENT") {
    if (args.projectCdmId) {
      filter.projectCdmId = args.projectCdmId;
    }
    if (args.datasetId) {
      filter.datasetIds = [args.datasetId];
    }
    if (trimmedSearch.length > 0) {
      filter.search = trimmedSearch;
    }
  } else if (entity === "WORKLOG") {
    if (args.projectCdmId) {
      filter.projectCdmId = args.projectCdmId;
    }
    if (args.datasetId) {
      filter.datasetIds = [args.datasetId];
    }
  } else if (entity === "PROJECT") {
    if (args.datasetId) {
      filter.datasetIds = [args.datasetId];
    }
    if (trimmedSearch.length > 0) {
      filter.search = trimmedSearch;
    }
  } else if (entity === "USER") {
    if (args.datasetId) {
      filter.datasetIds = [args.datasetId];
    }
    if (trimmedSearch.length > 0) {
      filter.search = trimmedSearch;
    }
  }
  return Object.keys(filter).length ? filter : undefined;
}

function toggleStatusFilter(status: string, selected: string[], update: (next: string[]) => void) {
  if (!status) {
    return;
  }
  if (selected.includes(status)) {
    update(selected.filter((entry) => entry !== status));
  } else {
    update([...selected, status]);
  }
}

function resolveProjectName(projectCdmId: string | null | undefined, projects: CdmWorkProject[]) {
  if (!projectCdmId) {
    return "";
  }
  const match = projects.find((project) => project.cdmId === projectCdmId);
  return match?.name ?? projectCdmId;
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return "—";
  }
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatDuration(seconds?: number | null) {
  if (!seconds || seconds <= 0) {
    return "—";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (!hours) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

function truncateText(value: string, length: number) {
  if (!value) {
    return "—";
  }
  if (value.length <= length) {
    return value;
  }
  return `${value.slice(0, length)}…`;
}

function formatDatasetLabel(datasetId: string | null | undefined, lookup: Map<string, CdmWorkDataset>) {
  if (!datasetId) {
    return "—";
  }
  return lookup.get(datasetId)?.label ?? datasetId;
}

function resolveSourceUrl(raw: Record<string, unknown> | null | undefined) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const rawRecord = raw as Record<string, unknown>;
  const candidateKeys = [
    rawRecord.source_url,
    rawRecord.sourceUrl,
    rawRecord.url,
    rawRecord.webUrl,
    rawRecord.self,
    getNestedString(rawRecord, ["raw", "self"]),
    getNestedString(rawRecord, ["raw", "url"]),
    getNestedString(rawRecord, ["rawFields", "self"]),
  ];
  return candidateKeys.find((entry): entry is string => typeof entry === "string" && entry.length > 0) ?? null;
}

function getNestedString(input: unknown, path: string[]) {
  if (!input || typeof input !== "object") {
    return null;
  }
  let current: unknown = input;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : null;
}

function extractRawTimestamp(raw: Record<string, unknown> | null | undefined, path: string[]) {
  return getNestedString(raw, path);
}

function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 px-6 py-10 text-center dark:border-slate-700">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
      {description ? <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{description}</p> : null}
    </div>
  );
}

function Filters({
  entityKind,
  onEntityChange,
  projects,
  projectFilter,
  onProjectFilterChange,
  statuses,
  selectedStatuses,
  onStatusToggle,
  datasetOptions,
  datasetFilter,
  onDatasetFilterChange,
  searchInput,
  onSearchInputChange,
  searchPlaceholder,
}: {
  entityKind: CdmWorkEntityKind;
  onEntityChange: (next: CdmWorkEntityKind) => void;
  projects: CdmWorkProject[];
  projectFilter: string;
  onProjectFilterChange: (next: string) => void;
  statuses: string[];
  selectedStatuses: string[];
  onStatusToggle: (status: string) => void;
  datasetOptions: CdmWorkDataset[];
  datasetFilter: string;
  onDatasetFilterChange: (next: string) => void;
  searchInput: string;
  onSearchInputChange: (next: string) => void;
  searchPlaceholder: string;
}) {
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-2">
        {ENTITY_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onEntityChange(option.id)}
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] transition ${
              entityKind === option.id
                ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                : "border-slate-200 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Project</label>
          <select
            className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            value={projectFilter}
            onChange={(event) => onProjectFilterChange(event.target.value)}
          >
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.cdmId} value={project.cdmId}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Dataset</label>
          <select
            className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            value={datasetFilter}
            onChange={(event) => onDatasetFilterChange(event.target.value)}
          >
            <option value="">All datasets</option>
            {datasetOptions.map((dataset) => (
              <option key={dataset.datasetId} value={dataset.datasetId}>
                {dataset.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Search</label>
          <input
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="mt-1 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
      </div>
      {entityKind === "ITEM" && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Status</p>
          <div className="flex flex-wrap gap-2">
            {statuses.length === 0 ? (
              <span className="text-xs text-slate-500">No statuses detected yet.</span>
            ) : (
              statuses.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => onStatusToggle(status)}
                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] transition ${
                    selectedStatuses.includes(status)
                      ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                      : "border-slate-200 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200"
                  }`}
                >
                  {status}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
