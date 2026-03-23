import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { GraphPayload } from "@shared/types";

type GraphCanvasProps = {
  graph: GraphPayload;
  selectedNodeId: string | null;
  highlightedNodeIds: string[];
  focusedEdgeIds: string[];
  onSelectNode: (nodeId: string) => void;
  onBackgroundClick: () => void;
  onClearHighlights: () => void;
};

type RenderNode = GraphPayload["nodes"][number] & {
  x?: number;
  y?: number;
};

type RenderLink = GraphPayload["edges"][number] & {
  source: string | RenderNode;
  target: string | RenderNode;
};

export function GraphCanvas({
  graph,
  selectedNodeId,
  highlightedNodeIds,
  focusedEdgeIds,
  onSelectNode,
  onBackgroundClick,
  onClearHighlights
}: GraphCanvasProps) {
  const graphRef = useRef<any>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const highlightedSet = useMemo(
    () => new Set(highlightedNodeIds),
    [highlightedNodeIds]
  );
  const focusedEdgeSet = useMemo(() => new Set(focusedEdgeIds), [focusedEdgeIds]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      graphRef.current?.zoomToFit(600, 80);
    }, 350);
    return () => window.clearTimeout(handle);
  }, [graph.nodes.length, graph.edges.length]);

  useEffect(() => {
    const graphInstance = graphRef.current;
    if (!graphInstance) {
      return;
    }

    const chargeForce = graphInstance.d3Force("charge");
    if (chargeForce?.strength) {
      chargeForce.strength(-150);
    }

    const linkForce = graphInstance.d3Force("link");
    if (linkForce?.distance) {
      linkForce.distance((link: RenderLink) =>
        focusedEdgeSet.has(link.id) ? 105 : 72
      );
    }

    graphInstance.d3ReheatSimulation?.();
  }, [focusedEdgeSet, graph.nodes.length, graph.edges.length]);

  const graphData = useMemo(
    () => ({
      nodes: seedClusterLayout(graph.nodes),
      links: graph.edges
    }),
    [graph]
  );

  return (
    <div className="graph-canvas-shell">
      <div className="graph-toolbar">
        <button
          type="button"
          className="toolbar-button"
          onClick={() => graphRef.current?.zoomToFit(400, 80)}
        >
          Fit Graph
        </button>
        <button
          type="button"
          className="toolbar-button toolbar-button-dark"
          onClick={onClearHighlights}
        >
          Clear Highlights
        </button>
      </div>

      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        linkColor={(link) =>
          focusedEdgeSet.has((link as RenderLink).id)
            ? "rgba(217, 72, 95, 0.95)"
            : (link as RenderLink).color
        }
        linkWidth={(link) =>
          focusedEdgeSet.has((link as RenderLink).id)
            ? 3
            : highlightedSet.has(getNodeId((link as RenderLink).source)) ||
                highlightedSet.has(getNodeId((link as RenderLink).target))
              ? 2
              : 1
        }
        nodeCanvasObject={(node, context, globalScale) => {
          drawNode(
            node as RenderNode,
            context,
            globalScale,
            selectedNodeId,
            highlightedSet,
            hoveredNodeId
          );
        }}
        nodePointerAreaPaint={(node, color, context) => {
          context.fillStyle = color;
          context.beginPath();
          context.arc(node.x ?? 0, node.y ?? 0, 10, 0, 2 * Math.PI, false);
          context.fill();
        }}
        onNodeClick={(node) => onSelectNode((node as RenderNode).id)}
        onNodeHover={(node) =>
          setHoveredNodeId(node ? (node as RenderNode).id : null)
        }
        onBackgroundClick={onBackgroundClick}
        onEngineStop={() => graphRef.current?.zoomToFit(500, 80)}
        enablePointerInteraction
        cooldownTicks={120}
        d3VelocityDecay={0.25}
        enableNodeDrag
      />
    </div>
  );
}

function drawNode(
  node: RenderNode,
  context: CanvasRenderingContext2D,
  globalScale: number,
  selectedNodeId: string | null,
  highlightedSet: Set<string>,
  hoveredNodeId: string | null
) {
  const isSelected = node.id === selectedNodeId;
  const isHighlighted = highlightedSet.has(node.id);
  const isHovered = hoveredNodeId === node.id;
  const radius =
    node.size + (isSelected ? 4 : isHighlighted ? 2.5 : isHovered ? 1.5 : 0);
  const fontSize = Math.max(10 / globalScale, 4.2);

  context.beginPath();
  context.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI, false);
  context.fillStyle = node.color;
  context.fill();

  if (isSelected || isHighlighted || isHovered) {
    context.lineWidth = isSelected ? 2.5 : isHighlighted ? 1.8 : 1.2;
    context.strokeStyle = isSelected
      ? "#111827"
      : isHighlighted
        ? "#f59e0b"
        : "rgba(15, 23, 42, 0.55)";
    context.stroke();
  }

  const showLabel =
    isSelected ||
    isHighlighted ||
    isHovered ||
    (globalScale > 2.1 && radius >= 7.5);

  if (showLabel) {
    context.font = `600 ${fontSize}px Aptos, "Segoe UI", sans-serif`;
    context.fillStyle = "#0f172a";
    context.textAlign = "left";
    context.textBaseline = "middle";
    const text = node.label.length > 34 ? `${node.label.slice(0, 34)}...` : node.label;
    context.fillText(text, (node.x ?? 0) + radius + 5, node.y ?? 0);
  }
}

function getNodeId(value: string | RenderNode): string {
  return typeof value === "string" ? value : value.id;
}

function seedClusterLayout(nodes: GraphPayload["nodes"]): RenderNode[] {
  const groups = new Map<string, GraphPayload["nodes"]>();
  for (const node of nodes) {
    const list = groups.get(node.kind) ?? [];
    list.push(node);
    groups.set(node.kind, list);
  }

  const kinds = Array.from(groups.keys()).sort();
  const orbitRadiusX = 430;
  const orbitRadiusY = 250;
  const positioned = new Map<string, RenderNode>();

  kinds.forEach((kind, kindIndex) => {
    const group = groups.get(kind) ?? [];
    const clusterAngle = (Math.PI * 2 * kindIndex) / Math.max(kinds.length, 1);
    const clusterX = Math.cos(clusterAngle) * orbitRadiusX;
    const clusterY = Math.sin(clusterAngle) * orbitRadiusY;

    group.forEach((node, itemIndex) => {
      const localAngle = itemIndex * 0.62 + kindIndex * 0.28;
      const localRadius = 18 + Math.sqrt(itemIndex + 1) * 16;
      positioned.set(node.id, {
        ...node,
        x: clusterX + Math.cos(localAngle) * localRadius,
        y: clusterY + Math.sin(localAngle) * localRadius * 0.82
      });
    });
  });

  return nodes.map((node) => positioned.get(node.id) ?? node);
}
