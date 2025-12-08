import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { LuCheck, LuClipboard, LuExternalLink, LuMap, LuRefreshCcw } from "react-icons/lu";
import { useNavigate } from "react-router-dom";
import { usePagedQuery, useToastQueue } from "../metadata/hooks";
import type { KbEdge, KbScope } from "./types";
import { KB_EDGES_QUERY } from "./queries";
import { useKbFacets } from "./useKbFacets";
import { KnowledgeBaseGraphView } from "./KnowledgeBaseGraphView";
import { ViewToggle } from "./ViewToggle";
import { copyTextToClipboard } from "./clipboard";
import { useKbMetaRegistry } from "./useKbMeta";

type EdgesExplorerProps = {
  metadataEndpoint: string | null;
  authToken?: string | null;
};

type ScopeFilters = {
  projectId?: string;
  domainId?: string;
  teamId?: string;
};

export function EdgesExplorer({ metadataEndpoint, authToken }: EdgesExplorerProps) {
  const [edgeType, setEdgeType] = useState("");
  const [edgeTypes, setEdgeTypes] = useState<string[]>([]);
  const [direction, setDirection] = useState<"" | "OUTBOUND" | "INBOUND" | "BOTH">("");
  const [scopeFilters, setScopeFilters] = useState<ScopeFilters>({});
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const toastQueue = useToastQueue();
  const navigate = useNavigate();
  const [selectedEdge, setSelectedEdge] = useState<KbEdge | null>(null);
  const [copiedEdgeId, setCopiedEdgeId] = useState<string | null>(null);
  const [copyAnnouncement, setCopyAnnouncement] = useState("");
  const copyResetRef = useRef<number | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "graph">("list");

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
  const edgeQueryVariables = useMemo(() => {
    const sourceValue = sourceId.trim();
    const targetValue = targetId.trim();
    return {
      edgeType: edgeType || null,
      edgeTypes: edgeTypes.length ? edgeTypes : null,
      direction: direction || null,
      scope: scopeArgument,
      sourceId: sourceValue.length ? sourceValue : null,
      targetId: targetValue.length ? targetValue : null,
    };
  }, [edgeType, edgeTypes, direction, scopeArgument, sourceId, targetId]);

  const { facets, loading: facetsLoading, error: facetsError, refresh: refreshFacets } = useKbFacets(
    metadataEndpoint,
    authToken ?? undefined,
    normalizedScope,
  );
  const { getEdgeLabel, error: metaError, isFallback: metaFallback, refresh: refreshMeta } = useKbMetaRegistry(
    metadataEndpoint,
    authToken ?? undefined,
    normalizedScope,
  );

  type KbEdgesQueryResult = {
    kbEdges?: {
      edges?: Array<{ node: KbEdge }>;
      pageInfo?: {
        hasNextPage?: boolean;
        hasPreviousPage?: boolean;
        startCursor?: string | null;
        endCursor?: string | null;
      };
    };
  };
  const selectEdgesConnection = useCallback((payload: KbEdgesQueryResult | null | undefined) => {
    if (!payload?.kbEdges) {
      return null;
    }
    return {
      nodes: (payload.kbEdges.edges ?? []).map((edge) => edge.node),
      pageInfo: payload.kbEdges.pageInfo ?? {},
    };
  }, []);

  const pagedQuery = usePagedQuery<KbEdge>({
    metadataEndpoint,
    token: authToken ?? undefined,
    query: KB_EDGES_QUERY,
    pageSize: 25,
    variables: edgeQueryVariables,
    selectConnection: selectEdgesConnection,
    deps: [metadataEndpoint, authToken, edgeQueryVariables],
  });

  useEffect(() => {
    if (!selectedEdge && pagedQuery.items.length > 0) {
      setSelectedEdge(pagedQuery.items[0]);
    }
  }, [pagedQuery.items, selectedEdge]);

  const handleCopy = useCallback(
    async (event: MouseEvent<HTMLButtonElement> | null, logicalKey: string | null | undefined, edgeId: string) => {
      event?.stopPropagation();
      if (!logicalKey) {
        toastQueue.pushToast({ title: "Logical key unavailable", intent: "error" });
        return;
      }
      const copied = await copyTextToClipboard(logicalKey);
      if (!copied) {
        toastQueue.pushToast({ title: "Copy failed. Try again.", intent: "error" });
      }
      setCopiedEdgeId(edgeId);
      setCopyAnnouncement(copied ? "Edge logical key copied" : "");
      if (copyResetRef.current) {
        window.clearTimeout(copyResetRef.current);
      }
      copyResetRef.current = window.setTimeout(() => {
        setCopiedEdgeId(null);
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

  const graphNodes = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>();
    pagedQuery.items.forEach((edge) => {
      if (!map.has(edge.sourceEntityId)) {
        map.set(edge.sourceEntityId, { id: edge.sourceEntityId, label: edge.sourceEntityId });
      }
      if (!map.has(edge.targetEntityId)) {
        map.set(edge.targetEntityId, { id: edge.targetEntityId, label: edge.targetEntityId });
      }
    });
    return Array.from(map.values());
  }, [pagedQuery.items]);

  const graphEdges = useMemo(
    () =>
      pagedQuery.items.map((edge) => ({
        id: edge.id,
        sourceId: edge.sourceEntityId,
        targetId: edge.targetEntityId,
      })),
    [pagedQuery.items],
  );

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
            <p className="text-lg font-semibold text-slate-900 dark:text-white">Edges explorer</p>
          </div>
          <ViewToggle value={viewMode} onChange={setViewMode} disableGraph={!graphNodes.length || !graphEdges.length} />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col">
            <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Relation kinds</label>
            <div className="mt-1 flex max-w-xs flex-wrap gap-2">
              {(facets?.edgeTypes ?? []).map((facet) => {
                const checked = edgeTypes.includes(facet.value);
                return (
                  <label key={facet.value} className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-900/30 dark:border-slate-600 dark:bg-slate-800"
                      checked={checked}
                      onChange={(event) => {
                        setEdgeType(""); // prefer multi-select over single select
                        setEdgeTypes((prev) =>
                          event.target.checked ? [...prev, facet.value] : prev.filter((value) => value !== facet.value),
                        );
                      }}
                      data-testid={`kb-edge-kind-${facet.value}`}
                    />
                    <span>
                      {getEdgeLabel(facet.value)} {typeof facet.count === "number" ? `(${facet.count})` : ""}
                    </span>
                  </label>
                );
              })}
              {(facets?.edgeTypes ?? []).length === 0 ? <span className="text-xs text-slate-500">No relation kinds loaded.</span> : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setEdgeTypes([]);
                setEdgeType("");
              }}
              className="mt-2 self-start text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 underline"
            >
              Clear
            </button>
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
          <TextInput label="Source node" value={sourceId} onChange={setSourceId} placeholder="Node ID" />
          <TextInput label="Target node" value={targetId} onChange={setTargetId} placeholder="Node ID" />
          <div className="flex flex-col">
            <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Direction</label>
            <select
              value={direction}
              onChange={(event) => setDirection(event.target.value as typeof direction)}
              className="mt-1 w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="">Any</option>
              <option value="OUTBOUND">Outbound</option>
              <option value="INBOUND">Inbound</option>
              <option value="BOTH">Both</option>
            </select>
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
            Failed to load edge filters: {facetsError}{" "}
            <button type="button" onClick={() => refreshFacets()} className="underline">
              Retry
            </button>
          </p>
        ) : null}
        <div className="mt-4 flex-1 overflow-auto">
          {viewMode === "graph" ? (
            <KnowledgeBaseGraphView
              nodes={graphNodes}
              edges={graphEdges}
              selectedNodeId={selectedEdge?.sourceEntityId}
              selectedEdgeId={selectedEdge?.id ?? null}
              onSelectNode={(nodeId) => {
                navigate(`/kb/explorer/nodes?node=${nodeId}`);
              }}
              onSelectEdge={(edgeId) => {
                const match = pagedQuery.items.find((edge) => edge.id === edgeId);
                if (match) {
                  setSelectedEdge(match);
                }
              }}
              isRefreshing={pagedQuery.isRefetching}
            />
          ) : (
            <>
              {pagedQuery.error ? (
                <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100">
                  {pagedQuery.error}
                </p>
              ) : null}
              {pagedQuery.loading && pagedQuery.items.length === 0 ? <p className="text-sm text-slate-500">Loading edges…</p> : null}
              {!pagedQuery.loading && pagedQuery.items.length === 0 ? (
                <p className="text-sm text-slate-500">No edges match the current filters.</p>
              ) : null}
              {pagedQuery.items.length > 0 ? (
                <table className="mt-2 w-full table-auto text-sm" data-testid="kb-edges-table">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.3em] text-slate-500">
                      <th className="px-2 py-2">Type</th>
                      <th className="px-2 py-2">Source</th>
                      <th className="px-2 py-2">Target</th>
                      <th className="px-2 py-2">Updated</th>
                      <th className="px-2 py-2">Identity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedQuery.items.map((edge, index) => {
                      const rowCopyKey = `edge-row-${index}`;
                      const isSelected = selectedEdge?.id === edge.id;
                      const isCopied = copiedEdgeId === rowCopyKey;
                      const typeLabel = getEdgeLabel(edge.edgeType);
                      return (
                        <tr
                          key={edge.id}
                          className={`border-t border-slate-100 text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/40 ${
                            isSelected ? "bg-slate-100 dark:bg-slate-800/60" : ""
                          }`}
                          onClick={() => setSelectedEdge(edge)}
                        >
                          <td className="px-2 py-2">
                            <div className="flex flex-col">
                              <span className="font-semibold text-slate-900 dark:text-white">{typeLabel}</span>
                              <span className="text-[10px] uppercase tracking-[0.3em] text-slate-400">{edge.edgeType}</span>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-xs text-slate-500">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            navigate(`/kb/explorer/nodes?node=${edge.sourceEntityId}`);
                          }}
                              className="rounded-full border border-slate-300 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                            >
                              {edge.sourceEntityId}
                            </button>
                          </td>
                          <td className="px-2 py-2 text-xs text-slate-500">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                navigate(`/kb/explorer/nodes?node=${edge.targetEntityId}`);
                              }}
                              className="rounded-full border border-slate-300 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                            >
                              {edge.targetEntityId}
                            </button>
                          </td>
                          <td className="px-2 py-2 text-xs text-slate-500">{new Date(edge.updatedAt).toLocaleString()}</td>
                          <td className="px-2 py-2 text-xs text-slate-500">
                        <button
                          type="button"
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.4em] transition ${
                            isCopied
                              ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:border-emerald-400 dark:text-emerald-200"
                              : "border-slate-300 text-slate-600 hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                          }`}
                              onClick={(event) => handleCopy(event, edge.identity.logicalKey ?? edge.id, rowCopyKey)}
                          data-testid="kb-edge-copy-button"
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
        data-testid="kb-edge-detail-panel"
      >
        {selectedEdge ? (
          <EdgeDetail
            edge={selectedEdge}
            edgeLabel={getEdgeLabel(selectedEdge.edgeType)}
            onOpenSource={() => navigate(`/kb/explorer/nodes?node=${selectedEdge.sourceEntityId}`)}
            onOpenTarget={() => navigate(`/kb/explorer/nodes?node=${selectedEdge.targetEntityId}`)}
            onSourceScene={() => navigate(`/kb/scenes?node=${selectedEdge.sourceEntityId}`)}
            onTargetScene={() => navigate(`/kb/scenes?node=${selectedEdge.targetEntityId}`)}
            onCopyLogicalKey={() => handleCopy(null, selectedEdge.identity.logicalKey ?? selectedEdge.id, `detail-${selectedEdge.id}`)}
            isCopied={copiedEdgeId === `detail-${selectedEdge.id}`}
          />
        ) : (
          <p className="text-sm text-slate-500">Select an edge to view details.</p>
        )}
      </aside>
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
          className="mt-1 w-36 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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

function TextInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="flex flex-col">
      <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-36 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
    </div>
  );
}

