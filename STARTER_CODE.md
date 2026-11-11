# Starter code — HLT-06 · Claim Denial & Appeal-Letter Assistant (Provider)

> **Use the open code you already have. Do not scaffold a new app.**
> Your base is the open-source full-stack project you built in the Foundation
> (React + Vite SPA · Node/Express · JWT login/registration/dashboard · logger · validation · CORS).
> Full guide: `../00_PROGRAM/REUSING_YOUR_OPEN_CODE.md`.

## Step 0 — fork your base
1. Copy your Foundation repo into this folder (keep its git history or start a fresh commit).
2. Rename the app, confirm it runs (login/registration/dashboard working), then build on top.

## ✅ Reuse as-is from your base (don't rewrite these)
- Project structure + build tooling (Vite, Express entrypoint, scripts)
- **Auth**: JWT login / registration / protected routes / session handling
- The dashboard shell, routing, and layout
- API client with loading/error handling; backend middleware (logger, validation, CORS, error handler)
- `.env` loading, config, and DB connection setup

## ➕ Add for THIS project
**Data model** — replace the sample entities in your base with this project's (see `docs/DATA_MODEL.md`):
- Claim
- Denial
- DenialReason
- Evidence
- AppealLetter
- Reviewer

**API endpoints** — extend your Express app (contract in `docs/API_CONTRACT.md`):
- `GET /api/claims` — list/read Claim
- `POST /api/denials` — create/update Denial
- `GET /api/denialreasons` — list/read DenialReason
- `POST /api/evidences` — create/update Evidence
- `GET /api/appealletters` — list/read AppealLetter
- `POST /api/reviewers` — create/update Reviewer
- plus the **AI endpoint(s)** and any status/decision/review routes your functional requirements need.

**Screens** — add to your existing React app (reuse the dashboard shell + auth):
- Denial intake
- Reason + required-evidence view
- Appeal draft with citations
- Review & finalise

**AI core** — the new capability for this project (see `docs/AI_SPEC.md` for the full tool list):
- Pattern: **Denial-reason analysis + grounded appeal drafting**
- Build it as a small **Python FastAPI AI service** that your Node app calls over HTTP (your Node auth + API and the React app stay reused).
- Orchestrate with **LangGraph + LangChain**; schemas with **Pydantic**; local LLM via **Ollama**.
- If it reads documents, parse them with **Docling**. If it uses RAG, use **Chroma** + **RAGAS** evals.
- Mask PII with **Presidio**; red-team with **PyRIT + garak**; trace with **OpenTelemetry** (view in **Jaeger**).

## Keep it honest
- Every screen keeps real empty / loading / error / success states (your base already does this — don't regress it).
- Reuse your base's auth to enforce **per-user / per-tenant isolation** — and test it.
- Don't re-earn marks for boilerplate; the graded value is the data model, the UI, and the AI core.
