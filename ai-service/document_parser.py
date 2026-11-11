from __future__ import annotations

import re
import zipfile
from collections import OrderedDict
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.config import settings
from app.observability import log_event

MAX_UNPACKED_DOCX_BYTES = 50 * 1024 * 1024
CHUNK_SIZE = 2400
CHUNK_OVERLAP = 250


class StrictModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        strict=True,
        str_strip_whitespace=True,
    )


EvidenceType = Literal[
    "CLINICAL_NOTE", "IMAGING_REPORT", "LAB_RESULT", "ORDER", "AUTHORIZATION",
    "REFERRAL", "TREATMENT_HISTORY", "OTHER",
]


class DocumentProcessRequest(StrictModel):
    claim_id: str = Field(min_length=1, max_length=64)
    document_id: str = Field(min_length=1, max_length=64)
    evidence_type: EvidenceType
    source_document_name: str = Field(min_length=1, max_length=255)
    storage_key: str = Field(min_length=1, max_length=80)

    @field_validator("source_document_name")
    @classmethod
    def reject_control_chars(cls, value: str) -> str:
        if any(ord(character) < 32 for character in value):
            raise ValueError("sourceDocumentName cannot contain control characters.")
        return value


class ExtractedSegment(StrictModel):
    segment_key: str = Field(min_length=1, max_length=32)
    page_number: int | None = Field(default=None, ge=1)
    section_name: str | None = Field(default=None, max_length=200)
    content: str = Field(min_length=1, max_length=100000)
    summary: str = Field(min_length=1, max_length=4000)


class ExtractedChunk(StrictModel):
    chunk_id: str = Field(min_length=1, max_length=80)
    segment_key: str = Field(min_length=1, max_length=32)
    page_number: int | None = Field(default=None, ge=1)
    section_name: str | None = Field(default=None, max_length=200)
    content: str = Field(min_length=1, max_length=4000)


class DocumentProcessResponse(StrictModel):
    document_id: str
    claim_id: str
    source_document_name: str
    page_count: int | None = Field(default=None, ge=1)
    extracted_text: str = Field(min_length=1, max_length=1000000)
    segments: list[ExtractedSegment] = Field(min_length=1, max_length=2000)
    chunks: list[ExtractedChunk] = Field(min_length=1, max_length=20000)


class UnsupportedDocument(Exception):
    pass


class DocumentExtractionFailed(Exception):
    pass


class UnrelatedHealthcareDocument(Exception):
    def __init__(self, message: str = "Invalid Document! The uploaded file does not appear to be a medical or healthcare-related document. Please upload a valid medical document."):
        super().__init__(message)
        self.message = message


class EmptyDocumentError(Exception):
    def __init__(self, message: str = "The uploaded document is empty or contains no readable text. Please upload a valid medical document."):
        super().__init__(message)
        self.message = message


class PasswordProtectedDocumentError(Exception):
    def __init__(self, message: str = "The uploaded file is password-protected. Please upload an unlocked medical document."):
        super().__init__(message)
        self.message = message


class CorruptedDocumentError(Exception):
    def __init__(self, message: str = "The uploaded file is corrupted or unreadable. Please ensure the document is a valid readable PDF or DOCX file."):
        super().__init__(message)
        self.message = message


MEDICAL_KEYWORDS = [
    # Clinical & Medical
    "patient", "hospital", "physician", "doctor", "dr.", "dr ", "clinic", "nursing", "admission",
    "admitted", "discharge", "discharged", "diagnosis", "diagnostic", "prognosis", "treatment",
    "prescription", "rx", "medication", "medicine", "tablet", "capsule", "dosage", "syrup",
    "injection", "iv", "surgery", "surgical", "operation", "operative", "surgeon", "anesthesia",
    "procedure", "cpt", "icd", "icd-10", "consultation", "consultant", "vital", "vitals",
    "blood pressure", "bp", "pulse", "temperature", "heart rate", "bpm", "spo2", "respiratory",
    "cardio", "ortho", "neuro", "pediatric", "gynecolog", "patholog", "radiolog", "x-ray",
    "ultrasound", "usg", "ecg", "ekg", "mri", "ct scan", "biopsy", "specimen", "hemoglobin",
    "cbc", "platelet", "wbc", "rbc", "glucose", "creatinine", "urea", "urine", "serum",
    "acute", "chronic", "symptom", "pain", "fracture", "infection", "trauma", "casualty",
    "emergency", "ward", "icu", "ot", "bed no", "ipd", "opd", "inpatient", "outpatient",
    "cath lab", "dialysis", "physiotherapy", "oncology", "nephrology", "urology", "gastro",
    # Healthcare billing & insurance
    "health insurance", "mediclaim", "policy", "policyholder", "insured", "sum insured", "claim",
    "tpa", "pre-authorization", "pre-auth", "cashless", "reimbursement", "tariff", "room rent",
    "ot charges", "icu charges", "nursing charges", "doctor fee", "consultation fee", "pharmacy bill",
    "investigation charges", "medical store", "chemist", "dispensary", "pharmaceutical",
    "hospital invoice", "final bill", "interim bill", "tax invoice", "discharge summary",
    "claim form", "settlement", "denial", "adjudication", "medical report", "lab report"
]

