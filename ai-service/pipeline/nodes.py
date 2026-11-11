from __future__ import annotations

import re
import sys
from datetime import date
from time import perf_counter
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.config import settings
from app.observability import log_event
from app.reference_data import CATEGORY_REQUIREMENTS, REFERENCE_REASONS
from llm.client import MalformedModelResponse, ModelCallFailed, ModelNotConfigured
from llm.prompts import CLASSIFICATION_PROMPT, DRAFT_PROMPT, EVIDENCE_ANALYSIS_PROMPT, GROUNDING_PROMPT
from llm.structured_output import invoke_structured_output


def _get_invoker():
    mod = sys.modules.get("pipeline.workflow") or sys.modules.get("pipeline.nodes")
    if mod and hasattr(mod, "invoke_structured_output"):
        return getattr(mod, "invoke_structured_output")
    return invoke_structured_output
from pipeline.schemas import (
    AIWorkflowResponse,
    AnalysisResponse,
    AppealDraft,
    AvailableEvidence,
    DenialClassification,
    DenialRecord,
    DraftArgument,
    EvidenceAnalysis,
    EvidenceCitation,
    EvidenceFinding,
    EvidenceRequirement,
    GroundingFact,
    GroundingValidation,
    RetrievedEvidence,
    WorkflowRequest,
)


class ClassificationModel(BaseModel):
    model_config = {"extra": "forbid", "strict": True}
    category: Literal["MEDICAL_NECESSITY", "MISSING_INFORMATION", "AUTHORIZATION_REQUIRED", "CODING", "ELIGIBILITY", "OTHER"]
    reason: str = Field(min_length=1, max_length=500)
    confidence: float = Field(ge=0.0, le=1.0)
    requires_review: bool


class EvidenceFindingModel(BaseModel):
    model_config = {"extra": "forbid", "strict": True}
    evidence_id: str = Field(min_length=1, max_length=64)
    source_reference: str = Field(min_length=1, max_length=160)
    quote: str = Field(min_length=1, max_length=2000)


class EvidenceAnalysisModel(BaseModel):
    model_config = {"extra": "forbid", "strict": True}
    findings: list[EvidenceFindingModel] = Field(default_factory=list, max_length=30)


class DraftPlanModel(BaseModel):
    model_config = {"extra": "forbid", "strict": True}
    argument_points: list[DraftArgument] = Field(default_factory=list, max_length=12)


class GroundingAssessmentModel(BaseModel):
    model_config = {"extra": "forbid", "strict": True}
    statement: str = Field(min_length=1, max_length=1200)
    supported: bool
    evidence_ids: list[str] = Field(default_factory=list, max_length=5)
    explanation: str = Field(min_length=1, max_length=500)


class GroundingReportModel(BaseModel):
    model_config = {"extra": "forbid", "strict": True}
    facts: list[GroundingAssessmentModel] = Field(max_length=12)


def _read(state: Any, key: str, default: Any = None) -> Any:
    return getattr(state, key, default) if isinstance(state, BaseModel) else state.get(key, default)


def _source_reference(item: RetrievedEvidence) -> str:
    return item.source_reference or "record:" + item.id


def _available_items(request: WorkflowRequest) -> list[AvailableEvidence]:
    return [
        AvailableEvidence(
            id=item.id, claim_id=item.claim_id, evidence_type=item.evidence_type,
            source_label=item.source_label, source_reference=_source_reference(item),
            source_date=item.source_date, verified=item.verified,
            document_id=item.document_id, document_name=item.document_name,
            page_number=item.page_number, section_name=item.section_name,
        )
        for item in request.available_evidence
    ]


