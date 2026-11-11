from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    ai_service_token: SecretStr = SecretStr("")
    llm_provider: str = "ollama"
    ollama_base_url: str = "http://127.0.0.1:11434/v1"
    ollama_model: str = "llama3.2:1b"
    ollama_timeout_seconds: float = 5.0
    ollama_max_retries: int = 0
    glm_api_key: SecretStr = SecretStr("")
    glm_base_url: str = "https://api.z.ai/api/paas/v4"
    glm_model: str = "glm-5.3"
    glm_timeout_seconds: float = 35.0
    glm_max_retries: int = 1
    uploads_dir: Path = SERVICE_ROOT.parent / "backend" / "uploads"
    max_upload_mb: int = Field(default=10, ge=1, le=20)

    model_config = SettingsConfigDict(
        env_file=SERVICE_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def model_configured(self) -> bool:
        if self.llm_provider == "ollama":
            return bool(self.ollama_model.strip())
        return bool(self.glm_api_key.get_secret_value().strip())

    @property
    def glm_configured(self) -> bool:
        return self.model_configured

    @property
    def active_model(self) -> str:
        return self.ollama_model if self.llm_provider == "ollama" else self.glm_model

    @property
    def internal_auth_configured(self) -> bool:
        return len(self.ai_service_token.get_secret_value().strip()) >= 32

    @property
    def uploads_directory(self) -> Path:
        return self.uploads_dir if self.uploads_dir.is_absolute() else (SERVICE_ROOT / self.uploads_dir).resolve()


settings = Settings()
