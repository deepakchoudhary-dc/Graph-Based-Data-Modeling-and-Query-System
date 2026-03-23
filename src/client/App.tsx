import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useState
} from "react";
import type {
  ChatMessage,
  GraphPayload,
  NodeDetailsPayload,
  QueryResponse,
  QueryStreamEvent,
  SearchResult
} from "@shared/types";
import {
  fetchGraph,
  fetchNodeDetails,
  searchGraph,
  streamQuestion
} from "@client/api";
import { AnalyticsBoard } from "@client/components/AnalyticsBoard";
import { ChatPanel } from "@client/components/ChatPanel";
import { GraphCanvas } from "@client/components/GraphCanvas";
import { NodeInspector } from "@client/components/NodeInspector";
import { SearchPanel } from "@client/components/SearchPanel";

type UiMessage = ChatMessage & {
  sql?: string | null;
  engine?: string;
  rowCount?: number;
  rejected?: boolean;
  planSteps?: string[];
  status?: string | null;
};

const INITIAL_MESSAGE: UiMessage = {
  role: "assistant",
  content:
    "I can trace the Order-to-Cash graph, rank business entities, surface anomalies, and explain every answer with dataset-backed SQL.",
  planSteps: [
    "Use the search bar to jump to business entities.",
    "Filter visible node families to declutter the graph.",
    "Ask a question and I will stream the query plan and grounded answer."
  ]
};

const MESSAGE_STORAGE_KEY = "dodge-ai-order-to-cash-chat";

