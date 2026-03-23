import assert from "node:assert/strict";
import type { Database } from "sql.js";
import { buildDataModel } from "../services/data-model.js";

async function main() {
  const model = await buildDataModel(process.cwd());

  const topProducts = execSingle(
    model.db,
    `
      SELECT product_id, billing_document_count
      FROM v_product_billing_stats
      ORDER BY billing_document_count DESC, total_billed_amount DESC, product_id
      LIMIT 2
    `
  );
  assert.equal(topProducts.length, 2);
  assert.equal(Number(topProducts[0].billing_document_count), 22);
  assert.equal(Number(topProducts[1].billing_document_count), 22);

  const deliveredNotBilled = execSingle(
    model.db,
    `
      SELECT COUNT(*) AS anomaly_count
      FROM v_flow_anomalies
      WHERE anomaly_type = 'DELIVERED_NOT_BILLED'
    `
  );
  assert.equal(Number(deliveredNotBilled[0].anomaly_count), 13);

  const billedWithoutDelivery = execSingle(
    model.db,
    `
      SELECT COUNT(*) AS anomaly_count
      FROM v_flow_anomalies
      WHERE anomaly_type = 'BILLED_WITHOUT_DELIVERY'
    `
  );
  assert.equal(Number(billedWithoutDelivery[0].anomaly_count), 0);

  const billedNotPaid = execSingle(
    model.db,
    `
      SELECT COUNT(DISTINCT billing_document) AS billing_count
      FROM v_flow_anomalies
      WHERE anomaly_type = 'BILLED_NOT_PAID'
    `
  );
  assert.equal(Number(billedNotPaid[0].billing_count), 3);

  console.log("Dataset verification passed.");
  console.log(
    `Loaded ${model.graph.stats.totalNodes} nodes and ${model.graph.stats.totalEdges} edges.`
  );
}

function execSingle(db: Database, sql: string): Array<Record<string, unknown>> {
  const result = db.exec(sql)[0];
  if (!result) {
    return [];
  }

  return result.values.map((row: unknown[]) =>
    Object.fromEntries(
      row.map((value, index) => [result.columns[index], value])
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
