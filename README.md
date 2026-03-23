# Dodge AI: Order-to-Cash Context Graph

An evaluator-ready graph-based data modeling and query system for the provided SAP-style Order-to-Cash dataset.

## What Makes This Submission Strong

- Full order-to-cash graph across `Customer -> Sales Order -> Delivery -> Billing -> Journal Entry -> Payment`
- Supporting master-data context for addresses, products, plants, customer assignments, product plants, schedule lines, and storage locations
- Graph search, node expansion, metadata inspection, and node-family filters
- LLM-backed natural-language querying with read-only SQL guardrails
- Deterministic fast-path rules for high-value document-flow questions
- Streaming query UX with visible plan, SQL, row preview, and grounded final answer
- Analytics layer with process-health metrics, anomaly spotlights, top products, and top customers
- Dataset verification script for key evaluator questions
- AI session log artifact for submission packaging

## Architecture

### 1. Storage Choice

The app uses **in-memory SQLite via `sql.js`**.

Why this choice:

- The dataset is small enough to ingest quickly at startup
- SQLite gives a strong tabular reasoning layer for LLM-generated SQL
- `sql.js` avoids native database setup and keeps the project portable
- The graph and SQL layers are built from the same normalized source, which reduces model drift

### 2. Data Model

Raw JSONL datasets are loaded into base tables and then shaped into curated business views:

- `v_sales_flow`
- `v_billing_flow`
- `v_product_billing_stats`
- `v_customer_revenue_stats`
- `v_flow_anomalies`
- `v_customer_master`
- `v_product_master`
- `v_document_links`

These views are intentionally business-oriented so the LLM does not need to rediscover fragile joins at runtime.

### 3. Graph Model

#### Initial graph

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

#### Expansion-only graph

- Address
- Customer Company Assignment
- Customer Sales Area Assignment
- Schedule Line
- Product Plant
- Storage Location

This keeps the canvas readable while still using the full dataset.

### 4. Query Pipeline

The query system is hybrid:

1. Guardrail checks whether the prompt is about the provided dataset
2. Rule planner handles common high-confidence business questions
3. Gemini generates SQL for broader natural-language analysis
4. SQL is validated to allow only read-only queries
5. SQL is executed against curated views
6. The result is summarized in natural language
7. Relevant graph nodes and edges are highlighted in the UI

## LLM Prompting Strategy

The LLM is not pointed at raw tables first. It is guided toward curated views with explicit instructions to:

- stay within the dataset
- use SQLite-compatible `SELECT` or `WITH` queries only
- prefer `v_sales_flow`, `v_billing_flow`, `v_product_billing_stats`, `v_customer_revenue_stats`, and `v_flow_anomalies`
- limit result size
- reject off-topic prompts

This reduces hallucinated joins and makes generated SQL more stable.

## Guardrails

Guardrails operate at multiple layers:

- Domain keyword and business-ID checks
- Off-topic rejection for irrelevant prompts
- SQL validation blocking non-read operations
- Curated-view-first prompting
- Result-grounded answer generation only after execution

Example rejection:

> This system is designed to answer questions related to the provided dataset only.

## Advanced Features Implemented

- Natural language to SQL
- Graph-aware trace highlighting
- Streaming query lifecycle
- Conversation memory persisted in browser storage
- Searchable graph index across labels, summaries, and metadata
- Analytics summary cards and risk spotlights
- Node-family filters for graph decluttering
- SQL evidence preview in chat

## Project Structure

- `src/server/services/data-model.ts`
  Graph construction, curated SQLite views, analytics summary, graph search

- `src/server/services/query-service.ts`
  Hybrid rule + Gemini query planner, SQL execution, streamed query events

- `src/server/services/guardrails.ts`
  Prompt-domain checks and SQL safety validation

- `src/client/App.tsx`
  App-level state for graph, streaming chat, search, filters, and highlights

- `src/client/components/GraphCanvas.tsx`
  Force-directed graph canvas

- `src/client/components/AnalyticsBoard.tsx`
  Process-health dashboard and focus shortcuts

- `src/client/components/ChatPanel.tsx`
  Analyst chat, plan visibility, SQL evidence, and row preview

- `src/server/utils/verifyData.ts`
  Data verification script

- `artifacts/ai-session-log.md`
  AI-assisted development log for submission packaging

## Running Locally

### Environment

Create `.env` from `.env.example` and add your Gemini key:

```env
GEMINI_API_KEY=put-your-api-key-here
GEMINI_MODEL=gemini-2.5-flash
PORT=4000
```

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

### Production Build

```bash
npm run build
npm start
```

### Verification

```bash
npm run check
npm run verify:data
```

## Verified Behaviors

- TypeScript passes on client and server
- Dataset verification passes
- Production build passes
- Built server responds on `/api/health`
- Query API returns grounded results for evaluator-style questions

## Example Questions

- Which products are associated with the highest number of billing documents?
- Trace the full flow for billing document 90504248.
- Show sales orders that were delivered but not billed.
- Which billing documents are posted but not yet paid?
- Which customers have the highest billed revenue?
- Find the journal entry linked to billing document 90504248.

## Submission Artifacts Prepared

- Main project README
- AI session log artifact
- Working app codebase with no authentication
- Setup ready for public deployment and demo recording

## Notes

- The dataset zip is already included in the workspace root
- The app runs directly against the provided extracted data
- Gemini is the default provider because it has a usable free tier and works well for structured planning tasks
