import { useCallback, useMemo, useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchMetadataGraphQL } from "../metadata/api";
import { CDM_ENTITY_CONNECTION_QUERY, CDM_ENTITY_QUERY } from "../metadata/queries";
import type { CdmEntity, CdmEntityConnection } from "../metadata/types";
import { useDebouncedValue } from "../metadata/hooks";

 type DocsListResponse = {
  cdmEntities: CdmEntityConnection;
};

 type DocDetailResponse = {
  cdmEntity: CdmEntity | null;
};

 type CdmDocsListViewProps = {
  metadataEndpoint: string | null;
  authToken?: string | null;
};

const PAGE_SIZE = 25;

export function CdmDocsListView({ metadataEndpoint, authToken }: CdmDocsListViewProps) {
  const navigate = useNavigate();
  const { entityId } = useParams();
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [spaceFilter, setSpaceFilter] = useState<string>("");
  const [searchInput, setSearchInput] = useState("");
  const [entities, setEntities] = useState<CdmEntity[]>([]);
  const [pageInfo, setPageInfo] = useState<{ endCursor: string | null; hasNextPage: boolean }>({ endCursor: null, hasNextPage: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<CdmEntity | null>(null);
  const headers = useMemo(() => ({ token: authToken ?? undefined }), [authToken]);
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  const filterVariables = useMemo(() => {
    return {
      domain: "DOC_ITEM",
      sourceSystems: sourceFilter ? [sourceFilter] : undefined,
      docSpaceIds: spaceFilter ? [spaceFilter] : undefined,
      search: debouncedSearch || undefined,
    };
  }, [sourceFilter, spaceFilter, debouncedSearch]);

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

  const uniqueSources = useMemo(() => Array.from(new Set(entities.map((entity) => entity.sourceSystem))).sort(), [entities]);
  const uniqueSpaces = useMemo(() => {
    const values = entities
      .map((entity) => (typeof entity.data?.spaceCdmId === "string" ? entity.data.spaceCdmId : null))
      .filter(Boolean) as string[];
    return Array.from(new Set(values)).sort();
  }, [entities]);

  if (!metadataEndpoint) {
    return <EmptyState title="Metadata endpoint not configured" description="Cannot load CDM docs data." />;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
      <div className="space-y-4">
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              Source
              <select
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                value={sourceFilter}
                onChange={(event) => {
                  setSourceFilter(event.target.value);
                  loadEntities(null, true);
                }}
              >
                <option value="">All</option>
                {uniqueSources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              Space
              <select
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                value={spaceFilter}
                onChange={(event) => {
                  setSpaceFilter(event.target.value);
                  loadEntities(null, true);
                }}
              >
                <option value="">All</option>
                {uniqueSpaces.map((space) => (
                  <option key={space} value={space}>
                    {space}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              Search
              <input
                type="text"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                placeholder="Search title"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          {error ? (
            <div className="p-6 text-sm text-rose-500">{error}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
                <thead className="bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:bg-slate-900/60">
                  <tr>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Space</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {entities.length === 0 && !loading ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                        No CDM docs found. Adjust filters or run CDM ingestion.
                      </td>
                    </tr>
                  ) : (
                    entities.map((entity) => (
                      <tr
                        key={entity.cdmId}
                        className="cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
                        onClick={() => {
                          setSelectedEntity(entity);
                          navigate(`/cdm/docs/${encodeURIComponent(entity.cdmId)}`);
                        }}
                      >
                        <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">{entity.title ?? entity.cdmId}</td>
                        <td className="px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-500">
                          {typeof entity.data?.spaceCdmId === "string" ? entity.data.spaceCdmId : "—"}
                        </td>
                        <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{entity.sourceSystem}</td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                          {entity.updatedAt ? new Date(entity.updatedAt).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))
                  )}
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
          <DocDetailCard entity={selectedEntity} />
        ) : (
          <EmptyState title="Select a doc" description="Choose a doc item to view metadata." />
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

function DocDetailCard({ entity }: { entity: CdmEntity }) {
  const metadata = entity.data ?? {};
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500">CDM DOC</p>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{entity.title ?? entity.cdmId}</h2>
        <p className="text-xs text-slate-500">Source · {entity.sourceSystem}</p>
      </div>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-[0.3em] text-slate-500">CDM ID</dt>
          <dd className="font-mono text-slate-900 dark:text-slate-100">{entity.cdmId}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.3em] text-slate-500">Space</dt>
          <dd>{typeof metadata.spaceCdmId === "string" ? metadata.spaceCdmId : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.3em] text-slate-500">Type</dt>
          <dd>{typeof metadata.docType === "string" ? metadata.docType : entity.state ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.3em] text-slate-500">Updated</dt>
          <dd>{entity.updatedAt ? new Date(entity.updatedAt).toLocaleString() : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.3em] text-slate-500">Link</dt>
          <dd>
            {typeof metadata.url === "string" ? (
              <a href={metadata.url} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                Open in source
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
