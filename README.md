# Dodge Order-to-Cash Context Graph

This project turns the provided SAP-style order-to-cash dataset into a queryable context graph with a graph UI and a chat analyst panel.

## What It Does

- Builds a graph from the provided JSONL datasets.
- Preserves the core flow: `Sales Order -> Delivery -> Billing -> Journal Entry -> Payment`.
- Exposes supporting master data: customers, addresses, products, plants, customer assignments, product plants, and storage locations.
- Lets users inspect nodes, expand hidden supporting nodes, and trace relationships visually.
- Accepts natural-language questions and answers them with dataset-backed SQL results.
- Rejects off-topic prompts outside the dataset domain.

## Architecture

### Backend

- `src/server/services/data-model.ts`
  - Loads every JSONL dataset from `data/sap-o2c-data`
  - Builds an in-memory SQLite model with `sql.js`
  - Creates analyst-friendly views:
    - `v_sales_flow`
    - `v_billing_flow`
    - `v_product_billing_stats`
    - `v_flow_anomalies`
    - `v_customer_master`
    - `v_product_master`
  - Builds the graph nodes, edges, adjacency index, and node-expansion map

- `src/server/services/query-service.ts`
  - Runs a hybrid planner:
    - deterministic rules for high-value O2C questions
    - Gemini SQL generation for broader open-ended analysis
  - Validates SQL before execution
  - Executes only read-only SQL
  - Grounds answers in returned rows

- `src/server/services/guardrails.ts`
  - Rejects off-topic questions
  - Blocks non-SELECT SQL

### Frontend

- `src/client/components/GraphCanvas.tsx`
  - force-directed graph exploration
  - node highlighting and fitting

- `src/client/components/NodeInspector.tsx`
  - metadata inspection
  - on-demand node expansion

- `src/client/components/ChatPanel.tsx`
  - conversation UI
  - latest SQL evidence preview
  - prompt suggestions

## Graph Modeling Decisions

### Initial graph nodes

- Customer
- Sales Order
- Sales Order Item
- Delivery
- Delivery Item
- Billing Document
- Billing Item
- Journal Entry
- Payment
- Product
- Plant

### Expansion-only nodes

- Address
- Customer Company Assignment
- Customer Sales Area Assignment
- Schedule Line
- Product Plant
- Storage Location

This keeps the initial graph readable while still using the full dataset.

## Natural Language Querying

The chat flow is:

1. Domain guardrail checks the question.
2. Rule planner tries known high-value business questions first.
3. If needed, Gemini generates safe SQL against the curated views.
4. SQL is validated and executed.
5. The answer is summarized from the returned rows only.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Add your Gemini key to `.env`:

```env
GEMINI_API_KEY=put-your-api-key-here
GEMINI_MODEL=gemini-2.5-flash
PORT=4000
```

3. Run the app:

```bash
npm run dev
```

4. Open:

- `http://localhost:5173` for the UI
- `http://localhost:4000/api/health` for the API health check

## Verification

Run the dataset verification script:

```bash
npm run verify:data
```

It checks:

- top products by billing-document coverage
- delivered-not-billed anomaly count
- billed-without-delivery anomaly count
- billed-not-paid billing count

## Example Questions

- Which products are associated with the highest number of billing documents?
- Trace the full flow for billing document 90504248.
- Identify sales orders that were delivered but not billed.
- Which billing documents are posted but not yet paid?
- Show the customers with the highest billed revenue.

## Guardrails

Example rejected prompt:

> This system is designed to answer questions related to the provided dataset only.

## Dataset Source

The app expects the extracted dataset at:

`data/sap-o2c-data`

The original zip is kept in the repo root as provided:

`sap-order-to-cash-dataset.zip`
