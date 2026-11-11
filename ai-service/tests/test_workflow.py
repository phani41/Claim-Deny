from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from pydantic import SecretStr

import pipeline.workflow as workflow_module
from app.config import settings
from document_parser import DocumentExtractionFailed, DocumentProcessResponse, ExtractedChunk, ExtractedSegment
from main import app
from app.observability import log_event, logger
from pipeline.schemas import DraftArgument


CLAIM_ID = "synthetic-claim-001"
EVIDENCE_ID = "synthetic-evidence-001"
SOURCE_REF = "synthetic-record:clinic-note-001"
SOURCE_TEXT = "Synthetic clinic note: the patient reported persistent knee pain after six weeks of conservative therapy."


def request_data(*, evidence_verified: bool = True) -> dict:
    return {
        "claim": {
            "id": CLAIM_ID,
            "claimNumber": "SYN-2025-0001",
            "payerName": "Northstar Example Health",
            "serviceDate": "2025-02-14",
            "amount": "1480.50",
            "currency": "USD",
            "procedureCodes": ["SYN123"],
        },
        "denial": {
            "id": "synthetic-denial-001",
            "code": "CO-50",
            "reasonText": "Synthetic denial: documentation did not establish medical necessity.",
            "denialDate": "2025-03-01",
        },
        "availableEvidence": [
            {
                "id": EVIDENCE_ID,
                "claimId": CLAIM_ID,
                "evidenceType": "CLINICAL_NOTE",
                "sourceLabel": "Synthetic clinic note",
                "sourceReference": SOURCE_REF,
                "content": SOURCE_TEXT,
                "sourceDate": "2025-02-14",
                "verified": evidence_verified,
            }
        ],
    }


def finding_result(quote: str = SOURCE_TEXT):
    return workflow_module.EvidenceAnalysisModel(
        findings=[workflow_module.EvidenceFindingModel(
            evidence_id=EVIDENCE_ID,
            source_reference=SOURCE_REF,
            quote=quote,
        )]
    )


class WorkflowStageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.request = workflow_module.WorkflowRequest.model_validate(request_data())

    def test_curated_classifier_uses_reference_without_glm(self) -> None:
        with patch.object(workflow_module, "invoke_structured_output") as llm:
            result = workflow_module.run_workflow("classify", self.request)
        llm.assert_not_called()
        self.assertEqual(result["classification"]["category"], "MEDICAL_NECESSITY")
        self.assertEqual(result["classification"]["basis"], "CURATED_REFERENCE")

    def test_free_text_classification_uses_glm_and_preserves_input_denial_code(self) -> None:
        payload = request_data()
        payload["denial"]["code"] = "SYN-UNKNOWN"
        request = workflow_module.WorkflowRequest.model_validate(payload)
        classification = workflow_module.ClassificationModel(
            category="OTHER", reason="Ambiguous synthetic denial", confidence=0.4, requires_review=True
        )
        with patch.object(workflow_module, "invoke_structured_output", return_value=classification) as llm:
            result = workflow_module.run_workflow("classify", request)
        self.assertEqual(result["classification"]["code"], "SYN-UNKNOWN")
        self.assertIn(result["classification"]["basis"], ["GLM", "Ollama"])
        self.assertTrue(result["classification"]["requiresReview"])
        self.assertEqual(llm.call_args.kwargs["stage"], "denial_classifier")

    def test_mapper_marks_only_verified_evidence_available(self) -> None:
        request = workflow_module.WorkflowRequest.model_validate(request_data(evidence_verified=False))
        result = workflow_module.run_workflow("analyze", request)
        clinical_note = next(
            item for item in result["evidenceRequirements"] if item["evidenceType"] == "CLINICAL_NOTE"
        )
        self.assertFalse(clinical_note["satisfied"])
        self.assertIn("CLINICAL_NOTE", [item["evidenceType"] for item in result["missingEvidence"]])
        self.assertEqual(result["evidenceAnalysis"]["findings"], [])

    def test_analysis_discards_nonliteral_quotes_and_ignores_unverified_records(self) -> None:
        request = workflow_module.WorkflowRequest.model_validate(request_data(evidence_verified=False))
        with patch.object(workflow_module, "invoke_structured_output") as llm:
            result = workflow_module.run_workflow("generate", request)
        llm.assert_not_called()
        self.assertFalse(result["appealDraft"]["argumentPoints"])

        with patch.object(
            workflow_module,
            "invoke_structured_output",
            return_value=finding_result("The patient had severe pain and failed surgery."),
        ):
            result = workflow_module.run_workflow("generate", self.request)
        self.assertEqual(result["evidenceAnalysis"]["findings"], [])
        self.assertEqual(result["evidenceAnalysis"]["discardedFindingCount"], 1)
        self.assertFalse(result["appealDraft"]["argumentPoints"])

    def test_draft_is_grounded_only_after_independent_statement_review(self) -> None:
        point = DraftArgument(
            text="The synthetic clinic note documents persistent knee pain after six weeks of conservative therapy.",
            citation_ids=[EVIDENCE_ID],
        )

        def llm(*, stage, schema, system_prompt, payload):
            if stage == "evidence_analysis":
                self.assertIn("verifiedEvidence", payload)
                return finding_result()
            if stage == "appeal_drafter":
                return workflow_module.DraftPlanModel(argument_points=[point])
            if stage == "grounding_validator":
                return workflow_module.GroundingReportModel(facts=[
                    workflow_module.GroundingAssessmentModel(
                        statement=point.text,
                        supported=True,
                        evidence_ids=[EVIDENCE_ID],
                        explanation="Supported by the exact supplied quotation.",
                    )
                ])
            self.fail(f"Unexpected GLM stage: {stage}")

        with patch.object(workflow_module, "invoke_structured_output", side_effect=llm):
            result = workflow_module.run_workflow("generate", self.request)
        draft = result["appealDraft"]
        self.assertTrue(draft["grounded"])
        self.assertEqual(draft["status"], "REQUIRES_CORRECTION")  # Other CO-50 evidence is still missing.
        self.assertEqual(len(draft["argumentPoints"]), 1)
        self.assertEqual(result["validation"]["status"], "PASSED")
        self.assertEqual(result["citations"][0]["evidenceId"], EVIDENCE_ID)

    def test_unsupported_factual_statement_is_withheld(self) -> None:
        point = DraftArgument(
            text="The patient completed imaging and improved after surgery.",
            citation_ids=[EVIDENCE_ID],
        )

        def llm(*, stage, schema, system_prompt, payload):
            if stage == "evidence_analysis":
                return finding_result()
            if stage == "appeal_drafter":
                return workflow_module.DraftPlanModel(argument_points=[point])
            if stage == "grounding_validator":
                return workflow_module.GroundingReportModel(facts=[
                    workflow_module.GroundingAssessmentModel(
                        statement=point.text,
                        supported=False,
                        evidence_ids=[],
                        explanation="The quotation does not support this statement.",
                    )
                ])
            self.fail(f"Unexpected GLM stage: {stage}")

        with patch.object(workflow_module, "invoke_structured_output", side_effect=llm):
            result = workflow_module.run_workflow("generate", self.request)
        draft = result["appealDraft"]
        self.assertFalse(draft["grounded"])
        self.assertFalse(draft["argumentPoints"])
        self.assertFalse(draft["citations"])
        self.assertIn("did not pass grounding validation", draft["content"])
        self.assertEqual(result["validation"]["status"], "FAILED")


class ApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        self.auth_patch = patch.object(settings, "ai_service_token", SecretStr("synthetic-internal-service-token-0123456789"))
        self.auth_patch.start()
        self.headers = {"Authorization": "Bearer synthetic-internal-service-token-0123456789"}

    def tearDown(self) -> None:
        self.auth_patch.stop()

    def test_health_does_not_expose_credentials(self) -> None:
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertIn(response.json()["provider"], ["glm", "ollama"])
        self.assertNotIn("apiKey", response.json())

    def test_classify_endpoint_accepts_synthetic_claim(self) -> None:
        response = self.client.post("/ai/classify", json=request_data(), headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["classification"]["code"], "CO-50")

    def test_analyze_and_generate_endpoints_run_without_mock_ai_output(self) -> None:
        payload = request_data(evidence_verified=False)
        analysis = self.client.post("/ai/analyze", json=payload, headers=self.headers)
        self.assertEqual(analysis.status_code, 200, analysis.text)
        self.assertIn("CLINICAL_NOTE", [
            item["evidenceType"] for item in analysis.json()["missingEvidence"]
        ])

        draft = self.client.post("/ai/generate-appeal", json=payload, headers=self.headers)
        self.assertEqual(draft.status_code, 200, draft.text)
        self.assertFalse(draft.json()["appealDraft"]["grounded"])
        self.assertEqual(draft.json()["validation"]["status"], "UNVERIFIED")

    def test_unknown_denial_uses_safe_provider_unavailable_error(self) -> None:
        payload = request_data()
        payload["denial"]["code"] = "SYN-UNKNOWN"
        payload["denial"]["reasonText"] = "Synthetic free-text denial requires classification."
        with patch.object(
            workflow_module, "invoke_structured_output", side_effect=workflow_module.ModelNotConfigured
        ):
            response = self.client.post("/ai/classify", json=payload, headers=self.headers)
        self.assertEqual(response.status_code, 503)
        self.assertIn("provider is not configured", response.json()["detail"])

    def test_cross_claim_evidence_is_rejected_without_echoing_body(self) -> None:
        payload = request_data()
        payload["availableEvidence"][0]["claimId"] = "another-synthetic-claim"
        payload["availableEvidence"][0]["content"] = "SENSITIVE_SYNTHETIC_MARKER"
        response = self.client.post("/ai/classify", json=payload, headers=self.headers)
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("SENSITIVE_SYNTHETIC_MARKER", response.text)

    def test_verified_evidence_requires_original_source_reference(self) -> None:
        payload = request_data()
        payload["availableEvidence"][0]["sourceReference"] = None
        response = self.client.post("/ai/analyze", json=payload, headers=self.headers)
        self.assertEqual(response.status_code, 422)

    def test_internal_workflows_require_the_service_token(self) -> None:
        response = self.client.post("/ai/classify", json=request_data())
        self.assertEqual(response.status_code, 401)

    def test_health_does_not_require_internal_token(self) -> None:
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)

    def test_document_process_is_internal_and_returns_source_locations(self) -> None:
        payload = {
            "claimId": CLAIM_ID, "documentId": "synthetic-document-001",
            "evidenceType": "CLINICAL_NOTE", "sourceDocumentName": "synthetic-note.pdf",
            "storageKey": "00000000-0000-0000-0000-000000000001.pdf",
        }
        with patch("main.process_document", return_value=DocumentProcessResponse(
            claimId=CLAIM_ID, documentId="synthetic-document-001", sourceDocumentName="synthetic-note.pdf",
            pageCount=1, extractedText=SOURCE_TEXT,
            segments=[ExtractedSegment(segmentKey="segment-0001", pageNumber=1, sectionName="Assessment", content=SOURCE_TEXT, summary=SOURCE_TEXT)],
            chunks=[ExtractedChunk(chunkId="segment-0001-chunk-0001", segmentKey="segment-0001", pageNumber=1, sectionName="Assessment", content=SOURCE_TEXT)],
        )) as processor:
            denied = self.client.post("/documents/process", json=payload)
            self.assertEqual(denied.status_code, 401)
            response = self.client.post("/documents/process", json=payload, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["segments"][0]["pageNumber"], 1)
        self.assertEqual(response.json()["chunks"][0]["sectionName"], "Assessment")
        processor.assert_called_once()

    def test_document_extraction_errors_are_safe(self) -> None:
        payload = {
            "claimId": CLAIM_ID, "documentId": "synthetic-document-001",
            "evidenceType": "CLINICAL_NOTE", "sourceDocumentName": "synthetic-note.pdf",
            "storageKey": "00000000-0000-0000-0000-000000000001.pdf",
        }
        with patch("main.process_document", side_effect=DocumentExtractionFailed):
            response = self.client.post("/documents/process", json=payload, headers=self.headers)
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("storageKey", response.text)


class LoggingTests(unittest.TestCase):
    def test_unrecognized_sensitive_fields_are_dropped(self) -> None:
        with patch.object(logger, "info") as log_sink:
            log_event("test_event", stage="synthetic_stage", content="SENSITIVE_SYNTHETIC_MARKER")
        logged = log_sink.call_args.args[0]
        self.assertIn("synthetic_stage", logged)
        self.assertNotIn("SENSITIVE_SYNTHETIC_MARKER", logged)


if __name__ == "__main__":
    unittest.main()
