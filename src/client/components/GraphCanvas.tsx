import { useEffect, useMemo, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { GraphPayload } from "@shared/types";

type GraphCanvasProps = {
  graph: GraphPayload;
  selectedNodeId: string | null;
  highlightedNodeIds: string[];
  focusedEdgeIds: string[];
  onSelectNode: (nodeId: string) => void;
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
  onClearHighlights
}: GraphCanvasProps) {
  const graphRef = useRef<any>(null);
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

  const graphData = useMemo(
    () => ({
      nodes: graph.nodes,
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
            highlightedSet
          );
        }}
        nodePointerAreaPaint={(node, color, context) => {
          context.fillStyle = color;
          context.beginPath();
          context.arc(node.x ?? 0, node.y ?? 0, 10, 0, 2 * Math.PI, false);
          context.fill();
        }}
        onNodeClick={(node) => onSelectNode((node as RenderNode).id)}
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
  highlightedSet: Set<string>
) {
  const isSelected = node.id === selectedNodeId;
  const isHighlighted = highlightedSet.has(node.id);
  const radius = node.size + (isSelected ? 4 : isHighlighted ? 2.5 : 0);
  const fontSize = Math.max(10 / globalScale, 3.6);

  context.beginPath();
  context.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI, false);
  context.fillStyle = node.color;
  context.fill();

  if (isSelected || isHighlighted) {
    context.lineWidth = isSelected ? 2.5 : 1.8;
    context.strokeStyle = isSelected ? "#111827" : "#f59e0b";
    context.stroke();
  }

  if (isSelected || isHighlighted || radius >= 7) {
    context.font = `600 ${fontSize}px Aptos, "Segoe UI", sans-serif`;
    context.fillStyle = "#0f172a";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(node.label, (node.x ?? 0) + radius + 4, node.y ?? 0);
  }
}

function getNodeId(value: string | RenderNode): string {
  return typeof value === "string" ? value : value.id;
}
