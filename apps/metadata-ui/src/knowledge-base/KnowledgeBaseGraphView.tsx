import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { select, type Selection } from "d3-selection";
import { drag, type D3DragEvent } from "d3-drag";
import { zoom, zoomIdentity, ZoomBehavior, ZoomTransform, type D3ZoomEvent } from "d3-zoom";
import "d3-transition";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import type { Simulation } from "d3-force";
import { quadtree as d3Quadtree } from "d3-quadtree";
import type { Quadtree, QuadtreeInternalNode, QuadtreeLeaf } from "d3-quadtree";

export type GraphVizNode = {
  id: string;
  label: string;
};

export type GraphVizEdge = {
  id: string;
  sourceId: string;
  targetId: string;
};

type ForceLinkEdge = GraphVizEdge & {
  source: string;
  target: string;
};

type GraphViewProps = {
  nodes: GraphVizNode[];
  edges: GraphVizEdge[];
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  onSelectNode?: (id: string) => void;
  onSelectEdge?: (id: string) => void;
  height?: number;
  isRefreshing?: boolean;
};

type PositionedNode = GraphVizNode & {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
};

type LayoutState = {
  width: number;
  height: number;
  nodes: PositionedNode[];
  edges: GraphVizEdge[];
  nodesMap: Map<string, PositionedNode>;
};

const NODE_BASE_RADIUS = 18;
const NODE_SELECTED_RADIUS = 22;
const LABEL_ZOOM_THRESHOLD = 1.05;
const LABEL_FULL_ZOOM_THRESHOLD = 1.6;
const MIN_SCALE = 0.45;
const MAX_SCALE = 2.75;
const FORCE_CHARGE = -420;
const FORCE_DISTANCE = 160;
const SIMULATION_DECAY_MS = 1200;
const SIMULATION_MAX_TICKS = 60;
const MINI_LABEL_OFFSET = 18;
const MINI_LABEL_MAX = 90;
const MAX_VISIBLE_NODES = 200;
const MAX_VISIBLE_EDGES = 500;

