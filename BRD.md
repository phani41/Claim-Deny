# BRD — HLT-06 · Claim Denial & Appeal-Letter Assistant (Provider)

> **This is a client brief, not a spec.** Read it, find the gaps, ask the questions, then write the PRD.
> **New to this industry? That's expected.** Read §0 (the primer) and §0.1 (the glossary) first —
> they explain the domain in plain English. A polished version of this brief is in **`BRIEF.html`**
> (open it in a browser).

**Domain:** Healthcare — Revenue Cycle  
**Difficulty:** Core  
**Headline AI capability:** Denial-reason analysis + grounded appeal drafting

**In one line:** Analyse a claim denial and draft a grounded, evidence-backed appeal letter.

---

## 0. Domain primer — read this first (no prior knowledge needed)
Insurers deny some provider claims, and providers lose money when denials aren't appealed well. A strong appeal matches the denial reason to evidence in the record. You're building the assistant that analyses a denial and drafts a grounded, evidence-backed appeal letter — citing only real record facts, with a specialist finalising it.

### 0.1 Glossary — the words you'll meet
- **Claim denial** — The insurer refusing to pay a claim.
- **Appeal** — Challenging a denial to overturn it.
- **Denial code / reason** — Why the claim was denied.
- **Evidence** — Record facts that rebut the denial.
- **Revenue cycle** — The money side of healthcare (billing, claims).
- **Grounded appeal** — An appeal using only real record facts.
- **Rebuttal** — The argument against the denial.
- **Recoverable value** — Money that could be won back.

### 0.2 Worked example — one trip through the finished system
A claim is denied 'not medically necessary'. The tool identifies the evidence needed, pulls from the record ('two prior conservative treatments failed; imaging shows X'), and drafts an appeal citing each fact. The billing specialist reviews, tweaks, and sends. No clinical claims are made up.

---

## 1. Business context
Payers deny claims for many reasons; providers lose revenue when denials aren't appealed well. Writing a strong appeal means matching denial reason to evidence in the record.

## 2. Problem statement
Appeals are time-consuming and inconsistent; weak appeals fail; revenue leaks.

## 3. Primary users / user types
- Revenue-cycle / billing specialist
- Provider office manager
- Compliance

## 4. Business goals (outcomes)
- Understand each denial reason precisely
- Assemble the right evidence
- Draft a strong, grounded appeal

## 5. In scope (MVP)
- Ingest denial + claim + record
- Classify the denial reason
- Map available evidence to rebut the reason
- Draft a grounded appeal letter
- Specialist review & finalise

## 6. Out of scope
- Payer submission integration
- The appeal outcome

## 7. Key functional requirements
- Parse the denial code/reason
- Identify the evidence needed to overturn it
- Pull supporting facts from the record (grounded)
- Draft the appeal citing the evidence
- Specialist edits & approves

## 8. System architecture — the parts to build
> This is a real multi-component system, not a Basic form with one AI call. Build each part
> **explicitly**, behind a typed contract, and wire them into one bounded pipeline.

1. **Denial Classifier** — Parses the denial reason/code.
2. **Evidence Mapper** — What's needed to rebut it.
3. **Record Puller (grounded)** — Supporting facts from the record.
4. **Appeal Drafter (LLM)** — Grounded letter with citations.
5. **Specialist Review** — Finalise/approve.

**Pipeline (data flow):**  Denial in → Classify reason → Map evidence → Pull facts (grounded) → Draft appeal (cite) → Specialist finalise

### 8.1 What makes THIS build complex
- Appeal cites only real evidence
- No made up clinical statements
- Denial-reason accuracy measured
- Appeal-success likelihood (stretch)

## 9. AI engineering requirement
Denial classification + grounded appeal drafting that cites only real record evidence (no made up clinical claims). Guardrail: specialist finalises. Eval denial-reason accuracy + appeal groundedness on sample denials.

### 9.1 Platform bar — every project must clear this (top-level)
- **Join the parts into one simple pipeline** — Use LangGraph to connect the parts into one clear flow — a few nodes is plenty. Put a limit on every loop and retry.
- **Use a fixed data shape at every step** — Pass data between parts in a fixed Pydantic shape. Check every AI output; fix or reject it if it's wrong.
- **Keep the run's state** — Save the run's state (LangGraph state) so a step can resume. A simple store is fine — no fancy memory needed.
- **Knowledge base + good search** — If the project uses RAG: load the knowledge base into Chroma with LangChain, search by keyword and by meaning, and show where each answer came from. Re-ranking is a nice-to-have.
- **A small test set for the AI** — Make a small golden set — about 6–10 examples with the right answers — and score your AI on it (RAGAS for RAG). Show the score.
- **Fail the run on bad scores** — If the score is below your bar, the run fails. A broken AI must not pass quietly.
- **A quick safety check** — Run a short prompt-injection check (about a dozen prompts with PyRIT or garak) and mask obvious PII with Presidio. For risky steps, wrap the AI in fixed rules so it never makes the dangerous choice alone.
- **See what it's doing** — Trace the main steps with OpenTelemetry (view in Jaeger, or just the console to start): prompt, time and cost. Add a backup for when the model is busy.

## 10. Core data entities (seed for your data model)
- Claim (id, codes[], amount)
- Denial (claimId, code, reasonText)
- DenialReason (code, rebuttalEvidenceNeeded[])
- Evidence (claimId, type, source)
- AppealLetter (claimId, text, citations[])
- Reviewer (id, approved)

## 11. Key screens (seed for your UI/UX)
- Denial intake
- Reason + required-evidence view
- Appeal draft with citations
- Review & finalise

## 12. Non-functional requirements
- Appeal cites only real evidence
- No made up clinical statements
- Human finalises

## 13. Success metrics — the 2–3 that will actually be checked
- Denial-reason classification accuracy
- Appeal groundedness
- Evidence-completeness of drafts

## 14. Suggested sample data
A denial-reason reference + 10 denied claims with records.

## 15. Stretch goals (only after the MVP is solid)
- Appeal-success likelihood estimate
- Batch-prioritise denials by recoverable value

## 16. Defend-your-design prompts (you WILL be asked these)
- Show an appeal and trace each claim to the record.
- How do you stop made up clinical justification?
- Report denial-reason accuracy.
