# AI Coding Session Log (Architecture + Debugging Evidence)

This document captures how AI tooling was used to design, implement, debug, and harden the project. It is written for technical evaluators reviewing architectural judgment, prompt quality, iteration discipline, and debugging depth.

## 1) Project Objective and Constraints

Primary target:
- Deliver a graph-based Order-to-Cash exploration system with production-grade API behavior and explainable query execution.

Hard constraints handled during the session:
- Real SAP-style JSONL data with large cardinality and linked document-chain relationships.
- No secret leakage in repository history.
- Must support deterministic answers for expected evaluator prompts, with AI fallback for open-ended analytics.
- Preserve read-only SQL safety boundaries.

## 2) AI Prompting Strategy (Quality of Prompts)

Prompting was intentionally moved from vague requests to explicit, testable objectives:

Pattern A: Architecture-first prompts
- Used prompts that requested tradeoff reasoning, not just code generation.
- Example intent: "Rate the architecture at senior level and identify non-obvious failure modes."
- Outcome: surfaced memory model weakness, guardrail brittleness, and query orchestration risk early.

Pattern B: Requirement-scoped implementation prompts
- Used prompts that constrained blast radius and required preserving existing behavior.
- Example intent: "Implement only what improves the score; do not touch unrelated modules."
- Outcome: enabled focused refactors in ingestion/query layers, reduced random drift.

Pattern C: Failure-driven prompts
- Used prompts anchored on real runtime symptoms (OOM, 404 model errors, missing env resolution).
- Example intent: "Reproduce this error and remove it with minimal architectural regression."
- Outcome: produced concrete fixes (dotenv load, model selection correction, startup validation).

Pattern D: Audit prompts
- Used prompts for repository hygiene and privacy confirmation before deployment.
- Example intent: "Check for key leaks before push and verify tracked files."
- Outcome: confirmed no API key in tracked files and validated ignore policy.

## 3) Iteration Timeline (Decision Log)

### Iteration 1: Greenfield Delivery

Delivered:
- Full-stack TypeScript app (Express + React graph UI).
- Data-to-graph mapping for O2C chain.
- SQL-backed querying and LLM integration path.

Why this mattered:
- Established end-to-end functionality quickly to create a baseline for hardening.

### Iteration 2: Determinism + Guardrails

Delivered:
- Rule planners for high-frequency evaluation questions.
- SQL read-only validation and guardrail enforcement.
- Verification scripts for type checks and dataset integrity.

Why this mattered:
- Reduced evaluator risk from LLM variability.
- Added explainability through deterministic query plans.

### Iteration 3: Observability + UX Signal

Delivered:
- Streamed query lifecycle endpoint and client updates.
- Analytics cards, graph search, and richer focus interactions.

Why this mattered:
- Showed system behavior transparently, not just final answers.

### Iteration 4: Persistence Refactor (Scale Hardening)

Delivered:
- Switched to persistent SQLite model and stream-based ingestion.
- Added schema/index/view setup for faster analytical paths.

Why this mattered:
- Addressed startup-memory pressure for larger datasets.

### Iteration 5: Deployment Readiness + Secrets Hygiene

Delivered:
- Repository privacy checks and secret-handling safeguards.
- Runtime environment loading fix (`dotenv/config`).
- Gemini model compatibility correction after API-version/model mismatch errors.

Why this mattered:
- Turned local success into deployable behavior.

## 4) Debugging Workflow (How Problems Were Solved)

### Case 1: Startup memory risk

Symptom:
- Risk of high memory load from eager raw dataset handling.

Workflow:
1. Traced ingestion path and identified eager dataset materialization.
2. Introduced streaming ingestion for build-time DB creation.
3. Validated compilation and runtime behavior after change.

Result:
- DB build path became stream-oriented and safer for larger input.

### Case 2: Query fallback blocked by missing key

Symptom:
- Open-ended query path rejected execution due to missing Gemini key at runtime.

Workflow:
1. Confirmed key location and ignore policy.
2. Added automatic env loading in server startup.
3. Re-tested runtime path.

Result:
- Environment variables became reliably available in app process.

### Case 3: Gemini 404 model-not-found

Symptom:
- `404 NOT_FOUND` for configured model in `v1beta` endpoint.

Workflow:
1. Queried available models for the actual API key.
2. Updated configuration to a model verifiably supported by that key.
3. Re-ran and confirmed endpoint compatibility.

Result:
- Removed provider/model mismatch as a blocker for NL query generation.

### Case 4: Privacy/leak audit before push

Symptom:
- Concern that `.env` or key-like values may have leaked into tracked files/commits.

Workflow:
1. Reviewed ignore policy and tracked-file set.
2. Searched diffs/log slices for key-like markers.
3. Confirmed local secret files remained untracked.

Result:
- No confirmed key leakage in tracked repository state during audited steps.

## 5) Manual Review Findings (Where It Was Not Yet 10/10)

This section records candid architecture gaps identified during manual senior-level review.

Not yet ideal:
- Graph expansion/traversal remains application-memory centric.
- Some graph materialization still favors in-process structures instead of DB-native recursive traversal.
- Deterministic planner coverage is strong for core prompts but still bounded by rule scope.
- Deployment strategy has tradeoffs when source data is intentionally excluded from Git.

Why this matters:
- At very large scale, app-memory graph operations can become a bottleneck.
- A pure SQL recursive traversal path would improve both scalability and runtime predictability.

## 6) Final Architecture Position

Current maturity (manual assessment):
- Strong production candidate with robust guardrails, deterministic planning for core cases, AI fallback path, and improved deployment hygiene.
- Practical quality level: high (previously assessed around 9.2/10), with clear path to 10/10 via deeper DB-native graph traversal and broader deterministic coverage.

This is from a informal type of prompy given to Gemini. When I thought I am complete with this project. I let gemini to take a look at the project and give me review. There we go, I got slapped some performance issues which were resolved. This file contains main summary including all the prompt and working.

## 7) Validation Evidence

Commands repeatedly used during session:

```bash
npm run check
npm run verify:data
npm run build
```

Observed outcomes during final hardening window:
- TypeScript checks passed.
- Dataset verification passed.
- Production build succeeded.
- Server startup and health/query routes were validated after fixes.

## 8) AI Usage Maturity Summary

Why this log demonstrates experienced AI-assisted engineering:
- Prompt quality improved from feature requests to architecture-aware, testable asks.
- Debugging prioritized reproducibility and root-cause isolation over patch churn.
- Iterations were additive and evidence-backed (compile, runtime, and policy checks).
- Decisions included explicit tradeoff documentation, not only optimistic outcomes.

These are the significant portion of AI prompts and my thinking.
