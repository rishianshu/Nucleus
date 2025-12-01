import { useCallback, useMemo, useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchMetadataGraphQL } from "../metadata/api";
import { CDM_ENTITY_CONNECTION_QUERY, CDM_ENTITY_QUERY, CDM_DOCS_DATASETS_QUERY } from "../metadata/queries";
import type { CdmEntity, CdmEntityConnection, CdmDocsDataset } from "../metadata/types";
import { useDebouncedValue } from "../metadata/hooks";

type DocsListResponse = {
  cdmEntities: CdmEntityConnection;
};

type DocDetailResponse = {
  cdmEntity: CdmEntity | null;
};

type DocsDatasetResponse = {
  cdmDocsDatasets: CdmDocsDataset[];
};

type CdmDocsListViewProps = {
  metadataEndpoint: string | null;
  authToken?: string | null;
};

const PAGE_SIZE = 25;

export function CdmDocsListView({ metadataEndpoint, authToken }: CdmDocsListViewProps) {
  const navigate = useNavigate();
  const { entityId } = useParams();
  const headers = useMemo(() => ({ token: authToken ?? undefined }), [authToken]);

  const [datasetOptions, setDatasetOptions] = useState<CdmDocsDataset[]>([]);
  const datasetLookup = useMemo(() => new Map(datasetOptions.map((entry) => [entry.datasetId, entry])), [datasetOptions]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  const [entities, setEntities] = useState<CdmEntity[]>([]);
  const [pageInfo, setPageInfo] = useState<{ endCursor: string | null; hasNextPage: boolean }>({
    endCursor: null,
    hasNextPage: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<CdmEntity | null>(null);

  const filterVariables = useMemo(() => {
    return {
      domain: "DOC_ITEM",
      docDatasetIds: selectedDatasetId ? [selectedDatasetId] : undefined,
      docSourceSystems: sourceFilter ? [sourceFilter] : undefined,
      docSearch: debouncedSearch || undefined,
    };
  }, [selectedDatasetId, sourceFilter, debouncedSearch]);

  const loadEntities = useCallback(
    async (cursor: string | null, reset: boolean) => {
      if (!metadataEndpoint) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const variables = {
          filter: filterVariables,
          first: PAGE_SIZE,
          after: cursor,
        };
        const data = await fetchMetadataGraphQL<DocsListResponse>(metadataEndpoint, CDM_ENTITY_CONNECTION_QUERY, variables, undefined, headers);
        const nextRows = data.cdmEntities.edges.map((edge) => edge.node);
        setEntities((prev) => (reset ? nextRows : [...prev, ...nextRows]));
        setPageInfo({
          endCursor: data.cdmEntities.pageInfo.endCursor ?? null,
          hasNextPage: data.cdmEntities.pageInfo.hasNextPage,
        });
      } catch (err) {
        console.error(err);
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [metadataEndpoint, filterVariables, headers],
  );

  useEffect(() => {
    loadEntities(null, true);
  }, [loadEntities]);

  const loadDetail = useCallback(
    async (cdmId: string) => {
      if (!metadataEndpoint) {
        return;
      }
      try {
        const data = await fetchMetadataGraphQL<DocDetailResponse>(
          metadataEndpoint,
          CDM_ENTITY_QUERY,
          { id: cdmId, domain: "DOC_ITEM" },
          undefined,
          headers,
        );
        if (data.cdmEntity) {
          setSelectedEntity(data.cdmEntity);
        }
      } catch (err) {
        console.error(err);
        setError((err as Error).message);
      }
    },
    [metadataEndpoint, headers],
  );

  useEffect(() => {
    if (entityId) {
      loadDetail(entityId);
    } else {
      setSelectedEntity(null);
    }
  }, [entityId, loadDetail]);

  useEffect(() => {
    if (!metadataEndpoint) {
      setDatasetOptions([]);
      return;
    }
    let cancelled = false;
    const loadDatasets = async () => {
      try {
        const resp = await fetchMetadataGraphQL<DocsDatasetResponse>(
          metadataEndpoint,
          CDM_DOCS_DATASETS_QUERY,
          undefined,
          undefined,
          headers,
        );
        if (cancelled) {
          return;
        }
        const records = Array.isArray(resp.cdmDocsDatasets) ? resp.cdmDocsDatasets : [];
        setDatasetOptions(records);
        if (selectedDatasetId && !records.some((entry) => entry.datasetId === selectedDatasetId)) {
          setSelectedDatasetId("");
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError((err as Error).message);
        }
      }
    };
    loadDatasets();
    return () => {
      cancelled = true;
    };
  }, [metadataEndpoint, headers, selectedDatasetId]);

  const sourceOptions = useMemo(() => {
    const values = new Set<string>();
    datasetOptions.forEach((entry) => {
      if (entry.sourceSystem) {
        values.add(entry.sourceSystem);
      }
    });
    entities.forEach((entity) => {
      if (entity.docSourceSystem ?? entity.sourceSystem) {
        values.add((entity.docSourceSystem ?? entity.sourceSystem) as string);
      }
    });
    return Array.from(values).sort();
  }, [datasetOptions, entities]);

  if (!metadataEndpoint) {
    return <EmptyState title="Metadata endpoint not configured" description="Cannot load CDM docs data." />;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
      <div className="space-y-4">
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <div className="grid gap-3 sm:grid-cols-3">
            <FilterBlock label="Dataset">
              <select
                value={selectedDatasetId}
                onChange={(event) => setSelectedDatasetId(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 text-sm outline-none transition focus:border-slate-900 dark:border-slate-600 dark:bg-slate-900/60"
              >
                <option value="">All datasets</option>
                {datasetOptions.map((dataset) => (
                  <option key={dataset.id} value={dataset.datasetId}>
                    {dataset.name} · {dataset.endpointName}
                  </option>
                ))}
              </select>
            </FilterBlock>
            <FilterBlock label="Source">
              <select
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 text-sm outline-none transition focus:border-slate-900 dark:border-slate-600 dark:bg-slate-900/60"
              >
                <option value="">All sources</option>
                {sourceOptions.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </FilterBlock>
            <FilterBlock label="Search">
              <input
                type="text"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search titles, paths, or excerpts…"
                className="w-full rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 text-sm outline-none transition focus:border-slate-900 dark:border-slate-600 dark:bg-slate-900/60"
              />
            </FilterBlock>
          </div>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          {error && (
            <div className="border-b border-red-100 bg-red-50/80 px-4 py-3 text-sm text-red-800 dark:border-red-400/40 dark:bg-red-950/40 dark:text-red-200">
              {error}
            </div>
          )}
          {entities.length === 0 && !loading ? (
            <div className="p-6">
              <EmptyState title="No docs found" description="Try adjusting your dataset, source, or search filters." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
                <thead className="bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:bg-slate-900/60">
                  <tr>
                    <th className="px-4 py-3">Project</th>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {entities.map((entity) => (
                    <tr
                      key={entity.cdmId}
                      className="cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      onClick={() => {
                        setSelectedEntity(entity);
                        navigate(`/cdm/docs/${encodeURIComponent(entity.cdmId)}`);
                      }}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900 dark:text-slate-100">{entity.docProjectName ?? "—"}</p>
                        <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">{entity.docProjectKey ?? " "}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900 dark:text-white">{entity.docTitle ?? entity.title ?? entity.cdmId}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                          {entity.docContentExcerpt ?? "No excerpt available"}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{entity.docType ?? entity.state ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                        <p>{formatDatasetLabel(entity, datasetLookup)}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{entity.docSourceSystem ?? entity.sourceSystem}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                        {formatDateTime(entity.docUpdatedAt ?? entity.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {loading && (
                <div className="border-t border-slate-100 px-4 py-3 text-center text-xs text-slate-500 dark:border-slate-800">Loading…</div>
              )}
              {!loading && pageInfo.hasNextPage && (
                <div className="border-t border-slate-100 px-4 py-3 text-center dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => loadEntities(pageInfo.endCursor, false)}
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
      <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        {selectedEntity ? (
          <DocDetailCard entity={selectedEntity} datasetLookup={datasetLookup} />
        ) : (
          <EmptyState title="Select a doc" description="Choose a document to view metadata and content excerpts." />
        )}
      </div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-center text-slate-500">
      <p className="text-sm font-semibold text-slate-600 dark:text-slate-200">{title}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>
    </div>
  );
}

function FilterBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function DocDetailCard({ entity, datasetLookup }: { entity: CdmEntity; datasetLookup: Map<string, CdmDocsDataset> }) {
  const datasetId =
    entity.docDatasetId ??
    (typeof entity.data?.datasetId === "string" ? (entity.data.datasetId as string) : null) ??
    null;
  const datasetRecord = datasetId ? datasetLookup.get(datasetId) : null;
  const datasetName = datasetRecord?.name ?? entity.docDatasetName ?? datasetId ?? "—";
  const datasetEndpoint = datasetRecord?.endpointName ?? entity.docSourceEndpointId ?? null;
  const datasetLink = datasetId ? `/catalog/datasets/${datasetId}` : null;
  const sourceSystem = entity.docSourceSystem ?? entity.sourceSystem;
  const sourceUrl =
    entity.docUrl ?? (typeof entity.data?.url === "string" ? (entity.data.url as string) : null) ?? null;
  const updatedAt = entity.docUpdatedAt ?? entity.updatedAt;
  const location = entity.docLocation ?? (typeof entity.data?.path === "string" ? (entity.data.path as string) : null);
  const metadata = entity.data ?? {};

  const detailRows = [
    { label: "Project / Workspace", value: formatProjectLabel(entity) },
    { label: "Location", value: location ?? "—" },
    { label: "Type", value: entity.docType ?? entity.state ?? "—" },
    { label: "Dataset", value: datasetName ?? "—" },
    { label: "Source system", value: sourceSystem ?? "—" },
    { label: "Source endpoint", value: datasetEndpoint ?? "—" },
    { label: "Updated", value: formatDateTime(updatedAt) },
  ];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500">CDM DOC</p>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{entity.docTitle ?? entity.title ?? entity.cdmId}</h2>
        <p className="text-xs text-slate-500">
          {sourceSystem}
          {datasetName ? ` · ${datasetName}` : null}
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        {sourceUrl && (
          <a
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open in source
          </a>
        )}
        {datasetLink && (
          <a
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
            href={datasetLink}
          >
            View dataset
          </a>
        )}
      </div>
      <dl className="space-y-4 text-sm">
        {detailRows.map((row) => (
          <div key={row.label}>
            <dt className="text-[10px] uppercase tracking-[0.4em] text-slate-500">{row.label}</dt>
            <dd className="text-slate-900 dark:text-slate-100">{row.value ?? "—"}</dd>
          </div>
        ))}
      </dl>
      {entity.docContentExcerpt && (
        <div className="rounded-2xl bg-slate-50/80 p-4 text-sm text-slate-700 shadow-inner dark:bg-slate-800/50 dark:text-slate-200">
          <p className="text-[10px] uppercase tracking-[0.4em] text-slate-500">Content excerpt</p>
          <p className="mt-2 whitespace-pre-line">{entity.docContentExcerpt}</p>
        </div>
      )}
      <details className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-900/40" open>
        <summary className="cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-200">Raw CDM payload</summary>
        <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-900/80 p-4 text-xs text-slate-100">
          {JSON.stringify(metadata, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function formatDatasetLabel(entity: CdmEntity, lookup: Map<string, CdmDocsDataset>) {
  if (entity.docDatasetId) {
    const match = lookup.get(entity.docDatasetId);
    if (match) {
      return `${match.name} · ${match.endpointName}`;
    }
    if (entity.docDatasetName) {
      return entity.docDatasetName;
    }
    return entity.docDatasetId;
  }
  return entity.docDatasetName ?? entity.sourceSystem;
}

function formatProjectLabel(entity: CdmEntity) {
  if (entity.docProjectName && entity.docProjectKey) {
    return `${entity.docProjectName} (${entity.docProjectKey})`;
  }
  return entity.docProjectName ?? entity.docProjectKey ?? "—";
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "—";
  }
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}
