"""Small, transparent starter reference set; not a payer policy database."""

from typing import Any

REFERENCE_REASONS: dict[str, dict[str, Any]] = {
    "CO-50": {
        "category": "MEDICAL_NECESSITY",
        "title": "Medical necessity",
        "requirements": [
            ("CLINICAL_NOTE", "Include the relevant clinician note."),
            ("IMAGING_REPORT", "Include the referenced imaging report."),
            ("TREATMENT_HISTORY", "Include relevant prior treatment history when available."),
        ],
    },
    "CO-16": {
        "category": "MISSING_INFORMATION",
        "title": "Missing information",
        "requirements": [
            ("ORDER", "Include the signed order or referral."),
            ("CLINICAL_NOTE", "Include supporting documentation when relevant."),
        ],
    },
    "CO-197": {
        "category": "AUTHORIZATION_REQUIRED",
        "title": "Authorization required",
        "requirements": [
            ("AUTHORIZATION", "Include authorization confirmation."),
            ("REFERRAL", "Include referral documentation when applicable."),
        ],
    },
    "MED-NEC-01": {
        "category": "MEDICAL_NECESSITY",
        "title": "Medical necessity not established",
        "requirements": [
            ("CLINICAL_NOTE", "Include clinical and operative notes substantiating surgical necessity."),
            ("IMAGING_REPORT", "Include radiology/MRI/X-ray reports confirming diagnosis."),
            ("TREATMENT_HISTORY", "Include conservative treatment failure history."),
        ],
    },
    "PRE-AUTH-03": {
        "category": "AUTHORIZATION_REQUIRED",
        "title": "Prior authorization missing or unapproved",
        "requirements": [
            ("AUTHORIZATION", "Include emergency admission notification and pre-auth request."),
            ("CLINICAL_NOTE", "Include emergency admission clinical assessment."),
        ],
    },
    "POL-COV-05": {
        "category": "POLICY_EXCLUSION",
        "title": "Waiting period or specific policy exclusion",
        "requirements": [
            ("CLINICAL_NOTE", "Include acute onset clinical notes proving emergency exception."),
            ("IMAGING_REPORT", "Include diagnostic confirmation of acute progression."),
        ],
    },
    "DOC-REQ-02": {
        "category": "MISSING_INFORMATION",
        "title": "Missing required diagnostic documentation",
        "requirements": [
            ("LAB_RESULT", "Include diagnostic laboratory reports."),
            ("ORDER", "Include physician order sheets."),
        ],
    },
    "DOC-01": {
        "category": "MISSING_INFORMATION",
        "title": "Missing Clinical Documentation",
        "requirements": [
            ("CLINICAL_NOTE", "Include clinical notes and operative summaries."),
            ("ORDER", "Include physician orders and diagnostic test results."),
        ],
    },
    "AUTH-01": {
        "category": "AUTHORIZATION_REQUIRED",
        "title": "Missing Prior Authorization",
        "requirements": [
            ("AUTHORIZATION", "Include prior authorization request or approval letter."),
            ("CLINICAL_NOTE", "Include emergency admission clinical assessment."),
        ],
    },
    "MED-01": {
        "category": "MEDICAL_NECESSITY",
        "title": "Medical Necessity Not Established",
        "requirements": [
            ("CLINICAL_NOTE", "Include clinician notes and operative details."),
            ("IMAGING_REPORT", "Include relevant diagnostic imaging reports."),
        ],
    },
    "POLICY-01": {
        "category": "POLICY_EXCLUSION",
        "title": "Policy Exclusion or Benefit Limit Exceeded",
        "requirements": [
            ("CLINICAL_NOTE", "Include clinical justification proving emergency exception."),
        ],
    },
    "TIMELY-01": {
        "category": "TIMELY_FILING",
        "title": "Exceeded Timely Filing Limit",
        "requirements": [
            ("CLINICAL_NOTE", "Include documentation substantiating timely initial care."),
        ],
    },
}

CATEGORY_REQUIREMENTS: dict[str, list[tuple[str, str]]] = {
    "MEDICAL_NECESSITY": [
        ("CLINICAL_NOTE", "Include the relevant clinician note."),
        ("IMAGING_REPORT", "Include imaging referenced by the denial."),
        ("TREATMENT_HISTORY", "Include relevant documented treatment history."),
    ],
    "MISSING_INFORMATION": [
        ("ORDER", "Include the missing order or referral."),
        ("CLINICAL_NOTE", "Include supporting documentation when relevant."),
    ],
    "AUTHORIZATION_REQUIRED": [
        ("AUTHORIZATION", "Include authorization confirmation."),
        ("REFERRAL", "Include referral documentation when applicable."),
    ],
}

