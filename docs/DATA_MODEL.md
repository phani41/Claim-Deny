# HLT-06 data model

This schema is implemented in backend/prisma/schema.prisma. All sample records are synthetic. IDs are generated string keys except stable denial-reason codes and composite keys noted below.

## Entities and keys

- User: id (PK), unique email, displayName, passwordHash, role (PROVIDER, REVIEWER, ADMIN), createdAt, updatedAt. Password hashes are never returned by the API.
- Claim: id (PK), ownerId (FK to User), claimNumber, payerName, serviceDate, amount (Prisma Decimal / SQLite DECIMAL), currency, status (ClaimStatus), createdAt, updatedAt. claimNumber is unique per owner.
- Denial: id (PK), claimId (FK to Claim), denialReasonCode (FK to DenialReason.code), reasonText, status (DenialStatus), denialDate, payerReference, createdAt, updatedAt.
- DenialReason: code (PK), title, description, active, createdAt, updatedAt.
- DenialReasonEvidenceRule: composite PK (denialReasonCode, evidenceType), required, guidance, createdAt, updatedAt. This small join table stores the typed evidence checklist without a JSON field or rule engine.
- Document: id (PK), claimId (FK to Claim), uploadedById (FK to User), type, originalName, unique storageKey, mimeType, sizeBytes, status (DocumentStatus), pageCount, sectionNamesJson, processingError, createdAt, updatedAt. File paths are internal and never returned by the API.
- Evidence: id (PK), claimId (FK to Claim), createdById (FK to User), optional documentId (FK to Document), type (EvidenceType), sourceLabel, summary, optional extracted content/sourceReference/pageNumber/sectionName, sourceDate, createdAt, updatedAt. One uploaded document creates source-located Evidence rows; manual metadata entries remain supported.
- AppealLetter: id (PK), claimId (FK to Claim), authorId (FK to User), optional reviewerId (FK to User), optional unique generationKey for idempotent creation, subject, content, status (AppealLetterStatus), grounded, requiresCorrection, reviewedAt, createdAt, updatedAt.
- AppealCitation: composite PK (appealLetterId, evidenceId), excerpt, createdAt, updatedAt. It joins an appeal letter to the evidence supporting it.

## Relationships and authorization

- User 1-to-many Claim, Evidence, authored AppealLetter, and reviewed AppealLetter.
- Claim 1-to-many Denial, Evidence, and AppealLetter. Multiple denials on one claim are supported.
- Claim 1-to-many Document; Document 1-to-many extracted Evidence segments. A Chroma chunk points to the owning claim, document, and Evidence segment but is not an application source of truth.
- DenialReason 1-to-many Denial and DenialReasonEvidenceRule.
- AppealLetter many-to-many Evidence through AppealCitation. A draft edit clears `grounded`; final approval stores the assigned reviewer and reviewedAt timestamp. Approved letters are immutable through the API.
- A reviewer is a User with role REVIEWER; there is no duplicate Reviewer model.
- Claim, Denial, and Evidence reads are scoped to the owning User. Evidence creation checks the claim owner. AppealLetter reads are allowed to the claim owner and the assigned reviewer. DenialReason is shared reference data for authenticated users.

Indexes support owner/status/date claim lists, owner-scoped claim number uniqueness, denial lookup by claim and reason, evidence lookup by claim/type and document/page, document lookup by claim/status, and appeal lookup by claim or reviewer/status. Financial amounts use Prisma Decimal-compatible SQLite storage. Document processing and vector indexing statuses are persisted on Document; Chroma is a rebuildable semantic index while SQLite remains authoritative.

The API accepts monetary amounts as decimal strings with no more than two fractional digits. This avoids binary floating-point conversion in the request layer. SQLite enums are enforced by Prisma Client; direct SQL writers must follow the same allowed values.
