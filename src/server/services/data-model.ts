import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database } from "sql.js";
import {
  type AnalyticsSummary,
  type GraphEdge,
  type GraphNode,
  type GraphPayload,
  type GraphStats,
  type JsonValue,
  type NodeKind
} from "../../shared/types.js";
import type { SearchResult } from "../../shared/types.js";
import {
  asIntegerKey,
  asNullableString,
  asString,
  readJsonlDirectory,
  safeNumber,
  toDbValue,
  toDisplayValue,
  titleFromKey
} from "../utils/jsonl.js";
import {
  GOVERNANCE_SUMMARY,
  maskSensitiveValue,
  NODE_GOVERNANCE,
  SENSITIVE_COLUMNS
} from "./governance.js";

type Row = Record<string, unknown>;
type RawDatasets = Record<string, Row[]>;

type ExpansionPayload = {
  nodes: Set<string>;
  edges: Set<string>;
};

export interface DataModel {
  db: Database;
  graph: GraphPayload;
  allNodes: Map<string, GraphNode>;
  allEdges: Map<string, GraphEdge>;
  adjacency: Map<string, Set<string>>;
  expansions: Map<string, ExpansionPayload>;
  schemaSummary: string;
  examplePrompts: string[];
  lookup: {
    customers: Map<string, string>;
    products: Map<string, string>;
    salesOrders: Map<string, string>;
    deliveries: Map<string, string>;
    billings: Map<string, string>;
    journals: Map<string, string>;
    payments: Map<string, string>;
    genericIds: Map<string, string[]>;
  };
}

const DATASET_NAMES = [
  "billing_document_cancellations",
  "billing_document_headers",
  "billing_document_items",
  "business_partners",
  "business_partner_addresses",
  "customer_company_assignments",
  "customer_sales_area_assignments",
  "journal_entry_items_accounts_receivable",
  "outbound_delivery_headers",
  "outbound_delivery_items",
  "payments_accounts_receivable",
  "plants",
  "products",
  "product_descriptions",
  "product_plants",
  "product_storage_locations",
  "sales_order_headers",
  "sales_order_items",
  "sales_order_schedule_lines"
] as const;

const COLORS: Record<NodeKind, string> = {
  customer: "#0f766e",
  address: "#c0841a",
  "sales-order": "#1d3557",
  "sales-order-item": "#457b9d",
  "schedule-line": "#8d99ae",
  delivery: "#1d4ed8",
  "delivery-item": "#60a5fa",
  "billing-document": "#d9485f",
  "billing-item": "#f59e8b",
  "journal-entry": "#111827",
  payment: "#15803d",
  product: "#9a6700",
  plant: "#475569",
  "customer-company": "#6b7280",
  "customer-sales-area": "#64748b",
  "product-plant": "#7c3aed",
  "storage-location": "#6366f1"
};

const SIZES: Record<NodeKind, number> = {
  customer: 8,
  address: 5,
  "sales-order": 7,
  "sales-order-item": 5.5,
  "schedule-line": 4,
  delivery: 6.5,
  "delivery-item": 5.5,
  "billing-document": 7,
  "billing-item": 5,
  "journal-entry": 6.5,
  payment: 6,
  product: 6,
  plant: 6,
  "customer-company": 4.5,
  "customer-sales-area": 4.5,
  "product-plant": 4.5,
  "storage-location": 4
};

const EXAMPLE_PROMPTS = [
  "Which products are associated with the highest number of billing documents?",
  "Trace the full flow for billing document 90504248.",
  "Show sales orders that were delivered but not billed.",
  "Which billing documents are posted but not yet paid?",
  "List the customers with the highest billed revenue."
];

export async function buildDataModel(rootDirectory: string): Promise<DataModel> {
  const dataDirectory = resolveDataDirectory(rootDirectory);
  const raw = loadRawDatasets(dataDirectory);
  const db = await buildDatabase(raw);
  const graphContext = buildGraph(raw);
  const analytics = buildAnalyticsSummary(db, graphContext.lookup);

  return {
    db,
    graph: {
      nodes: graphContext.initialNodes,
      edges: graphContext.initialEdges,
      stats: graphContext.stats,
      examplePrompts: EXAMPLE_PROMPTS,
      analytics,
      governance: GOVERNANCE_SUMMARY
    },
    allNodes: graphContext.allNodes,
    allEdges: graphContext.allEdges,
    adjacency: graphContext.adjacency,
    expansions: graphContext.expansions,
    schemaSummary: buildSchemaSummary(),
    examplePrompts: EXAMPLE_PROMPTS,
    lookup: graphContext.lookup
  };
}

function resolveDataDirectory(rootDirectory: string): string {
  const extractedPath = path.join(rootDirectory, "data", "sap-o2c-data");
  if (!fs.existsSync(extractedPath)) {
    throw new Error(
      `Dataset directory not found at ${extractedPath}. Extract sap-order-to-cash-dataset.zip first.`
    );
  }

  return extractedPath;
}

function loadRawDatasets(dataDirectory: string): RawDatasets {
  const datasets: RawDatasets = {};
  for (const name of DATASET_NAMES) {
    datasets[name] = readJsonlDirectory(path.join(dataDirectory, name));
  }
  return datasets;
}

async function buildDatabase(raw: RawDatasets): Promise<Database> {
  const SQL = await initSqlJs({
    locateFile: (file: string) =>
      path.join(process.cwd(), "node_modules", "sql.js", "dist", file)
  });

  const db = new SQL.Database();
  for (const [tableName, rows] of Object.entries(raw)) {
    createRawTable(db, tableName, rows);
  }
  createAnalyticsViews(db);
  return db;
}