export function KnowledgeBaseGraphView({
  nodes,
  edges,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  height = 460,
  isRefreshing = false,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const svgSelectionRef = useRef<Selection<SVGSVGElement, unknown, null, undefined> | null>(null);
  const [layout, setLayout] = useState<LayoutState>(() => ({
    width: 720,
    height,
    nodes: [],
    edges: [],
    nodesMap: new Map(),
  }));
  const [zoomTransform, setZoomTransform] = useState<ZoomTransform>(() => zoomIdentity);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const prevPositionsRef = useRef<Map<string, PositionedNode>>(new Map());
  const simulationRef = useRef<Simulation<PositionedNode, undefined> | null>(null);
  const animationFrameRef = useRef<number>();
  const [viewport, setViewport] = useState(() => ({ width: 720, height }));
  const nodeSignature = useMemo(() => nodes.map((node) => node.id).join("|"), [nodes]);
  const dragKey = useMemo(() => `${nodeSignature}-${layout.nodes.length}`, [nodeSignature, layout.nodes.length]);
  const isGraphCapped = nodes.length >= MAX_VISIBLE_NODES || edges.length >= MAX_VISIBLE_EDGES;

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      setViewport((current) => {
        const nextWidth = Math.max(360, entry.contentRect.width);
        if (current.width === nextWidth && current.height === height) {
          return current;
        }
        return {
          width: nextWidth,
          height,
        };
      });
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [height]);

  useEffect(() => {
    if (!svgRef.current) {
      svgSelectionRef.current = null;
      return;
    }
    const selection = select(svgRef.current);
    svgSelectionRef.current = selection;
    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([MIN_SCALE, MAX_SCALE])
      .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        setZoomTransform(event.transform);
      });
    selection.call(zoomBehavior).on("dblclick.zoom", null);
    zoomBehaviorRef.current = zoomBehavior;
    return () => {
      if (svgSelectionRef.current === selection) {
        svgSelectionRef.current = null;
      }
      selection.on("zoom", null);
    };
  }, [layout.nodes.length]);

  useEffect(() => {
    if (!nodes.length) {
      simulationRef.current?.stop();
      simulationRef.current = null;
      prevPositionsRef.current = new Map();
      setLayout((current) => ({
        ...current,
        nodes: [],
        edges: [],
        nodesMap: new Map(),
      }));
      return;
    }

    const width = viewport.width;
    const targetHeight = viewport.height;
    const positioned = prepareNodesWithPositions(nodes, prevPositionsRef.current, width, targetHeight);
    const normalizedEdges: ForceLinkEdge[] = edges.map((edge) => ({
      ...edge,
      source: edge.sourceId,
      target: edge.targetId,
    }));

    let simulation = simulationRef.current;
    if (!simulation) {
      simulation = forceSimulation(positioned);
      simulationRef.current = simulation;
    } else {
      simulation.nodes(positioned);
    }

    simulation
      .force("charge", forceManyBody().strength(FORCE_CHARGE).distanceMin(40).distanceMax(420))
      .force(
        "link",
        forceLink<PositionedNode, ForceLinkEdge>(normalizedEdges)
          .id((node: PositionedNode) => node.id)
          .distance(FORCE_DISTANCE)
          .strength(0.7),
      )
      .force("center", forceCenter(width / 2, targetHeight / 2))
      .force(
        "collision",
        forceCollide<PositionedNode>().radius((node) => {
          const labelLength = Math.min(24, node.label?.length ?? 0);
          return NODE_SELECTED_RADIUS + labelLength * 2.5;
        }),
      );

    simulation.alpha(0.9).restart();

    let tickCount = 0;
    const tickStart = performance.now();

    const handleTick = () => {
      tickCount += 1;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = requestAnimationFrame(() => {
        const boundedNodes = positioned.map((node) => {
          node.x = clamp(node.x ?? width / 2, NODE_SELECTED_RADIUS + 8, width - NODE_SELECTED_RADIUS - 8);
          node.y = clamp(node.y ?? targetHeight / 2, NODE_SELECTED_RADIUS + 8, targetHeight - NODE_SELECTED_RADIUS - 8);
          return node;
        });
        const nodesMap = new Map(boundedNodes.map((node) => [node.id, node]));
        prevPositionsRef.current = nodesMap;
        setLayout({
          width,
          height: targetHeight,
          nodes: boundedNodes,
          edges,
          nodesMap,
        });
      });
      if (tickCount >= SIMULATION_MAX_TICKS || performance.now() - tickStart >= SIMULATION_DECAY_MS) {
        simulation?.alphaTarget(0);
        simulation?.stop();
      }
    };

    simulation.on("tick", handleTick);
    const settleTimeout = window.setTimeout(() => {
      simulation?.alphaTarget(0);
    }, SIMULATION_DECAY_MS);

    return () => {
      simulation?.on("tick", null);
      window.clearTimeout(settleTimeout);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [nodes, edges, viewport]);

  const nodeColorMap = useMemo(() => deriveNodeColorMap(nodes), [nodes]);
  const labelTree = d3Quadtree<LabelRecord>()
    .x((record) => record.cx)
    .y((record) => record.cy);
  const canExpandLabels = zoomTransform.k >= LABEL_FULL_ZOOM_THRESHOLD && layout.nodes.length <= MAX_VISIBLE_NODES;
  const labelFontSize = useMemo(() => clamp(14 / Math.max(zoomTransform.k, 0.85), 10, 16), [zoomTransform.k]);
  const activeHoveredId = hoveredNodeId ?? selectedNodeId ?? null;

  useEffect(() => {
    if (!svgRef.current || !layout.nodes.length) {
      return;
    }
    const dragBehavior = drag<SVGGElement, PositionedNode>()
      .on("start", (event: D3DragEvent<SVGGElement, PositionedNode, PositionedNode>, node: PositionedNode) => {
        event.sourceEvent.stopPropagation();
        if (!event.active) {
          simulationRef.current?.alphaTarget(0.35).restart();
        }
        node.fx = node.x;
        node.fy = node.y;
      })
      .on("drag", (event: D3DragEvent<SVGGElement, PositionedNode, PositionedNode>, node: PositionedNode) => {
        node.fx = clamp(event.x, NODE_SELECTED_RADIUS + 8, layout.width - NODE_SELECTED_RADIUS - 8);
        node.fy = clamp(event.y, NODE_SELECTED_RADIUS + 8, layout.height - NODE_SELECTED_RADIUS - 8);
      })
      .on("end", (event: D3DragEvent<SVGGElement, PositionedNode, PositionedNode>, node: PositionedNode) => {
        if (!event.active) {
          simulationRef.current?.alphaTarget(0);
        }
        node.fx = undefined;
        node.fy = undefined;
      });
    const selection = select(svgRef.current).selectAll<SVGGElement, PositionedNode>("[data-node-id]");
    selection.each(function eachNode(this: SVGGElement) {
      const element = this;
      const id = element.getAttribute("data-node-id");
      if (!id) {
        return;
      }
      const datum = layout.nodesMap.get(id);
      if (datum) {
        (element as any).__data__ = datum;
      }
    });
    selection.call(dragBehavior);
    return () => {
      selection.on("start.drag", null).on("drag.drag", null).on("end.drag", null);
    };
  }, [dragKey, layout.width, layout.height, layout.nodesMap]);

  if (!layout.nodes.length) {
    return <p className="text-sm text-slate-500">Graph view is unavailable for the current filters.</p>;
  }

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-100 p-4 shadow-xl shadow-slate-900/5 dark:border-slate-800 dark:from-slate-900 dark:via-slate-950 dark:to-slate-950 dark:shadow-black/50"
      data-testid="kb-graph-view"
      style={{ minHeight: `${height}px` }}
      role="figure"
      aria-label="Knowledge graph visualization"
    >
      <svg
        ref={svgRef}
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="h-full w-full"
        style={{ touchAction: "none" }}
        role="presentation"
      >
        <defs>
          <pattern id="kb-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(148,163,184,0.25)" strokeWidth="1" />
          </pattern>
          <filter id="kb-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="rgba(15,23,42,0.4)" />
          </filter>
          <marker id="kb-arrow" viewBox="0 -5 10 10" refX="14" refY="0" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,-5 L10,0 L0,5" fill="rgba(15,23,42,0.45)" />
          </marker>
          {layout.nodes.map((node) => {
            const palette = nodeColorMap.get(node.id);
            const baseColor = palette?.fill ?? "#38bdf8";
            return (
              <radialGradient id={buildGradientId(node.id)} key={node.id} cx="30%" cy="30%" r="70%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
                <stop offset="45%" stopColor={baseColor} stopOpacity="0.85" />
                <stop offset="100%" stopColor={baseColor} stopOpacity="1" />
              </radialGradient>
            );
          })}
        </defs>
        <rect width="100%" height="100%" fill="url(#kb-grid)" />
        <g transform={`translate(${zoomTransform.x}, ${zoomTransform.y}) scale(${zoomTransform.k})`}>
          {layout.edges.map((edge) => {
            const source = layout.nodesMap.get(edge.sourceId);
            const target = layout.nodesMap.get(edge.targetId);
            if (!source || !target) {
              return null;
            }
            const isSelected = edge.id === selectedEdgeId;
            return (
              <g key={edge.id} className="cursor-pointer" onClick={(event) => handleEdgeSelect(event, edge.id)}>
                <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={isSelected ? "#0f172a" : "rgba(30,41,59,0.45)"}
                  strokeWidth={isSelected ? 3 : Math.max(1.2, 1.6 / zoomTransform.k)}
                  strokeDasharray={isSelected ? undefined : "6 4"}
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                  markerEnd="url(#kb-arrow)"
                  className="transition-all duration-300 ease-out"
                />
                {isSelected ? (
                  <text
                    x={(source.x + target.x) / 2}
                    y={(source.y + target.y) / 2 - 6}
                    textAnchor="middle"
                    className="uppercase tracking-widest text-slate-600"
                    style={{ fontSize: `${labelFontSize * 0.75}px` }}
                  >
                    Edge
                  </text>
                ) : null}
              </g>
            );
          })}
          {layout.nodes.map((node) => {
            const isSelected = node.id === selectedNodeId;
            const isHovered = node.id === activeHoveredId;
            const color = nodeColorMap.get(node.id);
            const accent = color?.accent ?? "rgba(14,165,233,0.6)";
            const truncatedLabel = truncateLabel(node.label);
            const labelWidth = Math.min(140, Math.max(96, truncatedLabel.length * 9));
            const miniWidth = Math.min(MINI_LABEL_MAX, labelWidth);
            const labelHeight = 32;
            const labelOffset = isSelected ? NODE_SELECTED_RADIUS + 32 : NODE_BASE_RADIUS + 28;
            const labelRecord: LabelRecord = {
              cx: node.x,
              cy: node.y + labelOffset,
              halfWidth: labelWidth / 2,
              halfHeight: labelHeight / 2,
            };
            const hasPriority = Boolean(isSelected || isHovered);
            let showLabel = false;
            if (hasPriority) {
              registerLabelRecord(labelTree, labelRecord);
              showLabel = true;
            } else if (canExpandLabels && registerLabelRecord(labelTree, labelRecord)) {
              showLabel = true;
            }
            const miniRecord: LabelRecord = {
              cx: node.x,
              cy: node.y + NODE_BASE_RADIUS + MINI_LABEL_OFFSET,
              halfWidth: miniWidth / 2,
              halfHeight: 12,
            };
            const showMiniLabel = !showLabel && registerLabelRecord(labelTree, miniRecord);
            return (
              <g
                key={node.id}
                data-node-id={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                className="cursor-pointer select-none"
                onClick={(event) => handleNodeSelect(event, node.id)}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId((prev) => (prev === node.id ? null : prev))}
              >
                <circle
                  r={isSelected ? NODE_SELECTED_RADIUS : NODE_BASE_RADIUS}
                  fill={`url(#${buildGradientId(node.id)})`}
                  stroke={isSelected ? "#020617" : "rgba(226,232,240,0.7)"}
                  strokeWidth={isSelected ? 3 : 2}
                  filter="url(#kb-shadow)"
                  className="transition-all duration-300 ease-out"
                />
                <circle
                  r={isSelected ? NODE_SELECTED_RADIUS + 6 : NODE_BASE_RADIUS + 4}
                  fill="none"
                  stroke={accent}
                  strokeOpacity={isSelected || isHovered ? 0.95 : 0.3}
                  strokeWidth={isSelected ? 1.8 : 1}
                  strokeDasharray="8 6"
                  className="transition-opacity duration-300 ease-out"
                />
                {showMiniLabel ? (
                  <g transform={`translate(0, ${NODE_BASE_RADIUS + MINI_LABEL_OFFSET})`}>
                    <rect
                      x={-miniWidth / 2}
                      y={-14}
                      width={miniWidth}
                      height={24}
                      rx={6}
                      fill="rgba(15,23,42,0.7)"
                      stroke="rgba(148,163,184,0.35)"
                    />
                    <text
                      x={0}
                      y={-1}
                      textAnchor="middle"
                      fill="#e2e8f0"
                      className="font-semibold tracking-wide"
                      style={{ fontSize: `${Math.max(9, labelFontSize * 0.75)}px` }}
                    >
                      <title>{node.label}</title>
                      {truncateMiniLabel(node.label)}
                    </text>
                  </g>
                ) : null}
                {showLabel ? (
                  <g transform={`translate(0, ${labelOffset})`}>
                    <rect
                      x={-labelWidth / 2}
                      y={-labelHeight / 2}
                      width={labelWidth}
                      height={labelHeight}
                      rx={10}
                      fill="rgba(15,23,42,0.9)"
                      stroke="rgba(148,163,184,0.4)"
                    />
                    <text
                      x={0}
                      y={4}
                      textAnchor="middle"
                      fill="#f8fafc"
                      className="font-semibold tracking-wide"
                      style={{ fontSize: `${labelFontSize}px` }}
                    >
                      <title>{node.label}</title>
                      {truncatedLabel}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-12 items-center justify-between px-4">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Interactive graph</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">Drag to pan · Scroll to zoom · Click to inspect</p>
      </div>
      {isRefreshing ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-white/60 text-sm font-semibold text-slate-600 backdrop-blur dark:bg-slate-900/40 dark:text-slate-300">
          Refreshing graph…
        </div>
      ) : null}
      {isGraphCapped ? (
        <div className="pointer-events-none absolute left-4 top-14 rounded-xl border border-amber-200 bg-amber-50/95 px-4 py-2 text-xs font-semibold text-amber-900 shadow dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200">
          View capped at {MAX_VISIBLE_NODES} nodes / {MAX_VISIBLE_EDGES} edges. Refine filters to see more.
        </div>
      ) : null}
      <div className="pointer-events-auto absolute right-4 bottom-4 flex gap-2">
        <GraphControlButton label="Zoom out" onClick={handleZoomOut} icon="-" />
        <GraphControlButton label="Reset view" onClick={handleZoomReset} icon="R" />
        <GraphControlButton label="Zoom in" onClick={handleZoomIn} icon="+" />
      </div>
      <div className="pointer-events-auto absolute left-4 bottom-4 hidden max-w-xs rounded-xl border border-white/70 bg-white/85 p-3 text-[11px] text-slate-600 shadow-lg shadow-slate-900/5 backdrop-blur md:block dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-200">
        <p className="font-semibold uppercase tracking-[0.4em] text-slate-500 dark:text-slate-300">Legend</p>
        <ul className="mt-2 space-y-1">
          {layout.nodes.slice(0, 10).map((node) => {
            const color = nodeColorMap.get(node.id)?.fill ?? "#38bdf8";
            return (
              <li key={node.id} className="flex items-center gap-2 text-[10px]">
                <span className="inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="truncate" title={node.label}>
                  {node.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );

  function handleNodeSelect(event: ReactMouseEvent<SVGGElement>, id: string) {
    event.stopPropagation();
    onSelectNode?.(id);
  }

  function handleEdgeSelect(event: ReactMouseEvent<SVGGElement>, id: string) {
    event.stopPropagation();
    onSelectEdge?.(id);
  }

  function handleZoomIn() {
    if (!svgSelectionRef.current || !zoomBehaviorRef.current) {
      return;
    }
    svgSelectionRef.current
      .transition()
      .duration(250)
      .call(zoomBehaviorRef.current.scaleBy as any, 1.2);
  }

  function handleZoomOut() {
    if (!svgSelectionRef.current || !zoomBehaviorRef.current) {
      return;
    }
    svgSelectionRef.current
      .transition()
      .duration(250)
      .call(zoomBehaviorRef.current.scaleBy as any, 0.8);
  }

  function handleZoomReset() {
    if (!svgSelectionRef.current || !zoomBehaviorRef.current) {
      return;
    }
    svgSelectionRef.current
      .transition()
      .duration(300)
      .call(zoomBehaviorRef.current.transform as any, zoomIdentity);
  }
}

type GraphControlButtonProps = {
  label: string;
  onClick: () => void;
  icon: string;
};

function GraphControlButton({ label, onClick, icon }: GraphControlButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-10 w-10 rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
      aria-label={label}
    >
      {icon}
    </button>
  );
}

function deriveNodeColorMap(nodes: GraphVizNode[]) {
  const palette = createPalette(nodes.length || 1);
  const map = new Map<string, { fill: string; accent: string }>();
  nodes.forEach((node, index) => {
    const base = palette[index % palette.length];
    map.set(node.id, {
      fill: base,
      accent: `${base}AA`,
    });
  });
  return map;
}

function createPalette(size: number) {
  const base = ["#38bdf8", "#c084fc", "#f472b6", "#fb923c", "#34d399", "#facc15", "#818cf8", "#f97316"];
  return new Array(size).fill(null).map((_, index) => base[index % base.length]);
}

function buildGradientId(id: string) {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `kb-node-${safe}-${hashString(id)}`;
}

type LabelRecord = {
  cx: number;
  cy: number;
  halfWidth: number;
  halfHeight: number;
};

type QuadTreeNode = QuadtreeInternalNode<LabelRecord> | QuadtreeLeaf<LabelRecord> | null;

function registerLabelRecord(tree: Quadtree<LabelRecord>, record: LabelRecord) {
  let collision = false;
  tree.visit((node: QuadTreeNode, x0: number, y0: number, x1: number, y1: number) => {
    if (collision) {
      return true;
    }
    const data =
      node && "data" in node ? (node as QuadtreeLeaf<LabelRecord>).data : undefined;
    if (data && boxesOverlap(data, record)) {
      collision = true;
      return true;
    }
    const outside =
      record.cx + record.halfWidth < x0 ||
      record.cx - record.halfWidth > x1 ||
      record.cy + record.halfHeight < y0 ||
      record.cy - record.halfHeight > y1;
    return outside;
  });
  if (!collision) {
    tree.add(record);
    return true;
  }
  return false;
}

function boxesOverlap(a: LabelRecord, b: LabelRecord) {
  return !(
    a.cx + a.halfWidth < b.cx - b.halfWidth ||
    a.cx - a.halfWidth > b.cx + b.halfWidth ||
    a.cy + a.halfHeight < b.cy - b.halfHeight ||
    a.cy - a.halfHeight > b.cy + b.halfHeight
  );
}

function hashString(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function prepareNodesWithPositions(
  nodes: GraphVizNode[],
  previousPositions: Map<string, PositionedNode>,
  width: number,
  height: number,
) {
  return nodes.map((node, index) => {
    const prev = previousPositions.get(node.id);
    if (prev) {
      return { ...node, x: prev.x, y: prev.y, vx: prev.vx, vy: prev.vy };
    }
    return {
      ...node,
      ...seedPosition(node.id, index, nodes.length, width, height),
    };
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function truncateLabel(label: string) {
  if (label.length <= 28) {
    return label;
  }
  return `${label.slice(0, 28)}…`;
}

function truncateMiniLabel(label: string) {
  if (label.length <= 18) {
    return label;
  }
  return `${label.slice(0, 18)}…`;
}

function seedPosition(id: string, index: number, total: number, width: number, height: number) {
  const radius = Math.min(width, height) * 0.35;
  const radialFactor = 0.4 + hashNumber(`${id}-radial`) * 0.6;
  const angle = hashNumber(`${id}-angle`) * Math.PI * 2 + (index / Math.max(1, total)) * 0.25;
  const jitterX = (hashNumber(`${id}-jx`) - 0.5) * 40;
  const jitterY = (hashNumber(`${id}-jy`) - 0.5) * 40;
  return {
    x: width / 2 + Math.cos(angle) * radius * radialFactor + jitterX,
    y: height / 2 + Math.sin(angle) * radius * radialFactor + jitterY,
  };
}

function hashNumber(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return (hash >>> 0) / 2 ** 32;
}