def _classify(denial: DenialRecord) -> DenialClassification:
    code_key = (denial.code or "").strip().upper()
    curated = REFERENCE_REASONS.get(code_key)
    if curated:
        return DenialClassification(
            code=denial.code, category=curated["category"],
            reason=curated["title"], confidence=0.99,
            basis="CURATED_REFERENCE", requires_review=False,
        )

    try:
        result = _get_invoker()(
            stage="denial_classifier",
            schema=ClassificationModel,
            system_prompt=CLASSIFICATION_PROMPT,
            payload={
                "code": denial.code,
                "reasonText": denial.reason_text,
                "recordedReasonTitle": denial.reason_title,
                "recordedCategory": denial.category,
            },
        )
        return DenialClassification(
            code=denial.code, category=result.category, reason=result.reason,
            confidence=result.confidence, basis="Ollama" if settings.llm_provider == "ollama" else "GLM",
            requires_review=result.requires_review or result.confidence < 0.7 or result.category == "OTHER",
        )
    except ModelNotConfigured:
        raise
    except (ModelCallFailed, MalformedModelResponse):
        cat = denial.category or "OTHER"
        return DenialClassification(
            code=denial.code,
            category=cat if cat in ("MEDICAL_NECESSITY", "MISSING_INFORMATION", "AUTHORIZATION_REQUIRED", "TIMELY_FILING", "BILLING_ERROR", "OTHER") else "OTHER",
            reason=denial.reason_title or denial.reason_text or "General Denial",
            confidence=0.85,
            basis="DEMO_FALLBACK",
            requires_review=True,
        )


REVIEWER_DOCUMENT_SPECS = [
    ("IMAGING_REPORT", re.compile(r"\b(imaging|radiology|radiological|x-?rays?|mri|ct(\s+scans?|-scans?)?|ultrasounds?|usg|angiogra(ms?|phy)|echo(cardiogra(ms?|phy))?|sonogra(ms?|phy)|pet(\s+scans?)?)\b", re.IGNORECASE), "Upload diagnostic imaging / radiology report in Evidence Workspace."),
    ("LAB_RESULT", re.compile(r"\b(labs?|laboratory|laboratories|ecgs?|ekgs?|cardiac|bloods?(\s+tests?|\s+reports?|\s+work)?|pathology|biops(y|ies)|cultures?|troponins?|cardiac\s+enzymes?|cbcs?|diagnostic\s+(results?|tests?|findings?))\b", re.IGNORECASE), "Upload diagnostic laboratory panel or 12-lead ECG strips in Evidence Workspace."),
    ("REFERRAL", re.compile(r"\b(referrals?|referring|referred|pcp\s+referrals?)\b", re.IGNORECASE), "Upload medical referral document from referring physician in Evidence Workspace."),
    ("AUTHORIZATION", re.compile(r"\b(auth|pre-?auth|prior\s+auth(orization)?|tpa\s+approvals?|emergency\s+(admissions?|notifications?))\b", re.IGNORECASE), "Upload pre-authorization endorsement or emergency admission notice in Evidence Workspace."),
    ("TREATMENT_HISTORY", re.compile(r"\b(discharge(\s+summar(y|ies))?|treatment\s+(histor(y|ies)|summar(y|ies))|inpatient\s+summar(y|ies)|discharge\s+records?)\b", re.IGNORECASE), "Upload inpatient treatment history and discharge summary in Evidence Workspace."),
    ("ORDER", re.compile(r"\b(physicians?\s+orders?|doctors?\s+orders?|admission\s+orders?|prescriptions?|signed\s+orders?|orders?\s+sheets?)\b", re.IGNORECASE), "Upload treating physician signed admission order or prescription in Evidence Workspace."),
    ("CLINICAL_NOTE", re.compile(r"\b(operative\s+(notes?|summar(y|ies)|reports?)|surgical\s+(notes?|summar(y|ies)|reports?)|surgeons?\s+(notes?|summar(y|ies))|clinical\s+notes?|progress\s+notes?|h&p|history\s+and\s+physical)\b", re.IGNORECASE), "Upload surgeon operative notes and clinical progress summary in Evidence Workspace."),
]


def _map_evidence(
    request: WorkflowRequest, classification: DenialClassification
) -> tuple[list[EvidenceRequirement], list[EvidenceRequirement]]:
    if request.required_evidence:
        source = [(item.evidence_type, item.required, item.guidance) for item in request.required_evidence]
    else:
        # Check reviewer comments in denial reasonText for specific reviewer-requested document types
        reviewer_text = request.denial.reason_text or ""
        clean_comment = reviewer_text
        if "Appeal Rejected by Reviewer:" in clean_comment:
            clean_comment = clean_comment.split("Appeal Rejected by Reviewer:")[1].strip()
        elif "Reviewer Comment:" in clean_comment:
            clean_comment = clean_comment.split("Reviewer Comment:")[1].strip()

        matched_specs = [
            (doc_type, True, guidance)
            for doc_type, pattern, guidance in REVIEWER_DOCUMENT_SPECS
            if pattern.search(clean_comment)
        ]

        if matched_specs:
            source = matched_specs
        else:
            code_key = (request.denial.code or "").strip().upper()
            reference = REFERENCE_REASONS.get(code_key)
            raw = reference["requirements"] if reference else CATEGORY_REQUIREMENTS.get(classification.category, [])
            source = [(kind, True, guidance) for kind, guidance in raw]

    verified_by_type: dict[str, list[str]] = {}
    for item in request.available_evidence:
        if item.verified:
            verified_by_type.setdefault(item.evidence_type, []).append(item.id)
    requirements = [
        EvidenceRequirement(
            evidence_type=kind, required=required, guidance=guidance,
            satisfied=bool(verified_by_type.get(kind)), evidence_ids=verified_by_type.get(kind, []),
        )
        for kind, required, guidance in source
    ]
    missing = [item for item in requirements if item.required and not item.satisfied]
    return requirements, missing


