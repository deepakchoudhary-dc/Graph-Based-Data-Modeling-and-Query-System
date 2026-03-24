# Project Report

## 1. Objective

The goal was to build a graph-based data modeling and conversational query system for the provided Order-to-Cash dataset, with strong architecture, grounded LLM behavior, graph exploration, and evaluator-grade guardrails.

This report documents how the project was built, how the requirements were interpreted, what research was done, how the implementation evolved, and how the work was planned and executed.

## 2. How The Work Was Approached

The project was not treated as a frontend-only demo or a one-off chatbot wrapper. It was approached as a proper analytical system with four layers:

1. data understanding and schema validation
2. canonical business modeling
3. graph and query runtime
4. evaluator-facing polish and hardening

The user set a very high bar from the beginning:

- complete the assignment end to end
- use the provided dataset fully
- match the reference graph+chat interface direction
- build with strong guardrails
- make the submission stand out on architecture and quality

The implementation was therefore planned in iterative passes rather than one monolithic build.

## 3. Requirement Analysis

The instructions were broken into these concrete engineering tracks:

### Functional requirements

- ingest the dataset
- define graph nodes and edges
- render a graph UI
- support node expansion and metadata inspection
- support natural-language querying
- translate natural language into structured queries dynamically
- ground answers in executed data

### Evaluation-driven requirements

- code quality and maintainability
- strong graph modeling choices
- sensible storage/database choice
- serious LLM prompting and query translation
- robust misuse prevention

### Bonus opportunities selected for depth

- natural language to SQL
- graph highlighting from query answers
- conversation memory
- streaming query lifecycle
- search over entities
- advanced graph analysis summaries

## 4. Research Performed

Before building the app, the dataset and the reference images were inspected directly in the workspace.

### 4.1 UI reference research

The supplied reference images were studied to extract the intended product shape:

- large graph canvas on the left
- chat analyst panel on the right
- node inspection card
- document-flow tracing use case
- lightweight but business-oriented visual language

### 4.2 Dataset research

The dataset zip was extracted and profiled locally. Every JSONL directory was enumerated and sampled.

The research established:

- available entities
- row counts by source
- field shapes
- candidate join keys
- which joins were real in this dataset rather than assumed from generic SAP knowledge

### 4.3 Join validation research

Instead of assuming the document flow, the joins were validated programmatically.

The confirmed flow was:

`Sales Order -> Delivery -> Billing -> Journal Entry -> Payment`

Important findings:

- delivery items reference sales-order items cleanly
- billing items reference deliveries, not sales orders directly
- journal entries point back to billing documents
- payments clear journal/accounting documents

This research step was critical, because the correctness of the entire graph and query system depends on these joins.

### 4.4 Anomaly validation research

Specific anomaly counts were validated to ensure the curated views matched the real data:

- delivered but not billed
- billed without delivery
- billed but not paid

One important correction was made during hardening:

- the initial unpaid-flow logic was too broad and included cancellation noise
- the anomaly definition was tightened so unpaid billing reflects genuinely posted but uncleared billing flows

### 4.5 Architecture review and remediation research

A later production-style review surfaced four risks that needed to be corrected:

- in-memory storage was not the right long-term foundation
- backend services had become too monolithic
- regex-only SQL checks were not sufficient for privacy and abuse resistance
- generated SQL needed an automatic repair path instead of failing on first error

That critique triggered a final remediation pass focused on persistent storage, AST validation, query healing, and backend decomposition.

## 5. Planning Style

The work was planned and executed like a senior engineering delivery:

- first understand the real data model
- define canonical business views before UI work
- keep graph and SQL reasoning on the same source of truth
- make high-value evaluator paths deterministic
- let the LLM operate inside curated boundaries
- add hardening and submission artifacts only after correctness was established

The user’s prompts repeatedly pushed the standard upward:

- first for completeness
- then for differentiation
- then for UI quality
- then for graph clarity
- then for future adaptability and privacy-aware guardrails
- then for FDE-grade corrections on scale, security, and maintainability

That iterative direction materially shaped the final system.

## 6. Implementation Timeline

## Pass 1: Greenfield Build

This pass established the working system:

- project scaffolding
- backend API
- React graph UI
- data ingestion
- SQLite analytical layer
- graph construction
- initial chat interface
- Gemini-backed query path

Key decision:

- start with a local SQL layer to move quickly on business modeling, then harden the storage architecture once the semantic model was validated

## Pass 2: Query and Graph Hardening

This pass improved correctness and evaluator performance:

- deterministic rule-based plans for core questions
- graph highlighting for query answers
- analytics summary cards
- graph search
- streaming query lifecycle
- conversation memory
- richer node interactions

## Pass 3: UX Refinement

This pass improved clarity:

- cleaner initial graph layout
- fewer default labels to reduce clutter
- background-click dismissal for the inspector
- better graph ergonomics and selection behavior

## Pass 4: Future-Adaptive and Privacy-Aware Hardening

This pass made the architecture more durable:

- provider abstraction for the LLM layer
- policy-driven guardrails
- curated-source enforcement for SQL
- `SELECT *` blocking
- bulk extraction defenses
- sensitive-field redaction
- node governance metadata
- ontology and policy versioning

## Pass 5: FDE-Grade Remediation

This pass corrected the main production weaknesses:

- replaced startup-only in-memory storage with a persistent SQLite semantic store in `generated/o2c.sqlite`
- added dataset-manifest hashing so the store rebuilds only when the source data changes
- added join-key indexes for the semantic layer
- extracted storage concerns into dedicated modules
- extracted deterministic rule planning into its own service
- added LLM-assisted intent classification as a second safety layer
- replaced regex-only SQL checking with AST validation using `node-sql-parser`
- blocked restricted address/contact columns even when selected through aliases
- added a one-retry SQL healing loop for failed generated queries

## 7. Architecture Decisions

### 7.1 Why persistent SQLite

The final storage design uses a persistent SQLite file built through `better-sqlite3`.

Reasons:

- it behaves like a real embedded database rather than a transient runtime cache
- it supports repeatable analytical SQL without requiring an external server
- it keeps the submission operational on a single machine while still being disk-backed
- it allows manifest-based rebuilds instead of rebuilding the full database every boot
- it is a better stepping stone for future migration to DuckDB, Postgres, or a graph-native engine if the data volume outgrows SQLite

### 7.2 Why curated views

The LLM is strongest when reasoning over business views, not raw ingestion tables.

Curated views reduced:

- hallucinated joins
- prompt complexity
- instability across prompts

### 7.3 Why a graph plus SQL model

The graph is ideal for:

- exploration
- lineage tracing
- visual inspection
- structural relationships

SQL is ideal for:

- aggregation
- ranking
- anomaly detection
- tabular evidence

Using both made the system stronger than forcing everything into only one paradigm.

### 7.4 Why hybrid rule + LLM planning

The strongest evaluator questions are known in advance.

So the system uses:

- deterministic planners for high-confidence business questions
- LLM planning for flexible open-ended analysis

This produces both reliability and adaptability.

### 7.5 Why AST validation

Regex was not treated as a serious SQL policy boundary in the final architecture.

The validator now parses generated SQL and enforces:

- only `SELECT` / CTE-based statements
- only curated semantic-layer sources
- no `SELECT *`
- no restricted address/contact columns
- policy row-limit compliance

This closed the obvious alias-based leakage path that a simpler output-key redaction approach would miss.

### 7.6 Why a healing loop

LLM-generated SQL is valuable, but a one-shot execution model is fragile.

The final pipeline therefore:

- validates the first generated SQL
- attempts execution
- if validation or execution fails, sends the failure back for one repair pass
- only returns a user-facing failure if the repaired SQL still cannot be validated safely

## 8. Graph Construction Design

The graph is not just a mirror of raw files.

It is a business-context graph built from normalized entities and relationships.

### Node categories

- commercial demand
- logistics execution
- billing and finance
- customer master-data
- product and plant master-data
- supporting planning and location nodes

### Edge semantics

Edges are business-semantic, for example:

- `placed-order`
- `contains-item`
- `fulfilled-by`
- `billed-by`
- `posted-to`
- `cleared-by`

### Governance enrichment

Each node is enriched with:

- graph classification
- source datasets
- ontology version
- connection count
- semantic-store provenance

This makes the graph more future-adaptive for later AI techniques or agent systems.

## 9. Guardrail Design

The guardrails were designed to be **policy-driven** rather than dependent on one prompt.

### Prompt-level controls

- off-topic rejection
- known-domain entity checks
- dataset-only enforcement
- bulk extraction rejection

### SQL-level controls

- read-only SQL only
- curated-view allowlist
- AST validation instead of regex-only checks
- `SELECT *` blocked
- restricted address/contact columns blocked even through aliases
- row limits enforced
- one repair attempt for failed generated SQL
- multi-statement SQL blocked

### Result-level controls

- row truncation
- sensitive-field redaction
- privacy-aware notes carried with the response

### Graph-level controls

- sensitive fields masked in node metadata returned by the inspector

This makes the system more robust even if a future LLM becomes more creative or more aggressive in query generation.

## 10. How The User Prompting Drove The Outcome

The user’s prompts shaped the work in several important ways:

### The first prompt established the ambition

The system needed to:

- use the provided dataset deeply
- be architecturally strong
- support graph exploration and dynamic NL querying
- stand out on evaluation

### Later prompts raised the quality bar

The user then pushed specifically for:

- a more advanced system
- stronger bonus-feature implementation
- cleaner graph behavior
- more refined visualization
- future adaptability
- privacy-aware guardrails
- production-grade correction of scale, security, and maintainability issues
- a final report documenting the process

That prompt pattern matters because the final system is the result of repeated quality escalation, not a single fixed brief. The last remediation pass especially came from a harsher engineering review standard rather than a basic assignment checklist.

## 11. What Was Verified

The following checks were run locally during development:

- `npm run check`
- `npm run verify:data`
- `npm run build`
- built server health checks
- query endpoint smoke tests
- AST validation smoke tests for alias-based restricted column access
- graph search endpoint tests
- streamed query endpoint tests

This ensured the project remained working while being upgraded.

## 12. What Makes The Final Submission Strong

- the data model is correct for this specific dataset
- the graph is business-semantic, not superficial
- the SQL layer is curated, persistent, and LLM-friendly
- the UI supports exploration, analytics, and conversational querying
- the guardrails are policy-driven, privacy-aware, and AST-validated
- the architecture is adaptable to future LLM/provider changes
- the project includes documentation and AI-session artifacts for submission

## 13. Final Assessment

The project was built as a serious analytical system rather than a shallow demo.

The work combined:

- dataset research
- business modeling
- graph design
- LLM orchestration
- safety design
- UX refinement
- verification discipline

The result is a submission-ready system that is not only complete, but also structured to remain useful as the AI layer evolves over time.