SHORT_MEDICAL_WORDS = {"ot", "icu", "iv", "rx", "bp", "cbc", "wbc", "rbc", "usg", "ecg", "ekg", "dr"}

NON_MEDICAL_PATTERNS = [
    "curriculum vitae", "resume", "summary of qualifications", "work experience",
    "employment history", "bachelor of", "master of", "b.tech", "m.tech", "b.sc", "m.sc",
    "gpa", "cgpa", "technical skills", "programming languages", "software engineer", "software developer",
    "github.com", "linkedin.com", "degree certificate", "diploma in", "academic transcript",
    "bank statement", "current account", "savings account", "statement of account",
    "atm withdrawal", "credit card statement", "ifsc:", "rental agreement", "lease agreement",
    "tenancy contract", "electricity bill", "water bill", "broadband bill", "power distribution",
    "kwh", "units consumed", "meter reading", "movie ticket", "boarding pass", "flight ticket"
]


def is_medical_healthcare_document(text: str) -> bool:
    if not text or not text.strip():
        return False
    lower = text.lower()
    
    # Check for short medical abbreviations using word boundaries
    short_matches = 0
    for short_word in SHORT_MEDICAL_WORDS:
        if re.search(rf"\b{short_word}\b", lower):
            short_matches += 1

    # Check for regular medical keywords
    regular_matches = 0
    for kw in MEDICAL_KEYWORDS:
        if kw not in SHORT_MEDICAL_WORDS and kw in lower:
            regular_matches += 1

    total_medical = regular_matches + short_matches

    # Check for non-medical patterns
    non_medical_matches = 0
    for nmp in NON_MEDICAL_PATTERNS:
        if nmp in lower:
            non_medical_matches += 1

    # If document has non-medical signatures (resume, electricity bill, etc.) and few/no medical keywords:
    if non_medical_matches >= 1 and total_medical < 2:
        return False

    # Valid clinical/healthcare document requires at least 2 distinct medical/billing terms
    if total_medical >= 2:
        return True

    # If 1 medical keyword found and 0 non-medical keywords, check if it's a strong clinical keyword
    if total_medical == 1 and non_medical_matches == 0:
        strong_terms = ["patient", "hospital", "prescription", "discharge", "diagnosis", "doctor", "physician", "surgery", "mediclaim"]
        if any(term in lower for term in strong_terms):
            return True

    return False


def resolve_storage_key(storage_key: str) -> Path:
    if not re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(?:pdf|docx)", storage_key):
        raise UnsupportedDocument
    root = settings.uploads_directory.resolve()
    candidate = root / storage_key
    if candidate.is_symlink():
        raise UnsupportedDocument
    path = candidate.resolve()
    if path.parent != root or not path.is_file():
        raise UnsupportedDocument
    if path.stat().st_size <= 0 or path.stat().st_size > settings.max_upload_mb * 1024 * 1024:
        raise UnsupportedDocument
    return path


def _validate_file(path: Path) -> None:
    if not path.is_file() or path.stat().st_size <= 0:
        raise EmptyDocumentError
    with path.open("rb") as handle:
        signature = handle.read(8)
    if path.suffix.lower() == ".pdf":
        if not signature.startswith(b"%PDF-"):
            raise UnsupportedDocument
        return
    if path.suffix.lower() != ".docx" or not signature.startswith(b"PK\x03\x04"):
        raise UnsupportedDocument
    try:
        with zipfile.ZipFile(path) as archive:
            names = set(archive.namelist())
            expanded_size = sum(entry.file_size for entry in archive.infolist())
            if (
                "[Content_Types].xml" not in names
                or "word/document.xml" not in names
                or len(names) > 5000
                or expanded_size > MAX_UNPACKED_DOCX_BYTES
            ):
                raise CorruptedDocumentError
    except (OSError, zipfile.BadZipFile):
        raise CorruptedDocumentError from None


