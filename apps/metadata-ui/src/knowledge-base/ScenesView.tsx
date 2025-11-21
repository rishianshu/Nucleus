import { useEffect, useRef, useState } from "react";
import { LuRefreshCcw } from "react-icons/lu";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchMetadataGraphQL } from "../metadata/api";
import { KB_SCENE_QUERY } from "./queries";
import type { KbScene } from "./types";

type ScenesViewProps = {
  metadataEndpoint: string | null;
  authToken?: string | null;
};

const SCENE_NODE_CAP = 300;
const SCENE_EDGE_CAP = 600;

export function ScenesView({ metadataEndpoint, authToken }: ScenesViewProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [nodeId, setNodeId] = useState("");
  const [edgeTypes, setEdgeTypes] = useState("DEPENDENCY_OF");
  const [depth, setDepth] = useState(2);
  const [limit, setLimit] = useState(150);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scene, setScene] = useState<KbScene | null>(null);
  const autoFetchNodeRef = useRef<string | null>(null);
  const [sceneVersion, setSceneVersion] = useState(0);

  useEffect(() => {
    const paramNode = searchParams.get("node");
    if (paramNode) {
      if (!nodeId) {
        setNodeId(paramNode);
      }
      autoFetchNodeRef.current = paramNode;
      void runScenePreview(paramNode, false);
    }
  }, [searchParams]);

  const handlePreview = async () => {
    await runScenePreview(nodeId, true);
  };

  const runScenePreview = async (rawNodeId: string, persistParam: boolean) => {
    const trimmedNode = rawNodeId.trim();
    if (!metadataEndpoint || !trimmedNode) {
      if (persistParam) {
        setError("Enter a node id to preview a scene.");
      }
      return;
    }
    if (persistParam) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("node", trimmedNode);
      setSearchParams(nextParams, { replace: true });
    }
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchMetadataGraphQL<{ kbScene: KbScene }>(
        metadataEndpoint,
        KB_SCENE_QUERY,
        {
          id: trimmedNode,
          edgeTypes: edgeTypes
            .split(",")
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
          depth,
          limit,
        },
        undefined,
        { token: authToken ?? undefined },
      );
      setScene(payload.kbScene);
    } catch (err) {
      setScene(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      if (autoFetchNodeRef.current === trimmedNode) {
        autoFetchNodeRef.current = null;
      }
    }
  };

  useEffect(() => {
    if (scene) {
      setSceneVersion((prev) => prev + 1);
    }
  }, [scene?.summary.nodeCount, scene?.summary.edgeCount, scene?.summary.truncated]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <TextField label="Node id" value={nodeId} onChange={setNodeId} placeholder="e.g., dataset-123" />
        <TextField label="Edge types" value={edgeTypes} onChange={setEdgeTypes} placeholder="Comma-separated" />
        <NumberField label="Depth" value={depth} min={1} max={3} onChange={setDepth} />
        <NumberField label="Max nodes" value={limit} min={50} max={300} onChange={setLimit} />
        <button
          type="button"
          onClick={handlePreview}
          className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
        >
          <LuRefreshCcw className="h-4 w-4" /> Preview scene
        </button>
      </div>
      {loading ? <p className="text-sm text-slate-500">Loading scene…</p> : null}
      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-100">
          {error}
        </div>
      ) : null}
      {scene ? (
        <div key={sceneVersion} className="flex flex-col gap-4 transition-all duration-500 ease-out">
          {scene.summary.truncated ? (
            <div
              className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-100"
              data-testid="kb-scenes-truncated"
            >
              Graph capped at {SCENE_NODE_CAP} nodes / {SCENE_EDGE_CAP} edges. Narrow filters to explore the full scene.
            </div>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 lg:col-span-1">
              <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Graph preview</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {scene.nodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className="rounded-full border border-slate-300 px-3 py-1 text-[11px] uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                    onClick={() => navigate(`/kb/explorer/nodes?node=${node.id}`)}
                  >
                    {node.displayName || node.id}
                  </button>
                ))}
              </div>
              <div className="mt-4 space-y-2 text-xs text-slate-500">
                <p>
                  {scene.summary.nodeCount} nodes · {scene.summary.edgeCount} edges
                </p>
                {scene.summary.truncated ? (
                  <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-amber-700 dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200">
                    Scene truncated — refine filters to load more.
                  </p>
                ) : null}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 lg:col-span-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Nodes</h2>
              {scene.nodes.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No nodes found for this scene.</p>
              ) : (
                <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full table-auto text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-[0.3em] text-slate-500">
                        <th className="px-3 py-2">Display</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Canonical path</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scene.nodes.map((node) => (
                        <tr key={node.id} className="border-t border-slate-100 text-slate-700 dark:border-slate-800 dark:text-slate-200">
                          <td className="px-3 py-2">
                            <div className="font-semibold">{node.displayName || node.id}</div>
                            <div className="text-xs text-slate-500">{node.id}</div>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-500">{node.entityType}</td>
                          <td className="px-3 py-2 text-xs text-slate-500">{node.canonicalPath ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
            <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Edges</h2>
            {scene.edges.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No edges found for this scene.</p>
            ) : (
              <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full table-auto text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.3em] text-slate-500">
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scene.edges.map((edge) => (
                      <tr key={edge.id} className="border-t border-slate-100 text-slate-700 dark:border-slate-800 dark:text-slate-200">
                        <td className="px-3 py-2">{edge.edgeType}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">
                          <button
                            type="button"
                            className="rounded-full border border-slate-300 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                            onClick={() => navigate(`/kb/explorer/nodes?node=${edge.sourceEntityId}`)}
                          >
                            {edge.sourceEntityId}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500">
                          <button
                            type="button"
                            className="rounded-full border border-slate-300 px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-slate-600 transition hover:border-slate-900 hover:text-slate-900 dark:border-slate-600 dark:text-slate-200"
                            onClick={() => navigate(`/kb/explorer/nodes?node=${edge.targetEntityId}`)}
                          >
                            {edge.targetEntityId}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Run a preview to visualize neighbor scenes.</p>
      )}
    </div>
  );
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="flex flex-col">
      <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">{label}</label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-48 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
    </div>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <div className="flex flex-col">
      <label className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-28 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
    </div>
  );
}
