import { useEffect, useMemo, useState } from "react";
import { LuSearch } from "react-icons/lu";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchMetadataGraphQL } from "../metadata/api";
import { KB_NODE_DETAIL_QUERY } from "./queries";
import type { KbNode } from "./types";
import { useKbMetaRegistry } from "./useKbMeta";

type ProvenanceViewProps = {
  metadataEndpoint: string | null;
  authToken?: string | null;
};

type ProvenanceEntry = {
  timestamp: string;
  phase?: string | null;
  originEndpointId?: string | null;
  logicalKey?: string | null;
  payload?: unknown;
};

export function ProvenanceView({ metadataEndpoint, authToken }: ProvenanceViewProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialNodeParam = searchParams.get("node") ?? "";
  const [nodeId, setNodeId] = useState(initialNodeParam);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ProvenanceEntry[]>([]);
  const [nodeMetadata, setNodeMetadata] = useState<{ id: string; displayName?: string | null; entityType?: string | null } | null>(null);
  const { getNodeLabel, error: metaError, isFallback: metaFallback, refresh: refreshMeta } = useKbMetaRegistry(
    metadataEndpoint,
    authToken ?? undefined,
    null,
  );

  useEffect(() => {
    const paramNode = searchParams.get("node");
    if (!paramNode) {
      return;
    }
    setNodeId((prev) => (prev === paramNode ? prev : paramNode));
    void fetchProvenance(paramNode, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [entries]);

  const handleLookup = async (persistParam = true) => {
    await fetchProvenance(nodeId, persistParam);
  };

  const fetchProvenance = async (rawNodeId: string, persistParam: boolean) => {
    if (!metadataEndpoint || !rawNodeId.trim()) {
      setError("Enter a node id to view provenance.");
      return;
    }
    const trimmed = rawNodeId.trim();
    if (persistParam) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("node", trimmed);
      setSearchParams(nextParams, { replace: true });
    }
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchMetadataGraphQL<{ kbNode: KbNode | null }>(
        metadataEndpoint,
        KB_NODE_DETAIL_QUERY,
        { id: trimmed },
        undefined,
        { token: authToken ?? undefined },
      );
      if (!payload.kbNode) {
        setEntries([]);
        setNodeMetadata(null);
        setError("Node not found.");
        return;
      }
      const rawProvenance = normalizeProvenance(payload.kbNode);
      setEntries(rawProvenance);
      setNodeMetadata({ id: payload.kbNode.id, displayName: payload.kbNode.displayName, entityType: payload.kbNode.entityType });
    } catch (err) {
      setEntries([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex flex-col">
          <label htmlFor="kb-provenance-node-id" className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            Node id
          </label>
          <input
            id="kb-provenance-node-id"
            type="text"
            value={nodeId}
            onChange={(event) => setNodeId(event.target.value)}
            className="mt-1 w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => handleLookup(true)}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
          >
            <LuSearch className="h-4 w-4" /> Lookup
          </button>
          {nodeMetadata ? (
            <button
              type="button"
              onClick={() => navigate(`/kb/explorer/nodes?node=${nodeMetadata.id}`)}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover-border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
            >
              View node
            </button>
          ) : null}
        </div>
      </div>
      {metaError && metaFallback ? (
        <div
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-100"
          data-testid="kb-meta-warning"
        >
          {metaError} — canonical labels will be used.{" "}
          <button type="button" onClick={() => refreshMeta()} className="underline">
            Retry
          </button>
        </div>
      ) : null}
      {loading ? <p className="text-sm text-slate-500">Loading provenance…</p> : null}
      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100">
          {error}
        </div>
      ) : null}
      {sortedEntries.length > 0 ? (
        <div className="overflow-auto rounded-2xl border border-slate-200 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          {nodeMetadata ? (
            <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:text-slate-100">
              {nodeMetadata.displayName ?? nodeMetadata.id} · {nodeMetadata.entityType ? getNodeLabel(nodeMetadata.entityType) : "entity"}
              {nodeMetadata.entityType ? (
                <span className="ml-2 text-[10px] uppercase tracking-[0.3em] text-slate-400">{nodeMetadata.entityType}</span>
              ) : null}
            </div>
          ) : null}
          <table className="w-full table-auto text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-[0.3em] text-slate-500">
                <th className="px-3 py-2">Timestamp</th>
                <th className="px-3 py-2">Phase</th>
                <th className="px-3 py-2">Origin endpoint</th>
                <th className="px-3 py-2">Logical key</th>
                <th className="px-3 py-2">Payload</th>
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map((entry) => (
                <tr key={`${entry.timestamp}-${entry.logicalKey ?? "-"}`} className="border-t border-slate-100 text-slate-700 dark:border-slate-800 dark:text-slate-200">
                  <td className="px-3 py-2 text-xs text-slate-500">{new Date(entry.timestamp).toLocaleString()}</td>
                  <td className="px-3 py-2">{entry.phase ?? "—"}</td>
                  <td className="px-3 py-2 break-all text-xs text-slate-500">{entry.originEndpointId ?? "—"}</td>
                  <td className="px-3 py-2 break-all text-xs text-slate-500">{entry.logicalKey ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {entry.payload ? <code>{JSON.stringify(entry.payload)}</code> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !loading && !error ? (
        <p className="text-sm text-slate-500">Use the form above to fetch provenance for a node.</p>
      ) : null}
    </div>
  );
}

function normalizeProvenance(node: KbNode): ProvenanceEntry[] {
  const payload = node.provenance ?? node.identity.provenance;
  if (Array.isArray(payload)) {
    return payload.map((entry) => ({
      timestamp: entry?.timestamp ?? node.updatedAt,
      phase: entry?.phase ?? node.phase,
      originEndpointId: entry?.originEndpointId ?? node.identity.originEndpointId,
      logicalKey: entry?.logicalKey ?? node.identity.logicalKey,
      payload: entry,
    }));
  }
  if (payload && typeof payload === "object" && Array.isArray((payload as any).history)) {
    return (payload as any).history.map((entry: any) => ({
      timestamp: entry?.timestamp ?? node.updatedAt,
      phase: entry?.phase ?? node.phase,
      originEndpointId: entry?.originEndpointId ?? node.identity.originEndpointId,
      logicalKey: entry?.logicalKey ?? node.identity.logicalKey,
      payload: entry,
    }));
  }
  return [
    {
      timestamp: node.updatedAt,
      phase: node.phase,
      originEndpointId: node.identity.originEndpointId ?? null,
      logicalKey: node.identity.logicalKey,
      payload: payload ?? null,
    },
  ];
}
