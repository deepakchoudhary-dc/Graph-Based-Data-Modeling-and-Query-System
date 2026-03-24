import type {
  JsonValue,
  QueryFocus
} from "../../shared/types.js";
import { escapeSqlLiteral } from "../utils/jsonl.js";
import {
  collectTraceHighlight,
  type DataModel
} from "./data-model.js";
import { extractKnownIds } from "./guardrails.js";

export type QueryRows = Array<Record<string, JsonValue>>;

export type RulePlan = {
  intent: string;
  sql: string;
  answer: (rows: QueryRows) => string;
  planSteps: string[];
  highlights?: (rows: QueryRows) => string[];
};

export function planRuleQuestion(
  question: string,
  model: DataModel
): RulePlan | null {
  const normalized = question.toLowerCase();

  if (
    /highest number of billing documents|most billing documents|top products.*billing|products.*billing documents/.test(
      normalized
    )
  ) {
    return {
      intent: "top-products-by-billing-documents",
      sql: `
        SELECT
          product_id,
          product_description,
          billing_document_count,
          billed_line_count,
          total_billed_amount
        FROM v_product_billing_stats
        ORDER BY billing_document_count DESC, total_billed_amount DESC, product_id
        LIMIT 10
      `,
      planSteps: [
        "Matched the question to the curated product-billing ranking rule.",
        "Queried v_product_billing_stats for distinct billing-document coverage."
      ],
      answer: (rows) => summarizeTopProducts(rows),
      highlights: (rows) =>
        rows
          .slice(0, 5)
          .map((row) => String(row.product_id))
          .map((productId) => model.lookup.products.get(productId))
          .filter((candidate): candidate is string => Boolean(candidate))
    };
  }

  if (
    /delivered but not billed|broken|incomplete|not paid|anomal|billed without delivery/.test(
      normalized
    )
  ) {
    const anomalyFilter = normalized.includes("without delivery")
      ? "WHERE anomaly_type = 'BILLED_WITHOUT_DELIVERY'"
      : normalized.includes("not paid")
        ? "WHERE anomaly_type = 'BILLED_NOT_PAID'"
        : normalized.includes("delivered but not billed")
          ? "WHERE anomaly_type = 'DELIVERED_NOT_BILLED'"
          : "";
    return {
      intent: "flow-anomalies",
      sql: `
        SELECT
          anomaly_type,
          sales_order,
          sales_order_item,
          delivery_document,
          billing_document,
          accounting_document,
          customer_name,
          product_description,
          detail
        FROM v_flow_anomalies
        ${anomalyFilter}
        ORDER BY anomaly_type, sales_order, delivery_document, billing_document
        LIMIT 25
      `,
      planSteps: [
        "Matched the question to anomaly analysis.",
        "Queried v_flow_anomalies to return only broken or incomplete flows."
      ],
      answer: (rows) => summarizeAnomalies(rows),
      highlights: (rows) => inferHighlights(rows, model)
    };
  }

  const knownIds = extractKnownIds(question, model);
  const primary = resolvePrimaryEntity(question, model, knownIds);
  if (!primary) {
    return null;
  }

  if (
    /journal|accounting document/.test(normalized) &&
    primary.kind === "billing-document"
  ) {
    return {
      intent: "billing-to-journal",
      sql: `
        SELECT DISTINCT
          billing_document,
          accounting_document,
          payment_document,
          customer_name
        FROM v_billing_flow
        WHERE billing_document = '${escapeSqlLiteral(primary.id)}'
      `,
      planSteps: [
        `Resolved ${primary.id} as a billing document.`,
        "Queried the billing-centric trace view to recover its accounting document."
      ],
      answer: (rows) => summarizeBillingToJournal(primary.id, rows),
      highlights: () => collectTraceHighlight(model, primary.nodeId, 3)
    };
  }

  if (/trace|full flow|journey|path|linked|relation|flow/.test(normalized)) {
    return createTracePlan(primary, model);
  }

  if (primary.kind === "billing-document" || primary.kind === "sales-order") {
    return createTracePlan(primary, model);
  }

  return null;
}

