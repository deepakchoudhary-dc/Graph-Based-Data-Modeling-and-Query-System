import type DatabaseConstructor from "better-sqlite3";
import { toDbValue } from "../utils/jsonl.js";
import { DATASET_NAMES, type RawDatasets } from "./dataset-catalog.js";

export type SqliteDatabase = ReturnType<typeof DatabaseConstructor>;

export interface SemanticSource {
  name: string;
  description: string;
  columns: string[];
  restrictedColumns: string[];
}

export type SemanticCatalog = Record<string, SemanticSource>;

export const CURATED_QUERY_SOURCES = [
  "v_sales_flow",
  "v_billing_flow",
  "v_product_billing_stats",
  "v_customer_revenue_stats",
  "v_flow_anomalies",
  "v_customer_master",
  "v_product_master",
  "v_document_links"
] as const;

const SOURCE_DESCRIPTIONS: Record<(typeof CURATED_QUERY_SOURCES)[number], string> = {
  v_sales_flow:
    "One row per sales-order item with downstream delivery, billing, journal-entry, and payment context.",
  v_billing_flow:
    "Billing-centric flow view that links billing documents to delivery, sales order, accounting, and payment.",
  v_product_billing_stats:
    "Product-level billing coverage and billed amount ranking.",
  v_customer_revenue_stats:
    "Customer revenue rollup with billing counts and open receivables.",
  v_flow_anomalies:
    "Curated anomaly surface for broken or incomplete order-to-cash flows.",
  v_customer_master:
    "Customer master view with address, company-code, and sales-area attributes.",
  v_product_master:
    "Product master view with descriptions and plant/storage coverage.",
  v_document_links:
    "Graph-style source-target document links spanning customer, order, delivery, billing, journal, and payment."
};

export const RESTRICTED_COLUMN_NAMES = new Set<string>([
  "address_id",
  "street_name",
  "postal_code",
  "city",
  "region",
  "country",
  "accountingClerkFaxNumber",
  "accountingClerkInternetAddress",
  "accountingClerkPhoneNumber",
  "firstName",
  "lastName",
  "businessPartnerFullName",
  "businessPartnerName",
  "organizationBpName1",
  "organizationBpName2"
]);

const ROUTING_HINTS: Array<{
  source: (typeof CURATED_QUERY_SOURCES)[number];
  keywords: string[];
}> = [
  {
    source: "v_sales_flow",
    keywords: [
      "sales order",
      "order",
      "delivery",
      "fulfillment",
      "trace",
      "flow",
      "status"
    ]
  },
  {
    source: "v_billing_flow",
    keywords: ["billing", "invoice", "journal", "accounting", "payment"]
  },
  {
    source: "v_product_billing_stats",
    keywords: ["product", "material", "top product", "highest billing"]
  },
  {
    source: "v_customer_revenue_stats",
    keywords: ["customer", "revenue", "receivable", "open amount"]
  },
  {
    source: "v_flow_anomalies",
    keywords: ["broken", "incomplete", "anomaly", "not billed", "not paid"]
  },
  {
    source: "v_document_links",
    keywords: ["relationship", "path", "linked", "graph"]
  },
  {
    source: "v_customer_master",
    keywords: ["address", "sales area", "company code", "partner"]
  },
  {
    source: "v_product_master",
    keywords: ["plant", "storage", "product master"]
  }
];

