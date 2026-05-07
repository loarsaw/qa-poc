from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from sqlalchemy.orm import selectinload
from typing import List
import json

from app.db.database import get_db
from app.models.models import ChatSession, ChatMessage
from app.schemas.schemas import (
    ChatSessionCreate,
    ChatSessionResponse,
    ChatSessionListItem,
    SendMessageRequest,
    SendMessageResponse,
    ChatMessageResponse,
    PaginatedResponse,
)
from app.services.llm_service import llm_service
from app.services.document_service import document_service

router = APIRouter()

# Models that are NOT valid Gemini model names — remap them
GEMINI_MODEL_FALLBACK = "gemini-flash-latest"

ALLOWED_MODELS = {
    "gemini-3.1-flash-lite-preview",
    "gemini-3.1-flash-lite-preview-lite",
    "gemini-flash-latest",
    "gemini-flash-latest-8b",
    "gemini-1.5-pro",
}


def _safe_model(model: str | None) -> str:
    if not model:
        return GEMINI_MODEL_FALLBACK
    clean = model.removeprefix("models/")
    if clean not in ALLOWED_MODELS:
        return GEMINI_MODEL_FALLBACK
    return clean



async def _get_session_with_messages(db: AsyncSession, session_id: str) -> ChatSession | None:
    result = await db.execute(
        select(ChatSession)
        .options(selectinload(ChatSession.messages))
        .where(ChatSession.id == session_id)
    )
    return result.scalar_one_or_none()


async def _get_session_only(db: AsyncSession, session_id: str) -> ChatSession | None:
    result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id)
    )
    return result.scalar_one_or_none()



@router.post("/sessions", response_model=ChatSessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    data: ChatSessionCreate,
    db: AsyncSession = Depends(get_db),
):
    session = ChatSession(
        title=data.title,
        model=_safe_model(data.model),  # FIX: Sanitize model name here
        system_prompt=data.system_prompt,
    )
    db.add(session)
    await db.commit()
    session = await _get_session_with_messages(db, session.id)
    return session


@router.get("/sessions", response_model=PaginatedResponse)
async def list_sessions(
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    total = (await db.execute(select(func.count(ChatSession.id)))).scalar()
    offset = (page - 1) * page_size
    result = await db.execute(
        select(ChatSession)
        .order_by(desc(ChatSession.updated_at))
        .offset(offset)
        .limit(page_size)
    )
    sessions = result.scalars().all()

    items = [ChatSessionListItem.model_validate(s) for s in sessions]

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, -(-total // page_size)),
    }


@router.get("/sessions/{session_id}", response_model=ChatSessionResponse)
async def get_session(session_id: str, db: AsyncSession = Depends(get_db)):
    session = await _get_session_with_messages(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(session_id: str, db: AsyncSession = Depends(get_db)):
    session = await _get_session_only(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await db.delete(session)
    await db.commit()



@router.post("/sessions/{session_id}/messages", response_model=SendMessageResponse)
async def send_message(
    session_id: str,
    data: SendMessageRequest,
    db: AsyncSession = Depends(get_db),
):
    session = await _get_session_only(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    history_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at)
        .limit(40)
    )
    history = history_result.scalars().all()

    context_docs: list = []
    source_documents: list = []
    if data.use_rag:
        context_docs = await document_service.get_context_for_rag(
            db, data.content, document_ids=data.document_ids
        )
        source_documents = [{"content": d[:200]} for d in context_docs]

    llm_messages = llm_service.build_messages(
        history=[{"role": m.role, "content": m.content} for m in history]
        + [{"role": "user", "content": data.content}],
        system_prompt=session.system_prompt,
        context_docs=context_docs or None,
    )

    # Sanitise model: never send an OpenAI model name to Gemini
    gemini_model = _safe_model(session.model)
    response = await llm_service.chat(llm_messages, model=gemini_model)

    user_msg = ChatMessage(
        session_id=session_id,
        role="user",
        content=data.content,
        token_count=llm_service.count_tokens(data.content),
    )
    db.add(user_msg)

    assistant_msg = ChatMessage(
        session_id=session_id,
        role="assistant",
        content=response["content"],
        token_count=response["token_count"],
        model=response["model"],
        finish_reason=response["finish_reason"],
        latency_ms=response["latency_ms"],
        source_documents=source_documents,
    )
    db.add(assistant_msg)

    session.message_count = (session.message_count or 0) + 2
    if not session.title:
        session.title = data.content[:60]

    await db.commit()
    await db.refresh(assistant_msg)
    await db.refresh(session)

    return {"message": assistant_msg, "session": session}


@router.post("/sessions/{session_id}/messages/stream")
async def stream_message(
    session_id: str,
    data: SendMessageRequest,
    db: AsyncSession = Depends(get_db),
):
    session = await _get_session_only(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    history_result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at)
        .limit(40)
    )
    history = history_result.scalars().all()

    context_docs: list = []
    if data.use_rag:
        context_docs = await document_service.get_context_for_rag(
            db, data.content, document_ids=data.document_ids
        )

    llm_messages = llm_service.build_messages(
        history=[{"role": m.role, "content": m.content} for m in history]
        + [{"role": "user", "content": data.content}],
        system_prompt=session.system_prompt,
        context_docs=context_docs or None,
    )

    gemini_model = _safe_model(session.model)

    async def event_generator():
        full_content = []
        async for chunk in llm_service.stream_chat(llm_messages, model=gemini_model):
            full_content.append(chunk)
            yield f"data: {json.dumps({'delta': chunk})}\n\n"

        from app.db.database import AsyncSessionLocal
        async with AsyncSessionLocal() as inner_db:
            user_msg = ChatMessage(
                session_id=session_id,
                role="user",
                content=data.content,
                token_count=llm_service.count_tokens(data.content),
            )
            inner_db.add(user_msg)
            full_text = "".join(full_content)
            assistant_msg = ChatMessage(
                session_id=session_id,
                role="assistant",
                content=full_text,
                token_count=llm_service.count_tokens(full_text),
                model=gemini_model,
            )
            inner_db.add(assistant_msg)
            sess_result = await inner_db.execute(
                select(ChatSession).where(ChatSession.id == session_id)
            )
            sess = sess_result.scalar_one_or_none()
            if sess:
                sess.message_count = (sess.message_count or 0) + 2
            await inner_db.commit()

        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/sessions/{session_id}/messages", response_model=List[ChatMessageResponse])
async def get_messages(
    session_id: str,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at)
        .limit(limit)
    )
    return result.scalars().all()