export function inferHighlights(rows: QueryRows, model: DataModel): string[] {
  const highlights = new Set<string>();
  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (typeof value !== "string" && typeof value !== "number") {
        continue;
      }
      const stringValue = String(value);
      const candidates = [
        model.lookup.customers.get(stringValue),
        model.lookup.products.get(stringValue),
        model.lookup.salesOrders.get(stringValue),
        model.lookup.deliveries.get(stringValue),
        model.lookup.billings.get(stringValue),
        model.lookup.journals.get(stringValue),
        model.lookup.payments.get(stringValue)
      ].filter((candidate): candidate is string => Boolean(candidate));

      for (const candidate of candidates) {
        highlights.add(candidate);
      }
    }
  }
  return Array.from(highlights).slice(0, 20);
}

export function buildFocus(
  model: DataModel,
  nodes: string[],
  question: string
): QueryFocus | null {
  if (nodes.length === 0) {
    return null;
  }

  const selected = new Set(nodes);
  const edges = Array.from(model.allEdges.values())
    .filter((edge) => selected.has(edge.source) && selected.has(edge.target))
    .slice(0, 40)
    .map((edge) => edge.id);

  return {
    title: `Focus for: ${question}`,
    nodes,
    edges
  };
}

export function nextSuggestions(model: DataModel, question: string): string[] {
  return model.examplePrompts
    .filter((prompt) => prompt.toLowerCase() !== question.toLowerCase())
    .slice(0, 4);
}

function createTracePlan(
  primary: { id: string; kind: string; nodeId: string },
  model: DataModel
): RulePlan {
  const traceConfigs: Record<
    string,
    {
      sql: string;
      label: string;
    }
  > = {
    "billing-document": {
      sql: `
        SELECT
          billing_document,
          billing_item,
          delivery_document,
          delivery_item,
          sales_order,
          sales_order_item,
          customer_name,
          product_description,
          accounting_document,
          payment_document,
          billing_cancelled
        FROM v_billing_flow
        WHERE billing_document = '${escapeSqlLiteral(primary.id)}'
        ORDER BY billing_item
      `,
      label: "billing document"
    },
    "sales-order": {
      sql: `
        SELECT
          sales_order,
          sales_order_item,
          customer_name,
          product_description,
          delivery_document,
          billing_document,
          accounting_document,
          payment_document,
          flow_status
        FROM v_sales_flow
        WHERE sales_order = '${escapeSqlLiteral(primary.id)}'
        ORDER BY sales_order_item, delivery_document, billing_document
      `,
      label: "sales order"
    },
    delivery: {
      sql: `
        SELECT
          delivery_document,
          delivery_item,
          sales_order,
          sales_order_item,
          product_description,
          billing_document,
          accounting_document,
          payment_document,
          customer_name,
          flow_status
        FROM v_sales_flow
        WHERE delivery_document = '${escapeSqlLiteral(primary.id)}'
        ORDER BY delivery_item, billing_document
      `,
      label: "delivery"
    },
    "journal-entry": {
      sql: `
        SELECT
          billing_document,
          sales_order,
          delivery_document,
          accounting_document,
          payment_document,
          customer_name,
          product_description
        FROM v_billing_flow
        WHERE accounting_document = '${escapeSqlLiteral(primary.id)}'
        ORDER BY billing_document, delivery_document
      `,
      label: "journal entry"
    },
    payment: {
      sql: `
        SELECT
          billing_document,
          sales_order,
          delivery_document,
          accounting_document,
          payment_document,
          customer_name,
          product_description
        FROM v_billing_flow
        WHERE payment_document = '${escapeSqlLiteral(primary.id)}'
        ORDER BY billing_document, delivery_document
      `,
      label: "payment"
    }
  };

  const config = traceConfigs[primary.kind];
  return {
    intent: `trace-${primary.kind}`,
    sql: config.sql,
    planSteps: [
      `Resolved ${primary.id} as a ${config.label}.`,
      "Ran the trace against the curated flow view to recover upstream and downstream documents."
    ],
    answer: (rows) => summarizeTrace(primary.id, config.label, rows),
    highlights: () => collectTraceHighlight(model, primary.nodeId, 3)
  };
}

function summarizeTopProducts(rows: QueryRows): string {
  if (rows.length === 0) {
    return "No billed products were found in the dataset.";
  }

  const top = rows[0];
  const topCount = Number(top.billing_document_count);
  const leaders = rows
    .filter((row) => Number(row.billing_document_count) === topCount)
    .map((row) => `${row.product_description} (${row.product_id})`);
  const leadText =
    leaders.length === 1
      ? `${leaders[0]} leads with ${topCount} billing documents`
      : `${leaders.join(" and ")} are tied at ${topCount} billing documents each`;
  return `${leadText}. The result grid shows the top 10 products ranked by distinct billing-document coverage and billed amount.`;
}

