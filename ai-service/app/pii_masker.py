"""PII / PHI Masking Engine with Microsoft Presidio and Regex Fallback.

Provides dual-engine sanitization for clinical documents, prompts, and logs:
1. Primary Engine: Microsoft Presidio Anonymizer + RecognizerRegistry
2. Fallback Engine: High-precision Regular Expression PII Masker
"""

from __future__ import annotations

import re
from typing import Any, NamedTuple


class MaskResult(NamedTuple):
    text: str
    engine: str
    entities_detected: list[str]


# ---------------------------------------------------------------------------
# Fallback Engine: High-Precision Regex Patterns
# ---------------------------------------------------------------------------
_REGEX_PATTERNS = [
    # Email addresses
    (
        "EMAIL_ADDRESS",
        re.compile(r"\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b"),
        "<EMAIL_ADDRESS>",
    ),
    # Indian & International phone numbers
    (
        "PHONE_NUMBER",
        re.compile(r"(?:\+91[\s-]?)?[6789]\d{9}|\b(?:\+1[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b"),
        "<PHONE_NUMBER>",
    ),
    # Indian Aadhaar 12-digit numbers
    (
        "IN_AADHAAR",
        re.compile(r"\b\d{4}\s\d{4}\s\d{4}\b|\bAADHAAR[\s:]*\d{12}\b", re.IGNORECASE),
        "<AADHAAR_NUMBER>",
    ),
    # Indian PAN Cards (5 uppercase letters + 4 digits + 1 uppercase letter)
    (
        "IN_PAN",
        re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b"),
        "<PAN_NUMBER>",
    ),
    # US Social Security Numbers
    (
        "US_SSN",
        re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
        "<SSN>",
    ),
    # Credit / Debit Card Numbers (16 digits with optional dashes/spaces)
    (
        "CREDIT_CARD",
        re.compile(r"\b(?:\d{4}[-\s]?){3}\d{4}\b"),
        "<CARD_NUMBER>",
    ),
    # Date of Birth (DOB)
    (
        "DATE_OF_BIRTH",
        re.compile(r"(?i)\b(?:DOB|Date of Birth|Birthdate)[\s:]+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b"),
        "DOB: <DOB>",
    ),
    # Patient Name in clinical headers
    (
        "PATIENT_NAME",
        re.compile(r"(?i)\b(?:Patient(?:\s+Name)?|Pt\s*Name|Pt\s*:)[\s:]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b"),
        "Patient Name: <PATIENT_NAME>",
    ),
    # IPv4 Addresses
    (
        "IP_ADDRESS",
        re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b"),
        "<IP_ADDRESS>",
    ),
]


def _regex_mask_pii(text: str) -> MaskResult:
    """Fallback PII masking using compiled regular expressions."""
    if not text:
        return MaskResult(text="", engine="regex", entities_detected=[])

    masked = text
    detected = []
    for entity_name, pattern, replacement in _REGEX_PATTERNS:
        if pattern.search(masked):
            detected.append(entity_name)
            masked = pattern.sub(replacement, masked)

    return MaskResult(text=masked, engine="regex", entities_detected=detected)


# ---------------------------------------------------------------------------
# Primary Engine: Microsoft Presidio
# ---------------------------------------------------------------------------
_presidio_initialized = False
_presidio_anonymizer = None
_presidio_registry = None


def _init_presidio():
    """Lazily initialize Presidio Pattern Recognizers and Anonymizer Engine."""
    global _presidio_initialized, _presidio_anonymizer, _presidio_registry
    if _presidio_initialized:
        return _presidio_registry, _presidio_anonymizer

    try:
        from presidio_analyzer import Pattern, PatternRecognizer, RecognizerRegistry
        from presidio_anonymizer import AnonymizerEngine

        registry = RecognizerRegistry()
        registry.load_predefined_recognizers()

        # Add Custom Indian Healthcare & PII Recognizers
        aadhaar_recognizer = PatternRecognizer(
            supported_entity="IN_AADHAAR",
            name="InAadhaarRecognizer",
            patterns=[Pattern("aadhaar_spaced", r"\b\d{4}\s\d{4}\s\d{4}\b", 0.85)],
        )
        registry.add_recognizer(aadhaar_recognizer)

        pan_recognizer = PatternRecognizer(
            supported_entity="IN_PAN",
            name="InPanRecognizer",
            patterns=[Pattern("pan_card", r"\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b", 0.90)],
        )
        registry.add_recognizer(pan_recognizer)

        anonymizer = AnonymizerEngine()
        _presidio_registry = registry
        _presidio_anonymizer = anonymizer
        _presidio_initialized = True
        return _presidio_registry, _presidio_anonymizer
    except Exception:
        _presidio_initialized = False
        return None, None


def mask_pii(text: str) -> MaskResult:
    """Mask PII / PHI using Presidio with seamless Regex fallback.

    Args:
        text: Clinical text or document chunk to sanitize.

    Returns:
        MaskResult containing sanitized text, active engine name, and detected entities.
    """
    if not text or not text.strip():
        return MaskResult(text=text, engine="none", entities_detected=[])

    registry, anonymizer = _init_presidio()

    if registry and anonymizer:
        try:
            results = []
            for recognizer in registry.recognizers:
                try:
                    found = recognizer.analyze(text, entities=recognizer.supported_entities)
                    if found:
                        results.extend(found)
                except Exception:
                    continue

            if results:
                anonymized = anonymizer.anonymize(text=text, analyzer_results=results)
                detected = sorted({r.entity_type for r in results})
                # Apply secondary regex for any medical-specific heading names that NLP might miss
                secondary = _regex_mask_pii(anonymized.text)
                combined_detected = sorted(set(detected + secondary.entities_detected))
                return MaskResult(text=secondary.text, engine="presidio", entities_detected=combined_detected)
            else:
                # If Presidio pattern found nothing, run regex pass to ensure complete coverage
                regex_res = _regex_mask_pii(text)
                return MaskResult(
                    text=regex_res.text,
                    engine="presidio",
                    entities_detected=regex_res.entities_detected,
                )
        except Exception:
            # Fall back safely to regex engine
            return _regex_mask_pii(text)

    # Direct fallback if Presidio is not available
    return _regex_mask_pii(text)

