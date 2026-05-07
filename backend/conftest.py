"""
pytest configuration – provides:
  - async test client (httpx + ASGITransport)
  - in-memory SQLite database (aiosqlite) so tests need no real Postgres
  - mock for Gemini & Google STT so tests run without real API keys
"""
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, MagicMock, patch
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db.database import Base, get_db


TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestSessionLocal = async_sessionmaker(
    test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def override_get_db():
    async with TestSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


app.dependency_overrides[get_db] = override_get_db



@pytest_asyncio.fixture(scope="session", autouse=True)
async def create_tables():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def db_session():
    async with TestSessionLocal() as session:
        yield session


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac



@pytest.fixture(autouse=True)
def mock_gemini(monkeypatch):
    """Patch google.generativeai so no real API calls are made."""
    mock_response = MagicMock()
    mock_response.text = "Mocked Gemini response"
    mock_response.usage_metadata.candidates_token_count = 10

    mock_chat = MagicMock()
    mock_chat.send_message.return_value = mock_response

    mock_model = MagicMock()
    mock_model.start_chat.return_value = mock_chat
    mock_model.generate_content.return_value = mock_response

    with patch("google.generativeai.GenerativeModel", return_value=mock_model), \
         patch("google.generativeai.configure"):
        yield mock_model


@pytest.fixture
def mock_transcription_service():
    """Return a fixed transcription result without real file I/O or API calls."""
    with patch(
        "app.services.transcription_service.transcription_service.transcribe",
        new_callable=AsyncMock,
        return_value={
            "text": "Hello world this is a test transcription.",
            "language": "en-US",
            "duration": 5.0,
            "segments": [{"id": 0, "text": "Hello world", "start": 0.0, "end": 2.5}],
            "model": "gemini-multimodal/gemini-flash-latest",
        },
    ) as m:
        yield m


@pytest.fixture
def mock_save_upload():
    with patch(
        "app.services.transcription_service.transcription_service.save_upload",
        new_callable=AsyncMock,
        return_value="/tmp/uploads/test.mp3",
    ) as m:
        yield m