# Dodge AI: Order-to-Cash Context Graph

An evaluator-ready graph-based data modeling and query system for the provided SAP-style Order-to-Cash dataset.

## What Makes This Strong

- Full order-to-cash graph across `Customer -> Sales Order -> Delivery -> Billing -> Journal Entry -> Payment`
- Supporting master-data context for addresses, products, plants, customer assignments, product plants, schedule lines, and storage locations
- Graph search, node expansion, metadata inspection, and node-family filters
- LLM-backed natural-language querying with read-only SQL guardrails
- Deterministic fast-path rules for high-value document-flow questions
- Streaming query UX with visible plan, SQL, row preview, and grounded final answer
- Analytics layer with process-health metrics, anomaly spotlights, top products, and top customers
- Policy-driven privacy guardrails with LLM intent classification, AST SQL validation, exfiltration blocking, and sensitive-field protection
- Model-provider abstraction so the LLM layer can evolve without rewriting graph or safety logic
- Dataset verification script for key evaluator questions
- AI session log artifact for submission packaging

## IMAGES
<img width="1905" height="916" alt="Screenshot 2026-03-24 222022" src="https://github.com/user-attachments/assets/7876f6d4-e64f-4133-af33-c191ac1670fc" />

<img width="1430" height="788" alt="Screenshot 2026-03-24 221831" src="https://github.com/user-attachments/assets/87dc1919-9557-4402-a640-e45184ebe12b" />


## Architecture

### 1. Storage Choice

The app uses a **persistent SQLite semantic store via `better-sqlite3`**.

Why this choice:

- The raw JSONL dataset is ingested into `generated/o2c.sqlite` and reused across restarts
- SQLite gives a strong local analytical layer for LLM-generated SQL without requiring an external service
- A file-backed store is more realistic and future-adaptive than rebuilding an in-memory database on every boot
- The graph and SQL layers are built from the same curated semantic layer, which reduces model drift
- Manifest-based rebuilds keep the database synchronized with dataset changes

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

### 2.1 Governance Layer

The graph and query engine now include a governance layer with:

- ontology versioning
- curated query-source allowlists
- privacy-sensitive field groups
- node governance profiles
- bulk-extraction defenses
- redaction-aware result sanitization

This keeps the system durable even if the underlying LLM provider changes later.

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

The query system is hybrid and layered:

1. Deterministic + LLM-assisted classification checks whether the prompt is about the provided dataset
2. Rule planner handles common high-confidence business questions
3. Gemini generates SQL for broader natural-language analysis
4. SQL is validated with an AST parser against the curated semantic layer
5. If the generated SQL fails validation or execution, the system performs one repair pass automatically
6. SQL is executed against persistent curated views
7. The result is summarized in natural language
8. Relevant graph nodes and edges are highlighted in the UI

## LLM Prompting Strategy

The LLM is not pointed at raw tables first. It is guided toward a targeted subset of curated views with explicit instructions to:

- stay within the dataset
- use SQLite-compatible `SELECT` or `WITH` queries only
- use curated views only and never raw staging tables
- limit result size
- avoid restricted address/contact columns
- reject off-topic prompts

This reduces hallucinated joins, shrinks prompt context, and makes generated SQL more stable.

## Guardrails

Guardrails operate at multiple layers:

- Domain keyword and business-ID checks
- Optional LLM intent classification for safety routing
- Off-topic rejection for irrelevant prompts
- Bulk extraction and dataset-dump rejection
- AST-based SQL validation blocking non-read operations
- Curated-view allowlists enforced at parse time
- `SELECT *` blocking
- restricted address/contact column blocking even through aliases
- policy-based row caps
- sensitive-field redaction in privacy-sensitive queries
- Curated-view-first prompting
- single-retry healing loop for bad generated SQL
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
- Persistent semantic store with rebuild-on-change ingestion
- Automatic SQL repair after execution failures

## Project Structure

- `src/server/services/data-model.ts`
  Graph construction, analytics summary, graph search, and node details

- `src/server/services/query-service.ts`
  Public query entrypoints

- `src/server/services/query-runtime.ts`
  Hybrid rule + Gemini orchestration, SQL healing loop, streamed query events

- `src/server/services/rule-planner.ts`
  Deterministic evaluator-grade question routing and summaries

- `src/server/services/question-classifier.ts`
  Deterministic + LLM-assisted intent and extraction-risk routing

- `src/server/services/guardrails.ts`
  Prompt-domain checks and AST SQL policy validation

- `src/server/storage/persistent-database.ts`
  Persistent SQLite build/rebuild, query execution, metadata tracking

- `src/server/storage/semantic-layer.ts`
  Curated analytical views, indexes, semantic catalog, and schema summaries

- `src/server/storage/dataset-catalog.ts`
  Dataset discovery, manifest hashing, and raw JSONL loading

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
LLM_PROVIDER=gemini
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

This project is the result of my (Skills + AI Tools). 
I have taken care of maintainability, future enchancements. This is a pure example of own skills + AI Tools. 

## One main thing I suffered is:  

My attempt to force "Zero-RAM" on the graph-builder using that dirty Proxy hack in data-model.ts was reckless. I bypassed  explicit object types, pumped raw JSON strings into functions expecting deeply parsed maps, and quite literally fucked the project by breaking the backend's type stability.

## Notes

- The dataset zip is already included in the workspace root
- The app runs directly against the provided extracted data
- Gemini is the default provider because it has a usable free tier and works well for structured planning tasks

If you find this project interesting and want to suggest some cool project or ideas, Please write to me at: dchoudhary2004@gmail.com
