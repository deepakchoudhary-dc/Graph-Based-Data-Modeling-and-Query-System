import type {
  GovernanceSummary,
  JsonValue,
  NodeKind
} from "../../shared/types.js";

export const GOVERNANCE_SUMMARY: GovernanceSummary = {
  ontologyVersion: "2026.03-o2c-graph",
  policyVersion: "2026.03-privacy-guardrails",
  privacyMode: "balanced-public-demo",
  curatedQuerySources: [
    "v_sales_flow",
    "v_billing_flow",
    "v_product_billing_stats",
    "v_customer_revenue_stats",
    "v_flow_anomalies",
    "v_customer_master",
    "v_product_master",
    "v_document_links"
  ],
  sensitiveFieldGroups: {
    address: ["street_name", "postal_code", "address_id", "city", "region"],
    contact: [
      "accountingClerkFaxNumber",
      "accountingClerkInternetAddress",
      "accountingClerkPhoneNumber"
    ],
    personal: ["firstName", "lastName", "businessPartnerFullName", "businessPartnerName"]
  },
  graphProfiles: {
    customer: "Business partner master-data node with customer-facing commercial context.",
    "sales-order": "Commercial demand document anchoring the fulfillment flow.",
    delivery: "Outbound logistics execution document.",
    "billing-document": "Revenue recognition and customer invoicing document.",
    "journal-entry": "Accounts receivable posting generated from billing.",
    payment: "Clearing document representing receivables settlement."
  }
};

export const NODE_GOVERNANCE: Record<
  NodeKind,
  {
    classification: "transaction" | "master-data" | "sensitive-supporting";
    sourceDatasets: string[];
    description: string;
  }
> = {
  customer: {
    classification: "master-data",
    sourceDatasets: [
      "business_partners",
      "business_partner_addresses",
      "customer_company_assignments",
      "customer_sales_area_assignments"
    ],
    description: "Customer account master-data node"
  },
  address: {
    classification: "sensitive-supporting",
    sourceDatasets: ["business_partner_addresses"],
    description: "Address-supporting node that should remain privacy-aware"
  },
  "sales-order": {
    classification: "transaction",
    sourceDatasets: ["sales_order_headers"],
    description: "Sales order commercial header"
  },
  "sales-order-item": {
    classification: "transaction",
    sourceDatasets: ["sales_order_items"],
    description: "Sales order line item"
  },
  "schedule-line": {
    classification: "transaction",
    sourceDatasets: ["sales_order_schedule_lines"],
    description: "Schedule-line planning detail"
  },
  delivery: {
    classification: "transaction",
    sourceDatasets: ["outbound_delivery_headers"],
    description: "Outbound delivery header"
  },
  "delivery-item": {
    classification: "transaction",
    sourceDatasets: ["outbound_delivery_items"],
    description: "Outbound delivery item"
  },
  "billing-document": {
    classification: "transaction",
    sourceDatasets: ["billing_document_headers", "billing_document_cancellations"],
    description: "Billing document header"
  },
  "billing-item": {
    classification: "transaction",
    sourceDatasets: ["billing_document_items"],
    description: "Billing document line item"
  },
  "journal-entry": {
    classification: "transaction",
    sourceDatasets: ["journal_entry_items_accounts_receivable"],
    description: "Accounts receivable journal entry"
  },
  payment: {
    classification: "transaction",
    sourceDatasets: ["payments_accounts_receivable"],
    description: "Clearing payment document"
  },
  product: {
    classification: "master-data",
    sourceDatasets: ["products", "product_descriptions"],
    description: "Sellable product master"
  },
  plant: {
    classification: "master-data",
    sourceDatasets: ["plants"],
    description: "Supplying plant master"
  },
  "customer-company": {
    classification: "sensitive-supporting",
    sourceDatasets: ["customer_company_assignments"],
    description: "Company-code accounting settings for a customer"
  },
  "customer-sales-area": {
    classification: "sensitive-supporting",
    sourceDatasets: ["customer_sales_area_assignments"],
    description: "Sales-area configuration for a customer"
  },
  "product-plant": {
    classification: "master-data",
    sourceDatasets: ["product_plants"],
    description: "Product-to-plant availability mapping"
  },
  "storage-location": {
    classification: "master-data",
    sourceDatasets: ["product_storage_locations"],
    description: "Product storage location detail"
  }
};

export type GuardrailDecision = {
  allowed: boolean;
  reason?: string;
  notes: string[];
  maxRows: number;
  redactSensitiveFields: boolean;
};

export const DATA_EXFILTRATION_PATTERNS = [
  /\b(export|dump|extract|download|give me all|show all|entire dataset|raw dataset)\b/i,
  /\b(all customers|all addresses|all street|all postal|all contact)\b/i
];

export const PRIVACY_SENSITIVE_PROMPT_PATTERNS = [
  /\b(address|street|postal|zip|phone|fax|internet address|email)\b/i,
  /\bpersonal|private|contact\b/i
];

export const FORBIDDEN_SQL = /\b(insert|update|delete|drop|alter|attach|detach|pragma|vacuum|create|replace|reindex|analyze)\b/i;
export const SELECT_STAR_SQL = /\bselect\s+\*/i;

export const SENSITIVE_COLUMNS = new Set<string>([
  "address_id",
  "street_name",
  "postal_code",
  "city",
  "region",
  "country",
  "firstName",
  "lastName",
  "businessPartnerFullName",
  "businessPartnerName",
  "organizationBpName1",
  "organizationBpName2",
  "accountingClerkFaxNumber",
  "accountingClerkInternetAddress",
  "accountingClerkPhoneNumber"
]);

export function maskSensitiveValue(column: string, value: JsonValue): JsonValue {
  if (value === null) {
    return null;
  }

  if (column === "street_name") {
    return "[redacted street]";
  }

  if (column === "postal_code") {
    return "[redacted postal]";
  }

  if (column === "address_id") {
    return "[redacted address id]";
  }

  if (column === "city" || column === "region" || column === "country") {
    return "[redacted location]";
  }

  return "[redacted]";
}
