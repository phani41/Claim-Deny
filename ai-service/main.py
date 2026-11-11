from __future__ import annotations

import re
import secrets
from time import perf_counter
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.observability import log_event, request_id_context
from document_parser import (
    CorruptedDocumentError,
    DocumentExtractionFailed,
    DocumentProcessRequest,
    EmptyDocumentError,
    PasswordProtectedDocumentError,
    UnrelatedHealthcareDocument,
    UnsupportedDocument,
    process_document,
)
from llm.client import MalformedModelResponse, ModelCallFailed, ModelNotConfigured
from pipeline.schemas import WorkflowRequest
from pipeline.workflow import run_workflow

app = FastAPI(
    title="HLT-06 AI Service",
    description="Provider Claim Denial Appeal Letter Assistant with Ollama & LangGraph Workflows",
    version="0.4.0",
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    candidate = request.headers.get("x-request-id", "")
    request_id = candidate if re.fullmatch(r"[A-Za-z0-9._-]{1,64}", candidate) else str(uuid4())
    token = request_id_context.set(request_id)
    started = perf_counter()
    try:
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        log_event(
            "http_request_completed", method=request.method, path=request.url.path,
            status_code=response.status_code,
            elapsed_ms=round((perf_counter() - started) * 1000),
        )
        return response
    finally:
        request_id_context.reset(token)


@app.exception_handler(RequestValidationError)
async def invalid_request(_request: Request, _error: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"detail": "Request validation failed.", "requestId": request_id_context.get()},
    )


@app.exception_handler(ValidationError)
async def invalid_workflow_data(_request: Request, _error: ValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"detail": "Request validation failed.", "requestId": request_id_context.get()},
    )


@app.get("/health")
def health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "service": "ai-service",
        "provider": settings.llm_provider,
        "model": settings.active_model,
        "providerConfigured": settings.model_configured,
        "internalAuthConfigured": settings.internal_auth_configured,
    }


def require_internal_service(authorization: str | None = Header(default=None)) -> None:
    expected = settings.ai_service_token.get_secret_value().strip()
    if len(expected) < 32:
        raise HTTPException(status_code=503, detail="Internal service authentication is not configured.")
    match = re.fullmatch(r"Bearer\s+(.+)", authorization or "", flags=re.IGNORECASE)
    if not match or not secrets.compare_digest(match.group(1), expected):
        raise HTTPException(status_code=401, detail="Internal service authentication failed.")


# ---------------------------------------------------------------------------
# Document Processing Endpoint
# ---------------------------------------------------------------------------

@app.post("/documents/process")
async def document_process(
    request: DocumentProcessRequest,
    _internal: None = Depends(require_internal_service),
) -> dict:
    try:
        result = await run_in_threadpool(process_document, request)
        return result.model_dump(mode="json", by_alias=True)
    except UnsupportedDocument:
        raise HTTPException(status_code=415, detail="Invalid Document! The uploaded file does not appear to be a medical or healthcare-related document. Please upload a valid medical document.") from None
    except UnrelatedHealthcareDocument as e:
        raise HTTPException(status_code=422, detail=e.message) from None
    except EmptyDocumentError as e:
        raise HTTPException(status_code=422, detail=e.message) from None
    except PasswordProtectedDocumentError as e:
        raise HTTPException(status_code=422, detail=e.message) from None
    except CorruptedDocumentError as e:
        raise HTTPException(status_code=422, detail=e.message) from None
    except DocumentExtractionFailed:
        raise HTTPException(status_code=422, detail="Document text extraction failed. Please ensure the document is a valid readable PDF or DOCX file.") from None


# ---------------------------------------------------------------------------
# LangGraph & Ollama Workflow Endpoints (Classification, Denial Analysis, Appeal Draft)
# ---------------------------------------------------------------------------

def _execute(mode: str, request: WorkflowRequest) -> dict:
    try:
        return run_workflow(mode, request)  # type: ignore[arg-type]
    except ModelNotConfigured:
        raise HTTPException(status_code=503, detail="Ollama/LLM provider is not configured.") from None
    except ModelCallFailed:
        raise HTTPException(status_code=503, detail="Ollama/LLM provider request failed.") from None
    except MalformedModelResponse:
        raise HTTPException(status_code=502, detail="Ollama/LLM returned an invalid structured response.") from None
    except (ValidationError, ValueError):
        raise HTTPException(status_code=422, detail="Request validation failed.") from None
    except HTTPException:
        raise
    except Exception as error:
        log_event("workflow_failed", error_type=type(error).__name__, level="error")
        raise HTTPException(status_code=500, detail="AI workflow failed safely.") from None


@app.post("/ai/classify")
def classify(request: WorkflowRequest, _internal: None = Depends(require_internal_service)) -> dict:
    return _execute("classify", request)


@app.post("/ai/analyze")
def analyze(request: WorkflowRequest, _internal: None = Depends(require_internal_service)) -> dict:
    return _execute("analyze", request)


@app.post("/ai/generate-appeal")
def generate_appeal(request: WorkflowRequest, _internal: None = Depends(require_internal_service)) -> dict:
    return _execute("generate", request)


class MaskPiiRequest(BaseModel):
    text: str


@app.post("/ai/mask-pii")
def mask_pii_endpoint(request: MaskPiiRequest, _internal: None = Depends(require_internal_service)) -> dict:
    from app.pii_masker import mask_pii
    result = mask_pii(request.text)
    return {
        "maskedText": result.text,
        "engine": result.engine,
        "entitiesDetected": result.entities_detected,
    }
