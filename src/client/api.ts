import type {
  GraphPayload,
  NodeDetailsPayload,
  QueryRequest,
  QueryResponse
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
