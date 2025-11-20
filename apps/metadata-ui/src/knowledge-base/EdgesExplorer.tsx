import { useCallback, useEffect, useMemo, useState } from "react";
import { LuClipboard, LuExternalLink, LuMap, LuRefreshCcw } from "react-icons/lu";
import { useNavigate } from "react-router-dom";
import { usePagedQuery, useToastQueue } from "../metadata/hooks";
import type { KbEdge, KbScope } from "./types";
import { KB_EDGES_QUERY } from "./queries";

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
  const [edgeType, setEdgeType] = useState("all");
  const [scopeFilters, setScopeFilters] = useState<ScopeFilters>({});
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const toast = useToastQueue();
  const navigate = useNavigate();
  const [selectedEdge, setSelectedEdge] = useState<KbEdge | null>(null);

  const edgeQueryVariables = useMemo(() => {
    const projectId = scopeFilters.projectId?.trim() ?? "";
    const domainId = scopeFilters.domainId?.trim() ?? "";
    const teamId = scopeFilters.teamId?.trim() ?? "";
    const normalizedScope = {
      projectId: projectId.length ? projectId : null,
      domainId: domainId.length ? domainId : null,
      teamId: teamId.length ? teamId : null,
    };
    const hasScopeFilters = Boolean(normalizedScope.projectId || normalizedScope.domainId || normalizedScope.teamId);
    const sourceValue = sourceId.trim();
    const targetValue = targetId.trim();
    return {
      edgeType: edgeType === "all" ? null : edgeType,
      scope: hasScopeFilters ? normalizedScope : null,
      sourceId: sourceValue.length ? sourceValue : null,
      targetId: targetValue.length ? targetValue : null,
    };
  }, [edgeType, scopeFilters.projectId, scopeFilters.domainId, scopeFilters.teamId, sourceId, targetId]);

  const selectEdgesConnection = useCallback(
    (payload: { kbEdges?: { edges: Array<{ node: KbEdge }>; pageInfo: unknown } } | null | undefined) => {
      if (!payload?.kbEdges) {
        return null;
      }
      return {
        nodes: payload.kbEdges.edges.map((edge: { node: KbEdge }) => edge.node),
        pageInfo: payload.kbEdges.pageInfo,
      };
    },
    [],
  );

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

  if (!metadataEndpoint) {
    return <p className="text-sm text-slate-500">Metadata endpoint not configured.</p>;
  }

  return (
    <div className="flex h-full min-h-0 gap-6">
      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col">
            <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Edge type</label>
            <select
              value={edgeType}
              onChange={(event) => setEdgeType(event.target.value)}
              className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="all">All</option>
              <option value="DEPENDENCY_OF">Dependency</option>
              <option value="DOCUMENTED_BY">Documented by</option>
            </select>
          </div>
          <ScopeInput label="Project" value={scopeFilters.projectId ?? ""} onChange={(value) => setScopeFilters((prev) => ({ ...prev, projectId: value }))} />
          <ScopeInput label="Domain" value={scopeFilters.domainId ?? ""} onChange={(value) => setScopeFilters((prev) => ({ ...prev, domainId: value }))} />
          <ScopeInput label="Team" value={scopeFilters.teamId ?? ""} onChange={(value) => setScopeFilters((prev) => ({ ...prev, teamId: value }))} />
          <TextInput label="Source node" value={sourceId} onChange={setSourceId} placeholder="Node ID" />
          <TextInput label="Target node" value={targetId} onChange={setTargetId} placeholder="Node ID" />
          <button
            type="button"
            onClick={() => pagedQuery.refresh()}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
          >
            <LuRefreshCcw className="h-4 w-4" /> Refresh
          </button>
        </div>
        <div className="mt-4 flex-1 overflow-auto">
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
                {pagedQuery.items.map((edge) => {
                  const isSelected = selectedEdge?.id === edge.id;
                  return (
                    <tr
                      key={edge.id}
                      className={`border-t border-slate-100 text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/40 ${
                        isSelected ? "bg-slate-100 dark:bg-slate-800/60" : ""
                      }`}
                      onClick={() => setSelectedEdge(edge)}
                    >
                    <td className="px-2 py-2 font-semibold">{edge.edgeType}</td>
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
                        className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-2 py-1 text-[10px] uppercase tracking-[0.4em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                        onClick={(event) => {
                          event.stopPropagation();
                          navigator.clipboard?.writeText(edge.identity.logicalKey ?? "");
                          toast.enqueue({ id: `kb-edge-copy-${edge.id}`, message: "Logical key copied", tone: "success" });
                        }}
                      >
                        <LuClipboard className="h-3 w-3" /> Copy
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}
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
            onOpenSource={() => navigate(`/kb/explorer/nodes?node=${selectedEdge.sourceEntityId}`)}
            onOpenTarget={() => navigate(`/kb/explorer/nodes?node=${selectedEdge.targetEntityId}`)}
            onSourceScene={() => navigate(`/kb/scenes?node=${selectedEdge.sourceEntityId}`)}
            onTargetScene={() => navigate(`/kb/scenes?node=${selectedEdge.targetEntityId}`)}
            onCopyLogicalKey={() => {
              navigator.clipboard?.writeText(selectedEdge.identity.logicalKey ?? "");
              toast.enqueue({ id: `kb-edge-detail-copy-${selectedEdge.id}`, message: "Logical key copied", tone: "success" });
            }}
          />
        ) : (
          <p className="text-sm text-slate-500">Select an edge to view details.</p>
        )}
      </aside>
    </div>
  );
}

function ScopeInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col">
      <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
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
  onOpenSource,
  onOpenTarget,
  onSourceScene,
  onTargetScene,
  onCopyLogicalKey,
}: {
  edge: KbEdge;
  onOpenSource: () => void;
  onOpenTarget: () => void;
  onSourceScene: () => void;
  onTargetScene: () => void;
  onCopyLogicalKey: () => void;
}) {
  return (
    <div className="space-y-3 text-sm text-slate-700 dark:text-slate-200">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">Edge type</p>
        <p className="text-lg font-semibold text-slate-900 dark:text-white">{edge.edgeType}</p>
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
            className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-2 py-1 text-[10px] uppercase tracking-[0.4em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
          >
            <LuClipboard className="h-3 w-3" /> Copy
          </button>
        </div>
        <p className="break-all text-slate-900 dark:text-white">{edge.identity.logicalKey}</p>
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
