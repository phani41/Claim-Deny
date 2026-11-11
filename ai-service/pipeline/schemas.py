from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel


class StrictModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        strict=True,
        str_strip_whitespace=True,
    )


DenialCategory = Literal[
    "MEDICAL_NECESSITY",
    "MISSING_INFORMATION",
    "AUTHORIZATION_REQUIRED",
    "CODING",
    "ELIGIBILITY",
    "OTHER",
]


class AppealClaim(StrictModel):
    id: str = Field(min_length=1, max_length=64)
    claim_number: str = Field(min_length=1, max_length=40)
    payer_name: str = Field(min_length=1, max_length=120)
    patient_name: str | None = Field(default=None, max_length=120)
    hospital_name: str | None = Field(default=None, max_length=120)
    service_date: date
    amount: Decimal = Field(gt=Decimal("0"), max_digits=12, decimal_places=2)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    procedure_codes: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("service_date", mode="before")
    @classmethod
    def parse_service_date(cls, value: Any) -> date:
        if isinstance(value, date):
            return value
        if isinstance(value, str):
            try:
                return date.fromisoformat(value)
            except ValueError:
                pass
        raise ValueError("serviceDate must be an ISO date.")

    @field_validator("amount", mode="before")
    @classmethod
    def parse_decimal_amount(cls, value: Any) -> Decimal:
        if isinstance(value, Decimal):
            return value
        if isinstance(value, str):
            try:
                return Decimal(value)
            except (InvalidOperation, ValueError):
                pass
        raise ValueError("amount must be a decimal string.")

    @field_validator("currency")
    @classmethod
    def normalize_currency(cls, value: str) -> str:
        return value.upper()

    @field_validator("procedure_codes")
    @classmethod
    def clean_codes(cls, values: list[str]) -> list[str]:
        return [value.strip()[:30] for value in values if value.strip()]


class DenialRecord(StrictModel):
    id: str | None = Field(default=None, min_length=1, max_length=64)
    code: str | None = Field(default=None, min_length=1, max_length=32)
    reason_text: str = Field(min_length=1, max_length=4000)
    denial_date: date | None = None
    reason_title: str | None = Field(default=None, max_length=200)
    category: DenialCategory | None = None

    @field_validator("denial_date", mode="before")
    @classmethod
    def parse_denial_date(cls, value: Any) -> date | None:
        if value is None or isinstance(value, date):
            return value
        if isinstance(value, str):
            try:
                return date.fromisoformat(value)
            except ValueError:
                pass
        raise ValueError("denialDate must be an ISO date.")


class EvidenceRequirementInput(StrictModel):
    evidence_type: str = Field(min_length=1, max_length=48)
    required: bool = True
    guidance: str | None = Field(default=None, max_length=500)

    @field_validator("evidence_type")
    @classmethod
    def normalize_evidence_type(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9_.-]{0,47}", normalized):
            raise ValueError("evidenceType must be a short identifier.")
        return normalized


class RetrievedEvidence(StrictModel):
    id: str = Field(min_length=1, max_length=64)
    claim_id: str = Field(min_length=1, max_length=64)
    evidence_type: str = Field(min_length=1, max_length=48)
    source_label: str = Field(min_length=1, max_length=160)
    source_reference: str | None = Field(default=None, max_length=160)
    content: str = Field(min_length=1, max_length=20000)
    source_date: date | None = None
    verified: bool = False
    document_id: str | None = Field(default=None, max_length=64)
    document_name: str | None = Field(default=None, max_length=255)
    page_number: int | None = Field(default=None, ge=1)
    section_name: str | None = Field(default=None, max_length=200)

    @field_validator("source_date", mode="before")
    @classmethod
    def parse_source_date(cls, value: Any) -> date | None:
        if value is None or isinstance(value, date):
            return value
        if isinstance(value, str):
            try:
                return date.fromisoformat(value)
            except ValueError:
                pass
        raise ValueError("sourceDate must be an ISO date.")

    @field_validator("evidence_type")
    @classmethod
    def normalize_evidence_type(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9_.-]{0,47}", normalized):
            raise ValueError("evidenceType must be a short identifier.")
        return normalized


class WorkflowRequest(StrictModel):
    claim: AppealClaim
    denial: DenialRecord
    available_evidence: list[RetrievedEvidence] = Field(default_factory=list, max_length=50)
    required_evidence: list[EvidenceRequirementInput] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def validate_claim_scope_and_size(self) -> "WorkflowRequest":
        evidence_ids = [item.id for item in self.available_evidence]
        if len(evidence_ids) != len(set(evidence_ids)):
            raise ValueError("Evidence identifiers must be unique.")
        if any(item.claim_id != self.claim.id for item in self.available_evidence):
            raise ValueError("Evidence records must belong to the supplied claim.")
        if any(item.verified and not item.source_reference for item in self.available_evidence):
            raise ValueError("Verified evidence must include its original source reference.")
        requirement_types = [item.evidence_type for item in self.required_evidence]
        if len(requirement_types) != len(set(requirement_types)):
            raise ValueError("Required evidence types must be unique.")
        total_chars = sum(len(item.content) for item in self.available_evidence)
        if total_chars > 80000:
            raise ValueError("Evidence content exceeds the request limit.")
        return self


