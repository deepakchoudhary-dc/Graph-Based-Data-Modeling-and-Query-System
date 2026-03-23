import type {
  GraphPayload,
  NodeDetailsPayload,
  QueryRequest,
  QueryResponse,
  QueryStreamEvent,
  SearchResult
} from "@shared/types";

export async function fetchGraph(): Promise<GraphPayload> {
  const response = await fetch("/api/graph");
  if (!response.ok) {
    throw new Error("Failed to load graph.");
  }
  return response.json() as Promise<GraphPayload>;
}

export async function fetchNodeDetails(nodeId: string): Promise<NodeDetailsPayload> {
  const response = await fetch(`/api/graph/nodes/${encodeURIComponent(nodeId)}`);
  if (!response.ok) {
    throw new Error("Failed to load node details.");
  }
  return response.json() as Promise<NodeDetailsPayload>;
}

export async function submitQuestion(
  payload: QueryRequest
): Promise<QueryResponse> {
  const response = await fetch("/api/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Failed to submit query.");
  }

  return response.json() as Promise<QueryResponse>;
}

export async function streamQuestion(
  payload: QueryRequest,
  onEvent: (event: QueryStreamEvent) => void
): Promise<void> {
  const response = await fetch("/api/query/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok || !response.body) {
    throw new Error("Failed to stream query response.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      onEvent(JSON.parse(line) as QueryStreamEvent);
    }
  }
}

export async function searchGraph(query: string): Promise<SearchResult[]> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    throw new Error("Failed to search graph.");
  }
  return response.json() as Promise<SearchResult[]>;
}