function summarizeAnomalies(rows: QueryRows): string {
  if (rows.length === 0) {
    return "No flow anomalies matched that filter in the current dataset.";
  }

  const counts = new Map<string, number>();
  for (const row of rows) {
    const type = String(row.anomaly_type);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  const summary = Array.from(counts.entries())
    .map(([type, count]) => `${type}: ${count}`)
    .join(", ");
  const sample = rows[0];
  return `I found ${rows.length} anomaly rows in the returned slice. Breakdown: ${summary}. The first example is sales order ${sample.sales_order ?? "n/a"} with detail: ${sample.detail}.`;
}

function summarizeBillingToJournal(
  billingDocument: string,
  rows: QueryRows
): string {
  if (rows.length === 0) {
    return `No accounting document was found for billing document ${billingDocument}.`;
  }

  const accountingDocuments = uniqueValues(rows, "accounting_document");
  const payments = uniqueValues(rows, "payment_document");
  const paymentText =
    payments.length > 0
      ? ` It is cleared by payment ${payments.join(", ")}.`
      : " It is not yet cleared by a payment document.";
  return `Billing document ${billingDocument} posts to journal entry ${accountingDocuments.join(", ")}.${paymentText}`;
}

function summarizeTrace(
  entityId: string,
  label: string,
  rows: QueryRows
): string {
  if (rows.length === 0) {
    return `No downstream flow records were found for ${label} ${entityId}.`;
  }

  const salesOrders = uniqueValues(rows, "sales_order");
  const deliveries = uniqueValues(rows, "delivery_document");
  const billings = uniqueValues(rows, "billing_document");
  const journals = uniqueValues(rows, "accounting_document");
  const payments = uniqueValues(rows, "payment_document");

  return [
    `${label[0].toUpperCase()}${label.slice(1)} ${entityId} links to ${salesOrders.length || 0} sales order(s), ${deliveries.length || 0} delivery document(s), ${billings.length || 0} billing document(s), and ${journals.length || 0} journal entry document(s).`,
    payments.length > 0
      ? `The flow is cleared by payment document ${payments.join(", ")}.`
      : "No clearing payment document is present in the matched flow rows."
  ].join(" ");
}

function uniqueValues(rows: QueryRows, key: string): string[] {
  return Array.from(
    new Set(
      rows
        .map((row) => row[key])
        .filter((value): value is string | number => value !== null && value !== "")
        .map((value) => String(value))
    )
  );
}

function resolvePrimaryEntity(
  question: string,
  model: DataModel,
  knownIds: string[]
): { id: string; kind: string; nodeId: string } | null {
  const normalized = question.toLowerCase();

  for (const id of knownIds) {
    if (/(billing|invoice)/.test(normalized) && model.lookup.billings.has(id)) {
      return { id, kind: "billing-document", nodeId: model.lookup.billings.get(id)! };
    }
    if (/(sales order|order)/.test(normalized) && model.lookup.salesOrders.has(id)) {
      return { id, kind: "sales-order", nodeId: model.lookup.salesOrders.get(id)! };
    }
    if (/delivery/.test(normalized) && model.lookup.deliveries.has(id)) {
      return { id, kind: "delivery", nodeId: model.lookup.deliveries.get(id)! };
    }
    if (/(journal|accounting)/.test(normalized) && model.lookup.journals.has(id)) {
      return { id, kind: "journal-entry", nodeId: model.lookup.journals.get(id)! };
    }
    if (/(payment|clearing)/.test(normalized) && model.lookup.payments.has(id)) {
      return { id, kind: "payment", nodeId: model.lookup.payments.get(id)! };
    }
  }

  for (const id of knownIds) {
    if (model.lookup.billings.has(id)) {
      return { id, kind: "billing-document", nodeId: model.lookup.billings.get(id)! };
    }
    if (model.lookup.salesOrders.has(id)) {
      return { id, kind: "sales-order", nodeId: model.lookup.salesOrders.get(id)! };
    }
    if (model.lookup.deliveries.has(id)) {
      return { id, kind: "delivery", nodeId: model.lookup.deliveries.get(id)! };
    }
    if (model.lookup.journals.has(id)) {
      return { id, kind: "journal-entry", nodeId: model.lookup.journals.get(id)! };
    }
    if (model.lookup.payments.has(id)) {
      return { id, kind: "payment", nodeId: model.lookup.payments.get(id)! };
    }
  }

  return null;
}
