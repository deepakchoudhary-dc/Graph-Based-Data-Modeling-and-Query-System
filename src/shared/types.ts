export type NodeKind =
  | "customer"
  | "address"
  | "sales-order"
  | "sales-order-item"
  | "schedule-line"
  | "delivery"
  | "delivery-item"
  | "billing-document"
  | "billing-item"
  | "journal-entry"
  | "payment"
  | "product"
  | "plant"
  | "customer-company"
  | "customer-sales-area"
  | "product-plant"
  | "storage-location";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  summary: string;
  color: string;
  size: number;
  metadata: Record<string, JsonValue>;
  initial: boolean;
  expandable: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  label: string;
  color: string;
  initial: boolean;
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  initialNodes: number;
  initialEdges: number;
  nodeKinds: Record<string, number>;
}

export interface MetricCard {
  label: string;
  value: number | string;
  tone: "neutral" | "good" | "warning" | "accent";
  detail: string;
}

export interface BreakdownItem {
  label: string;
  count: number;
}

export interface RankedEntity {
  id: string;
  label: string;
  primaryMetric: number;
  secondaryMetric?: number;
}

export interface RiskSpotlight {
  title: string;
  detail: string;
  nodeIds: string[];
}

export interface AnalyticsSummary {
  metricCards: MetricCard[];
  flowBreakdown: BreakdownItem[];
  anomalyBreakdown: BreakdownItem[];
  topProducts: RankedEntity[];
  topCustomers: RankedEntity[];
  riskSpotlights: RiskSpotlight[];
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
  examplePrompts: string[];
  analytics: AnalyticsSummary;
}

export interface NodeDetailsPayload {
  node: GraphNode;
  neighbors: GraphNode[];
  expansion: {
    nodes: GraphNode[];
    edges: GraphEdge[];
  };
}

export interface SearchResult {
  nodeId: string;
  label: string;
  kind: NodeKind;
  summary: string;
  score: number;
  reason: string;
}

export interface QueryRequest {
  question: string;
  conversation: ChatMessage[];
}

export interface QueryFocus {
  title: string;
  nodes: string[];
  edges: string[];
}

export interface QueryResponse {
  rejected: boolean;
  answer: string;
  sql: string | null;
  columns: string[];
  rows: Array<Record<string, JsonValue>>;
  highlights: string[];
  focus: QueryFocus | null;
  intent: string;
  engine: "guardrail" | "rule" | "gemini";
  reason?: string;
  planSteps: string[];
  suggestions: string[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface QueryStreamEvent {
  type:
    | "status"
    | "plan"
    | "sql"
    | "rows"
    | "answer"
    | "done"
    | "error";
  payload: JsonValue;
}