class DenialClassification(StrictModel):
    code: str | None = Field(default=None, max_length=32)
    category: DenialCategory
    reason: str = Field(min_length=1, max_length=500)
    confidence: float = Field(ge=0.0, le=1.0)
    basis: Literal["CURATED_REFERENCE", "GLM", "Ollama", "OLLAMA", "UNCLASSIFIED", "DEMO_FALLBACK"]
    requires_review: bool = False


class EvidenceRequirement(StrictModel):
    evidence_type: str
    required: bool
    guidance: str | None = None
    satisfied: bool
    evidence_ids: list[str] = Field(default_factory=list)


class AvailableEvidence(StrictModel):
    id: str
    claim_id: str
    evidence_type: str
    source_label: str
    source_reference: str
    source_date: date | None = None
    verified: bool
    document_id: str | None = None
    document_name: str | None = None
    page_number: int | None = Field(default=None, ge=1)
    section_name: str | None = None


class EvidenceFinding(StrictModel):
    evidence_id: str
    source_reference: str
    quote: str = Field(min_length=1, max_length=2000)
    document_id: str | None = None
    document_name: str | None = None
    page_number: int | None = Field(default=None, ge=1)
    section_name: str | None = None


class EvidenceAnalysis(StrictModel):
    findings: list[EvidenceFinding] = Field(default_factory=list)
    discarded_finding_count: int = 0
    messages: list[str] = Field(default_factory=list)


class DraftArgument(StrictModel):
    text: str = Field(min_length=1, max_length=1200)
    citation_ids: list[str] = Field(min_length=1, max_length=5)

    @field_validator("text")
    @classmethod
    def require_single_line_statement(cls, value: str) -> str:
        if any(ord(character) < 32 for character in value):
            raise ValueError("Draft statements must be single-line text.")
        return value


class EvidenceCitation(StrictModel):
    evidence_id: str
    source_reference: str
    source_label: str
    evidence_type: str
    source_date: date | None = None
    excerpt: str
    document_id: str | None = None
    document_name: str | None = None
    page_number: int | None = Field(default=None, ge=1)
    section_name: str | None = None


class GroundingFact(StrictModel):
    statement: str
    supported: bool
    evidence_ids: list[str] = Field(default_factory=list)
    explanation: str = Field(max_length=500)


class GroundingValidation(StrictModel):
    status: Literal["PASSED", "FAILED", "UNVERIFIED"]
    grounded: bool
    facts: list[GroundingFact] = Field(default_factory=list)
    messages: list[str] = Field(default_factory=list)


class AppealDraft(StrictModel):
    subject: str
    content: str
    argument_points: list[DraftArgument] = Field(default_factory=list)
    citations: list[EvidenceCitation] = Field(default_factory=list)
    status: Literal["DRAFT", "REQUIRES_CORRECTION"]
    grounded: bool
    requires_specialist_review: bool = True


class ClassificationResponse(StrictModel):
    classification: DenialClassification


class AnalysisResponse(StrictModel):
    classification: DenialClassification
    evidence_requirements: list[EvidenceRequirement]
    available_evidence: list[AvailableEvidence]
    missing_evidence: list[EvidenceRequirement]
    evidence_analysis: EvidenceAnalysis


class AIWorkflowResponse(AnalysisResponse):
    appeal_draft: AppealDraft
    citations: list[EvidenceCitation]
    validation: GroundingValidation


class AIWorkflowState(StrictModel):
    mode: Literal["classify", "analyze", "generate"]
    request: WorkflowRequest
    is_demo_fallback: bool = False
    classification: DenialClassification | None = None
    evidence_requirements: list[EvidenceRequirement] = Field(default_factory=list)
    available_evidence: list[AvailableEvidence] = Field(default_factory=list)
    missing_evidence: list[EvidenceRequirement] = Field(default_factory=list)
    evidence_analysis: EvidenceAnalysis | None = None
    draft_arguments: list[DraftArgument] = Field(default_factory=list)
    draft_precheck_errors: list[str] = Field(default_factory=list)
    appeal_draft: AppealDraft | None = None
    validation: GroundingValidation | None = None
    workflow_result: dict[str, Any] | None = None

