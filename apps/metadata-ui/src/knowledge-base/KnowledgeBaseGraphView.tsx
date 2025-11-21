import { useMemo } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";

export type GraphVizNode = {
  id: string;
  label: string;
};

export type GraphVizEdge = {
  id: string;
  sourceId: string;
  targetId: string;
};

type GraphViewProps = {
  nodes: GraphVizNode[];
  edges: GraphVizEdge[];
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  onSelectNode?: (id: string) => void;
  onSelectEdge?: (id: string) => void;
  height?: number;
};

type PositionedNode = GraphVizNode & { x: number; y: number };

export function KnowledgeBaseGraphView({
  nodes,
  edges,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  height = 420,
}: GraphViewProps) {
  const layout = useMemo(() => computeGraphLayout(nodes, edges, height), [nodes, edges, height]);
  if (!layout.nodes.length) {
    return <p className="text-sm text-slate-500">Graph view is unavailable for the current filters.</p>;
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60" data-testid="kb-graph-view">
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="w-full" role="presentation">
        {layout.edges.map((edge) => {
          const source = layout.nodesMap.get(edge.sourceId);
          const target = layout.nodesMap.get(edge.targetId);
          if (!source || !target) {
            return null;
          }
          return (
            <line
              key={edge.id}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke={edge.id === selectedEdgeId ? "#0f172a" : "#94a3b8"}
              strokeWidth={edge.id === selectedEdgeId ? 3 : 1.5}
              strokeDasharray={edge.id === selectedEdgeId ? "0" : "4 3"}
              className="transition-colors"
              onClick={(event) => {
                event.stopPropagation();
                onSelectEdge?.(edge.id);
              }}
            />
          );
        })}
        {layout.nodes.map((node) => (
          <g
            key={node.id}
            transform={`translate(${node.x}, ${node.y})`}
            className="cursor-pointer transition-all"
            onClick={(event) => {
              event.stopPropagation();
              onSelectNode?.(node.id);
            }}
          >
            <circle
              r={node.id === selectedNodeId ? 16 : 12}
              fill={node.id === selectedNodeId ? "#0f172a" : "#1d4ed8"}
              fillOpacity={0.8}
              stroke="#e2e8f0"
              strokeWidth={2}
            />
            <text
              x={0}
              y={node.id === selectedNodeId ? 32 : 28}
              textAnchor="middle"
              className="select-none text-[10px] font-semibold uppercase tracking-[0.3em]"
              fill="#475569"
            >
              {node.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function computeGraphLayout(nodes: GraphVizNode[], edges: GraphVizEdge[], height: number) {
  const width = 720;
  if (!nodes.length) {
    return { width, height, nodes: [] as PositionedNode[], edges: [] as GraphVizEdge[], nodesMap: new Map<string, PositionedNode>() };
  }
  const nodeData: PositionedNode[] = nodes.map((node, index) => ({
    ...node,
    x: width / 2 + Math.cos((index / nodes.length) * Math.PI * 2) * Math.min(width, height) * 0.25,
    y: height / 2 + Math.sin((index / nodes.length) * Math.PI * 2) * Math.min(width, height) * 0.25,
  }));
  const nodeMap = new Map(nodeData.map((node) => [node.id, node]));
  const linkData = edges
    .map((edge) => ({
      ...edge,
      source: nodeMap.get(edge.sourceId) ?? nodeData[0],
      target: nodeMap.get(edge.targetId) ?? nodeData[0],
    }))
    .filter((link) => link.source && link.target);

  if (nodeData.length > 1) {
    const simulation = forceSimulation(nodeData)
      .force("charge", forceManyBody().strength(-180))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collision", forceCollide().radius(36))
      .force("link", forceLink(linkData).id((node: any) => node.id).distance(140));
    for (let index = 0; index < 200; index += 1) {
      simulation.tick();
    }
    simulation.stop();
  }

  nodeData.forEach((node) => {
    node.x = clamp(node.x ?? width / 2, 24, width - 24);
    node.y = clamp(node.y ?? height / 2, 24, height - 24);
  });

  return {
    width,
    height,
    nodes: nodeData,
    edges,
    nodesMap: new Map(nodeData.map((node) => [node.id, node])),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
