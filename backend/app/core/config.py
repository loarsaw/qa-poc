from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # App
    APP_NAME: str = "QA Chatbot API"
    DEBUG: bool = False
    SECRET_KEY: str = "change-me-in-production"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://user:POSTGRES_PASSWORD@db:5432/qadb"

    # Google / Gemini
    GOOGLE_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-1.5-flash"          # or gemini-1.5-pro
    GEMINI_VISION_MODEL: str = "gemini-1.5-flash"

    # Google Speech-to-Text (for audio transcription)
    # Leave blank to fall back to Gemini multimodal transcription
    GOOGLE_APPLICATION_CREDENTIALS: str = ""        # path to service-account JSON

    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:5173"]

    # File uploads
    MAX_UPLOAD_SIZE_MB: int = 100
    UPLOAD_DIR: str = "/tmp/uploads"

    # LLM settings
    MAX_TOKENS: int = 2048
    TEMPERATURE: float = 0.7

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()