import { useCallback, useEffect, useMemo, useState } from "react";
import { LuClipboard, LuExternalLink, LuMap, LuRefreshCcw } from "react-icons/lu";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchMetadataGraphQL } from "../metadata/api";
import { usePagedQuery, useToastQueue, useDebouncedValue } from "../metadata/hooks";
import type { Role } from "../auth/AuthProvider";
import { KB_NODES_QUERY, KB_NODE_DETAIL_QUERY } from "./queries";
import type { KbNode, KbScope } from "./types";

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
  const [typeFilter, setTypeFilter] = useState("all");
  const [scopeFilters, setScopeFilters] = useState<ScopeFilters>({});
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 400);
  const toast = useToastQueue();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<KbNode | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const handleSelectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    const next = new URLSearchParams(searchParams);
    next.set("node", nodeId);
    setSearchParams(next, { replace: true });
  };
  const nodeQueryVariables = useMemo(() => {
    const projectId = scopeFilters.projectId?.trim() ?? "";
    const domainId = scopeFilters.domainId?.trim() ?? "";
    const teamId = scopeFilters.teamId?.trim() ?? "";
    const searchValue = debouncedSearch.trim();
    const normalizedScope = {
      projectId: projectId.length ? projectId : null,
      domainId: domainId.length ? domainId : null,
      teamId: teamId.length ? teamId : null,
    };
    const hasScopeFilters = Boolean(normalizedScope.projectId || normalizedScope.domainId || normalizedScope.teamId);
    return {
      type: typeFilter === "all" ? null : typeFilter,
      scope: hasScopeFilters ? normalizedScope : null,
      search: searchValue.length ? searchValue : null,
    };
  }, [typeFilter, scopeFilters.projectId, scopeFilters.domainId, scopeFilters.teamId, debouncedSearch]);

  const selectNodesConnection = useCallback(
    (payload: { kbNodes?: { edges: Array<{ node: KbNode }>; pageInfo: unknown } } | null | undefined) => {
      if (!payload?.kbNodes) {
        return null;
      }
      return {
        nodes: payload.kbNodes.edges.map((edge: { node: KbNode }) => edge.node),
        pageInfo: payload.kbNodes.pageInfo,
      };
    },
    [],
  );

  const pagedQuery = usePagedQuery<KbNode>({
    metadataEndpoint,
    token: authToken ?? undefined,
    query: KB_NODES_QUERY,
    pageSize: 25,
    variables: nodeQueryVariables,
    selectConnection: selectNodesConnection,
    deps: [metadataEndpoint, authToken, nodeQueryVariables],
  });

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
      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
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
            >
              <option value="all">All types</option>
              <option value="Dataset">Dataset</option>
              <option value="Endpoint">Endpoint</option>
              <option value="DocPage">Doc page</option>
            </select>
          </div>
          <ScopeInput
            label="Project"
            value={scopeFilters.projectId ?? ""}
            onChange={(value) => setScopeFilters((prev) => ({ ...prev, projectId: value }))}
          />
          <ScopeInput label="Domain" value={scopeFilters.domainId ?? ""} onChange={(value) => setScopeFilters((prev) => ({ ...prev, domainId: value }))} />
          <ScopeInput label="Team" value={scopeFilters.teamId ?? ""} onChange={(value) => setScopeFilters((prev) => ({ ...prev, teamId: value }))} />
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
          </div>
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
                {pagedQuery.items.map((node) => {
                  const isSelected = node.id === selectedNodeId;
                  return (
                    <tr
                      key={node.id}
                      className={`cursor-pointer border-t border-slate-100 text-slate-700 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/40 ${
                        isSelected ? "bg-slate-100 dark:bg-slate-800/60" : ""
                      }`}
                      onClick={() => handleSelectNode(node.id)}
                    >
                      <td className="px-2 py-2 font-semibold">{node.entityType}</td>
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
                          className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-2 py-1 text-[10px] uppercase tracking-[0.4em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                          onClick={(event) => {
                            event.stopPropagation();
                            navigator.clipboard?.writeText(node.identity.logicalKey ?? "");
                            toast.enqueue({
                              id: `kb-node-copy-${node.id}`,
                              message: "Logical key copied",
                              tone: "success",
                            });
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
        data-testid="kb-node-detail-panel"
      >
        {selectedNode ? (
          <NodeDetail
            node={selectedNode}
            onOpenScenes={() => navigate(`/kb/scenes?node=${selectedNode.id}`)}
            onOpenProvenance={() => navigate(`/kb/provenance?node=${selectedNode.id}`)}
            onOpenExplorer={() => navigate(`/kb/explorer/nodes?node=${selectedNode.id}`)}
            onCopyLogicalKey={() => {
              navigator.clipboard?.writeText(selectedNode.identity.logicalKey ?? "");
              toast.enqueue({ id: `kb-node-detail-copy-${selectedNode.id}`, message: "Logical key copied", tone: "success" });
            }}
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

function ScopeInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col">
      <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
    </div>
  );
}

function NodeDetail({
  node,
  onOpenScenes,
  onOpenProvenance,
  onOpenExplorer,
  onCopyLogicalKey,
}: {
  node: KbNode;
  onOpenScenes: () => void;
  onOpenProvenance: () => void;
  onOpenExplorer: () => void;
  onCopyLogicalKey: () => void;
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
            className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-2 py-1 text-[10px] uppercase tracking-[0.4em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
          >
            <LuClipboard className="h-3 w-3" /> Copy
          </button>
        </div>
        <p className="break-all text-sm text-slate-900 dark:text-white">{node.identity.logicalKey}</p>
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
