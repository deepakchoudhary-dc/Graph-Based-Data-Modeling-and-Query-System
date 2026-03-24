import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJsonlDirectory, type Row } from "../utils/jsonl.js";

export type RawDatasets = Record<string, Row[]>;

export interface DatasetManifestEntry {
  dataset: string;
  fileCount: number;
  totalBytes: number;
  latestModifiedAt: number;
}

export const DATASET_NAMES = [
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

export function resolveDataDirectory(rootDirectory: string, allowMissing = false): string {
  const extractedPath = path.join(rootDirectory, "data", "sap-o2c-data");
  if (!fs.existsSync(extractedPath) && !allowMissing) {
    throw new Error(
      `Dataset directory not found at ${extractedPath}. Extract sap-order-to-cash-dataset.zip first.`
    );
  }

  return extractedPath;
}

export function loadRawDatasetsFromDb(db: import("./semantic-layer.js").SqliteDatabase): RawDatasets {
  const datasets: RawDatasets = {};
  for (const name of DATASET_NAMES) {
    datasets[name] = db.prepare(`SELECT * FROM "${name}"`).all() as Row[];
  }
  return datasets;
}

export function loadRawDatasets(dataDirectory: string): RawDatasets {
  const datasets: RawDatasets = {};
  for (const name of DATASET_NAMES) {
    datasets[name] = readJsonlDirectory(path.join(dataDirectory, name));
  }
  return datasets;
}

export function collectDatasetManifest(
  dataDirectory: string
): DatasetManifestEntry[] {
  return DATASET_NAMES.map((dataset) => {
    const datasetDirectory = path.join(dataDirectory, dataset);
    const files = fs.existsSync(datasetDirectory)
      ? fs
          .readdirSync(datasetDirectory)
          .filter((file) => file.endsWith(".jsonl"))
          .sort()
      : [];

    let totalBytes = 0;
    let latestModifiedAt = 0;

    for (const file of files) {
      const stats = fs.statSync(path.join(datasetDirectory, file));
      totalBytes += stats.size;
      latestModifiedAt = Math.max(latestModifiedAt, stats.mtimeMs);
    }

    return {
      dataset,
      fileCount: files.length,
      totalBytes,
      latestModifiedAt
    };
  });
}

export function hashDatasetManifest(manifest: DatasetManifestEntry[]): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(manifest))
    .digest("hex");
}