function createRawTable(db: Database, tableName: string, rows: Row[]): void {
  const columns = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row)))
  );

  if (columns.length === 0) {
    db.run(`CREATE TABLE "${tableName}" ("_empty" TEXT)`);
    return;
  }

  const columnSql = columns.map((column) => `"${column}" TEXT`).join(", ");
  db.run(`CREATE TABLE "${tableName}" (${columnSql})`);

  const insertSql = `INSERT INTO "${tableName}" (${columns
    .map((column) => `"${column}"`)
    .join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
  const statement = db.prepare(insertSql);

  for (const row of rows) {
    statement.run(columns.map((column) => toDbValue(row[column])));
  }

  statement.free();
}

function createAnalyticsViews(db: Database): void {
  db.run(`
    CREATE VIEW v_customer_master AS
    SELECT
      bp.customer AS customer_id,
      bp.businessPartner AS business_partner_id,
      COALESCE(NULLIF(bp.businessPartnerFullName, ''), NULLIF(bp.businessPartnerName, ''), NULLIF(bp.organizationBpName1, ''), bp.customer) AS customer_name,
      addr.addressId AS address_id,
      addr.cityName AS city,
      addr.region AS region,
      addr.country AS country,
      addr.postalCode AS postal_code,
      addr.streetName AS street_name,
      cca.companyCode AS company_code,
      cca.paymentTerms AS company_payment_terms,
      cca.reconciliationAccount AS reconciliation_account,
      csa.salesOrganization AS sales_organization,
      csa.distributionChannel AS distribution_channel,
      csa.division AS division,
      csa.salesOffice AS sales_office,
      csa.salesGroup AS sales_group,
      csa.supplyingPlant AS supplying_plant,
      csa.currency AS sales_currency
    FROM business_partners bp
    LEFT JOIN business_partner_addresses addr
      ON addr.businessPartner = bp.businessPartner
    LEFT JOIN customer_company_assignments cca
      ON cca.customer = bp.customer
    LEFT JOIN customer_sales_area_assignments csa
      ON csa.customer = bp.customer;
  `);

  db.run(`
    CREATE VIEW v_product_master AS
    SELECT
      p.product AS product_id,
      COALESCE(pd.productDescription, p.productOldId, p.product) AS product_description,
      p.productType AS product_type,
      p.productGroup AS product_group,
      p.baseUnit AS base_unit,
      p.division AS division,
      (
        SELECT COUNT(DISTINCT pp.plant)
        FROM product_plants pp
        WHERE pp.product = p.product
      ) AS plant_count,
      (
        SELECT COUNT(*)
        FROM product_storage_locations psl
        WHERE psl.product = p.product
      ) AS storage_location_count
    FROM products p
    LEFT JOIN product_descriptions pd
      ON pd.product = p.product
     AND pd.language = 'EN';
  `);

  db.run(`
    CREATE VIEW v_payment_documents AS
    SELECT
      companyCode AS company_code,
      clearingDocFiscalYear AS fiscal_year,
      clearingAccountingDocument AS payment_document,
      MIN(clearingDate) AS clearing_date,
      MAX(customer) AS customer_id,
      COUNT(DISTINCT accountingDocument) AS source_document_count,
      SUM(CASE WHEN accountingDocument = clearingAccountingDocument THEN 1 ELSE 0 END) AS payment_self_rows
    FROM payments_accounts_receivable
    WHERE NULLIF(clearingAccountingDocument, '') IS NOT NULL
      AND NULLIF(clearingAccountingDocument, '0') IS NOT NULL
      AND NULLIF(clearingDocFiscalYear, '0') IS NOT NULL
    GROUP BY companyCode, clearingDocFiscalYear, clearingAccountingDocument;
  `);

  db.run(`
    CREATE VIEW v_sales_flow AS
    SELECT
      soh.salesOrder AS sales_order,
      printf('%06d', CAST(soi.salesOrderItem AS INTEGER)) AS sales_order_item,
      CAST(soi.salesOrderItem AS INTEGER) AS sales_order_item_number,
      soh.salesOrderType AS sales_order_type,
      soh.creationDate AS sales_order_created_at,
      soh.requestedDeliveryDate AS requested_delivery_date,
      soh.totalNetAmount AS sales_order_total_net_amount,
      soh.transactionCurrency AS order_currency,
      soh.overallDeliveryStatus AS overall_delivery_status,
      soh.overallOrdReltdBillgStatus AS overall_billing_status,
      soh.soldToParty AS customer_id,
      cm.customer_name AS customer_name,
      soi.material AS product_id,
      pm.product_description AS product_description,
      soi.requestedQuantity AS requested_quantity,
      soi.requestedQuantityUnit AS requested_quantity_unit,
      soi.netAmount AS sales_order_item_net_amount,
      soi.productionPlant AS production_plant,
      soi.storageLocation AS order_storage_location,
      odl.deliveryDocument AS delivery_document,
      printf('%06d', CAST(odl.deliveryDocumentItem AS INTEGER)) AS delivery_item,
      odh.creationDate AS delivery_created_at,
      odl.actualDeliveryQuantity AS delivery_quantity,
      odl.deliveryQuantityUnit AS delivery_quantity_unit,
      odl.plant AS delivery_plant,
      odl.storageLocation AS delivery_storage_location,
      odh.shippingPoint AS shipping_point,
      odh.overallGoodsMovementStatus AS goods_movement_status,
      odh.overallPickingStatus AS picking_status,
      bdi.billingDocument AS billing_document,
      printf('%06d', CAST(bdi.billingDocumentItem AS INTEGER)) AS billing_item,
      bdh.billingDocumentDate AS billing_date,
      bdh.billingDocumentType AS billing_document_type,
      bdh.totalNetAmount AS billing_total_net_amount,
      bdi.netAmount AS billing_item_net_amount,
      bdi.billingQuantity AS billing_quantity,
      bdi.billingQuantityUnit AS billing_quantity_unit,
      bdh.transactionCurrency AS billing_currency,
      COALESCE(bcan.billingDocumentIsCancelled, bdh.billingDocumentIsCancelled) AS billing_cancelled,
      bdh.companyCode AS company_code,
      bdh.fiscalYear AS fiscal_year,
      bdh.accountingDocument AS accounting_document,
      jei.referenceDocument AS journal_reference_document,
      jei.postingDate AS journal_posting_date,
      jei.clearingAccountingDocument AS clearing_accounting_document,
      jei.clearingDate AS clearing_date,
      pay.payment_document AS payment_document,
      pay.clearing_date AS payment_clearing_date,
      CASE
        WHEN odl.deliveryDocument IS NULL THEN 'ORDERED_NOT_DELIVERED'
        WHEN bdi.billingDocument IS NULL THEN 'DELIVERED_NOT_BILLED'
        WHEN jei.accountingDocument IS NULL THEN 'BILLED_NOT_POSTED'
        WHEN pay.payment_document IS NULL THEN 'BILLED_NOT_PAID'
        ELSE 'PAID'
      END AS flow_status
    FROM sales_order_items soi
    JOIN sales_order_headers soh
      ON soh.salesOrder = soi.salesOrder
    LEFT JOIN v_customer_master cm
      ON cm.customer_id = soh.soldToParty
    LEFT JOIN v_product_master pm
      ON pm.product_id = soi.material
    LEFT JOIN outbound_delivery_items odl
      ON odl.referenceSdDocument = soi.salesOrder
     AND CAST(odl.referenceSdDocumentItem AS INTEGER) = CAST(soi.salesOrderItem AS INTEGER)
    LEFT JOIN outbound_delivery_headers odh
      ON odh.deliveryDocument = odl.deliveryDocument
    LEFT JOIN billing_document_items bdi
      ON bdi.referenceSdDocument = odl.deliveryDocument
     AND CAST(bdi.referenceSdDocumentItem AS INTEGER) = CAST(odl.deliveryDocumentItem AS INTEGER)
    LEFT JOIN billing_document_headers bdh
      ON bdh.billingDocument = bdi.billingDocument
    LEFT JOIN billing_document_cancellations bcan
      ON bcan.billingDocument = bdh.billingDocument
    LEFT JOIN journal_entry_items_accounts_receivable jei
      ON jei.companyCode = bdh.companyCode
     AND jei.fiscalYear = bdh.fiscalYear
     AND jei.accountingDocument = bdh.accountingDocument
    LEFT JOIN v_payment_documents pay
      ON pay.company_code = jei.companyCode
     AND pay.fiscal_year = jei.clearingDocFiscalYear
     AND pay.payment_document = jei.clearingAccountingDocument;
  `);

  db.run(`
    CREATE VIEW v_billing_flow AS
    SELECT DISTINCT
      bdh.billingDocument AS billing_document,
      printf('%06d', CAST(bdi.billingDocumentItem AS INTEGER)) AS billing_item,
      bdh.billingDocumentType AS billing_document_type,
      bdh.billingDocumentDate AS billing_date,
      bdh.soldToParty AS customer_id,
      cm.customer_name AS customer_name,
      bdi.material AS product_id,
      pm.product_description AS product_description,
      bdi.referenceSdDocument AS delivery_document,
      printf('%06d', CAST(bdi.referenceSdDocumentItem AS INTEGER)) AS delivery_item,
      odi.referenceSdDocument AS sales_order,
      printf('%06d', CAST(odi.referenceSdDocumentItem AS INTEGER)) AS sales_order_item,
      bdh.companyCode AS company_code,
      bdh.fiscalYear AS fiscal_year,
      bdh.accountingDocument AS accounting_document,
      jei.postingDate AS journal_posting_date,
      jei.clearingAccountingDocument AS clearing_accounting_document,
      pay.payment_document AS payment_document,
      pay.clearing_date AS payment_clearing_date,
      COALESCE(bcan.billingDocumentIsCancelled, bdh.billingDocumentIsCancelled) AS billing_cancelled,
      bdh.totalNetAmount AS billing_total_net_amount,
      bdi.netAmount AS billing_item_net_amount
    FROM billing_document_headers bdh
    LEFT JOIN billing_document_items bdi
      ON bdi.billingDocument = bdh.billingDocument
    LEFT JOIN outbound_delivery_items odi
      ON odi.deliveryDocument = bdi.referenceSdDocument
     AND CAST(odi.deliveryDocumentItem AS INTEGER) = CAST(bdi.referenceSdDocumentItem AS INTEGER)
    LEFT JOIN v_customer_master cm
      ON cm.customer_id = bdh.soldToParty
    LEFT JOIN v_product_master pm
      ON pm.product_id = bdi.material
    LEFT JOIN billing_document_cancellations bcan
      ON bcan.billingDocument = bdh.billingDocument
    LEFT JOIN journal_entry_items_accounts_receivable jei
      ON jei.companyCode = bdh.companyCode
     AND jei.fiscalYear = bdh.fiscalYear
     AND jei.accountingDocument = bdh.accountingDocument
    LEFT JOIN v_payment_documents pay
      ON pay.company_code = jei.companyCode
     AND pay.fiscal_year = jei.clearingDocFiscalYear
     AND pay.payment_document = jei.clearingAccountingDocument;
  `);

  db.run(`
    CREATE VIEW v_product_billing_stats AS
    SELECT
      product_id,
      product_description,
      COUNT(DISTINCT billing_document) AS billing_document_count,
      COUNT(*) AS billed_line_count,
      ROUND(SUM(CAST(billing_item_net_amount AS REAL)), 2) AS total_billed_amount
    FROM v_sales_flow
    WHERE billing_document IS NOT NULL
    GROUP BY product_id, product_description;
  `);

  db.run(`
    CREATE VIEW v_customer_revenue_stats AS
    SELECT
      customer_id,
      customer_name,
      COUNT(DISTINCT billing_document) AS billing_document_count,
      ROUND(SUM(CAST(billing_item_net_amount AS REAL)), 2) AS total_billed_amount,
      COUNT(DISTINCT CASE
        WHEN payment_document IS NULL
         AND journal_reference_document IS NOT NULL
         AND CAST(COALESCE(billing_cancelled, '0') AS INTEGER) = 0
        THEN billing_document
      END) AS open_billing_documents
    FROM v_sales_flow
    WHERE billing_document IS NOT NULL
    GROUP BY customer_id, customer_name;
  `);

  db.run(`
    CREATE VIEW v_document_links AS
    SELECT DISTINCT
      'customer' AS source_kind,
      customer_id AS source_id,
      'sales-order' AS target_kind,
      sales_order AS target_id,
      'placed-order' AS relation
    FROM v_sales_flow
    WHERE customer_id IS NOT NULL
      AND sales_order IS NOT NULL

    UNION ALL

    SELECT DISTINCT
      'sales-order',
      sales_order,
      'delivery',
      delivery_document,
      'fulfilled-by'
    FROM v_sales_flow
    WHERE sales_order IS NOT NULL
      AND delivery_document IS NOT NULL

    UNION ALL

    SELECT DISTINCT
      'delivery',
      delivery_document,
      'billing-document',
      billing_document,
      'billed-by'
    FROM v_sales_flow
    WHERE delivery_document IS NOT NULL
      AND billing_document IS NOT NULL

    UNION ALL

    SELECT DISTINCT
      'billing-document',
      billing_document,
      'journal-entry',
      accounting_document,
      'posted-to'
    FROM v_sales_flow
    WHERE billing_document IS NOT NULL
      AND journal_reference_document IS NOT NULL

    UNION ALL

    SELECT DISTINCT
      'journal-entry',
      accounting_document,
      'payment',
      payment_document,
      'cleared-by'
    FROM v_sales_flow
    WHERE journal_reference_document IS NOT NULL
      AND payment_document IS NOT NULL;
  `);

  db.run(`
    CREATE VIEW v_flow_anomalies AS
    SELECT DISTINCT
      'DELIVERED_NOT_BILLED' AS anomaly_type,
      sales_order,
      sales_order_item,
      delivery_document,
      delivery_item,
      NULL AS billing_document,
      NULL AS accounting_document,
      customer_id,
      customer_name,
      product_id,
      product_description,
      'Delivery exists but no downstream billing document was found.' AS detail
    FROM v_sales_flow
    WHERE delivery_document IS NOT NULL
      AND billing_document IS NULL

    UNION ALL

    SELECT DISTINCT
      'BILLED_WITHOUT_DELIVERY' AS anomaly_type,
      odi.referenceSdDocument AS sales_order,
      printf('%06d', CAST(odi.referenceSdDocumentItem AS INTEGER)) AS sales_order_item,
      NULL AS delivery_document,
      NULL AS delivery_item,
      bdi.billingDocument AS billing_document,
      bdh.accountingDocument AS accounting_document,
      bdh.soldToParty AS customer_id,
      cm.customer_name AS customer_name,
      bdi.material AS product_id,
      pm.product_description AS product_description,
      'Billing document item could not be matched back to an outbound delivery item.' AS detail
    FROM billing_document_items bdi
    JOIN billing_document_headers bdh
      ON bdh.billingDocument = bdi.billingDocument
    LEFT JOIN outbound_delivery_items odi
      ON odi.deliveryDocument = bdi.referenceSdDocument
     AND CAST(odi.deliveryDocumentItem AS INTEGER) = CAST(bdi.referenceSdDocumentItem AS INTEGER)
    LEFT JOIN v_customer_master cm
      ON cm.customer_id = bdh.soldToParty
    LEFT JOIN v_product_master pm
      ON pm.product_id = bdi.material
    WHERE odi.deliveryDocument IS NULL

    UNION ALL

    SELECT DISTINCT
      'BILLED_NOT_PAID' AS anomaly_type,
      sales_order,
      sales_order_item,
      delivery_document,
      delivery_item,
      billing_document,
      accounting_document,
      customer_id,
      customer_name,
      product_id,
      product_description,
      'Billing is posted but the clearing payment document is still missing.' AS detail
    FROM v_sales_flow
    WHERE billing_document IS NOT NULL
      AND journal_reference_document IS NOT NULL
      AND payment_document IS NULL
      AND CAST(COALESCE(billing_cancelled, '0') AS INTEGER) = 0

    UNION ALL

    SELECT DISTINCT
      'CANCELLED_BILLING' AS anomaly_type,
      sales_order,
      sales_order_item,
      delivery_document,
      delivery_item,
      billing_document,
      accounting_document,
      customer_id,
      customer_name,
      product_id,
      product_description,
      'Billing document is flagged as cancelled in the cancellation dataset.' AS detail
    FROM v_sales_flow
    WHERE billing_document IS NOT NULL
      AND CAST(COALESCE(billing_cancelled, '0') AS INTEGER) = 1;
  `);
}

function buildSchemaSummary(): string {
  return [
    "Primary business views:",
    "- v_sales_flow: one row per sales order item with downstream delivery, billing, journal entry, and payment columns.",
    "- v_billing_flow: billing-centric trace view from billing document to delivery, sales order, accounting, and payment.",
    "- v_product_billing_stats: product billing rollup with billing_document_count and total_billed_amount.",
    "- v_customer_revenue_stats: billed revenue, billing-document coverage, and open receivables by customer.",
    "- v_document_links: graph-style source/target links across customer, order, delivery, billing, journal, and payment documents.",
    "- v_flow_anomalies: anomaly_type, sales_order, delivery_document, billing_document, accounting_document, customer, product, detail.",
    "- v_customer_master: customer, address, company assignment, and sales area attributes.",
    "- v_product_master: product master plus description, plant_count, and storage_location_count.",
    "",
    "Raw tables available when needed:",
    DATASET_NAMES.map((name) => `- ${name}`).join("\n"),
    "",
    "Guardrails:",
    "- Only SELECT or CTE-based read queries are allowed.",
    "- Prefer v_sales_flow, v_billing_flow, v_product_billing_stats, and v_flow_anomalies for analyst questions."
  ].join("\n");
}

function buildAnalyticsSummary(
  db: Database,
  lookup: DataModel["lookup"]
): AnalyticsSummary {
  const flowBreakdown = executeRows(
    db,
    `
      SELECT flow_status AS label, COUNT(*) AS count
      FROM v_sales_flow
      GROUP BY flow_status
      ORDER BY count DESC
    `
  ).map((row) => ({
    label: String(row.label),
    count: Number(row.count)
  }));

  const anomalyBreakdown = executeRows(
    db,
    `
      SELECT anomaly_type AS label, COUNT(*) AS count
      FROM v_flow_anomalies
      GROUP BY anomaly_type
      ORDER BY count DESC
    `
  ).map((row) => ({
    label: String(row.label),
    count: Number(row.count)
  }));

  const topProducts = executeRows(
    db,
    `
      SELECT product_id, product_description, billing_document_count
      FROM v_product_billing_stats
      ORDER BY billing_document_count DESC, total_billed_amount DESC
      LIMIT 5
    `
  ).map((row) => ({
    id: String(row.product_id),
    label: String(row.product_description),
    primaryMetric: Number(row.billing_document_count)
  }));

  const topCustomers = executeRows(
    db,
    `
      SELECT customer_id, customer_name, total_billed_amount, open_billing_documents
      FROM v_customer_revenue_stats
      ORDER BY total_billed_amount DESC
      LIMIT 5
    `
  ).map((row) => ({
    id: String(row.customer_id),
    label: String(row.customer_name),
    primaryMetric: Number(row.total_billed_amount),
    secondaryMetric: Number(row.open_billing_documents)
  }));

  const deliveredNotBilled = anomalyBreakdown.find(
    (item) => item.label === "DELIVERED_NOT_BILLED"
  )?.count ?? 0;
  const billedNotPaid = anomalyBreakdown.find(
    (item) => item.label === "BILLED_NOT_PAID"
  )?.count ?? 0;
  const paidRows = flowBreakdown.find((item) => item.label === "PAID")?.count ?? 0;

  const riskSpotlights: AnalyticsSummary["riskSpotlights"] = [];
  const topOpenCustomer = topCustomers.find(
    (item) => (item.secondaryMetric ?? 0) > 0
  );
  if (topOpenCustomer) {
    riskSpotlights.push({
      title: "Open Receivables Hotspot",
      detail: `${topOpenCustomer.label} has ${topOpenCustomer.secondaryMetric} open billed document(s).`,
      nodeIds: [lookup.customers.get(topOpenCustomer.id)].filter(
        (candidate): candidate is string => Boolean(candidate)
      )
    });
  }
  if (deliveredNotBilled > 0) {
    riskSpotlights.push({
      title: "Delivery-to-Billing Breaks",
      detail: `${deliveredNotBilled} flow row(s) are delivered but not billed.`,
      nodeIds: []
    });
  }
  if (billedNotPaid > 0) {
    riskSpotlights.push({
      title: "Uncleared Billing Documents",
      detail: `${billedNotPaid} billed flow row(s) remain posted but unpaid.`,
      nodeIds: []
    });
  }

  return {
    metricCards: [
      {
        label: "Paid Flow Rows",
        value: paidRows,
        tone: "good",
        detail: "Rows in the curated sales-flow view that have completed payment."
      },
      {
        label: "Delivered Not Billed",
        value: deliveredNotBilled,
        tone: deliveredNotBilled > 0 ? "warning" : "good",
        detail: "Rows where delivery exists but no downstream billing document is found."
      },
      {
        label: "Posted Not Paid",
        value: billedNotPaid,
        tone: billedNotPaid > 0 ? "warning" : "good",
        detail: "Posted billing rows that still have no clearing payment document."
      },
      {
        label: "Searchable Graph Nodes",
        value: lookup.genericIds.size,
        tone: "accent",
        detail: "Unique business identifiers indexed for graph search and query focus."
      }
    ],
    flowBreakdown,
    anomalyBreakdown,
    topProducts,
    topCustomers,
    riskSpotlights
  };
}

function executeRows(db: Database, sql: string): Array<Record<string, JsonValue>> {
  const result = db.exec(sql)[0];
  if (!result) {
    return [];
  }

  return result.values.map((valueRow) =>
    Object.fromEntries(
      valueRow.map((value, index) => [result.columns[index], toMetadataValue(value)])
    )
  );
}

function buildGraph(raw: RawDatasets) {
  const allNodes = new Map<string, GraphNode>();
  const allEdges = new Map<string, GraphEdge>();
  const adjacency = new Map<string, Set<string>>();
  const expansions = new Map<string, ExpansionPayload>();

  const lookup = {
    customers: new Map<string, string>(),
    products: new Map<string, string>(),
    salesOrders: new Map<string, string>(),
    deliveries: new Map<string, string>(),
    billings: new Map<string, string>(),
    journals: new Map<string, string>(),
    payments: new Map<string, string>(),
    genericIds: new Map<string, string[]>()
  };

  const byBusinessPartner = indexBy(raw.business_partner_addresses, "businessPartner");
  const byCustomerCompany = indexManyBy(raw.customer_company_assignments, "customer");
  const byCustomerSalesArea = indexManyBy(
    raw.customer_sales_area_assignments,
    "customer"
  );
  const byProductDescription = indexBy(raw.product_descriptions, "product");
  const cancelledBillings = new Set(
    raw.billing_document_cancellations.map((row) => asString(row.billingDocument))
  );

  const paymentsByDocument = new Map<string, Row[]>();
  for (const row of raw.payments_accounts_receivable) {
    const paymentDocument = asNullableString(row.clearingAccountingDocument);
    const fiscalYear = asNullableString(row.clearingDocFiscalYear);
    if (!paymentDocument || !fiscalYear || fiscalYear === "0") {
      continue;
    }

    const key = paymentKey(asString(row.companyCode), fiscalYear, paymentDocument);
    const list = paymentsByDocument.get(key) ?? [];
    list.push(row);
    paymentsByDocument.set(key, list);
  }

  for (const row of raw.business_partners) {
    const customerId = asString(row.customer);
    const address = byBusinessPartner.get(asString(row.businessPartner));
    const addressId = asNullableString(address?.addressId);
    const nodeId = `customer:${customerId}`;
    const label =
      asNullableString(row.businessPartnerFullName) ??
      asNullableString(row.businessPartnerName) ??
      customerId;
    addNode(
      allNodes,
      nodeId,
      "customer",
      label,
      address
        ? `${toDisplayValue(address.cityName)}, ${toDisplayValue(address.region)}`
        : "Business partner",
      {
        customerId,
        businessPartner: asString(row.businessPartner),
        name: label,
        createdAt: asString(row.creationDate),
        blocked: asString(row.businessPartnerIsBlocked),
        addressId
      },
      true
    );
    lookup.customers.set(customerId, nodeId);
    pushGenericLookup(lookup.genericIds, customerId, nodeId);

    if (address && addressId) {
      const addressNodeId = `address:${addressId}`;
      addNode(
        allNodes,
        addressNodeId,
        "address",
        `${toDisplayValue(address.cityName)} (${addressId})`,
        `${toDisplayValue(address.streetName)} - ${toDisplayValue(address.postalCode)}`,
        rowToMetadata(address),
        false
      );
      addEdge(allEdges, adjacency, nodeId, addressNodeId, "has-address", false);
      addExpansion(expansions, nodeId, addressNodeId, edgeId(nodeId, addressNodeId, "has-address"));
      pushGenericLookup(lookup.genericIds, addressId, addressNodeId);
    }

    for (const companyRow of byCustomerCompany.get(customerId) ?? []) {
      const companyCode = asString(companyRow.companyCode);
      const companyNodeId = `customer-company:${customerId}:${companyCode}`;
      addNode(
        allNodes,
        companyNodeId,
        "customer-company",
        `${companyCode} / ${customerId}`,
        `Payment terms ${toDisplayValue(companyRow.paymentTerms)}`,
        rowToMetadata(companyRow),
        false
      );
      addEdge(allEdges, adjacency, nodeId, companyNodeId, "assigned-company", false);
      addExpansion(
        expansions,
        nodeId,
        companyNodeId,
        edgeId(nodeId, companyNodeId, "assigned-company")
      );
    }

    for (const salesAreaRow of byCustomerSalesArea.get(customerId) ?? []) {
      const salesOrg = asString(salesAreaRow.salesOrganization);
      const distributionChannel = asString(salesAreaRow.distributionChannel);
      const division = asString(salesAreaRow.division);
      const salesAreaNodeId = `customer-sales-area:${customerId}:${salesOrg}:${distributionChannel}:${division}`;
      addNode(
        allNodes,
        salesAreaNodeId,
        "customer-sales-area",
        `${salesOrg}/${distributionChannel}/${division}`,
        `Supplying plant ${toDisplayValue(salesAreaRow.supplyingPlant)}`,
        rowToMetadata(salesAreaRow),
        false
      );
      addEdge(
        allEdges,
        adjacency,
        nodeId,
        salesAreaNodeId,
        "assigned-sales-area",
        false
      );
      addExpansion(
        expansions,
        nodeId,
        salesAreaNodeId,
        edgeId(nodeId, salesAreaNodeId, "assigned-sales-area")
      );
    }
  }

  for (const row of raw.products) {
    const productId = asString(row.product);
    const description =
      asNullableString(byProductDescription.get(productId)?.productDescription) ??
      asNullableString(row.productOldId) ??
      productId;
    const nodeId = `product:${productId}`;
    addNode(
      allNodes,
      nodeId,
      "product",
      description,
      `${productId} - ${toDisplayValue(row.productType)}`,
      {
        productId,
        description,
        productType: asString(row.productType),
        productGroup: asString(row.productGroup),
        baseUnit: asString(row.baseUnit),
        division: asString(row.division)
      },
      true
    );
    lookup.products.set(productId, nodeId);
    pushGenericLookup(lookup.genericIds, productId, nodeId);
  }

  for (const row of raw.plants) {
    const plantId = asString(row.plant);
    const nodeId = `plant:${plantId}`;
    addNode(
      allNodes,
      nodeId,
      "plant",
      asNullableString(row.plantName) ?? plantId,
      `Plant ${plantId} - ${toDisplayValue(row.salesOrganization)}`,
      rowToMetadata(row),
      true
    );
    pushGenericLookup(lookup.genericIds, plantId, nodeId);
  }

  for (const row of raw.product_plants) {
    const productId = asString(row.product);
    const plantId = asString(row.plant);
    const nodeId = `product-plant:${productId}:${plantId}`;
    const productNodeId = lookup.products.get(productId);
    const plantNodeId = `plant:${plantId}`;
    if (!productNodeId || !allNodes.has(plantNodeId)) {
      continue;
    }

    addNode(
      allNodes,
      nodeId,
      "product-plant",
      `${productId} @ ${plantId}`,
      `MRP ${toDisplayValue(row.mrpType)}`,
      rowToMetadata(row),
      false
    );
    addEdge(allEdges, adjacency, productNodeId, nodeId, "available-at-plant", false);
    addEdge(allEdges, adjacency, nodeId, plantNodeId, "resolved-by-plant", false);
    addExpansion(
      expansions,
      productNodeId,
      nodeId,
      edgeId(productNodeId, nodeId, "available-at-plant"),
      edgeId(nodeId, plantNodeId, "resolved-by-plant")
    );
  }

  for (const row of raw.product_storage_locations) {
    const productId = asString(row.product);
    const plantId = asString(row.plant);
    const storageLocation = asString(row.storageLocation);
    const parentId = `product-plant:${productId}:${plantId}`;
    if (!allNodes.has(parentId)) {
      continue;
    }

    const nodeId = `storage-location:${productId}:${plantId}:${storageLocation}`;
    addNode(
      allNodes,
      nodeId,
      "storage-location",
      storageLocation,
      `${productId} @ ${plantId}`,
      rowToMetadata(row),
      false
    );
    addEdge(allEdges, adjacency, parentId, nodeId, "stored-in", false);
    addExpansion(expansions, parentId, nodeId, edgeId(parentId, nodeId, "stored-in"));
  }

  for (const row of raw.sales_order_headers) {
    const orderId = asString(row.salesOrder);
    const customerId = asString(row.soldToParty);
    const nodeId = `sales-order:${orderId}`;
    addNode(
      allNodes,
      nodeId,
      "sales-order",
      `SO ${orderId}`,
      `${toDisplayValue(row.totalNetAmount)} ${toDisplayValue(row.transactionCurrency)}`,
      rowToMetadata(row),
      true
    );
    lookup.salesOrders.set(orderId, nodeId);
    pushGenericLookup(lookup.genericIds, orderId, nodeId);

    const customerNodeId = lookup.customers.get(customerId);
    if (customerNodeId) {
      addEdge(allEdges, adjacency, customerNodeId, nodeId, "placed-order", true);
    }
  }

  for (const row of raw.sales_order_items) {
    const orderId = asString(row.salesOrder);
    const itemId = asIntegerKey(row.salesOrderItem);
    const productId = asString(row.material);
    const nodeId = `sales-order-item:${orderId}:${itemId}`;
    const orderNodeId = `sales-order:${orderId}`;
    addNode(
      allNodes,
      nodeId,
      "sales-order-item",
      `SO ${orderId} / ${Number.parseInt(itemId, 10)}`,
      `${toDisplayValue(row.requestedQuantity)} ${toDisplayValue(row.requestedQuantityUnit)}`,
      rowToMetadata(row),
      true
    );
    addEdge(allEdges, adjacency, orderNodeId, nodeId, "contains-item", true);

    const productNodeId = lookup.products.get(productId);
    if (productNodeId) {
      addEdge(allEdges, adjacency, nodeId, productNodeId, "requests-product", true);
    }
  }

  for (const row of raw.sales_order_schedule_lines) {
    const orderId = asString(row.salesOrder);
    const itemId = asIntegerKey(row.salesOrderItem);
    const scheduleLine = asIntegerKey(row.scheduleLine);
    const parentId = `sales-order-item:${orderId}:${itemId}`;
    if (!allNodes.has(parentId)) {
      continue;
    }

    const nodeId = `schedule-line:${orderId}:${itemId}:${scheduleLine}`;
    addNode(
      allNodes,
      nodeId,
      "schedule-line",
      `Schedule ${Number.parseInt(scheduleLine, 10)}`,
      `${toDisplayValue(row.confirmedDeliveryDate)}`,
      rowToMetadata(row),
      false
    );
    addEdge(allEdges, adjacency, parentId, nodeId, "scheduled-by", false);
    addExpansion(expansions, parentId, nodeId, edgeId(parentId, nodeId, "scheduled-by"));
  }

  for (const row of raw.outbound_delivery_headers) {
    const deliveryDocument = asString(row.deliveryDocument);
    const nodeId = `delivery:${deliveryDocument}`;
    addNode(
      allNodes,
      nodeId,
      "delivery",
      `Delivery ${deliveryDocument}`,
      `Shipping point ${toDisplayValue(row.shippingPoint)}`,
      rowToMetadata(row),
      true
    );
    lookup.deliveries.set(deliveryDocument, nodeId);
    pushGenericLookup(lookup.genericIds, deliveryDocument, nodeId);
  }

  const deliveryItemLookup = new Map<string, string>();
  for (const row of raw.outbound_delivery_items) {
    const deliveryDocument = asString(row.deliveryDocument);
    const deliveryItem = asIntegerKey(row.deliveryDocumentItem);
    const salesOrder = asString(row.referenceSdDocument);
    const salesOrderItem = asIntegerKey(row.referenceSdDocumentItem);
    const nodeId = `delivery-item:${deliveryDocument}:${deliveryItem}`;
    const deliveryNodeId = `delivery:${deliveryDocument}`;
    const plantNodeId = `plant:${asString(row.plant)}`;
    addNode(
      allNodes,
      nodeId,
      "delivery-item",
      `DL ${deliveryDocument} / ${Number.parseInt(deliveryItem, 10)}`,
      `${toDisplayValue(row.actualDeliveryQuantity)} ${toDisplayValue(row.deliveryQuantityUnit)}`,
      rowToMetadata(row),
      true
    );
    addEdge(allEdges, adjacency, deliveryNodeId, nodeId, "contains-item", true);
    if (allNodes.has(plantNodeId)) {
      addEdge(allEdges, adjacency, nodeId, plantNodeId, "ships-from-plant", true);
    }

    const salesOrderItemNodeId = `sales-order-item:${salesOrder}:${salesOrderItem}`;
    if (allNodes.has(salesOrderItemNodeId)) {
      addEdge(allEdges, adjacency, salesOrderItemNodeId, nodeId, "fulfilled-by", true);
    }

    deliveryItemLookup.set(`${deliveryDocument}:${deliveryItem}`, nodeId);
  }

  for (const row of raw.billing_document_headers) {
    const billingDocument = asString(row.billingDocument);
    const nodeId = `billing-document:${billingDocument}`;
    addNode(
      allNodes,
      nodeId,
      "billing-document",
      `Billing ${billingDocument}`,
      `${toDisplayValue(row.totalNetAmount)} ${toDisplayValue(row.transactionCurrency)}`,
      {
        ...rowToMetadata(row),
        cancelled: cancelledBillings.has(billingDocument)
      },
      true
    );
    lookup.billings.set(billingDocument, nodeId);
    pushGenericLookup(lookup.genericIds, billingDocument, nodeId);
  }

  for (const row of raw.billing_document_items) {
    const billingDocument = asString(row.billingDocument);
    const billingItem = asIntegerKey(row.billingDocumentItem);
    const nodeId = `billing-item:${billingDocument}:${billingItem}`;
    const billingNodeId = `billing-document:${billingDocument}`;
    addNode(
      allNodes,
      nodeId,
      "billing-item",
      `INV ${billingDocument} / ${Number.parseInt(billingItem, 10)}`,
      `${toDisplayValue(row.netAmount)} ${toDisplayValue(row.transactionCurrency)}`,
      rowToMetadata(row),
      true
    );
    addEdge(allEdges, adjacency, billingNodeId, nodeId, "contains-item", true);

    const deliveryKey = `${asString(row.referenceSdDocument)}:${asIntegerKey(
      row.referenceSdDocumentItem
    )}`;
    const deliveryItemNodeId = deliveryItemLookup.get(deliveryKey);
    if (deliveryItemNodeId) {
      addEdge(allEdges, adjacency, deliveryItemNodeId, nodeId, "billed-by", true);
    }
  }

  for (const row of raw.journal_entry_items_accounts_receivable) {
    const companyCode = asString(row.companyCode);
    const fiscalYear = asString(row.fiscalYear);
    const accountingDocument = asString(row.accountingDocument);
    const referenceDocument = asString(row.referenceDocument);
    const nodeId = `journal-entry:${companyCode}:${fiscalYear}:${accountingDocument}`;
    addNode(
      allNodes,
      nodeId,
      "journal-entry",
      `JE ${accountingDocument}`,
      `${toDisplayValue(row.postingDate)}`,
      rowToMetadata(row),
      true
    );
    lookup.journals.set(accountingDocument, nodeId);
    pushGenericLookup(lookup.genericIds, accountingDocument, nodeId);

    const billingNodeId = lookup.billings.get(referenceDocument);
    if (billingNodeId) {
      addEdge(allEdges, adjacency, billingNodeId, nodeId, "posted-to", true);
    }
  }

  for (const [paymentDocumentKey, rows] of paymentsByDocument.entries()) {
    const [companyCode, fiscalYear, accountingDocument] =
      paymentDocumentKey.split("|");
    const paymentNodeId = `payment:${companyCode}:${fiscalYear}:${accountingDocument}`;
    const customerIds = Array.from(
      new Set(rows.map((row) => asString(row.customer)).filter(Boolean))
    );
    const sourceDocuments = Array.from(
      new Set(
        rows
          .map((row) => asString(row.accountingDocument))
          .filter((value) => value && value !== accountingDocument)
      )
    );
    addNode(
      allNodes,
      paymentNodeId,
      "payment",
      `Payment ${accountingDocument}`,
      `${toDisplayValue(rows[0]?.clearingDate)} - ${sourceDocuments.length} invoice(s)`,
      {
        companyCode,
        fiscalYear,
        paymentDocument: accountingDocument,
        clearingDate: asString(rows[0]?.clearingDate),
        invoiceCount: sourceDocuments.length,
        customers: customerIds.join(", ")
      },
      true
    );
    lookup.payments.set(accountingDocument, paymentNodeId);
    pushGenericLookup(lookup.genericIds, accountingDocument, paymentNodeId);
  }

  for (const row of raw.journal_entry_items_accounts_receivable) {
    const companyCode = asString(row.companyCode);
    const fiscalYear = asString(row.fiscalYear);
    const accountingDocument = asString(row.accountingDocument);
    const clearingAccountingDocument = asNullableString(row.clearingAccountingDocument);
    const clearingDocFiscalYear = asNullableString(row.clearingDocFiscalYear);
    if (!clearingAccountingDocument || !clearingDocFiscalYear || clearingDocFiscalYear === "0") {
      continue;
    }

    const journalNodeId = `journal-entry:${companyCode}:${fiscalYear}:${accountingDocument}`;
    const paymentNodeId = lookup.payments.get(clearingAccountingDocument);
    if (paymentNodeId) {
      addEdge(allEdges, adjacency, journalNodeId, paymentNodeId, "cleared-by", true);
    }
  }

  for (const [nodeId] of expansions) {
    const node = allNodes.get(nodeId);
    if (node) {
      node.expandable = true;
    }
  }

  for (const [nodeId, node] of allNodes.entries()) {
    const profile = NODE_GOVERNANCE[node.kind];
    const connectionCount = (adjacency.get(nodeId) ?? new Set()).size;
    node.metadata.graphClassification = profile.classification;
    node.metadata.graphDescription = profile.description;
    node.metadata.graphSourceDatasets = profile.sourceDatasets.join(", ");
    node.metadata.graphOntologyVersion = GOVERNANCE_SUMMARY.ontologyVersion;
    node.metadata.connectionCount = connectionCount;
  }

  const initialNodes = Array.from(allNodes.values()).filter((node) => node.initial);
  const initialEdges = Array.from(allEdges.values()).filter((edge) => edge.initial);
  const stats: GraphStats = {
    totalNodes: allNodes.size,
    totalEdges: allEdges.size,
    initialNodes: initialNodes.length,
    initialEdges: initialEdges.length,
    nodeKinds: countNodeKinds(allNodes)
  };

  return {
    allNodes,
    allEdges,
    adjacency,
    expansions,
    initialNodes,
    initialEdges,
    stats,
    lookup
  };
}

export function getNodeDetails(model: DataModel, nodeId: string) {
  const node = model.allNodes.get(nodeId);
  if (!node) {
    return null;
  }

  const neighbors = Array.from(model.adjacency.get(nodeId) ?? [])
    .slice(0, 50)
    .map((neighborId) => model.allNodes.get(neighborId))
    .filter((neighbor): neighbor is GraphNode => Boolean(neighbor));
  const expansion = model.expansions.get(nodeId);
  const expansionNodes = Array.from(expansion?.nodes ?? [])
    .map((id) => model.allNodes.get(id))
    .filter((candidate): candidate is GraphNode => Boolean(candidate));
  const expansionEdges = Array.from(expansion?.edges ?? [])
    .map((id) => model.allEdges.get(id))
    .filter((candidate): candidate is GraphEdge => Boolean(candidate));

  return {
    node: {
      ...node,
      metadata: sanitizeMetadataRecord(node.metadata),
      expandable: expansionNodes.length > 0
    },
    neighbors: neighbors.map((neighbor) => ({
      ...neighbor,
      metadata: sanitizeMetadataRecord(neighbor.metadata)
    })),
    expansion: {
      nodes: expansionNodes.map((candidate) => ({
        ...candidate,
        metadata: sanitizeMetadataRecord(candidate.metadata)
      })),
      edges: expansionEdges
    }
  };
}

export function collectTraceHighlight(
  model: DataModel,
  startNodeId: string,
  _depth = 3
): string[] {
  const seen = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [
    { id: startNodeId, depth: 0 }
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current.id) || current.depth > _depth) {
      continue;
    }

    seen.add(current.id);
    const neighbors = model.adjacency.get(current.id) ?? new Set<string>();
    for (const neighborId of neighbors) {
      if (!seen.has(neighborId)) {
        queue.push({ id: neighborId, depth: current.depth + 1 });
      }
    }
  }

  return Array.from(seen);
}

export function searchNodes(model: DataModel, query: string): SearchResult[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [];
  }

  const terms = normalized.split(/\s+/).filter(Boolean);
  const results: SearchResult[] = [];

  for (const node of model.allNodes.values()) {
    const haystacks = [
      node.id.toLowerCase(),
      node.label.toLowerCase(),
      node.summary.toLowerCase(),
      JSON.stringify(node.metadata).toLowerCase()
    ];

    let score = 0;
    if (node.id.toLowerCase().includes(normalized)) {
      score += 120;
    }
    if (node.label.toLowerCase().includes(normalized)) {
      score += 90;
    }
    if (node.summary.toLowerCase().includes(normalized)) {
      score += 40;
    }

    for (const term of terms) {
      for (const haystack of haystacks) {
        if (haystack.includes(term)) {
          score += 8;
        }
      }
    }

    if (score > 0) {
      results.push({
        nodeId: node.id,
        label: node.label,
        kind: node.kind,
        summary: node.summary,
        score,
        reason:
          node.id.toLowerCase().includes(normalized)
            ? "Matched business identifier"
            : node.label.toLowerCase().includes(normalized)
              ? "Matched node label"
              : "Matched node summary or metadata"
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 12);
}

function addNode(
  collection: Map<string, GraphNode>,
  id: string,
  kind: NodeKind,
  label: string,
  summary: string,
  metadata: Record<string, JsonValue>,
  initial: boolean
): void {
  if (collection.has(id)) {
    return;
  }

  collection.set(id, {
    id,
    kind,
    label,
    summary,
    color: COLORS[kind],
    size: SIZES[kind],
    metadata,
    initial,
    expandable: false
  });
}

function addEdge(
  collection: Map<string, GraphEdge>,
  adjacency: Map<string, Set<string>>,
  source: string,
  target: string,
  relation: string,
  initial: boolean
): void {
  const id = edgeId(source, target, relation);
  if (collection.has(id)) {
    return;
  }

  collection.set(id, {
    id,
    source,
    target,
    relation,
    label: titleFromKey(relation),
    color: initial ? "rgba(59, 130, 246, 0.18)" : "rgba(100, 116, 139, 0.22)",
    initial
  });
  addNeighbor(adjacency, source, target);
  addNeighbor(adjacency, target, source);
}

function addNeighbor(
  adjacency: Map<string, Set<string>>,
  source: string,
  target: string
): void {
  const neighbors = adjacency.get(source) ?? new Set<string>();
  neighbors.add(target);
  adjacency.set(source, neighbors);
}

function addExpansion(
  expansions: Map<string, ExpansionPayload>,
  nodeId: string,
  expansionNodeId: string,
  ...edgeIds: string[]
): void {
  const payload = expansions.get(nodeId) ?? {
    nodes: new Set<string>(),
    edges: new Set<string>()
  };
  payload.nodes.add(expansionNodeId);
  for (const currentEdgeId of edgeIds) {
    payload.edges.add(currentEdgeId);
  }
  expansions.set(nodeId, payload);
}

function edgeId(source: string, target: string, relation: string): string {
  return `${source}->${target}:${relation}`;
}

function rowToMetadata(row: Row | undefined): Record<string, JsonValue> {
  if (!row) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, toMetadataValue(value)])
  );
}

function toMetadataValue(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  const numericValue = safeNumber(value);
  if (numericValue !== null) {
    return numericValue;
  }

  return toDisplayValue(value);
}

function countNodeKinds(nodes: Map<string, GraphNode>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of nodes.values()) {
    counts[node.kind] = (counts[node.kind] ?? 0) + 1;
  }
  return counts;
}

function sanitizeMetadataRecord(
  metadata: Record<string, JsonValue>
): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      SENSITIVE_COLUMNS.has(key) ? maskSensitiveValue(key, value) : value
    ])
  );
}

function indexBy(rows: Row[], field: string): Map<string, Row> {
  const lookup = new Map<string, Row>();
  for (const row of rows) {
    lookup.set(asString(row[field]), row);
  }
  return lookup;
}

function indexManyBy(rows: Row[], field: string): Map<string, Row[]> {
  const lookup = new Map<string, Row[]>();
  for (const row of rows) {
    const key = asString(row[field]);
    const list = lookup.get(key) ?? [];
    list.push(row);
    lookup.set(key, list);
  }
  return lookup;
}

function paymentKey(companyCode: string, fiscalYear: string, accountingDocument: string): string {
  return `${companyCode}|${fiscalYear}|${accountingDocument}`;
}

function pushGenericLookup(
  lookup: Map<string, string[]>,
  key: string,
  nodeId: string
): void {
  const values = lookup.get(key) ?? [];
  if (!values.includes(nodeId)) {
    values.push(nodeId);
    lookup.set(key, values);
  }
}
