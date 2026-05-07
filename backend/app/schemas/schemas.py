from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Any, Dict
from datetime import datetime
from enum import Enum



class TranscriptionStatusEnum(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class MessageRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"



class ChatMessageBase(BaseModel):
    role: MessageRole
    content: str = Field(..., min_length=1, max_length=32000)


class ChatMessageCreate(ChatMessageBase):
    pass


class ChatMessageResponse(ChatMessageBase):
    id: str
    session_id: str
    token_count: int
    model: Optional[str] = None
    finish_reason: Optional[str] = None
    latency_ms: Optional[int] = None
    source_documents: List[Dict[str, Any]] = []
    created_at: datetime

    class Config:
        from_attributes = True


class ChatSessionCreate(BaseModel):
    title: Optional[str] = None
    system_prompt: Optional[str] = Field(None, max_length=4000)
    model: Optional[str] = "gemini-1.5-flash"


class ChatSessionResponse(BaseModel):
    id: str
    title: Optional[str]
    model: Optional[str]
    system_prompt: Optional[str]
    message_count: int
    created_at: datetime
    updated_at: Optional[datetime]
    messages: List[ChatMessageResponse] = []

    class Config:
        from_attributes = True


class ChatSessionListItem(BaseModel):
    id: str
    title: Optional[str]
    model: Optional[str]
    message_count: int
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class SendMessageRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=32000)
    use_rag: bool = False
    document_ids: Optional[List[str]] = None


class SendMessageResponse(BaseModel):
    message: ChatMessageResponse
    session: ChatSessionListItem



class DocumentCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    content: str = Field(..., min_length=1)
    source_type: str = "text"
    metadata: Optional[Dict[str, Any]] = {}


class DocumentChunkResponse(BaseModel):
    id: str
    chunk_index: int
    content: str
    token_count: int
    created_at: datetime

    class Config:
        from_attributes = True


class DocumentResponse(BaseModel):
    id: str
    title: str
    content: str
    source_type: str
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    metadata_: Optional[Dict[str, Any]] = Field(default=None)
    chunk_count: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {
        "from_attributes": True,
        "populate_by_name": True,
    }

    @classmethod
    def from_orm_safe(cls, doc: Any) -> "DocumentResponse":
        """Build response, safely coercing metadata_ to a plain dict."""
        raw_meta = getattr(doc, "metadata_", None)
        meta = raw_meta if isinstance(raw_meta, dict) else {}
        return cls(
            id=doc.id,
            title=doc.title,
            content=doc.content,
            source_type=doc.source_type,
            file_name=getattr(doc, "file_name", None),
            file_size=getattr(doc, "file_size", None),
            mime_type=getattr(doc, "mime_type", None),
            metadata_=meta,
            chunk_count=getattr(doc, "chunk_count", 0) or 0,
            created_at=doc.created_at,
            updated_at=getattr(doc, "updated_at", None),
        )


class DocumentListItem(BaseModel):
    id: str
    title: str
    source_type: str
    file_name: Optional[str]
    file_size: Optional[int]
    chunk_count: int
    created_at: datetime

    class Config:
        from_attributes = True


class DocumentSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=1000)
    limit: int = Field(5, ge=1, le=20)
    source_types: Optional[List[str]] = None


class DocumentSearchResult(BaseModel):
    document: DocumentListItem
    relevance_score: float
    matched_chunk: Optional[str] = None



class TranscriptionSegment(BaseModel):
    id: int
    start: float
    end: float
    text: str
    avg_logprob: Optional[float] = None


class TranscriptionResponse(BaseModel):
    id: str
    document_id: Optional[str]
    file_name: str
    file_size: Optional[int]
    mime_type: Optional[str]
    status: TranscriptionStatusEnum
    transcript_text: Optional[str]
    language: Optional[str]
    duration_seconds: Optional[float]
    segments: List[Any] = []
    error_message: Optional[str]
    whisper_model: Optional[str]
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class TranscriptionListItem(BaseModel):
    id: str
    document_id: Optional[str]
    file_name: str
    file_size: Optional[int]
    status: TranscriptionStatusEnum
    language: Optional[str]
    duration_seconds: Optional[float]
    created_at: datetime

    class Config:
        from_attributes = True



class PaginatedResponse(BaseModel):
    items: List[Any]
    total: int
    page: int
    page_size: int
    pages: int


class ErrorResponse(BaseModel):
    detail: str
    code: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    version: str
    database: str