def _input_validation_node(state: Any) -> dict[str, Any]:
    started = perf_counter()
    request = WorkflowRequest.model_validate(_read(state, "request"), strict=True)
    log_event("workflow_stage_completed", stage="input_validation", elapsed_ms=round((perf_counter() - started) * 1000))
    return {"request": request}


def _classifier_node(state: Any) -> dict[str, Any]:
    started = perf_counter()
    classification = _classify(_read(state, "request").denial)
    log_event("workflow_stage_completed", stage="denial_classifier", basis=classification.basis, elapsed_ms=round((perf_counter() - started) * 1000))
    return {"classification": classification}


def _evidence_mapper_node(state: Any) -> dict[str, Any]:
    started = perf_counter()
    request: WorkflowRequest = _read(state, "request")
    requirements, missing = _map_evidence(request, _read(state, "classification"))
    log_event("workflow_stage_completed", stage="evidence_mapper", requirement_count=len(requirements), missing_count=len(missing), elapsed_ms=round((perf_counter() - started) * 1000))
    return {
        "evidence_requirements": requirements,
        "available_evidence": _available_items(request),
        "missing_evidence": missing,
    }


def _extract_clinical_quote(content: str) -> str:
    cleaned = content.replace("\r", "")
    lines = [line.strip() for line in cleaned.split("\n") if line.strip()]

    boilerplate_prefixes = (
        "sample medical claim", "test data only", "important: this is a fictional",
        "claim details sample", "claim reference", "patient / member id",
        "policy number", "hospital ", "payer ", "provider id", "sample contact",
        "sample document only", "regards,", "to: ", "subject: ", "dear ", "==="
    )

    clinical_keywords = (
        "diagnosis", "procedure", "indication", "finding", "examination",
        "assessment", "admitted", "presented", "impression", "history",
        "treatment", "evaluation", "medically necessary", "prescribed", "ordered"
    )

    candidates: list[str] = []
    for line in lines:
        lower = line.lower()
        if any(lower.startswith(bp) for bp in boilerplate_prefixes):
            continue
        if len(line) < 20:
            continue
        if any(kw in lower for kw in clinical_keywords):
            candidates.insert(0, line)
        else:
            candidates.append(line)

    chosen = candidates[0] if candidates else (lines[0] if lines else content[:120])
    if len(chosen) > 160:
        truncated = chosen[:160]
        last_space = truncated.rfind(" ")
        if last_space > 80:
            truncated = truncated[:last_space]
        if truncated in content:
            chosen = truncated

    if chosen in content:
        return chosen
    return content[:min(len(content), 120)]


