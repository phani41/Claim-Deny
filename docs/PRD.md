# PRD --- HLT-06 · Claim Denial & Appeal-Letter Assistant (Provider)

**Product Requirements Document · Four-day MVP proposal**\
**Domain:** Healthcare\
**Document status:** MVP proposal; open questions require review\
**Primary capability:** Denial-reason analysis and grounded appeal
drafting

## 0. Domain context

Insurers deny provider claims for different reasons, and providers can
lose revenue when denials are not appealed effectively. A useful appeal
must connect the stated denial reason to relevant facts in the claim and
medical record. This product helps a billing or revenue-cycle specialist
classify the denial, identify supporting evidence, and prepare an
evidence-backed draft for human review.

## 1. Problem statement

Appeal preparation is time-consuming and can be inconsistent because
staff must interpret the denial, locate relevant record facts, determine
which evidence responds to the denial, and write a clear appeal. Weak or
incomplete appeals may fail to address the payer's stated reason and
contribute to avoidable revenue loss.

The product should reduce the manual effort of assembling a first draft
while making the evidence behind each factual statement visible. It must
not invent clinical facts, treat an AI-generated conclusion as verified
truth, or submit an appeal without a specialist's review.

**Problem to solve:** Given a claim, its denial information, and
available supporting records, produce a reviewable appeal draft that
correctly classifies the denial, identifies relevant evidence, and cites
only verifiable source facts.

## 2. Target users

  -----------------------------------------------------------------------
  User                    Primary need in this    Product interaction
                          MVP                     
  ----------------------- ----------------------- -----------------------
  Revenue-cycle / billing Prepare and review a    Enter denial details,
  specialist              denial appeal           inspect evidence, edit
                          efficiently             and approve a draft

  Provider office manager Understand the status   Supporting stakeholder;
                          and completeness of     status view is optional
                          appeal preparation      and not required for
                                                  the MVP

  Compliance reviewer     Optional second-line    Optional: inspect
                          review of appeal        citations and missing
                          quality and evidence    evidence; approve or
                          support                 return drafts only if
                                                  this workflow is
                                                  included
  -----------------------------------------------------------------------

**Primary user for the first release:** Revenue-cycle / billing
specialist. The provider office manager and Compliance Reviewer are
supporting stakeholders only if their workflows are included. The
required MVP human review and approval is performed by the billing
specialist.

Admin is an operational role for managing accounts, roles, and access;
advanced role-specific workflows are not required.

## 3. Goals and success metrics

The project will be evaluated on the three metrics specified in the BRD.
No numeric pass threshold is provided by the source brief, so thresholds
must be agreed before final evaluation.

  -----------------------------------------------------------------------
  Metric                  What it measures        MVP measurement
                                                  approach
  ----------------------- ----------------------- -----------------------
  Denial-reason           Whether the predicted   Compare predictions
  classification accuracy denial category matches against labelled
                          the expected category   synthetic evaluation
                                                  cases

  Appeal groundedness     Whether factual claims  Review each material
                          in the generated appeal factual statement and
                          are supported by cited  verify its citation
                          record evidence         against the source
                                                  record

  Evidence-completeness   Whether the draft       Compare included
  of drafts               includes the relevant   evidence against the
                          evidence expected for   expected evidence
                          the denial type         checklist for each case
  -----------------------------------------------------------------------

**Evaluation set:** Use the 10 synthetic denied claims suggested by the
BRD as seed data and score all 10 as the labelled golden set for
repeatable evaluation. Include ordinary cases and cases where the system
should flag missing evidence or refuse unsupported claims. Define
expected classifications and evidence before scoring. Report results by
metric and note limitations. Do not claim production-level accuracy from
this small set.

## 4. Scope and prioritisation