export function App() {
  const [graph, setGraph] = useState<GraphPayload | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedDetails, setSelectedDetails] =
    useState<NodeDetailsPayload | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>(() => loadMessages());
  const [highlights, setHighlights] = useState<string[]>([]);
  const [focusedEdgeIds, setFocusedEdgeIds] = useState<string[]>([]);
  const [queryResult, setQueryResult] = useState<QueryResponse | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(true);
  const [loadingQuery, setLoadingQuery] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [enabledKinds, setEnabledKinds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const payload = await fetchGraph();
        setGraph(payload);
        setEnabledKinds(new Set(Object.keys(payload.stats.nodeKinds)));
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

  useEffect(() => {
    window.localStorage.setItem(MESSAGE_STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchGraph(searchQuery);
        if (!cancelled) {
          setSearchResults(results);
        }
      } catch {
        if (!cancelled) {
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [searchQuery]);

  const suggestions = useMemo(() => {
    if (queryResult?.suggestions?.length) {
      return queryResult.suggestions;
    }
    return graph?.examplePrompts ?? [];
  }, [graph?.examplePrompts, queryResult?.suggestions]);

  const visibleGraph = useMemo(() => {
    if (!graph) {
      return null;
    }

    const visibleNodes = graph.nodes.filter((node) => enabledKinds.has(node.kind));
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const visibleEdges = graph.edges.filter(
      (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    );

    return {
      ...graph,
      nodes: visibleNodes,
      edges: visibleEdges
    };
  }, [enabledKinds, graph]);

  const handleSelectNode = async (nodeId: string) => {
    setSelectedNodeId(nodeId);
    try {
      const details = await fetchNodeDetails(nodeId);
      setSelectedDetails(details);
    } catch {
      setSelectedDetails(null);
    }
  };

  const handleFocusNode = async (nodeId: string) => {
    const guessedKind = nodeId.split(":")[0];
    setEnabledKinds((current) => {
      if (current.has(guessedKind)) {
        return current;
      }
      const next = new Set(current);
      next.add(guessedKind);
      return next;
    });
    setHighlights([nodeId]);
    setFocusedEdgeIds([]);
    await handleSelectNode(nodeId);
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

  const handleClearInspector = () => {
    setSelectedNodeId(null);
    setSelectedDetails(null);
  };

  const handleAskQuestion = async (question: string) => {
    if (!question.trim() || loadingQuery) {
      return;
    }

    const nextConversation = [
      ...messages.map(({ role, content }) => ({ role, content })),
      { role: "user" as const, content: question }
    ];

    const placeholderIndex = messages.length + 1;
    setMessages((current) => [
      ...current,
      { role: "user", content: question },
      {
        role: "assistant",
        content: "Working through the graph...",
        status: "Starting query pipeline"
      }
    ]);
    setLoadingQuery(true);
    setStreamStatus("Starting query pipeline");

    try {
      await streamQuestion(
        {
          question,
          conversation: nextConversation
        },
        async (event) => {
          await handleStreamEvent(
            event,
            placeholderIndex,
            setMessages,
            setQueryResult,
            setHighlights,
            setFocusedEdgeIds,
            handleSelectNode
          );

          if (event.type === "status") {
            setStreamStatus(String(event.payload));
          }
          if (event.type === "done" || event.type === "error") {
            setStreamStatus(null);
          }
        }
      );
    } catch (error) {
      updateMessageAt(setMessages, placeholderIndex, {
        content:
          error instanceof Error ? error.message : "Failed to execute query.",
        rejected: true,
        status: null
      });
      setStreamStatus(null);
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
                <span>{Object.keys(graph.stats.nodeKinds).length} node kinds</span>
              </div>
            )}
          </header>

          {graph && (
            <AnalyticsBoard analytics={graph.analytics} onFocusNode={handleFocusNode} />
          )}

          <div className="control-row">
            <SearchPanel
              query={searchQuery}
              loading={searching}
              results={searchResults}
              onQueryChange={setSearchQuery}
              onSelect={handleFocusNode}
            />

            {graph && (
              <div className="kind-filter-row">
                {Object.entries(graph.stats.nodeKinds).map(([kind, count]) => {
                  const active = enabledKinds.has(kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      className={`kind-chip ${active ? "kind-chip-active" : ""}`}
                      onClick={() =>
                        setEnabledKinds((current) => {
                          const next = new Set(current);
                          if (next.has(kind)) {
                            next.delete(kind);
                          } else {
                            next.add(kind);
                          }
                          return next;
                        })
                      }
                    >
                      {kind} ({count})
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="graph-stage">
            {loadingGraph ? (
              <div className="empty-state">Loading graph model...</div>
            ) : graphError ? (
              <div className="empty-state error-state">{graphError}</div>
            ) : visibleGraph ? (
              <>
                <GraphCanvas
                  graph={visibleGraph}
                  selectedNodeId={selectedNodeId}
                  highlightedNodeIds={highlights}
                  focusedEdgeIds={focusedEdgeIds}
                  onSelectNode={handleSelectNode}
                  onBackgroundClick={handleClearInspector}
                  onClearHighlights={() => {
                    setHighlights([]);
                    setFocusedEdgeIds([]);
                  }}
                />
                <NodeInspector
                  details={selectedDetails}
                  onExpand={handleExpandNode}
                  onClose={handleClearInspector}
                />
              </>
            ) : null}
          </div>
        </section>

        <ChatPanel
          messages={messages}
          loading={loadingQuery}
          streamStatus={streamStatus}
          suggestions={suggestions}
          latestResult={queryResult}
          onSend={handleAskQuestion}
        />
      </main>
    </div>
  );
}

async function handleStreamEvent(
  event: QueryStreamEvent,
  placeholderIndex: number,
  setMessages: Dispatch<SetStateAction<UiMessage[]>>,
  setQueryResult: Dispatch<SetStateAction<QueryResponse | null>>,
  setHighlights: Dispatch<SetStateAction<string[]>>,
  setFocusedEdgeIds: Dispatch<SetStateAction<string[]>>,
  handleSelectNode: (nodeId: string) => Promise<void>
) {
  if (event.type === "status") {
    updateMessageAt(setMessages, placeholderIndex, {
      status: String(event.payload),
      content: String(event.payload)
    });
    return;
  }

  if (event.type === "plan") {
    const payload = event.payload as { steps?: string[] };
    updateMessageAt(setMessages, placeholderIndex, {
      planSteps: payload.steps ?? [],
      status: "Planning complete"
    });
    return;
  }

  if (event.type === "sql") {
    updateMessageAt(setMessages, placeholderIndex, {
      sql: String(event.payload)
    });
    return;
  }

  if (event.type === "rows") {
    const payload = event.payload as { count?: number };
    updateMessageAt(setMessages, placeholderIndex, {
      rowCount: payload.count ?? 0
    });
    return;
  }

  if (event.type === "answer") {
    updateMessageAt(setMessages, placeholderIndex, {
      content: String(event.payload),
      status: null
    });
    return;
  }

  if (event.type === "done") {
    const result = event.payload as unknown as QueryResponse;
    setQueryResult(result);
    setHighlights(result.highlights);
    setFocusedEdgeIds(result.focus?.edges ?? []);
    updateMessageAt(setMessages, placeholderIndex, {
      content: result.answer,
      sql: result.sql,
      engine: result.engine,
      rowCount: result.rows.length,
      rejected: result.rejected,
      planSteps: result.planSteps,
      status: null
    });

    if (result.highlights[0]) {
      await handleSelectNode(result.highlights[0]);
    }
    return;
  }

  if (event.type === "error") {
    updateMessageAt(setMessages, placeholderIndex, {
      content: `Streaming failed: ${String(event.payload)}`,
      rejected: true,
      status: null
    });
  }
}

function updateMessageAt(
  setMessages: Dispatch<SetStateAction<UiMessage[]>>,
  index: number,
  patch: Partial<UiMessage>
) {
  setMessages((current) =>
    current.map((message, messageIndex) =>
      messageIndex === index ? { ...message, ...patch } : message
    )
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

function loadMessages(): UiMessage[] {
  try {
    const raw = window.localStorage.getItem(MESSAGE_STORAGE_KEY);
    if (!raw) {
      return [INITIAL_MESSAGE];
    }
    const parsed = JSON.parse(raw) as UiMessage[];
    return parsed.length > 0 ? parsed : [INITIAL_MESSAGE];
  } catch {
    return [INITIAL_MESSAGE];
  }
}