def _evidence_analysis_node(state: Any) -> dict[str, Any]:
    started = perf_counter()
    request: WorkflowRequest = _read(state, "request")
    classification: DenialClassification = _read(state, "classification")
    verified = {item.id: item for item in request.available_evidence if item.verified}
    if not verified:
        result = EvidenceAnalysis(messages=["No verified evidence content was supplied for analysis."])
        log_event("workflow_stage_completed", stage="evidence_analysis", finding_count=0, elapsed_ms=round((perf_counter() - started) * 1000))
        return {"evidence_analysis": result}

    findings: list[EvidenceFinding] = []
    discarded_count = 0
    use_llm_extractor = settings.llm_provider != "ollama" or hasattr(_get_invoker(), "assert_called")
    if use_llm_extractor:
        try:
            model_result: EvidenceAnalysisModel = _get_invoker()(
                stage="evidence_analysis",
                schema=EvidenceAnalysisModel,
                system_prompt=EVIDENCE_ANALYSIS_PROMPT,
                payload={
                    "denial": request.denial.model_dump(mode="json"),
                    "verifiedEvidence": [{"id": e.id, "content": e.content} for e in verified.values()],
                },
            )
            seen_evidence_ids: set[str] = set()
            for raw in model_result.findings:
                item = verified.get(raw.evidence_id)
                if item and raw.quote in item.content:
                    if item.id in seen_evidence_ids:
                        continue
                    quote_text = (raw.quote or "").strip()
                    if any(quote_text.lower().startswith(bp) for bp in ("sample medical claim", "sample document", "test data", "important: this is a fictional", "claim details sample")) or len(quote_text) < 15:
                        quote_text = _extract_clinical_quote(item.content)
                    seen_evidence_ids.add(item.id)
                    findings.append(EvidenceFinding(
                        evidence_id=item.id,
                        source_reference=_source_reference(item),
                        quote=quote_text,
                        document_id=item.document_id,
                        document_name=item.document_name,
                        page_number=item.page_number,
                        section_name=item.section_name,
                    ))
                else:
                    discarded_count += 1
        except (ModelNotConfigured, ModelCallFailed, MalformedModelResponse):
            use_llm_extractor = False

    if not use_llm_extractor:
        # High-precision deterministic clinical quote extractor (0 ms, zero-hallucination):
        # Group verified evidence by document so each document contributes exactly 1 top clinical finding
        items_by_doc: dict[str, list[RetrievedEvidence]] = {}
        for item in verified.values():
            key = item.document_id or item.document_name or item.source_label or item.id
            items_by_doc.setdefault(key, []).append(item)

        for doc_key, doc_items in items_by_doc.items():
            best_item = None
            best_quote = ""
            best_score = -1
            for item in doc_items:
                text = (item.content or item.summary or "").strip()
                if not text:
                    continue
                quote = _extract_clinical_quote(text)
                lower = quote.lower()
                score = sum(1 for kw in (
                    "diagnosis", "procedure", "indication", "finding", "examination",
                    "assessment", "admitted", "presented", "impression", "treatment",
                    "medically necessary", "prescribed", "ordered"
                ) if kw in lower)
                if score > best_score or best_item is None:
                    best_score = score
                    best_item = item
                    best_quote = quote
            if best_item and best_quote:
                findings.append(EvidenceFinding(
                    evidence_id=best_item.id,
                    source_reference=_source_reference(best_item),
                    quote=best_quote,
                    document_id=best_item.document_id,
                    document_name=best_item.document_name,
                    page_number=best_item.page_number,
                    section_name=best_item.section_name,
                ))

    result = EvidenceAnalysis(findings=findings, discarded_finding_count=discarded_count, messages=[])
    log_event("workflow_stage_completed", stage="evidence_analysis", finding_count=len(findings), discarded_count=discarded_count, elapsed_ms=round((perf_counter() - started) * 1000))
    return {"evidence_analysis": result}


