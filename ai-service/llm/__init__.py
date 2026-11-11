"""LLM package for HLT-06.

Provides LangChain ChatOpenAI integration with GLM, bounded structured output
invocations with Pydantic schemas, and healthcare appeal prompt templates.
"""

from llm.client import (
    MalformedModelResponse,
    ModelCallFailed,
    ModelNotConfigured,
    build_glm_chat_model,
)
from llm.prompts import (
    CLASSIFICATION_PROMPT,
    DRAFT_PROMPT,
    EVIDENCE_ANALYSIS_PROMPT,
    GROUNDING_PROMPT,
)
from llm.structured_output import invoke_structured_output

__all__ = [
    "CLASSIFICATION_PROMPT",
    "DRAFT_PROMPT",
    "EVIDENCE_ANALYSIS_PROMPT",
    "GROUNDING_PROMPT",
    "MalformedModelResponse",
    "ModelCallFailed",
    "ModelNotConfigured",
    "build_glm_chat_model",
    "invoke_structured_output",
]