**RICE method:** Reach × Impact × Confidence ÷ Effort. The scores below
are relative planning estimates for this four-day sprint, not measured
user research. Scale used: Reach = expected share of MVP workflows
affected (1--5); Impact = contribution to the three required metrics
(1--3); Confidence = estimate confidence (0.5--1.0); Effort = relative
person-days (1--5). Re-score with the team if a different rubric is
required.

  ---------------------------------------------------------------------------------
  Requirement               MoSCoW                  RICE (R·I·C/E) Now / Next /
                                                                   Later
  ------------------------- ---------------- --------------------- ----------------
  Capture claim and denial  Must                  5·3·0.9/2 = 6.75 Now
  code/reason                                                      

  Load or attach synthetic  Must                  5·3·0.8/3 = 4.00 Now
  supporting record                                                
  evidence                                                         

  Classify denial reason    Must                  5·3·0.8/3 = 4.00 Now
  with a typed, validated                                          
  result                                                           

  Map denial reason to      Must                  5·3·0.8/3 = 4.00 Now
  required and available                                           
  evidence                                                         

  Draft appeal using only   Must                  5·3·0.7/4 = 2.63 Now
  available evidence and                                           
  verify                                                           

  Specialists can edit,     Must                  4·3·0.9/2 = 5.40 Now
  save, and approve a draft                                        

  Persist claims, denials,  Must                  5·3·0.8/3 = 4.00 Now
  evidence, draft and                                              
  review state                                                     

  Handle missing evidence,  Must                  4·3·0.8/2 = 4.80 Now
  invalid input, AI failure                                        
  and timeouts safely                                              

  Authentication and access Must                  4·3·0.8/3 = 3.20 Now
  control for claim                                                
  records, consistent with                                         
  the approved application                                         
  setup                                                            

  Run the golden evaluation Must                  4·3·0.9/2 = 5.40 Now
  set and report all three                                         
  metrics                                                          

  Import PDF/DOCX records   Should                3·2·0.6/3 = 1.20 Next, only if
  using a document parser                                          time permits

  Retrieval-augmented       Should /              3·2·0.6/4 = 0.90 Next, only if
  generation (RAG) over a   conditional                            needed for the
  curated evidence corpus                                          chosen data path

  Optional reviewer         Could                 2·1·0.6/3 = 0.40 Later, only if
  workflow: comments,                                              time permits or
  return-for-corrections,                                          required
  AI-assisted revision,                                            
  version history, and                                             
  audit timeline                                                   

  Batch prioritisation and  Won't for this        2·1·0.4/4 = 0.20 Later
  appeal-success likelihood sprint                                 

  Payer submission          Won't for this        1·1·0.3/5 = 0.06 Out of scope
  integration and automatic sprint                                 
  submission                                                       
  ---------------------------------------------------------------------------------

**MoSCoW meaning:** Must = required for a coherent and safe MVP; Should
= valuable if the core path is complete; Could = optional enhancement;
Won't = explicitly deferred in this sprint.

## 5. The honest MVP

Deliver one reliable vertical slice:

1.  A specialist creates a claim/denial record using synthetic data.
2.  The system identifies a denial category and explains the result in a
    structured response.
3.  The system lists evidence required for that denial and shows which
    evidence is available or missing.
4.  The AI drafts an appeal from available record facts. Each material
    factual assertion links to a source evidence item.
5.  The system flags unsupported assertions or missing evidence instead
    of filling gaps with invented details.
6.  The billing specialist can edit and save the draft, then mark it
    approved. Approval is an internal review state only. A separate
    Compliance Reviewer approval loop, return-for-corrections/rejection
    states, comments, and AI-assisted revision are optional extensions
    and should be implemented only if time permits or the project lead
    requires them.
7.  The team runs the evaluation set and reports classification
    accuracy, groundedness, and evidence-completeness.

**Technical boundary:** The suggested architecture is a React/Vite UI,
Node/Express product API, a Python FastAPI AI service, and SQLite or
PostgreSQL. Follow the stack and application conventions approved by the
team where specified. Detailed implementation choices belong in the
technical design.

**Not required to prove the MVP:** Production deployment, payer
connectivity, real patient data, a sophisticated RAG platform, or
prediction of appeal success.

## 6. User stories and acceptance criteria

Create each story as a GitHub issue. Link commits and pull requests to
the relevant issue. IDs below are suggested issue labels.

### HLT-06-01 --- Create a claim and denial

**As a billing specialist,** I want to enter claim and denial details,
so that the system has the context needed to analyse the denial.

-   Required claim identifier and denial reason/code are validated
    before submission.
-   Invalid or missing fields return actionable validation messages.
-   The saved claim and denial can be retrieved after refresh.
-   Only synthetic data is used in development and evaluation.

