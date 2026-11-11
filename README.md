# HLT-06 · Claim Denial & Appeal-Letter Assistant (Provider)

**Domain:** Healthcare — Revenue Cycle  |  **Difficulty:** Core  |  **AI core:** Denial-reason analysis + grounded appeal drafting

> Analyse a claim denial and draft a grounded, evidence-backed appeal letter.

---

## Your mission (4 days)
You have been handed a **client brief** — start with **`BRIEF.html`** (open it in a browser: it has
the domain primer, glossary, worked example, architecture and build path laid out visually), with the
same content in **`BRD.md`**. Nobody will pre-chew the requirements for you — reading the brief and
turning it into a plan is the first thing you are graded on. Take it the whole way:

**BRD → PRD → Data model → UI/UX → Fullstack (React + Node + data + APIs) + AI Engineering → Demo.**

> **Fullstack is half the work and 45% of the marks.** See `docs/FULLSTACK_SPEC.md` for the
> frontend, backend, data and integration in the same depth as the AI spec. The AI core is
> important, but a clean data model, real APIs with auth + isolation, and a solid React UI matter
> just as much.

Build a **real, working product slice**, not a toy. Deployment is out of scope for now — run it
locally and package it cleanly.

> ### ⏱ You have 4 days — keep it lean
> You're **reusing your Foundation app** (login, dashboard, basic API, auth are already done), so most
> of the app shell is free. Spend the 4 days on the AI layers you trained on. Build **one happy path
> really well** + the AI core + a small eval + the safety check. Touch each layer (orchestration, RAG,
> evals, guardrails, tracing) but a **lean slice of each is fine** — don't gold-plate. Every project is
> **Core**: same bar for everyone.

> ### ▶ Start from your existing open code — do NOT scaffold from scratch
> You already built an open-source full-stack app in the Foundation (React + Vite SPA, Node/Express
> API, **JWT login / registration / dashboard**, logger, validation, CORS). **That is your starting
> point.** Fork/copy it as the base for this project and extend it. See `STARTER_CODE.md` in this
> folder for exactly what to reuse and what to add, and
> `../00_PROGRAM/REUSING_YOUR_OPEN_CODE.md` for the full guide. Rebuilding boilerplate you already
> have wastes a day and earns no marks — reuse it and spend your time on the data model, the UI and
> the **AI core**.

## The 4 days
| Day | Focus | You produce |
|----|-------|-------------|
| **1** | Understand & define | `docs/PRD.md` (scope with MoSCoW/RICE, honest MVP, the 2–3 success metrics), user stories + acceptance criteria as GitHub issues, UX wireframes |
| **2** | Design & backend | **Branch from your existing Foundation repo** (reuse its auth, structure, API client, middleware). Then `docs/DATA_MODEL.md` (ERD + schema), `docs/API_CONTRACT.md` (OpenAPI), this project's endpoints with validation + logging |
| **3** | Frontend + AI | React UI wired to the APIs (loading/error states) + the AI core per `docs/AI_SPEC.md`, with guardrails and the eval suite in `evals/` |
| **4** | Harden & present | integration + negative + **authorization/isolation** tests, re-run evals, README + architecture notes, **demo + system-design viva** |

See `../00_PROGRAM/4_DAY_BUILD_PLAN.md` for the hour-by-hour version and the checkpoint gates.

## What's in this folder
```
HLT-06/
├─ README.md            ← you are here
├─ BRIEF.html           ← ★ open in a browser: the full, visual brief (domain primer, glossary, architecture, build path)
├─ STARTER_CODE.md      ← reuse your existing Foundation codebase: what to keep, what to add
├─ BRD.md               ← the client brief. Understanding this is task #1 (now with a domain primer + glossary)
├─ docs/
│  ├─ PRD.md            ← template — you fill it on Day 1
│  ├─ DATA_MODEL.md     ← entity seeds + ERD skeleton — you complete it Day 2
│  ├─ API_CONTRACT.md   ← OpenAPI skeleton — you complete it Day 2
│  ├─ FULLSTACK_SPEC.md ← frontend + backend + data + integration (45% of the marks)
│  └─ AI_SPEC.md        ← your AI requirement, the pattern, guardrails, eval plan
├─ data/SEED_SPEC.md    ← what synthetic data to generate + commit a seed script
├─ evals/eval_set.json  ← eval harness seed — expand it, then report the numbers
├─ .env.example         ← copy to .env and fill in
└─ .gitignore
```

## Suggested stack — 100% open source, runs locally, no paid API keys
- **Frontend:** React (Vite) · component architecture · useState/useContext (Redux only if justified) · explicit loading/error states
- **Backend:** Node + Express · validation · structured errors · logging · CORS · **JWT auth**
- **Data:** PostgreSQL / SQLite · open vector DBs (Chroma / Qdrant / pgvector / FAISS) for embeddings (if RAG)
- **AI core (Python service):** **LangGraph + LangChain** orchestration · **Pydantic** schemas · **Ollama** local LLM · **Docling** for documents · **Chroma** + **RAGAS** for RAG · **Presidio** for PII · **PyRIT + garak** for safety · **OpenTelemetry** + **Jaeger** for tracing. Full list + licences in `docs/AI_SPEC.md`.
- **AI build rule:** ground every answer, cite sources, refuse when unsupported, build evals.
- Full reference: `../00_PROGRAM/TECH_STACK_AND_AI_PLAYBOOK.md`
- **Licence:** this kit is MIT-licensed (`LICENSE`) — use it, change it, keep your work.

## Ground rules
- **Synthetic data only.** No real customer / patient / financial PII, ever.
- The AI must be **grounded** — cite sources, refuse when unsupported, never make up facts or figures.
- Where the brief is safety-critical, **wrap the LLM in deterministic guardrails** — the model never makes the dangerous/irreversible call alone.
- **Traceability is graded:** every requirement → a GitHub issue → commits that reference it.

## Definition of Done (aim here, not lower)
- [ ] PRD with a easy to defend MVP and the brief's success metrics
- [ ] ERD + schema that fit the domain; PII handled
- [ ] OpenAPI contract; endpoints with validation, errors, logging, JWT
- [ ] React app wired to the real APIs with honest states
- [ ] The AI core works, is **grounded + guardrailed**, and has an **eval suite with reported numbers**
- [ ] Integration + negative + **authorization/isolation** tests pass
- [ ] README (how to run) + architecture notes; every issue traces to code
- [ ] You can **defend** the data model, the AI design, and the safety in the viva