def _page_number(item: Any) -> int | None:
    value = getattr(item, "page_no", None)
    if value is None:
        return None
    try:
        page = int(value)
    except (TypeError, ValueError):
        return None
    return page + 1 if page == 0 else page if page > 0 else None


def _item_pages(item: Any) -> list[int | None]:
    provenance = getattr(item, "prov", None) or []
    values = list(dict.fromkeys(_page_number(entry) for entry in provenance))
    return values or [None]


def _label(item: Any) -> str:
    value = getattr(item, "label", "")
    return str(getattr(value, "value", value)).lower()


def _split_segments(page: int | None, section: str | None, content: str, base_index: int) -> list[ExtractedSegment]:
    segments: list[ExtractedSegment] = []
    offset = 0
    part = 1
    while offset < len(content):
        end = min(offset + 20000, len(content))
        if end < len(content):
            boundary = max(content.rfind("\n", offset + 10000, end), content.rfind(" ", offset + 10000, end))
            if boundary > offset:
                end = boundary
        part_text = content[offset:end]
        if part_text:
            key = f"segment-{base_index:04d}" if part == 1 else f"segment-{base_index:04d}-{part:02d}"
            segments.append(ExtractedSegment(
                segment_key=key, page_number=page, section_name=section,
                content=part_text, summary=part_text[:1000],
            ))
            part += 1
        offset = end
    return segments


def extract_segments(document: Any) -> list[ExtractedSegment]:
    grouped: OrderedDict[tuple[int | None, str | None], list[str]] = OrderedDict()
    current_section: str | None = None
    for item, _level in document.iterate_items():
        text = getattr(item, "text", None)
        if not isinstance(text, str) or not text.strip():
            continue
        text = text.strip()
        if "section_header" in _label(item) or _label(item) == "title":
            current_section = text[:200]
        for page in _item_pages(item):
            grouped.setdefault((page, current_section), []).append(text)

    segments: list[ExtractedSegment] = []
    for index, ((page, section), lines) in enumerate(grouped.items(), start=1):
        content = "\n".join(lines).strip()
        if not content:
            continue
        segments.extend(_split_segments(page, section, content, index))
    return segments


