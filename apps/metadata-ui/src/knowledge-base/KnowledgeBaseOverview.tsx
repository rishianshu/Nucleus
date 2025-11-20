import { useEffect, useMemo, useState } from "react";
import { LuArrowRight } from "react-icons/lu";
import { useNavigate } from "react-router-dom";
import { fetchMetadataGraphQL } from "../metadata/api";
import { KB_EDGES_QUERY, KB_NODES_QUERY } from "./queries";
import type { KbNode, KbEdge } from "./types";

type KnowledgeBaseOverviewProps = {
  metadataEndpoint: string | null;
  authToken?: string | null;
};

type OverviewState = {
  nodes: KbNode[];
  edges: KbEdge[];
  nodeCount: number;
  edgeCount: number;
  datasetCount: number;
  endpointCount: number;
  docPageCount: number;
  dependencyEdgeCount: number;
  documentedByCount: number;
};

export function KnowledgeBaseOverview({ metadataEndpoint, authToken }: KnowledgeBaseOverviewProps) {
  const navigate = useNavigate();
  const [state, setState] = useState<OverviewState>({
    nodes: [],
    edges: [],
    nodeCount: 0,
    edgeCount: 0,
    datasetCount: 0,
    endpointCount: 0,
    docPageCount: 0,
    dependencyEdgeCount: 0,
    documentedByCount: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!metadataEndpoint) {
      setError("Metadata endpoint is not configured.");
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setError(null);
    const recentVariables = { first: 10 };
    Promise.all([
      fetchMetadataGraphQL<{ kbNodes: { edges: Array<{ node: KbNode }>; totalCount: number } }>(
        metadataEndpoint,
        KB_NODES_QUERY,
        recentVariables,
        undefined,
        { token: authToken ?? undefined },
      ),
      fetchMetadataGraphQL<{ kbEdges: { edges: Array<{ node: KbEdge }>; totalCount: number } }>(
        metadataEndpoint,
        KB_EDGES_QUERY,
        recentVariables,
        undefined,
        { token: authToken ?? undefined },
      ),
      fetchMetadataGraphQL<{ kbNodes: { totalCount: number } }>(
        metadataEndpoint,
        KB_NODES_QUERY,
        { first: 1, type: "Dataset" },
        undefined,
        { token: authToken ?? undefined },
      ),
      fetchMetadataGraphQL<{ kbNodes: { totalCount: number } }>(
        metadataEndpoint,
        KB_NODES_QUERY,
        { first: 1, type: "Endpoint" },
        undefined,
        { token: authToken ?? undefined },
      ),
      fetchMetadataGraphQL<{ kbNodes: { totalCount: number } }>(
        metadataEndpoint,
        KB_NODES_QUERY,
        { first: 1, type: "DocPage" },
        undefined,
        { token: authToken ?? undefined },
      ),
      fetchMetadataGraphQL<{ kbEdges: { totalCount: number } }>(
        metadataEndpoint,
        KB_EDGES_QUERY,
        { first: 1, edgeType: "DEPENDENCY_OF" },
        undefined,
        { token: authToken ?? undefined },
      ),
      fetchMetadataGraphQL<{ kbEdges: { totalCount: number } }>(
        metadataEndpoint,
        KB_EDGES_QUERY,
        { first: 1, edgeType: "DOCUMENTED_BY" },
        undefined,
        { token: authToken ?? undefined },
      ),
    ])
      .then(([nodesPayload, edgesPayload, datasetSummary, endpointSummary, docSummary, dependencySummary, documentedSummary]) => {
        if (cancelled) {
          return;
        }
        setState({
          nodes: nodesPayload.kbNodes.edges.map((edge) => edge.node),
          edges: edgesPayload.kbEdges.edges.map((edge) => edge.node),
          nodeCount: nodesPayload.kbNodes.totalCount,
          edgeCount: edgesPayload.kbEdges.totalCount,
          datasetCount: datasetSummary.kbNodes.totalCount,
          endpointCount: endpointSummary.kbNodes.totalCount,
          docPageCount: docSummary.kbNodes.totalCount,
          dependencyEdgeCount: dependencySummary.kbEdges.totalCount,
          documentedByCount: documentedSummary.kbEdges.totalCount,
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authToken, metadataEndpoint]);

  const scopeSummary = useMemo(() => {
    const buckets = new Map<string, { label: string; count: number }>();
    state.nodes.forEach((node) => {
      const key = node.scope.projectId || node.scope.domainId || node.scope.orgId;
      const label = key ?? "global";
      buckets.set(label, { label, count: (buckets.get(label)?.count ?? 0) + 1 });
    });
    return Array.from(buckets.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  }, [state.nodes]);

  if (loading) {
    return <p className="text-sm text-slate-500">Loading Knowledge Base overview…</p>;
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100">
        {error}
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OverviewCard label="Total nodes" value={state.nodeCount.toLocaleString()} helper="Across all entity types" />
        <OverviewCard label="Datasets" value={state.datasetCount.toLocaleString()} helper="catalog.dataset" />
        <OverviewCard label="Endpoints" value={state.endpointCount.toLocaleString()} helper="metadata.endpoint" />
        <OverviewCard label="Total edges" value={state.edgeCount.toLocaleString()} helper="All edge types" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OverviewCard label="Docs" value={state.docPageCount.toLocaleString()} helper="doc.page" />
        <OverviewCard label="Dependencies" value={state.dependencyEdgeCount.toLocaleString()} helper="DEPENDENCY_OF" />
        <OverviewCard label="Documentation links" value={state.documentedByCount.toLocaleString()} helper="DOCUMENTED_BY" />
        <OverviewCard label="Top scopes" value={scopeSummary.length ? scopeSummary[0].label : "—"} helper={scopeSummary.length ? `${scopeSummary[0].count} recent nodes` : "No data"} />
      </div>
      {scopeSummary.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">Scope summary (last 10 nodes)</h2>
            <span className="text-xs text-slate-500">{scopeSummary.length} scopes</span>
          </div>
          <ul className="mt-3 divide-y divide-slate-200 text-sm dark:divide-slate-800">
            {scopeSummary.map((entry) => (
              <li key={entry.label} className="flex items-center justify-between py-2">
                <span className="font-semibold text-slate-900 dark:text-white">{entry.label}</span>
                <span className="text-xs text-slate-500">{entry.count} node(s)</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">Recent nodes</h2>
            <button
              type="button"
              onClick={() => navigate("/kb/explorer/nodes")}
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 hover:text-slate-900 dark:text-slate-300"
            >
              View explorer <LuArrowRight className="h-3 w-3" />
            </button>
          </div>
          {state.nodes.length === 0 ? (
            <p className="pt-4 text-sm text-slate-500">No nodes available.</p>
          ) : (
            <ul className="divide-y divide-slate-200 pt-3 text-sm dark:divide-slate-800">
              {state.nodes.map((node) => (
                <li key={node.id} className="py-2">
                  <p className="font-semibold text-slate-900 dark:text-white">{node.displayName}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {node.entityType} · {node.identity.logicalKey}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">Recent edges</h2>
            <button
              type="button"
              onClick={() => navigate("/kb/explorer/edges")}
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 hover:text-slate-900 dark:text-slate-300"
            >
              View explorer <LuArrowRight className="h-3 w-3" />
            </button>
          </div>
          {state.edges.length === 0 ? (
            <p className="pt-4 text-sm text-slate-500">No edges available.</p>
          ) : (
            <ul className="divide-y divide-slate-200 pt-3 text-sm dark:divide-slate-800">
              {state.edges.map((edge) => (
                <li key={edge.id} className="py-2">
                  <p className="font-semibold text-slate-900 dark:text-white">{edge.edgeType}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {edge.sourceEntityId} → {edge.targetEntityId}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewCard({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{value}</p>
      {helper ? <p className="text-xs text-slate-500 dark:text-slate-400">{helper}</p> : null}
    </div>
  );
}