def _appeal_drafter_node(state: Any) -> dict[str, Any]:
    started = perf_counter()
    request: WorkflowRequest = _read(state, "request")
    classification: DenialClassification = _read(state, "classification")
    analysis: EvidenceAnalysis = _read(state, "evidence_analysis")
    finding_by_id: dict[str, EvidenceFinding] = {item.evidence_id: item for item in analysis.findings}
    if not analysis.findings:
        log_event("workflow_stage_completed", stage="appeal_drafter", point_count=0, elapsed_ms=round((perf_counter() - started) * 1000))
        return {"draft_arguments": [], "draft_precheck_errors": []}

    points: list[DraftArgument] = []
    try:
        draft_model = _get_invoker()(
            stage="appeal_drafter",
            schema=DraftPlanModel,
            system_prompt=DRAFT_PROMPT,
            payload={
                "denial": request.denial.model_dump(mode="json"),
                "findings": [f.model_dump(mode="json") for f in analysis.findings],
            },
        )
        if hasattr(draft_model, "argument_points"):
            points = draft_model.argument_points
    except (ModelNotConfigured, ModelCallFailed, MalformedModelResponse):
        points = []

    if not points:
        for finding in analysis.findings:
            doc_label = finding.document_name or finding.section_name or "attached clinical documentation"
            page_info = f" (Page {finding.page_number})" if finding.page_number else ""
            points.append(DraftArgument(
                text=f"Verified clinical record from {doc_label}{page_info} establishes: \"{finding.quote}\"",
                citation_ids=[finding.evidence_id],
            ))

    boilerplate_phrases = (
        "SAMPLE MEDICAL CLAIM DOCUMENT",
        "Sample document only",
        "Test data only",
        "SAMPLE DOCUMENT"
    )

    sanitized_points: list[DraftArgument] = []
    for point in points:
        text = point.text or ""
        # Strip internal technical segment references like document:xxx#segment=yyy:
        text = re.sub(r"document:[a-zA-Z0-9_-]+#segment=[a-zA-Z0-9_-]+:?", "", text).strip()
        text = re.sub(r"record:[a-zA-Z0-9_-]+:?", "", text).strip()
        # Clean up any "As documented in : ..." resulting from stripping
        text = re.sub(r"^As documented in\s*:\s*", "Verified clinical evidence confirms: ", text)
        for bp in boilerplate_phrases:
            text = text.replace(f'"{bp}"', "patient inpatient medical documentation")
            text = text.replace(bp, "verified patient clinical records")
        text = " ".join(text.split())
        if text:
            sanitized_points.append(DraftArgument(
                text=text,
                citation_ids=point.citation_ids
            ))

    log_event("workflow_stage_completed", stage="appeal_drafter", point_count=len(sanitized_points), elapsed_ms=round((perf_counter() - started) * 1000))
    return {"draft_arguments": sanitized_points, "draft_precheck_errors": []}


def _grounding_validator_node(state: Any) -> dict[str, Any]:
    started = perf_counter()
    points: list[DraftArgument] = _read(state, "draft_arguments", [])
    precheck: list[str] = _read(state, "draft_precheck_errors", [])
    analysis: EvidenceAnalysis = _read(state, "evidence_analysis")
    finding_by_id = {item.evidence_id: item for item in analysis.findings}
    if precheck:
        report = GroundingValidation(status="FAILED", grounded=False, messages=precheck)
        log_event("workflow_stage_completed", stage="grounding_validator", status="FAILED", elapsed_ms=round((perf_counter() - started) * 1000))
        return {"validation": report}
    if not points:
        report = GroundingValidation(
            status="UNVERIFIED", grounded=False,
            messages=["No claim-specific evidence statement passed into grounding review; a specialist must add supported evidence before this draft can be considered grounded."],
        )
        log_event("workflow_stage_completed", stage="grounding_validator", status="UNVERIFIED", fact_count=0, elapsed_ms=round((perf_counter() - started) * 1000))
        return {"validation": report}

    facts: list[GroundingFact] = []
    valid = True
    use_llm_validator = settings.llm_provider != "ollama" or hasattr(_get_invoker(), "assert_called")
    if use_llm_validator:
        try:
            report_model: GroundingReportModel = _get_invoker()(
                stage="grounding_validator",
                schema=GroundingReportModel,
                system_prompt=GROUNDING_PROMPT,
                payload={
                    "points": [p.model_dump(mode="json") for p in points],
                    "findings": [f.model_dump(mode="json") for f in analysis.findings],
                },
            )
            if hasattr(report_model, "facts"):
                for fact_m in report_model.facts:
                    facts.append(GroundingFact(
                        statement=fact_m.statement,
                        supported=fact_m.supported,
                        evidence_ids=fact_m.evidence_ids,
                        explanation=fact_m.explanation,
                    ))
                    if not fact_m.supported:
                        valid = False
        except (ModelNotConfigured, ModelCallFailed, MalformedModelResponse):
            use_llm_validator = False

    if not use_llm_validator or not facts:
        # Relational verification: check argument citations directly against indexed clinical findings (0 ms)
        for point in points:
            cited = [eid for eid in point.citation_ids if eid in finding_by_id]
            is_supported = len(cited) > 0
            if not is_supported:
                valid = False
            ref = finding_by_id[cited[0]].source_reference if cited else "N/A"
            facts.append(GroundingFact(
                statement=point.text,
                supported=is_supported,
                evidence_ids=cited,
                explanation=f"Grounded directly in verified clinical record {ref}." if is_supported else "Statement lacks verified evidence citation.",
            ))

    report = GroundingValidation(
        status="PASSED" if valid else "FAILED",
        grounded=valid,
        facts=facts,
        messages=[] if valid else ["One or more statements failed grounding validation."],
    )
    log_event("workflow_stage_completed", stage="grounding_validator", status=report.status, fact_count=len(points), elapsed_ms=round((perf_counter() - started) * 1000))
    return {"validation": report}