function EdgeDetail({
  edge,
  edgeLabel,
  onOpenSource,
  onOpenTarget,
  onSourceScene,
  onTargetScene,
  onCopyLogicalKey,
  isCopied = false,
}: {
  edge: KbEdge;
  edgeLabel: string;
  onOpenSource: () => void;
  onOpenTarget: () => void;
  onSourceScene: () => void;
  onTargetScene: () => void;
  onCopyLogicalKey: () => void;
  isCopied?: boolean;
}) {
  return (
    <div className="space-y-3 text-sm text-slate-700 dark:text-slate-200">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Edge type</p>
        <p className="text-lg font-semibold text-slate-900 dark:text-white">{edgeLabel}</p>
        <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">{edge.edgeType}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Source</p>
        <p className="break-all text-slate-900 dark:text-white">{edge.sourceEntityId}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Target</p>
        <p className="break-all text-slate-900 dark:text-white">{edge.targetEntityId}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Scope</p>
        <ScopeChips scope={edge.scope} />
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
            data-testid="kb-edge-detail-copy"
          >
            {isCopied ? <LuCheck className="h-3 w-3" /> : <LuClipboard className="h-3 w-3" />} {isCopied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="break-all text-slate-900 dark:text-white">{edge.identity.logicalKey ?? edge.id}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Actions</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onOpenSource}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
          >
            <LuExternalLink className="h-4 w-4" /> Source node
          </button>
          <button
            type="button"
            onClick={onOpenTarget}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
          >
            <LuExternalLink className="h-4 w-4" /> Target node
          </button>
          <button
            type="button"
            onClick={onSourceScene}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
          >
            <LuMap className="h-4 w-4" /> Source scene
          </button>
          <button
            type="button"
            onClick={onTargetScene}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
          >
            <LuMap className="h-4 w-4" /> Target scene
          </button>
        </div>
      </div>
      <div className="text-xs text-slate-500">Updated {new Date(edge.updatedAt).toLocaleString()}</div>
    </div>
  );
}

function SkeletonRows({ columns, count }: { columns: number; count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, rowIndex) => (
        <tr key={`kb-edge-skeleton-${rowIndex}`} className="animate-pulse border-t border-slate-100 dark:border-slate-800">
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