def _chunk_segment(segment: ExtractedSegment) -> list[ExtractedChunk]:
    text = segment.content
    chunks: list[ExtractedChunk] = []
    start = 0
    ordinal = 1
    while start < len(text):
        end = min(start + CHUNK_SIZE, len(text))
        if end < len(text):
            boundary = max(text.rfind("\n", start + CHUNK_SIZE // 2, end), text.rfind(" ", start + CHUNK_SIZE // 2, end))
            if boundary > start:
                end = boundary
        content = text[start:end].strip()
        if content:
            chunks.append(ExtractedChunk(
                chunk_id=segment.segment_key + f"-chunk-{ordinal:04d}",
                segment_key=segment.segment_key,
                page_number=segment.page_number,
                section_name=segment.section_name,
                content=content,
            ))
            ordinal += 1
        if end >= len(text):
            break
        start = max(end - CHUNK_OVERLAP, start + 1)
        while start < len(text) and text[start].isspace():
            start += 1
    return chunks


def _extract_from_pdf(path: Path) -> tuple[int, list[ExtractedSegment]]:
    import pypdfium2 as pdfium

    try:
        pdf = pdfium.PdfDocument(path)
    except Exception as e:
        err_msg = str(e).lower()
        if "password" in err_msg or "encrypted" in err_msg or "security" in err_msg:
            raise PasswordProtectedDocumentError from None
        raise CorruptedDocumentError from None

    page_count = len(pdf)
    if page_count == 0:
        raise EmptyDocumentError from None

    segments: list[ExtractedSegment] = []
    seg_idx = 1
    total_text = ""
    for page_idx in range(page_count):
        page = pdf[page_idx]
        textpage = page.get_textpage()
        text = textpage.get_text_range().strip()
        if not text:
            continue
        total_text += text + " "
        page_num = page_idx + 1
        page_segments = _split_segments(page_num, f"Page {page_num}", text, seg_idx)
        seg_idx += len(page_segments)
        segments.extend(page_segments)

    if not total_text.strip() or not segments:
        raise EmptyDocumentError from None

    return max(page_count, 1), segments


def _extract_from_docx(path: Path) -> tuple[int, list[ExtractedSegment]]:
    import docx

    try:
        doc = docx.Document(path)
    except Exception:
        raise CorruptedDocumentError from None

    segments: list[ExtractedSegment] = []
    current_section = "General"
    lines: list[str] = []
    seg_idx = 1
    total_text = ""
    for p in doc.paragraphs:
        txt = p.text.strip()
        if not txt:
            continue
        total_text += txt + " "
        if p.style and "heading" in p.style.name.lower():
            if lines:
                content = "\n".join(lines).strip()
                if content:
                    part_segs = _split_segments(1, current_section, content, seg_idx)
                    seg_idx += len(part_segs)
                    segments.extend(part_segs)
                lines = []
            current_section = txt[:200]
        else:
            lines.append(txt)
    if lines:
        content = "\n".join(lines).strip()
        if content:
            part_segs = _split_segments(1, current_section, content, seg_idx)
            segments.extend(part_segs)

    if not total_text.strip() or not segments:
        raise EmptyDocumentError from None

    return 1, segments


def process_document(request: DocumentProcessRequest) -> DocumentProcessResponse:
    path = resolve_storage_key(request.storage_key)
    _validate_file(path)
    try:
        segments: list[ExtractedSegment] = []
        page_count: int = 1
        suffix = path.suffix.lower()

        # Try docling first if available in the environment
        docling_success = False
        try:
            from docling.datamodel.base_models import InputFormat
            from docling.document_converter import DocumentConverter

            converter = DocumentConverter(allowed_formats=[InputFormat.PDF, InputFormat.DOCX])
            conversion = converter.convert(str(path))
            document = getattr(conversion, "document", None)
            if document is not None:
                segments = extract_segments(document)
                if not segments:
                    fallback = document.export_to_text().strip()
                    if fallback:
                        segments = [
                            ExtractedSegment(
                                segment_key="segment-0001", page_number=1, section_name=None,
                                content=fallback, summary=fallback[:1000],
                            )
                        ]
                if segments:
                    page_count = getattr(document, "num_pages", None) or max((seg.page_number or 1 for seg in segments), default=1)
                    docling_success = True
        except (ImportError, ModuleNotFoundError):
            docling_success = False
        except Exception as e:
            log_event("docling_extraction_fallback", error=str(e), level="info")
            docling_success = False

        if not docling_success:
            if suffix == ".pdf":
                page_count, segments = _extract_from_pdf(path)
            elif suffix == ".docx":
                page_count, segments = _extract_from_docx(path)
            else:
                raise UnsupportedDocument

        if not segments:
            raise EmptyDocumentError

        chunks = [chunk for seg in segments for chunk in _chunk_segment(seg)]
        if not chunks:
            raise DocumentExtractionFailed
        extracted_text = "\n\n".join(seg.content for seg in segments).strip()
        if not extracted_text:
            raise EmptyDocumentError

        # Strict Healthcare / Medical Domain Content Validation
        if not is_medical_healthcare_document(extracted_text):
            raise UnrelatedHealthcareDocument

        # PII / PHI Masking using Presidio with Regex Fallback
        from app.pii_masker import mask_pii

        masked_segments = [
            ExtractedSegment(
                segment_key=seg.segment_key,
                page_number=seg.page_number,
                section_name=seg.section_name,
                content=mask_pii(seg.content).text,
                summary=mask_pii(seg.summary or "").text if seg.summary else None,
            )
            for seg in segments
        ]
        masked_chunks = [
            ExtractedChunk(
                chunk_id=chunk.chunk_id,
                segment_key=chunk.segment_key,
                page_number=chunk.page_number,
                section_name=chunk.section_name,
                content=mask_pii(chunk.content).text,
            )
            for chunk in chunks
        ]
        masked_extracted_text = mask_pii(extracted_text).text

        log_event("document_processed", page_count=page_count, segment_count=len(segments))
        return DocumentProcessResponse(
            document_id=request.document_id,
            claim_id=request.claim_id,
            source_document_name=request.source_document_name,
            page_count=page_count,
            extracted_text=masked_extracted_text,
            segments=masked_segments,
            chunks=masked_chunks,
        )
    except (
        UnsupportedDocument,
        DocumentExtractionFailed,
        UnrelatedHealthcareDocument,
        EmptyDocumentError,
        PasswordProtectedDocumentError,
        CorruptedDocumentError,
    ):
        raise
    except Exception as error:
        log_event("document_process_failed", error_type=type(error).__name__, level="error")
        raise DocumentExtractionFailed from None

