import { useEffect, useMemo, useState } from "react";
import type {
  ChatMessage,
  GraphPayload,
  NodeDetailsPayload,
  QueryResponse
} from "@shared/types";
import { fetchGraph, fetchNodeDetails, submitQuestion } from "@client/api";
import { ChatPanel } from "@client/components/ChatPanel";
import { GraphCanvas } from "@client/components/GraphCanvas";
import { NodeInspector } from "@client/components/NodeInspector";

type UiMessage = ChatMessage & {
  sql?: string | null;
  engine?: string;
  rowCount?: number;
  rejected?: boolean;
};

const INITIAL_MESSAGE: UiMessage = {
  role: "assistant",
  content:
    "I can analyze the provided Order-to-Cash dataset, trace document flows, and explain anomalies with data-backed answers."
};

export function App() {
  const [graph, setGraph] = useState<GraphPayload | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedDetails, setSelectedDetails] =
    useState<NodeDetailsPayload | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([INITIAL_MESSAGE]);
  const [highlights, setHighlights] = useState<string[]>([]);
  const [queryResult, setQueryResult] = useState<QueryResponse | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(true);
  const [loadingQuery, setLoadingQuery] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const payload = await fetchGraph();
        setGraph(payload);
      } catch (error) {
        setGraphError(
          error instanceof Error ? error.message : "Failed to load graph."
        );
      } finally {
        setLoadingGraph(false);
      }
    };

    void load();
  }, []);

  const suggestions = useMemo(() => {
    if (queryResult?.suggestions?.length) {
      return queryResult.suggestions;
    }
    return graph?.examplePrompts ?? [];
  }, [graph?.examplePrompts, queryResult?.suggestions]);

  const handleSelectNode = async (nodeId: string) => {
    setSelectedNodeId(nodeId);
    try {
      const details = await fetchNodeDetails(nodeId);
      setSelectedDetails(details);
    } catch {
      setSelectedDetails(null);
    }
  };

  const handleExpandNode = () => {
    if (!graph || !selectedDetails) {
      return;
    }

    setGraph((current) => {
      if (!current) {
        return current;
      }
      return mergeGraph(current, {
        nodes: selectedDetails.expansion.nodes,
        edges: selectedDetails.expansion.edges
      });
    });
  };

  const handleAskQuestion = async (question: string) => {
    if (!question.trim()) {
      return;
    }

    const nextConversation = [
      ...messages.map(({ role, content }) => ({ role, content })),
      { role: "user" as const, content: question }
    ];

    setMessages((current) => [...current, { role: "user", content: question }]);
    setLoadingQuery(true);

    try {
      const result = await submitQuestion({
        question,
        conversation: nextConversation
      });
      setQueryResult(result);
      setHighlights(result.highlights);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: result.answer,
          sql: result.sql,
          engine: result.engine,
          rowCount: result.rows.length,
          rejected: result.rejected
        }
      ]);

      if (result.highlights[0]) {
        void handleSelectNode(result.highlights[0]);
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            error instanceof Error ? error.message : "Failed to execute query.",
          rejected: true
        }
      ]);
    } finally {
      setLoadingQuery(false);
    }
  };

  return (
    <div className="app-shell">
      <main className="workspace">
        <section className="graph-panel">
          <header className="workspace-header">
            <div>
              <p className="eyebrow">Mapping / Order to Cash</p>
              <h1>Context Graph System</h1>
            </div>
            {graph && (
              <div className="stats-strip">
                <span>{graph.stats.totalNodes} nodes</span>
                <span>{graph.stats.totalEdges} edges</span>
                <span>{graph.stats.initialNodes} shown initially</span>
              </div>
            )}
          </header>

          <div className="graph-stage">
            {loadingGraph ? (
              <div className="empty-state">Loading graph model...</div>
            ) : graphError ? (
              <div className="empty-state error-state">{graphError}</div>
            ) : graph ? (
              <>
                <GraphCanvas
                  graph={graph}
                  selectedNodeId={selectedNodeId}
                  highlightedNodeIds={highlights}
                  onSelectNode={handleSelectNode}
                  onClearHighlights={() => setHighlights([])}
                />
                <NodeInspector
                  details={selectedDetails}
                  onExpand={handleExpandNode}
                />
              </>
            ) : null}
          </div>
        </section>

        <ChatPanel
          messages={messages}
          loading={loadingQuery}
          suggestions={suggestions}
          latestResult={queryResult}
          onSend={handleAskQuestion}
        />
      </main>
    </div>
  );
}

function mergeGraph(
  current: GraphPayload,
  addition: Pick<GraphPayload, "nodes" | "edges">
): GraphPayload {
  const nodeMap = new Map(current.nodes.map((node) => [node.id, node]));
  const edgeMap = new Map(current.edges.map((edge) => [edge.id, edge]));

  for (const node of addition.nodes) {
    nodeMap.set(node.id, node);
  }

  for (const edge of addition.edges) {
    edgeMap.set(edge.id, edge);
  }

  return {
    ...current,
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values())
  };
}