### HLT-06-02 --- Classify the denial reason

**As a billing specialist,** I want a structured denial classification,
so that I can understand the category being addressed.

-   The response includes a category, rationale, and any uncertainty
    supported by the workflow.
-   The response follows a defined schema; malformed model output is
    rejected or safely retried.
-   The predicted category is stored or returned for evaluation against
    the labelled case.
-   If the denial information is insufficient, the system asks for
    clarification or flags the case rather than guessing.

### HLT-06-03 --- Map required and available evidence

**As a billing specialist,** I want to see which evidence is needed and
which evidence is available, so that I can identify gaps before
drafting.

-   Each denial category maps to an explicit expected-evidence checklist
    or documented rule source.
-   Each listed available evidence item has a stable ID and source
    reference.
-   Missing expected evidence is clearly marked as missing.
-   The system does not imply that absent evidence exists in the record.

### HLT-06-04 --- Generate a grounded appeal draft

**As a billing specialist,** I want an appeal draft with source
citations, so that I can prepare a reviewable appeal without
reassembling every fact manually.

-   Each material factual claim in the draft links to a real evidence
    item and a location or excerpt where available.
-   No clinical fact is introduced unless it is supported by the
    supplied record.
-   If evidence is insufficient, the draft clearly identifies the gap
    and avoids unsupported claims.
-   AI output conforms to a typed schema; repeated failures return a
    structured error, not a fabricated draft.
-   Draft generation does not submit the appeal to a payer.

### HLT-06-05 --- Edit, save and approve the draft

**As a billing specialist,** I want to edit and save the appeal and mark
it approved, so that a human remains responsible for the final content.

-   The billing specialist can edit and save draft text.
-   The saved draft can be reopened with the latest saved edits intact.
-   The review status distinguishes at least Draft and Approved.
-   Approval records the approving billing specialist and timestamp
    where supported by the data model.
-   Approval is not represented as payer submission or a successful
    appeal outcome.

### HLT-06-06 --- Protect claim and record data

**As an authorised user,** I want access restricted to records I am
permitted to view, so that claim information is not exposed across users
or tenants.

-   Claim records are protected by the authentication and access
    controls required by the approved application setup.
-   Where the application supports multiple users or tenants, a user
    cannot read or modify another user's/tenant's claim by changing an
    ID.
-   Errors do not expose stack traces, secrets, or unnecessary sensitive
    record content.
-   Logs avoid recording raw sensitive patient information; use
    synthetic data for the capstone.

### HLT-06-07 --- Evaluate the AI workflow

**As the delivery team,** we want reproducible evaluation results, so
that the three stated success metrics can be assessed.

-   The BRD's 10 synthetic denied claims are used as seed data and as a
    labelled golden set of 10 cases for repeatable scoring, including
    missing-evidence or safe-refusal cases.
-   Expected classifications and expected evidence are defined before
    scoring.
-   The run reports classification accuracy, groundedness, and
    evidence-completeness separately.
-   Failed cases and known limitations are documented; thresholds are
    not invented or reported as approved without sign-off.

### HLT-06-08 --- Handle failure states

**As a billing specialist,** I want clear feedback when data or the AI
service is unavailable, so that I know whether I can continue safely.

-   Every screen has explicit empty, loading, error, and success states.
-   AI timeouts or service failures return a structured error and
    preserve previously saved data.
-   A failed generation cannot silently appear as a completed or
    approved appeal.
-   Retry behaviour is bounded; repeated failure is surfaced to the
    user.

