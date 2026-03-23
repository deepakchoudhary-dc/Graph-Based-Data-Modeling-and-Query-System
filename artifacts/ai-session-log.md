# AI Session Log

This file summarizes the major AI-assisted implementation iterations used to build and refine the submission.

## Session Summary

### Pass 1: Greenfield Build

- Inspected the workspace and confirmed only the dataset zip and mockup images were present
- Extracted the dataset and profiled all JSONL sources
- Verified the real document chain in the data:
  - Sales Order -> Delivery -> Billing -> Journal Entry -> Payment
- Built a full-stack TypeScript app:
  - Express API
  - React graph UI
  - in-memory SQLite via `sql.js`
  - Gemini-backed query path

### Pass 2: Hardening

- Added deterministic rule planners for common evaluator questions
- Added SQL validation and domain guardrails
- Added dataset verification script
- Fixed anomaly logic so `BILLED_NOT_PAID` reflects genuinely posted-but-uncleared billing flows instead of cancellation noise

### Pass 3: Standout Features

- Added analytics summary cards
- Added graph search across business IDs and metadata
- Added streamed query lifecycle endpoint
- Added client-side conversation memory
- Added node-family filters and richer graph focus behavior
- Added query plan visibility in the chat UI

## Key Debugging Moments

- Corrected the compiled server start path to `dist/server/server/main.js`
- Added ambient typings for `cors` and `sql.js`
- Re-ran verification after tightening anomaly semantics
- Confirmed API health and query execution on the built server

## Commands Used for Validation

```bash
npm run check
npm run verify:data
npm run build
```

## Final Verification Outcomes

- TypeScript passed
- Dataset verification passed
- Production build passed
- Built server responded successfully on `/api/health`
- Rule-based query smoke test returned grounded product-ranking results
