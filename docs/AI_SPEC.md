# AI spec — HLT-06 · Claim Denial & Appeal-Letter Assistant (Provider)

## Phase 3 implementation contract
Use the hosted GLM API through `GLM_API_KEY`, `GLM_BASE_URL`, and `GLM_MODEL`; do not use Ollama or a local model. The Python FastAPI service accepts structured claim, denial, and evidence records from Node.js and never connects to SQLite or Prisma. Its bounded LangGraph flow validates input, classifies denials, maps evidence requirements, extracts exact evidence spans, drafts appeal arguments, and independently checks each argument against its cited source. Untrusted document text is data, never instructions. Only verified evidence for the supplied claim can support draft arguments. No RAG or document ingestion is included in Phase 3; RAG is deferred to Phase 4. A specialist must review every generated draft.

## The requirement (from the BRD)
Denial classification + grounded appeal drafting that cites only real record evidence (no made up clinical claims). Guardrail: specialist finalises. Eval denial-reason accuracy + appeal groundedness on sample denials.

## Pattern to use
**Denial-reason analysis + grounded appeal drafting**

Reference patterns + guardrails: `../../00_PROGRAM/TECH_STACK_AND_AI_PLAYBOOK.md`

## System architecture — build these parts explicitly
1. **Denial Classifier** — Parses the denial reason/code.
2. **Evidence Mapper** — What's needed to rebut it.
3. **Record Puller (grounded)** — Supporting facts from the record.
4. **Appeal Drafter (LLM)** — Grounded letter with citations.
5. **Specialist Review** — Finalise/approve.

**Pipeline:** Denial in → Classify reason → Map evidence → Pull facts (grounded) → Draft appeal (cite) → Specialist finalise

**What makes this complex (don't skip):**
- Appeal cites only real evidence
- No made up clinical statements
- Denial-reason accuracy measured
- Appeal-success likelihood (stretch)

## Platform bar — every project must clear this (top-level)
- **Join the parts into one simple pipeline** — Use LangGraph to connect the parts into one clear flow — a few nodes is plenty. Put a limit on every loop and retry.
- **Use a fixed data shape at every step** — Pass data between parts in a fixed Pydantic shape. Check every AI output; fix or reject it if it's wrong.
- **Keep the run's state** — Save the run's state (LangGraph state) so a step can resume. A simple store is fine — no fancy memory needed.
- **Knowledge base + good search** — If the project uses RAG: load the knowledge base into Chroma with LangChain, search by keyword and by meaning, and show where each answer came from. Re-ranking is a nice-to-have.
- **A small test set for the AI** — Make a small golden set — about 6–10 examples with the right answers — and score your AI on it (RAGAS for RAG). Show the score.
- **Fail the run on bad scores** — If the score is below your bar, the run fails. A broken AI must not pass quietly.
- **A quick safety check** — Run a short prompt-injection check (about a dozen prompts with PyRIT or garak) and mask obvious PII with Presidio. For risky steps, wrap the AI in fixed rules so it never makes the dangerous choice alone.
- **See what it's doing** — Trace the main steps with OpenTelemetry (view in Jaeger, or just the console to start): prompt, time and cost. Add a backup for when the model is busy.

## Build it with these open-source tools (no paid accounts)
| Tool | Licence | What you use it for |
|---|---|---|
| **LangGraph** | MIT | Connect the parts into one clear, bounded state-graph — this is your orchestration. |
| **LangChain** | MIT | LLM calls, prompts, tool-calling, retrievers and output parsing. |
| **Pydantic** | MIT | The fixed data shape (schema) between every part; check and repair AI outputs. |
| **GLM API** | Hosted provider API | Classify free-text denials and produce validated structured evidence analysis and draft arguments. |
| **Docling** | MIT | Parse PDFs / DOCX / scanned files into clean text + tables for ingestion. |
| **OpenTelemetry** | Apache-2.0 | Trace the main steps — prompt, time, cost. Start with the console; Jaeger is optional. |
| **OpenLLMetry** | Apache-2.0 | One line to send OTel spans for your LLM/LangChain calls (adds token + cost). |
| **Jaeger** | Apache-2.0 | Optional local viewer for the traces (run it in Docker when you want a UI). |
| **Presidio** | MIT | Mask the obvious PII / PHI in inputs, logs and prompts. |
| **PyRIT** | MIT | A short prompt-injection / jailbreak check (about a dozen prompts) that must pass. |
| **garak** | Apache-2.0 | A quick scan for injection / leak weaknesses (a light scan is fine). |
| **pytest** | MIT | Unit, integration, negative and authorization/isolation tests. |

**Architecture note (this project uses: document ingestion):** Keep your existing Node/Express app for the product API + auth (reused from the Foundation) and the React frontend as-is — that's most of the app, already done. Add one small Python FastAPI "AI service" (a handful of endpoints) that runs the LangGraph pipeline and the AI tools; the Node app calls it over HTTP. That's the only new runtime.

Keep the model provider behind a small adapter so a hosted API could be swapped in later without rewriting your app.

## Build checklist
- [ ] Choose the right pattern (don't prompt-stuff what should be RAG; don't agent-ify what's one call).
- [ ] **Grounding:** answer only from retrieved/real data; **cite** the source.
- [ ] **Refusal:** when the data can't support an answer, refuse/escalate — don't guess.
- [ ] **Structured output** where a machine consumes the result (validate the JSON).
- [ ] **Deterministic guardrails** for anything safety-/money-critical — the LLM must not make the dangerous call alone.
- [ ] **Observability:** log prompt, tokens, latency and cost per AI call; add a fallback for model failure/rate-limits.

## Eval plan (required — you report these numbers in the demo)
Primary metric(s) from the brief:
- Denial-reason classification accuracy
- Appeal groundedness
- Evidence-completeness of drafts

- Put labelled cases in `../evals/eval_set.json` and grow the set.
- Measure the metric above (e.g. field accuracy / answer + citation correctness / precision@k /
  groundedness / red-flag catch rate).
- Where the brief is safety-critical, the safety metric (e.g. red-flag catch) must be **100%** to pass.

## Phase 4 document processing and RAG

Node remains the application source of truth and owns JWT authorization, claim ownership checks, file uploads, SQLite/Prisma Document and Evidence rows, and validation before appeal persistence. It passes Python only a generated storageKey under the shared uploads directory, and protects every internal Python endpoint with AI_SERVICE_TOKEN. Python never connects to SQLite.

Docling extracts PDF/DOCX content while preserving page and section provenance. Text is split into source-located chunks; each Chroma record includes claimId, documentId, evidenceId, source document name/reference, page number, section name, and text. Chroma uses a persistent local directory and filters every query by claimId, optionally documentId. An embedding model is configured separately from the GLM chat model using EMBEDDING_MODEL, EMBEDDING_BASE_URL, and EMBEDDING_API_KEY. The MVP default is OpenAI `text-embedding-3-small` at `/v1/embeddings`; GLM chat completion is not treated as an embedding endpoint.

RAG hits are revalidated against Node-owned Evidence and Document rows. The workflow only returns a grounded appeal when its material argument statements pass independent validation against exact evidence spans. Before saving, Node checks evidence/claim/document IDs, source reference, page/section metadata, and excerpt containment; a failed check returns validation errors and stores no letter. All retrieved document text remains untrusted input and cannot override workflow instructions.
