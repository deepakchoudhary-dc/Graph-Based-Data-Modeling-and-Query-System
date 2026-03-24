import fs from "node:fs";
import path from "node:path";
import DatabaseConstructor from "better-sqlite3";
import type { JsonValue } from "../../shared/types.js";
import {
  collectDatasetManifest,
  hashDatasetManifest,
  resolveDataDirectory,
  type DatasetManifestEntry,
} from "./dataset-catalog.js";
import {
  buildSchemaSummary,
  buildSemanticCatalog,
  type SemanticCatalog,
  type SqliteDatabase
} from "./semantic-layer.js";
import { seedRawSchemaStream } from "./seed-stream.js";

const STORAGE_SCHEMA_VERSION = "2026.03-persistent-sqlite";

interface StoredMetadata {
  schemaVersion: string | null;
  manifestHash: string | null;
}

export interface PersistentDatabaseContext {
  db: SqliteDatabase;
  databaseFile: string;
  dataDirectory: string;
  manifestHash: string;
  manifest: DatasetManifestEntry[];
  semanticCatalog: SemanticCatalog;
  schemaSummary: string;
}

export async function initializePersistentDatabase(
  rootDirectory: string
): Promise<PersistentDatabaseContext> {
  const generatedDirectory = path.join(rootDirectory, "generated");
  const databaseFile = path.join(generatedDirectory, "o2c.sqlite");
  fs.mkdirSync(generatedDirectory, { recursive: true });

  const isOffline = !fs.existsSync(path.join(rootDirectory, "data", "sap-o2c-data")) && fs.existsSync(databaseFile);
  const dataDirectory = resolveDataDirectory(rootDirectory, isOffline);

  let manifest: DatasetManifestEntry[] = [];
  let manifestHash = "offline-mode";

  if (!isOffline) {
    manifest = collectDatasetManifest(dataDirectory);
    manifestHash = hashDatasetManifest(manifest);

    if (shouldRebuildDatabase(databaseFile, manifestHash)) {
      await rebuildPersistentDatabase(databaseFile, dataDirectory, manifestHash, manifest);
    }
  }

  const db = openServingDatabase(databaseFile);
  const semanticCatalog = buildSemanticCatalog(db);

  return {
    db,
    databaseFile,
    dataDirectory,
    manifestHash,
    manifest,
    semanticCatalog,
    schemaSummary: buildSchemaSummary(semanticCatalog)
  };
}

export function executeQuery(
  db: SqliteDatabase,
  sql: string
): {
  sql: string;
  columns: string[];
  rows: Array<Record<string, JsonValue>>;
} {
  const statement = db.prepare(sql);
  const columns = statement.columns().map((column) => column.name);
  const rows = (statement.all() as Array<Record<string, unknown>>).map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, normalizeValue(value)])
    )
  );

  return { sql, columns, rows };
}

function shouldRebuildDatabase(databaseFile: string, manifestHash: string): boolean {
  if (!fs.existsSync(databaseFile)) {
    return true;
  }

  let db: SqliteDatabase | null = null;
  try {
    db = openServingDatabase(databaseFile);
    const metadata = readMetadata(db);
    return (
      metadata.schemaVersion !== STORAGE_SCHEMA_VERSION ||
      metadata.manifestHash !== manifestHash
    );
  } catch {
    return true;
  } finally {
    db?.close();
  }
}

async function rebuildPersistentDatabase(
  databaseFile: string,
  dataDirectory: string,
  manifestHash: string,
  manifest: DatasetManifestEntry[]
): Promise<void> {
  const temporaryFile = `.tmp`;
  if (fs.existsSync(temporaryFile)) {
    fs.unlinkSync(temporaryFile);
  }

  const db = openBuildDatabase(temporaryFile);
  try {
    await seedRawSchemaStream(db, dataDirectory);
    writeMetadata(db, manifestHash, manifest);
  } catch (error) {
    db.close();
    if (fs.existsSync(temporaryFile)) {
      fs.unlinkSync(temporaryFile);
    }
    throw error;
  }

  db.close();

  if (fs.existsSync(databaseFile)) {
    fs.unlinkSync(databaseFile);
  }
  fs.renameSync(temporaryFile, databaseFile);
}

function openServingDatabase(databaseFile: string): SqliteDatabase {
  const db = new DatabaseConstructor(databaseFile);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("temp_store = MEMORY");
  db.pragma("cache_size = -32000");
  db.pragma("busy_timeout = 5000");
  return db;
}

function openBuildDatabase(databaseFile: string): SqliteDatabase {
  const db = new DatabaseConstructor(databaseFile);
  db.pragma("journal_mode = DELETE");
  db.pragma("synchronous = OFF");
  db.pragma("temp_store = MEMORY");
  db.pragma("cache_size = -32000");
  return db;
}

function ensureMetadataTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS system_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

function writeMetadata(
  db: SqliteDatabase,
  manifestHash: string,
  manifest: DatasetManifestEntry[]
): void {
  ensureMetadataTable(db);
  const upsert = db.prepare(`
    INSERT INTO system_metadata (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const entries: Array<[string, string]> = [
    ["schema_version", STORAGE_SCHEMA_VERSION],
    ["manifest_hash", manifestHash],
    ["dataset_manifest", JSON.stringify(manifest)],
    ["built_at", new Date().toISOString()]
  ];
  for (const [key, value] of entries) {
    upsert.run(key, value);
  }
}

function readMetadata(db: SqliteDatabase): StoredMetadata {
  const tableExists = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE type = 'table'
        AND name = 'system_metadata'
    `)
    .get() as { count: number } | undefined;

  if (!tableExists || Number(tableExists.count) === 0) {
    return { schemaVersion: null, manifestHash: null };
  }

  const readValue = db.prepare(`
    SELECT value
    FROM system_metadata
    WHERE key = ?
  `);

  const schemaVersion = (readValue.get("schema_version") as { value: string } | undefined)
    ?.value ?? null;
  const manifestHash =
    (readValue.get("manifest_hash") as { value: string } | undefined)?.value ?? null;

  return { schemaVersion, manifestHash };
}

function normalizeValue(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  return JSON.stringify(value);
}