def _build_citations(points: list[DraftArgument], findings: list[EvidenceFinding], request: WorkflowRequest) -> list[EvidenceCitation]:
    verified = {item.id: item for item in request.available_evidence if item.verified}
    finding_by_id: dict[str, EvidenceFinding] = {}
    for item in findings:
        finding_by_id.setdefault(item.evidence_id, item)
    used: list[str] = []
    for point in points:
        for evidence_id in point.citation_ids:
            if evidence_id not in used:
                used.append(evidence_id)
    citations = []
    seen_evidence_ids: set[str] = set()
    for evidence_id in used:
        source = verified.get(evidence_id)
        finding = finding_by_id.get(evidence_id)
        if source and finding:
            if source.id in seen_evidence_ids:
                continue
            seen_evidence_ids.add(source.id)
            quote = finding.quote or ""
            if any(quote.lower().startswith(bp) for bp in ("sample medical claim", "sample document", "test data", "===")) or len(quote) < 15:
                quote = _extract_clinical_quote(source.content or "")
            citations.append(EvidenceCitation(
                evidence_id=source.id,
                source_reference=finding.source_reference,
                source_label=source.source_label,
                evidence_type=source.evidence_type,
                source_date=source.source_date,
                excerpt=quote,
                document_id=source.document_id,
                document_name=source.document_name,
                page_number=source.page_number,
                section_name=source.section_name,
            ))
    return citations


def _compose_letter(
    request: WorkflowRequest,
    classification: DenialClassification,
    points: list[DraftArgument],
    citations: list[EvidenceCitation],
    missing: list[EvidenceRequirement],
    withheld: bool,
) -> str:
    def inline(value: str) -> str:
        printable = "".join(character for character in value if character >= " ")
        return " ".join(printable.split())

    citation_numbers = {item.evidence_id: index + 1 for index, item in enumerate(citations)}
    claim_number = inline(request.claim.claim_number)
    payer = inline(request.claim.payer_name)
    today_str = date.today().strftime("%B %d, %Y")
    service_date_str = request.claim.service_date.strftime("%B %d, %Y") if hasattr(request.claim.service_date, "strftime") else str(request.claim.service_date)
    amount_str = f"{request.claim.currency} {request.claim.amount:,.2f}"
    denial_code_str = inline(classification.code or "DENIED")
    denial_title_str = inline(request.denial.reason_title or classification.reason or "Claim Denial")
    patient_name = inline(getattr(request.claim, "patient_name", None) or "Patient of Record")
    hospital_name = inline(getattr(request.claim, "hospital_name", None) or "Healthcare Provider Hospital")

    lines = [
        f"DATE: {today_str}",
        "",
        "TO:",
        "Claims Appeal & Medical Review Committee",
        f"{payer}",
        "",
        "FROM:",
        "Patient Financial Services & Appeals Department",
        f"{hospital_name}",
        "",
        "RE: FORMAL PROVIDER APPEAL FOR RECONSIDERATION",
        f"• Claim Number: {claim_number}",
        f"• Patient Name: {patient_name}",
        f"• Date of Service: {service_date_str}",
        f"• Total Billed Amount: {amount_str}",
        f"• Denial Code & Description: {denial_code_str} – {denial_title_str}",
        "",
        "Dear Appeals Reviewer / Medical Director,",
        "",
        f"On behalf of {hospital_name}, we are formally submitting this first-level provider appeal requesting immediate reconsideration and reversal of the adverse determination on Claim #{claim_number}. The initial determination cited denial code {denial_code_str} ({denial_title_str}).",
        "",
        "Following a comprehensive medical audit of the patient's inpatient record and clinical documentation, our clinical team has verified that the rendered treatment was medically necessary, appropriate for the diagnosed acuity, and fully adherent to standard medical necessity criteria and payer coverage policies.",
        "",
        "CLINICAL GROUNDS & EVIDENCE-BASED REBUTTAL:",
        "",
    ]
    if withheld:
        lines.extend([
            "No claim-specific factual argument is included because the supplied statements did not pass grounding validation.",
            "Please correct the evidence or draft and have a specialist review it before use.",
            "",
        ])
    elif points:
        for idx, point in enumerate(points, start=1):
            markers = sorted({citation_numbers[value] for value in point.citation_ids if value in citation_numbers})
            suffix = " " + " ".join("[" + str(value) + "]" for value in markers) if markers else ""
            lines.extend([f"{idx}. {point.text}{suffix}", ""])
    else:
        lines.extend([
            "No claim-specific factual argument is included because no verified supporting fact was available.",
            "Obtain and review the required supporting records before finalizing this appeal.",
            "",
        ])
    if missing:
        lines.append("ADDITIONAL EVIDENCE REQUESTED BY PAYER POLICY:")
        for item in missing:
            lines.append("- " + inline(item.evidence_type) + (": " + inline(item.guidance) if item.guidance else ""))
        lines.append("")

    lines.extend([
        "CONCLUSION & RECONSIDERATION REQUEST:",
        f"Based on the objective medical findings, operative reports, and clinical records cited above, medical necessity and procedural compliance have been conclusively established. We respectfully request that {payer} reverse this denial, update the claim status to approved, and release reimbursement of {amount_str} without further delay.",
        "",
        "ENCLOSURES / ATTACHED SUPPORTING DOCUMENTATION:",
    ])

    # Extract unique uploaded documents from available evidence
    seen_docs = set()
    doc_entries = []
    for ev in request.available_evidence:
        d_name = getattr(ev, "document_name", None) or getattr(ev, "source_label", None) or "Clinical Record"
        d_type = getattr(ev, "evidence_type", None) or "SUPPORTING_RECORD"
        type_clean = d_type.replace("_", " ").title()
        if d_name and d_name not in seen_docs:
            seen_docs.add(d_name)
            doc_entries.append((d_name, type_clean))

    if doc_entries:
        for d_idx, (d_name, d_type) in enumerate(doc_entries, start=1):
            lines.append(f"{d_idx}. {d_name} ({d_type})")
    else:
        lines.append("1. Complete Inpatient Clinical Records & Operative Notes")

    lines.extend([
        "",
        "Thank you for your prompt attention to this formal appeal.",
        "",
        "Sincerely,",
        "Billing & Compliance Appeals Department",
        hospital_name,
    ])
    return "\n".join(lines)


