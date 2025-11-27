import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Role } from "../auth/AuthProvider";
import { fetchMetadataGraphQL } from "../metadata/api";
import {
  CDM_WORK_ITEMS_QUERY,
  CDM_WORK_PROJECTS_QUERY,
} from "../metadata/queries";
import type {
  CdmWorkItem,
  CdmWorkItemConnection,
  CdmWorkProject,
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

type ProjectsResponse = {
  cdmWorkProjects: CdmWorkProject[];
};

export function CdmWorkListView({ metadataEndpoint, authToken }: CdmWorkListViewProps) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<CdmWorkProject[]>([]);
  const [items, setItems] = useState<CdmWorkItem[]>([]);
  const [pageInfo, setPageInfo] = useState<{ endCursor: string | null; hasNextPage: boolean }>({ endCursor: null, hasNextPage: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 350);

  const headers = useMemo(() => ({ token: authToken ?? undefined }), [authToken]);

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

  const loadItems = useCallback(
    async (cursor: string | null, reset: boolean) => {
      if (!metadataEndpoint) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const variables = {
          filter: buildFilter(projectFilter, selectedStatuses, debouncedSearch),
          first: DEFAULT_PAGE_SIZE,
          after: cursor,
        };
        const data = await fetchMetadataGraphQL<WorkItemsResponse>(
          metadataEndpoint,
          CDM_WORK_ITEMS_QUERY,
          variables,
          undefined,
          headers,
        );
        const nextEdges = data.cdmWorkItems.edges.map((edge) => edge.node);
        setItems((prev) => (reset ? nextEdges : [...prev, ...nextEdges]));
        setPageInfo({
          endCursor: data.cdmWorkItems.pageInfo.endCursor ?? null,
          hasNextPage: data.cdmWorkItems.pageInfo.hasNextPage,
        });
      } catch (err) {
        console.error(err);
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [metadataEndpoint, headers, projectFilter, selectedStatuses, debouncedSearch],
  );

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    loadItems(null, true);
  }, [loadItems]);

  const uniqueStatuses = useMemo(() => {
    const statusSet = new Set<string>();
    items.forEach((item) => {
      if (item.status) {
        statusSet.add(item.status);
      }
    });
    selectedStatuses.forEach((status) => statusSet.add(status));
    return Array.from(statusSet).sort();
  }, [items, selectedStatuses]);

  if (!metadataEndpoint) {
    return <EmptyState title="Metadata endpoint not configured" description="Cannot load CDM work data." />;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <Filters
          projects={projects}
          projectFilter={projectFilter}
          onProjectFilterChange={setProjectFilter}
          statuses={uniqueStatuses}
          selectedStatuses={selectedStatuses}
          onStatusToggle={(status) => toggleStatusFilter(status, selectedStatuses, setSelectedStatuses)}
          searchInput={searchInput}
          onSearchInputChange={setSearchInput}
        />
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        {error ? (
          <div className="p-6 text-sm text-rose-500">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table data-testid="cdm-work-table" className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
              <thead className="bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:bg-slate-900/60">
                <tr>
                  <th className="px-4 py-3">Project</th>
                  <th className="px-4 py-3">Summary</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Assignee</th>
                  <th className="px-4 py-3">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {items.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                      No CDM work items found. Adjust filters or run CDM ingestion.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr
                      key={item.cdmId}
                      data-testid="cdm-work-row"
                      className="cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      onClick={() => navigate(`/cdm/work/items/${encodeURIComponent(item.cdmId)}`)}
                    >
                      <td className="px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-500">
                        {resolveProjectName(item.projectCdmId, projects)}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                        {item.summary}
                        <div className="text-xs text-slate-500">{item.sourceIssueKey}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{item.status ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{item.priority ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{item.assignee?.displayName ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                        {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "—"}
                      </td>
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
                  onClick={() => loadItems(pageInfo.endCursor, false)}
                  className="rounded-full border border-slate-300 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                >
                  Load more
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function buildFilter(projectId: string, statuses: string[], search: string) {
  const filter: Record<string, unknown> = {};
  if (projectId) {
    filter.projectCdmId = projectId;
  }
  if (statuses.length > 0) {
    filter.statusIn = statuses;
  }
  if (search.trim().length > 0) {
    filter.search = search.trim();
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

function resolveProjectName(projectCdmId: string, projects: CdmWorkProject[]) {
  const match = projects.find((project) => project.cdmId === projectCdmId);
  if (!match) {
    return projectCdmId;
  }
  return match.name;
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
  projects,
  projectFilter,
  onProjectFilterChange,
  statuses,
  selectedStatuses,
  onStatusToggle,
  searchInput,
  onSearchInputChange,
}: {
  projects: CdmWorkProject[];
  projectFilter: string;
  onProjectFilterChange: (value: string) => void;
  statuses: string[];
  selectedStatuses: string[];
  onStatusToggle: (status: string) => void;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
      <label className="flex flex-1 flex-col gap-2 text-sm">
        <span className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Project</span>
        <select
          value={projectFilter}
          onChange={(event) => onProjectFilterChange(event.target.value)}
          className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="">All projects</option>
          {projects.map((project) => (
            <option key={project.cdmId} value={project.cdmId}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-1 flex-col gap-2 text-sm">
        <span className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Search</span>
        <input
          type="text"
          value={searchInput}
          onChange={(event) => onSearchInputChange(event.target.value)}
          placeholder="Summary or key"
          className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </label>
      <div className="flex flex-1 flex-col gap-2 text-sm">
        <span className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Status</span>
        <div className="flex flex-wrap gap-2">
          {statuses.length === 0 ? (
            <span className="text-xs text-slate-500">No statuses yet</span>
          ) : (
            statuses.map((status) => (
              <label key={status} className="inline-flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={selectedStatuses.includes(status)}
                  onChange={() => onStatusToggle(status)}
                  className="h-3.5 w-3.5 rounded border border-slate-300 text-slate-900 focus:ring-slate-900 dark:border-slate-600"
                />
                <span>{status}</span>
              </label>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
