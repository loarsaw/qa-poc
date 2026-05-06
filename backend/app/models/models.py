from sqlalchemy import Column, String, Text, Integer, Float, DateTime, ForeignKey, JSON, Enum as SAEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum

from app.db.database import Base


def gen_uuid():
    return str(uuid.uuid4())


class TranscriptionStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class Document(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True, default=gen_uuid)
    title = Column(String(500), nullable=False)
    content = Column(Text, nullable=False)
    source_type = Column(String(50), default="text")   # text | audio | video | pdf
    file_path = Column(String(1000), nullable=True)
    file_name = Column(String(500), nullable=True)
    file_size = Column(Integer, nullable=True)
    mime_type = Column(String(100), nullable=True)
    metadata_ = Column("metadata", JSON, default=dict)
    chunk_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    transcription = relationship("Transcription", back_populates="document", uselist=False)
    chunks = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(String, primary_key=True, default=gen_uuid)
    document_id = Column(String, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    token_count = Column(Integer, default=0)
    embedding_id = Column(String, nullable=True)   # reference to vector store
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    document = relationship("Document", back_populates="chunks")


class Transcription(Base):
    __tablename__ = "transcriptions"

    id = Column(String, primary_key=True, default=gen_uuid)
    document_id = Column(String, ForeignKey("documents.id", ondelete="CASCADE"), nullable=True)
    file_name = Column(String(500), nullable=False)
    file_path = Column(String(1000), nullable=True)
    file_size = Column(Integer, nullable=True)
    mime_type = Column(String(100), nullable=True)
    status = Column(SAEnum(TranscriptionStatus), default=TranscriptionStatus.PENDING)
    transcript_text = Column(Text, nullable=True)
    language = Column(String(10), nullable=True)
    duration_seconds = Column(Float, nullable=True)
    segments = Column(JSON, default=list)       # word-level timestamps
    error_message = Column(Text, nullable=True)
    whisper_model = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    document = relationship("Document", back_populates="transcription")


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(String, primary_key=True, default=gen_uuid)
    title = Column(String(500), nullable=True)
    model = Column(String(100), nullable=True)
    system_prompt = Column(Text, nullable=True)
    message_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan", order_by="ChatMessage.created_at")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(String, primary_key=True, default=gen_uuid)
    session_id = Column(String, ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(20), nullable=False)   # user | assistant | system
    content = Column(Text, nullable=False)
    token_count = Column(Integer, default=0)
    model = Column(String(100), nullable=True)
    finish_reason = Column(String(50), nullable=True)
    latency_ms = Column(Integer, nullable=True)
    source_documents = Column(JSON, default=list)   # RAG context docs used
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("ChatSession", back_populates="messages")