from __future__ import annotations

from langchain_openai import ChatOpenAI

from app.config import settings


class ModelNotConfigured(Exception):
    """Raised when the LLM provider API credentials/endpoint are missing."""
    pass


class ModelCallFailed(Exception):
    """Raised when an HTTP or network call to the LLM provider fails or times out."""
    pass


class MalformedModelResponse(Exception):
    """Raised when the model output cannot be parsed into expected JSON or fails Pydantic validation."""
    pass


def build_glm_chat_model(*, timeout: float | None = None, max_tokens: int | None = None) -> ChatOpenAI:
    """Builds and returns a configured LangChain ChatOpenAI client connected to Ollama or GLM."""
    if not settings.model_configured:
        raise ModelNotConfigured
    if settings.llm_provider == "ollama":
        return ChatOpenAI(
            model=settings.ollama_model,
            api_key="ollama",
            base_url=settings.ollama_base_url.rstrip("/") + "/",
            temperature=0,
            max_tokens=max_tokens or 350,
            timeout=timeout or settings.ollama_timeout_seconds,
            max_retries=settings.ollama_max_retries,
            model_kwargs={"response_format": {"type": "json_object"}},
        )
    return ChatOpenAI(
        model=settings.glm_model,
        api_key=settings.glm_api_key.get_secret_value(),
        base_url=settings.glm_base_url.rstrip("/") + "/",
        temperature=0,
        max_tokens=max_tokens or 1800,
        timeout=timeout or settings.glm_timeout_seconds,
        max_retries=settings.glm_max_retries,
    )
