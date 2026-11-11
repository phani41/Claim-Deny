import contextvars
import json
import logging
from datetime import datetime, timezone
from typing import Any

request_id_context: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")
logger = logging.getLogger("hlt06.ai")
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
logger.propagate = False

_SAFE_FIELDS = {
    "method", "path", "status_code", "elapsed_ms", "stage", "basis", "model",
    "input_tokens", "output_tokens", "requirement_count", "missing_count",
    "finding_count", "discarded_count", "point_count", "fact_count", "status",
    "mode", "error_type", "reason",
}


def log_event(event: str, *, level: str = "info", **fields: Any) -> None:
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "hlt06-ai-service",
        "requestId": request_id_context.get(),
        "event": event,
        # Drop unrecognized fields so accidental prompts, source text, or PHI cannot reach logs.
        **{key: value for key, value in fields.items() if key in _SAFE_FIELDS},
    }
    message = json.dumps(record, separators=(",", ":"), default=str)
    getattr(logger, level if level in {"debug", "info", "warning", "error"} else "info")(message)