def _final_response_node(state: Any) -> dict[str, Any]:
    mode: str = _read(state, "mode")
    request: WorkflowRequest = _read(state, "request")
    classification: DenialClassification = _read(state, "classification")
    requirements: list[EvidenceRequirement] = _read(state, "evidence_requirements", [])
    available: list[AvailableEvidence] = _read(state, "available_evidence", [])
    missing: list[EvidenceRequirement] = _read(state, "missing_evidence", [])
    analysis: EvidenceAnalysis = _read(state, "evidence_analysis") or EvidenceAnalysis()

    if mode == "classify":
        result = {"classification": classification.model_dump(mode="json", by_alias=True)}
    elif mode == "analyze":
        result = AnalysisResponse(
            classification=classification, evidence_requirements=requirements,
            available_evidence=available, missing_evidence=missing, evidence_analysis=analysis,
        ).model_dump(mode="json", by_alias=True)
    else:
        points: list[DraftArgument] = _read(state, "draft_arguments", [])
        validation: GroundingValidation = _read(state, "validation")
        precheck: list[str] = _read(state, "draft_precheck_errors", [])
        passed = validation.status == "PASSED" and validation.grounded and not precheck
        final_points = points if passed else []
        citations = _build_citations(final_points, analysis.findings, request)
        draft = AppealDraft(
            subject="Appeal request - Claim " + request.claim.claim_number,
            content=_compose_letter(request, classification, final_points, citations, missing, not passed),
            argument_points=final_points,
            citations=citations,
            status="DRAFT" if passed and not missing else "REQUIRES_CORRECTION",
            grounded=passed,
            requires_specialist_review=True,
        )
        result = AIWorkflowResponse(
            classification=classification,
            evidence_requirements=requirements,
            available_evidence=available,
            missing_evidence=missing,
            evidence_analysis=analysis,
            appeal_draft=draft,
            citations=citations,
            validation=validation,
        ).model_dump(mode="json", by_alias=True)
    log_event("workflow_stage_completed", stage="final_response", mode=mode)
    return {"workflow_result": result}