export function createRawTable(
  db: SqliteDatabase,
  tableName: string,
  rows: RawDatasets[string]
): void {
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));

  if (columns.length === 0) {
    db.exec(`CREATE TABLE "${tableName}" ("_empty" TEXT)`);
    return;
  }

  const columnSql = columns.map((column) => `"${column}" TEXT`).join(", ");
  db.exec(`CREATE TABLE "${tableName}" (${columnSql})`);

  const insertSql = `INSERT INTO "${tableName}" (${columns
    .map((column) => `"${column}"`)
    .join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
  const statement = db.prepare(insertSql);
  const insertMany = db.transaction((inputRows: RawDatasets[string]) => {
    for (const row of inputRows) {
      statement.run(...columns.map((column) => toDbValue(row[column])));
    }
  });

  insertMany(rows);
}

export function createPerformanceIndexes(db: SqliteDatabase): void {
  const indexStatements = [
    'CREATE INDEX IF NOT EXISTS idx_sales_order_headers_order ON sales_order_headers("salesOrder")',
    'CREATE INDEX IF NOT EXISTS idx_sales_order_headers_customer ON sales_order_headers("soldToParty")',
    'CREATE INDEX IF NOT EXISTS idx_sales_order_items_order_item ON sales_order_items("salesOrder", "salesOrderItem")',
    'CREATE INDEX IF NOT EXISTS idx_sales_order_items_material ON sales_order_items("material")',
    'CREATE INDEX IF NOT EXISTS idx_delivery_headers_document ON outbound_delivery_headers("deliveryDocument")',
    'CREATE INDEX IF NOT EXISTS idx_delivery_items_ref_order ON outbound_delivery_items("referenceSdDocument", "referenceSdDocumentItem")',
    'CREATE INDEX IF NOT EXISTS idx_delivery_items_document ON outbound_delivery_items("deliveryDocument", "deliveryDocumentItem")',
    'CREATE INDEX IF NOT EXISTS idx_billing_headers_document ON billing_document_headers("billingDocument")',
    'CREATE INDEX IF NOT EXISTS idx_billing_headers_accounting ON billing_document_headers("companyCode", "fiscalYear", "accountingDocument")',
    'CREATE INDEX IF NOT EXISTS idx_billing_items_document ON billing_document_items("billingDocument", "billingDocumentItem")',
    'CREATE INDEX IF NOT EXISTS idx_billing_items_ref_delivery ON billing_document_items("referenceSdDocument", "referenceSdDocumentItem")',
    'CREATE INDEX IF NOT EXISTS idx_journal_ar_document ON journal_entry_items_accounts_receivable("companyCode", "fiscalYear", "accountingDocument")',
    'CREATE INDEX IF NOT EXISTS idx_journal_ar_clearing ON journal_entry_items_accounts_receivable("companyCode", "clearingDocFiscalYear", "clearingAccountingDocument")',
    'CREATE INDEX IF NOT EXISTS idx_payments_clearing ON payments_accounts_receivable("companyCode", "clearingDocFiscalYear", "clearingAccountingDocument")',
    'CREATE INDEX IF NOT EXISTS idx_business_partners_customer ON business_partners("customer")',
    'CREATE INDEX IF NOT EXISTS idx_business_partner_addresses_partner ON business_partner_addresses("businessPartner")',
    'CREATE INDEX IF NOT EXISTS idx_products_product ON products("product")',
    'CREATE INDEX IF NOT EXISTS idx_product_descriptions_product ON product_descriptions("product", "language")'
  ];

  for (const statement of indexStatements) {
    db.exec(statement);
  }
}

export function createAnalyticsViews(db: SqliteDatabase): void {
  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

export function buildSemanticCatalog(db: SqliteDatabase): SemanticCatalog {
  return Object.fromEntries(
    CURATED_QUERY_SOURCES.map((sourceName) => {
      const pragmaRows = db
        .prepare(`PRAGMA table_info(${sourceName})`)
        .all() as Array<{ name: string }>;
      const columns = pragmaRows.map((row) => row.name);
      return [
        sourceName,
        {
          name: sourceName,
          description: SOURCE_DESCRIPTIONS[sourceName],
          columns,
          restrictedColumns: columns.filter((column) =>
            RESTRICTED_COLUMN_NAMES.has(column)
          )
        }
      ];
    })
  );
}

export function buildSchemaSummary(catalog: SemanticCatalog): string {
  return [
    "Curated business sources:",
    ...CURATED_QUERY_SOURCES.map((sourceName) => {
      const source = catalog[sourceName];
      const previewColumns = source.columns.slice(0, 8).join(", ");
      return `- ${source.name}: ${source.description} Columns: ${previewColumns}${source.columns.length > 8 ? ", ..." : ""}`;
    }),
    "",
    "Storage design:",
    "- Raw JSONL datasets are ingested into a persistent SQLite file and exposed through curated analytical views.",
    "- Queries must use curated views only; raw staging tables are blocked from user-generated SQL.",
    "",
    "Guardrails:",
    "- Only SELECT or CTE-based read queries are allowed.",
    "- SELECT * is not allowed.",
    "- Restricted address/contact columns are blocked from generated SQL.",
    "- Every generated query must stay within the curated semantic layer and row cap."
  ].join("\n");
}

export function selectRelevantSources(
  question: string,
  catalog: SemanticCatalog,
  maxSources = 4
): SemanticSource[] {
  const normalized = question.toLowerCase();
  const ranked = ROUTING_HINTS.map((hint) => ({
    source: catalog[hint.source],
    score: hint.keywords.filter((keyword) => normalized.includes(keyword)).length
  }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, maxSources)
    .map((item) => item.source);

  if (ranked.length > 0) {
    return ranked;
  }

  return CURATED_QUERY_SOURCES.slice(0, maxSources).map(
    (sourceName) => catalog[sourceName]
  );
}

export function buildTargetedSchemaSummary(
  question: string,
  catalog: SemanticCatalog
): string {
  const relevantSources = selectRelevantSources(question, catalog);
  return [
    "Relevant curated sources for this question:",
    ...relevantSources.map(
      (source) =>
        `- ${source.name}: ${source.description} Columns: ${source.columns.join(", ")}`
    ),
    "",
    "Restricted columns that must not appear in generated SQL:",
    Array.from(RESTRICTED_COLUMN_NAMES).join(", ")
  ].join("\n");
}

export function seedRawSchema(db: SqliteDatabase, rawDatasets: RawDatasets): void {
  for (const [tableName, rows] of Object.entries(rawDatasets)) {
    createRawTable(db, tableName, rows);
  }
  createPerformanceIndexes(db);
  createAnalyticsViews(db);
}

export function buildDatasetInventorySummary(): string {
  return DATASET_NAMES.map((name) => `- ${name}`).join("\n");
}
