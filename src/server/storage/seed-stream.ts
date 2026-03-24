import path from "node:path";
import { streamJsonlDirectory, toDbValue } from "../utils/jsonl.js";
import { DATASET_NAMES } from "./dataset-catalog.js";
import { SqliteDatabase, createPerformanceIndexes, createAnalyticsViews } from "./semantic-layer.js";

export async function seedRawSchemaStream(
  db: SqliteDatabase,
  dataDirectory: string
): Promise<void> {

  for (const tableName of DATASET_NAMES) {
    const datasetPath = path.join(dataDirectory, tableName);
    let isFirstRow = true;
    let columns: string[] = [];
    let statement: any = null;
    let rowCount = 0;

    console.log(`Streaming dataset: ${tableName}`);

    try {
      db.exec('BEGIN');

      await streamJsonlDirectory(datasetPath, (row) => {
        if (isFirstRow) {
          isFirstRow = false;
          columns = Object.keys(row);
          if (columns.length === 0) {
            db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}" ("_empty" TEXT)`);
            return;
          }

          const columnSql = columns.map((column) => ` "${column}" TEXT`).join(", ");
          db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}" (${columnSql})`);

          const insertSql = `INSERT INTO "${tableName}" (${columns.map((c) => ` "${c}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
          statement = db.prepare(insertSql);
        }
        
        if (statement) {
          statement.run(...columns.map((column) => toDbValue(row[column])));
          rowCount++;
        }

        if (rowCount % 10000 === 0) {
            db.exec('COMMIT');
            db.exec('BEGIN');
        }
      });

      if (isFirstRow) {
        // Table was empty
        db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}" ("_empty" TEXT)`);
      }
      
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      console.error("Error streaming ${tableName}", err);
    }
  }

  console.log("Creating indexes and views...");
  createPerformanceIndexes(db);
  createAnalyticsViews(db);
}
