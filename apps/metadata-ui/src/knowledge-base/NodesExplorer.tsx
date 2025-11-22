import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { LuCheck, LuClipboard, LuExternalLink, LuMap, LuRefreshCcw } from "react-icons/lu";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchMetadataGraphQL } from "../metadata/api";
import { usePagedQuery, useToastQueue, useDebouncedValue } from "../metadata/hooks";
import type { Role } from "../auth/AuthProvider";
import { KB_NODES_QUERY, KB_NODE_DETAIL_QUERY } from "./queries";
import type { KbNode, KbScope } from "./types";
import { useKbFacets } from "./useKbFacets";
import { KnowledgeBaseGraphView } from "./KnowledgeBaseGraphView";
import { ViewToggle } from "./ViewToggle";
import { copyTextToClipboard } from "./clipboard";
import { useKbMetaRegistry } from "./useKbMeta";

type NodesExplorerProps = {
  metadataEndpoint: string | null;
  authToken?: string | null;
  projectSlug?: string | null;
  userRole: Role;
};

type ScopeFilters = {
  projectId?: string;
  domainId?: string;
  teamId?: string;
};

export function NodesExplorer({ metadataEndpoint, authToken }: NodesExplorerProps) {
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState("");
  const [scopeFilters, setScopeFilters] = useState<ScopeFilters>({});
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 400);
  const toastQueue = useToastQueue();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<KbNode | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [copiedSourceId, setCopiedSourceId] = useState<string | null>(null);
  const [copyAnnouncement, setCopyAnnouncement] = useState("");
  const copyResetRef = useRef<number | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "graph">("list");
  const handleSelectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    const next = new URLSearchParams(searchParams);
    next.set("node", nodeId);
    setSearchParams(next, { replace: true });
  };
  const normalizedScope = useMemo(() => {
    const projectId = scopeFilters.projectId?.trim();
    const domainId = scopeFilters.domainId?.trim();
    const teamId = scopeFilters.teamId?.trim();
    return {
      projectId: projectId && projectId.length ? projectId : null,
      domainId: domainId && domainId.length ? domainId : null,
      teamId: teamId && teamId.length ? teamId : null,
    };
  }, [scopeFilters.projectId, scopeFilters.domainId, scopeFilters.teamId]);
  const hasScopeFilters = Boolean(normalizedScope.projectId || normalizedScope.domainId || normalizedScope.teamId);
  const scopeArgument = useMemo(() => (hasScopeFilters ? normalizedScope : null), [hasScopeFilters, normalizedScope]);

  const {
    getNodeLabel,
    matchNodeSynonym,
    error: metaError,
    isFallback: metaFallback,
    refresh: refreshMeta,
  } = useKbMetaRegistry(metadataEndpoint, authToken ?? undefined, normalizedScope);

  const synonymMatch = useMemo(() => {
    if (typeFilter.trim().length > 0) {
      return null;
    }
    const trimmed = debouncedSearch.trim();
    if (!trimmed) {
      return null;
    }
    return matchNodeSynonym(trimmed);
  }, [debouncedSearch, matchNodeSynonym, typeFilter]);

  const activeTypeFilter = typeFilter || synonymMatch?.value || "";
  const synonymLabel = useMemo(() => (synonymMatch ? getNodeLabel(synonymMatch.value) : null), [getNodeLabel, synonymMatch]);

  const nodeQueryVariables = useMemo(() => {
    const searchValue = debouncedSearch.trim();
    return {
      type: activeTypeFilter || null,
      scope: scopeArgument,
      search: searchValue.length ? searchValue : null,
    };
  }, [activeTypeFilter, scopeArgument, debouncedSearch]);

  const { facets, loading: facetsLoading, error: facetsError, refresh: refreshFacets } = useKbFacets(
    metadataEndpoint,
    authToken ?? undefined,
    normalizedScope,
  );

  type KbNodesQueryResult = {
    kbNodes?: {
      edges?: Array<{ node: KbNode }>;
      pageInfo?: {
        hasNextPage?: boolean;
        hasPreviousPage?: boolean;
        startCursor?: string | null;
        endCursor?: string | null;
      };
    };
  };
  const selectNodesConnection = useCallback((payload: KbNodesQueryResult | null | undefined) => {
    if (!payload?.kbNodes) {
      return null;
    }
    return {
      nodes: (payload.kbNodes.edges ?? []).map((edge) => edge.node),
      pageInfo: payload.kbNodes.pageInfo ?? {},
    };
  }, []);

  const pagedQuery = usePagedQuery<KbNode>({
    metadataEndpoint,
    token: authToken ?? undefined,
    query: KB_NODES_QUERY,
    pageSize: 25,
    variables: nodeQueryVariables,
    selectConnection: selectNodesConnection,
    deps: [metadataEndpoint, authToken, nodeQueryVariables],
  });

  const handleCopy = useCallback(
    async (event: MouseEvent<HTMLButtonElement> | null, logicalKey: string | null | undefined, sourceId: string) => {
      event?.stopPropagation();
      if (!logicalKey) {
        toastQueue.pushToast({ title: "Logical key unavailable", intent: "error" });
        return;
      }
      const copied = await copyTextToClipboard(logicalKey);
      if (!copied) {
        toastQueue.pushToast({ title: "Copy failed. Try again.", intent: "error" });
      }
      setCopiedSourceId(sourceId);
      setCopyAnnouncement(copied ? "Logical key copied" : "");
      if (copyResetRef.current) {
        window.clearTimeout(copyResetRef.current);
      }
      copyResetRef.current = window.setTimeout(() => {
        setCopiedSourceId(null);
        setCopyAnnouncement("");
      }, 1200);
    },
    [toastQueue],
  );

  useEffect(() => {
    return () => {
      if (copyResetRef.current) {
        window.clearTimeout(copyResetRef.current);
      }
    };
  }, []);

  const graphNodes = useMemo(
    () =>
      pagedQuery.items.map((node) => ({
        id: node.id,
        label: node.displayName ?? getNodeLabel(node.entityType),
      })),
    [getNodeLabel, pagedQuery.items],
  );


  useEffect(() => {
    const preselected = searchParams.get("node");
    if (preselected && preselected !== selectedNodeId) {
      setSelectedNodeId(preselected);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!selectedNodeId) {
      setSelectedNode(null);
      return;
    }
    let cancelled = false;
    if (!metadataEndpoint) {
      return () => {
        cancelled = true;
      };
    }
    fetchMetadataGraphQL<{ kbNode: KbNode | null }>(
      metadataEndpoint,
      KB_NODE_DETAIL_QUERY,
      { id: selectedNodeId },
      undefined,
      { token: authToken ?? undefined },
    )
      .then((payload) => {
        if (!cancelled) {
          setSelectedNode(payload.kbNode ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedNode(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authToken, metadataEndpoint, selectedNodeId]);

  if (!metadataEndpoint) {
    return <p className="text-sm text-slate-500">Metadata endpoint not configured.</p>;
  }

  return (
    <div className="flex h-full min-h-0 gap-6">
      <div role="status" aria-live="polite" className="sr-only">
        {copyAnnouncement}
      </div>
      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.4em] text-slate-500">View</p>
            <p className="text-lg font-semibold text-slate-900 dark:text-white">Nodes explorer</p>
          </div>
          <ViewToggle value={viewMode} onChange={setViewMode} disableGraph={!graphNodes.length} />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-1 flex-col">
            <label htmlFor="kb-node-type" className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              Type
            </label>
            <select
              id="kb-node-type"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              data-testid="kb-node-type-filter"
            >
              <option value="">All types</option>
              {(facets?.nodeTypes ?? []).map((facet) => (
                <option key={facet.value} value={facet.value}>
                  {facet.label} ({facet.count})
                </option>
              ))}
            </select>
          </div>
          <ScopeInput
            label="Project"
            value={scopeFilters.projectId ?? ""}
            onChange={(value) => setScopeFilters((prev) => ({ ...prev, projectId: value }))}
            options={facets?.projects}
          />
          <ScopeInput
            label="Domain"
            value={scopeFilters.domainId ?? ""}
            onChange={(value) => setScopeFilters((prev) => ({ ...prev, domainId: value }))}
            options={facets?.domains}
          />
          <ScopeInput
            label="Team"
            value={scopeFilters.teamId ?? ""}
            onChange={(value) => setScopeFilters((prev) => ({ ...prev, teamId: value }))}
            options={facets?.teams}
          />
          <div className="flex flex-1 flex-col">
            <label htmlFor="kb-node-search" className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
              Search
            </label>
            <input
              id="kb-node-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by display name or path"
              className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            {synonymLabel && !typeFilter && debouncedSearch.trim().length > 0 ? (
              <p className="mt-1 text-xs text-slate-500" data-testid="kb-node-search-synonym">
                Synonym matched <span className="font-semibold text-slate-900 dark:text-slate-100">{synonymLabel}</span>. Filtering by that type.
              </p>
            ) : null}
          </div>
        <button
          type="button"
          onClick={() => pagedQuery.refresh()}
          className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
        >
          <LuRefreshCcw className="h-4 w-4" /> Refresh
        </button>
      </div>
        {metaError && metaFallback ? (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400" data-testid="kb-meta-warning">
            {metaError} — showing canonical values.{" "}
            <button type="button" onClick={() => refreshMeta()} className="underline">
              Retry
            </button>
          </p>
        ) : null}
        {facetsError ? (
          <p className="mt-2 text-xs text-rose-500">
            Failed to load filters: {facetsError}{" "}
            <button type="button" onClick={() => refreshFacets()} className="underline">
              Retry
            </button>
          </p>
        ) : null}
        <div className="mt-4 flex-1 overflow-auto">
          {viewMode === "graph" ? (
            <KnowledgeBaseGraphView
              nodes={graphNodes}
              edges={[]}
              selectedNodeId={selectedNodeId}
              onSelectNode={(id) => handleSelectNode(id)}
              isRefreshing={pagedQuery.isRefetching}
            />
          ) : (
            <>
              {pagedQuery.error ? (
                <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100">
                  {pagedQuery.error}
                </p>
              ) : null}
              {pagedQuery.loading && pagedQuery.items.length === 0 ? (
                <p className="text-sm text-slate-500">Loading nodes…</p>
              ) : null}
              {!pagedQuery.loading && pagedQuery.items.length === 0 ? (
                <p className="text-sm text-slate-500">No nodes match the current filters.</p>
              ) : null}
              {pagedQuery.items.length > 0 ? (
                <table className="mt-2 w-full table-auto text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.3em] text-slate-500">
                      <th className="px-2 py-2">Type</th>
                      <th className="px-2 py-2">Display</th>
                      <th className="px-2 py-2">Scope</th>
                      <th className="px-2 py-2">Updated</th>
                      <th className="px-2 py-2">Identity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedQuery.items.map((node, index) => {
                      const rowCopyKey = `node-row-${index}`;
                      const isSelected = node.id === selectedNodeId;
                      const typeLabel = getNodeLabel(node.entityType);
                      const isCopied = copiedSourceId === rowCopyKey;
                      return (
                        <tr
                          key={node.id}
                          className={`cursor-pointer border-t border-slate-100 text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/40 ${
                            isSelected ? "bg-slate-100 dark:bg-slate-800/60" : ""
                          }`}
                          onClick={() => handleSelectNode(node.id)}
                        >
                          <td className="px-2 py-2">
                            <div className="flex flex-col">
                              <span className="font-semibold text-slate-900 dark:text-white">{typeLabel}</span>
                              <span className="text-[10px] uppercase tracking-[0.3em] text-slate-400">{node.entityType}</span>
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex flex-col">
                              <span className="font-semibold text-slate-900 dark:text-white">{node.displayName}</span>
                              <span className="text-xs text-slate-500 dark:text-slate-400">{node.canonicalPath ?? "—"}</span>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-xs text-slate-500">
                            <ScopeChips scope={node.scope} />
                          </td>
                          <td className="px-2 py-2 text-xs text-slate-500">{new Date(node.updatedAt).toLocaleString()}</td>
                          <td className="px-2 py-2 text-xs text-slate-500">
                            <button
                              type="button"
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.4em] transition ${
                                isCopied
                                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:border-emerald-400 dark:text-emerald-300"
                                  : "border-slate-300 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                              }`}
                              onClick={(event) => handleCopy(event, node.identity.logicalKey ?? node.id, rowCopyKey)}
                              data-testid="kb-node-copy-button"
                            >
                              {isCopied ? <LuCheck className="h-3 w-3" /> : <LuClipboard className="h-3 w-3" />} {isCopied ? "Copied" : "Copy"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {pagedQuery.loading ? <SkeletonRows columns={5} count={Math.max(3, pagedQuery.items.length ? 2 : 4)} /> : null}
                  </tbody>
                </table>
              ) : null}
            </>
          )}
        </div>
        {pagedQuery.pageInfo.hasNextPage ? (
          <button
            type="button"
            onClick={() => pagedQuery.fetchNext()}
            className="mt-4 inline-flex items-center gap-2 self-start rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
          >
            Load more
          </button>
        ) : null}
      </div>
      <aside
        className="w-96 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60"
        data-testid="kb-node-detail-panel"
      >
        {selectedNode ? (
          <NodeDetail
            node={selectedNode}
            onOpenScenes={() => navigate(`/kb/scenes?node=${selectedNode.id}`)}
            onOpenProvenance={() => navigate(`/kb/provenance?node=${selectedNode.id}`)}
            onOpenExplorer={() => navigate(`/kb/explorer/nodes?node=${selectedNode.id}`)}
            onCopyLogicalKey={() => handleCopy(null, selectedNode.identity.logicalKey ?? selectedNode.id, `detail-${selectedNode.id}`)}
            isCopied={copiedSourceId === `detail-${selectedNode.id}`}
          />
        ) : (
          <p className="text-sm text-slate-500">Select a node to view identity and provenance details.</p>
        )}
      </aside>
    </div>
  );
}

function ScopeChips({ scope }: { scope: KbScope }) {
  const chips = [scope.projectId, scope.domainId, scope.teamId].filter(Boolean);
  if (chips.length === 0) {
    return <span>org:{scope.orgId}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span key={chip} className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] uppercase tracking-[0.4em] text-slate-500 dark:border-slate-700">
          {chip}
        </span>
      ))}
    </div>
  );
}

function ScopeInput({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options?: Array<{ value: string; label: string; count?: number }> | null;
}) {
  const hasOptions = Boolean(options?.length);
  return (
    <div className="flex flex-col">
      <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">{label}</label>
      {hasOptions ? (
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          data-testid={`kb-scope-${label.toLowerCase()}`}
        >
          <option value="">{`All ${label.toLowerCase()}`}</option>
          {(options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} {typeof option.count === "number" ? `(${option.count})` : ""}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      )}
    </div>
  );
}

function NodeDetail({
  node,
  onOpenScenes,
  onOpenProvenance,
  onOpenExplorer,
  onCopyLogicalKey,
  isCopied = false,
}: {
  node: KbNode;
  onOpenScenes: () => void;
  onOpenProvenance: () => void;
  onOpenExplorer: () => void;
  onCopyLogicalKey: () => void;
  isCopied?: boolean;
}) {
  return (
    <div className="flex h-full flex-col gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Node</p>
        <p className="text-lg font-semibold text-slate-900 dark:text-white">{node.displayName}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{node.entityType}</p>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Logical key</p>
          <button
            type="button"
            onClick={onCopyLogicalKey}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.4em] transition ${
              isCopied
                ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:border-emerald-400 dark:text-emerald-200"
                : "border-slate-300 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
            }`}
            data-testid="kb-node-detail-copy"
          >
            {isCopied ? <LuCheck className="h-3 w-3" /> : <LuClipboard className="h-3 w-3" />} {isCopied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="break-all text-sm text-slate-900 dark:text-white">{node.identity.logicalKey ?? node.id}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Scope</p>
        <ScopeChips scope={node.scope} />
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Provenance</p>
        <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-slate-900/80 px-3 py-2 text-xs text-slate-100">
          {JSON.stringify(node.provenance ?? node.identity.provenance ?? {}, null, 2)}
        </pre>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Actions</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpenScenes}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
          >
            <LuMap className="h-4 w-4" /> Scenes
          </button>
          <button
            type="button"
            onClick={onOpenProvenance}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover-border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
          >
            Provenance
          </button>
          <button
            type="button"
            onClick={onOpenExplorer}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
          >
            <LuExternalLink className="h-4 w-4" /> Open in explorer
          </button>
        </div>
      </div>
      <div className="mt-auto text-xs text-slate-500">
        <span>Last updated {new Date(node.updatedAt).toLocaleString()}</span>
      </div>
    </div>
  );
}

function SkeletonRows({ columns, count }: { columns: number; count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, rowIndex) => (
        <tr key={`kb-node-skeleton-${rowIndex}`} className="animate-pulse border-t border-slate-100 dark:border-slate-800">
          {Array.from({ length: columns }).map((__, colIndex) => (
            <td key={colIndex} className="px-2 py-3">
              <div className="h-4 w-full rounded bg-slate-200/70 dark:bg-slate-700/50" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
