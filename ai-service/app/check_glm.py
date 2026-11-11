"""Check GLM configuration and, when configured, make a PHI-free probe call."""

from __future__ import annotations

import sys

from pydantic import BaseModel, ConfigDict

from app.config import settings
from llm.client import MalformedModelResponse, ModelCallFailed, ModelNotConfigured
from llm.structured_output import invoke_structured_output


class ProbeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    ok: bool


def main() -> int:
    print(f"provider=glm model={settings.glm_model} configured={str(settings.glm_configured).lower()}")
    if not settings.glm_configured:
        print("GLM_API_KEY is missing; live connectivity was not attempted.")
        return 2
    try:
        result = invoke_structured_output(
            stage="connectivity_probe",
            schema=ProbeResponse,
            system_prompt="Return JSON with ok set to true. This is a connectivity check.",
            payload={"probe": "HLT-06 synthetic connectivity check"},
        )
    except (ModelNotConfigured, ModelCallFailed, MalformedModelResponse):
        print("GLM connectivity check failed; see the sanitized structured service log.")
        return 1
    if not result.ok:
        print("GLM responded, but the probe result was not successful.")
        return 1
    print("GLM connectivity check passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