## 7. Assumptions, risks and open questions

  -------------------------------------------------------------------------
  Item                    Type                    Current resolution /
                                                  action
  ----------------------- ----------------------- -------------------------
  Input formats are not   Open question           MVP begins with
  fully specified                                 structured claim/denial
                                                  fields and supplied
                                                  synthetic evidence;
                                                  confirm whether PDF/DOCX
                                                  ingestion is mandatory

  Authoritative           High risk               Use a documented, curated
  denial-to-evidence                              rule/evidence checklist
  rules are not                                   for the synthetic cases;
  identified                                      confirm the approved
                                                  source with the project
                                                  lead

  Groundedness and        High risk               Define a material claim
  citation validation                             as supported only when
  need a concrete                                 its cited evidence item
  definition                                      actually contains the
                                                  fact; verify manually for
                                                  the golden set

  No numeric thresholds   Open question           Agree thresholds with the
  are supplied for the                            reviewer before the final
  three metrics                                   evaluation; report raw
                                                  scores until then

  Four days is a short    Delivery risk           Prioritise one end-to-end
  delivery window                                 path; defer document
                                                  parsing, complex RAG,
                                                  batch workflows and
                                                  advanced analytics

  Model output may be     Safety risk             Validate structured AI
  malformed or                                    outputs, bound retries,
  unsupported                                     check evidence support,
                                                  and fail safely; document
                                                  implementation details in
                                                  the technical design

  Clinical or personal    Privacy risk            Use synthetic data only;
  data could be sensitive                         mask sensitive content in
                                                  logs; do not use real
                                                  patient records

  Review workflow is      Open question           Core MVP: Draft and
  underspecified                                  Approved by the billing
                                                  specialist. A separate
                                                  reviewer loop,
                                                  return-for-corrections,
                                                  comments, AI-assisted
                                                  revision, and version
                                                  history are optional and
                                                  require project-lead
                                                  sign-off.

  Database choice is not  Technical decision      Use the approved project
  fixed in the BRD                                database; SQLite is
                                                  acceptable for a
                                                  local-only fallback if no
                                                  contrary requirement
                                                  exists

  RAG is conditional, not Scope decision          Add RAG only if the
  automatically mandatory                         selected evidence corpus
                                                  and retrieval requirement
                                                  justify it; do not add
                                                  complexity just to use a
                                                  tool
  -------------------------------------------------------------------------

### Decisions required from the project lead

1.  What input formats must the MVP support: structured fields only, or
    PDF/DOCX too?
2.  Which source defines the correct denial category and required
    rebuttal evidence?
3.  What citation granularity is required: evidence item, excerpt,
    page/section, or all of these?
4.  What pass thresholds, if any, should be used for the three
    evaluation metrics?
5.  What database/runtime setup and application conventions have been
    approved for this capstone?

## 8. Out of scope for this sprint

-   Payer submission integration or automatic submission.
-   Predicting or claiming the eventual appeal outcome.
-   Use of real patient/customer data.
-   Replacing a qualified specialist's judgement or final approval.
-   Advanced batch prioritisation or appeal-success likelihood.
-   Production deployment, unless separately required by the reviewer.
-   Full enterprise audit/versioning features beyond the minimum review
    state and traceability needed for the MVP.

## 9. UX and operational requirements

The primary journey starts with an already-denied claim; normal payer
claim submission happens outside this product.

**Journey:** Denial intake → Classification → Required/available
evidence → Grounded draft with citations → Billing specialist
edit/save/approve.

**Core screens:** Reuse the existing Login/Registration and Dashboard;
add Denial Intake (claim/denial fields and evidence upload), Denial
Analysis & Evidence (classification, required/available/missing
evidence), Appeal Draft (editable cited letter), and Review & Finalise
(billing specialist checks, saves, and approves). Admin user management
is reused or added only as needed. A separate Compliance Reviewer
dashboard is optional. Every screen must support empty, loading, error,
and success states.

Make missing evidence and source citations easy to inspect. Validate
requests and responses, return clear errors, and protect claim records
according to the approved application setup.

The AI workflow must have defined inputs/outputs, bounded retries, and a
clear failure path. Where retrieval is used, preserve evidence
provenance and cite retrieved source records. Trace core steps, duration
and errors without logging raw sensitive data. Detailed implementation
practices and optional security checks should be documented in the
technical design.

## 10. MVP Definition of done

The MVP is ready for review when:

-   The PRD, user stories, and acceptance criteria are reviewed.
-   The primary workflow works from claim intake through saved,
    human-approved draft.
-   All citations resolve to actual synthetic evidence items.
-   Missing evidence and AI failures are surfaced safely.
-   Authentication and record isolation are tested for the implemented
    data routes.
-   At least 10 synthetic evaluation cases run reproducibly.
-   Results for all three required metrics and the failed cases are
    reported.
-   Setup steps, architecture, assumptions, and known limitations are
    documented.
-   A repeatable local demo is prepared; deployment is not required by
    this PRD.
