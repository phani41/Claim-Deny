from __future__ import annotations

import json
import re
from typing import TypeVar

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, ValidationError

from app.config import settings
from app.observability import log_event
from llm.client import MalformedModelResponse, ModelCallFailed, ModelNotConfigured, build_glm_chat_model

SchemaT = TypeVar("SchemaT", bound=BaseModel)


def _content_as_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            item.get("text", "")
            for item in content
            if isinstance(item, dict) and isinstance(item.get("text"), str)
        ]
        return "\n".join(parts)
    return ""


def _extract_json_text(content: str) -> str:
    """Robustly extracts valid JSON payload using JSONDecoder raw_decode to ignore trailing text/schemas."""
    content = content.strip()
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", content, flags=re.IGNORECASE)
    if fence_match:
        cand = fence_match.group(1).strip()
        try:
            json.loads(cand)
            return cand
        except Exception:
            pass

    decoder = json.JSONDecoder()
    for i, ch in enumerate(content):
        if ch in ("{", "["):
            try:
                _obj, end_idx = decoder.raw_decode(content[i:])
                return content[i : i + end_idx]
            except Exception:
                continue

    return content


def invoke_structured_output(
    *,
    stage: str,
    schema: type[SchemaT],
    system_prompt: str,
    payload: dict[str, object],
    timeout: float | None = None,
    max_tokens: int | None = None,
) -> SchemaT:
    """One bounded LLM request with resilient JSON and Pydantic output validation."""
    try:
        model = build_glm_chat_model(timeout=timeout, max_tokens=max_tokens)
    except ModelNotConfigured:
        raise
    except Exception as error:
        log_event("model_setup_failed", stage=stage, error_type=type(error).__name__, level="error")
        raise ModelCallFailed from None

    safe_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str)
    schema_json = json.dumps(schema.model_json_schema(by_alias=True), ensure_ascii=False, separators=(",", ":"))
    messages = [
        SystemMessage(content=system_prompt + "\nJSON schema:\n" + schema_json),
        HumanMessage(content="UNTRUSTED_RECORD_DATA_BEGIN\n" + safe_json + "\nUNTRUSTED_RECORD_DATA_END"),
    ]
    model_name = settings.active_model
    log_event("model_call_started", stage=stage, model=model_name)
    try:
        response = model.invoke(messages)
    except Exception as error:
        log_event("model_call_failed", stage=stage, error_type=type(error).__name__, level="error")
        raise ModelCallFailed from None

    raw_text = _content_as_text(response.content)
    if not raw_text:
        log_event("model_response_malformed", stage=stage, reason="empty", level="warning")
        raise MalformedModelResponse from None
    try:
        json_candidate = _extract_json_text(raw_text)
        parsed = schema.model_validate_json(json_candidate, strict=False)
    except (ValueError, ValidationError, TypeError):
        log_event("model_response_malformed", stage=stage, reason="schema_validation", level="warning")
        raise MalformedModelResponse from None

    usage = getattr(response, "usage_metadata", None) or {}
    log_event(
        "model_call_completed",
        stage=stage,
        model=model_name,
        input_tokens=usage.get("input_tokens"),
        output_tokens=usage.get("output_tokens"),
    )
    return parsed
