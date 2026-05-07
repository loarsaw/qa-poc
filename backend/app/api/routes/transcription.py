from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from typing import Optional
import os

from app.db.database import get_db
from app.models.models import Transcription, TranscriptionStatus
from app.schemas.schemas import (
    TranscriptionResponse,
    TranscriptionListItem,
    PaginatedResponse,
    DocumentCreate,
)
from app.services.transcription_service import transcription_service
from app.services.document_service import document_service
from app.core.config import settings

router = APIRouter()

MAX_SIZE = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024


@router.post("/", response_model=TranscriptionResponse, status_code=status.HTTP_202_ACCEPTED)
async def upload_and_transcribe(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
    save_as_document: bool = Form(True),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    if not transcription_service.is_supported(file.filename):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file type '{file.filename}'. "
                "Supported: mp3, mp4, m4a, wav, webm, ogg, flac, mpga, mov, avi, mkv"
            ),
        )

    file_bytes = await file.read()
    if len(file_bytes) > MAX_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Max: {settings.MAX_UPLOAD_SIZE_MB} MB",
        )

    file_path = await transcription_service.save_upload(file_bytes, file.filename)
    mime_type = transcription_service.get_mime_type(file.filename)

    transcription = Transcription(
        file_name=file.filename,
        file_path=file_path,
        file_size=len(file_bytes),
        mime_type=mime_type,
        status=TranscriptionStatus.PENDING,
    )
    db.add(transcription)
    await db.commit()
    await db.refresh(transcription)

    background_tasks.add_task(
        _run_transcription,
        transcription_id=transcription.id,
        file_path=file_path,
        language=language,
        save_as_document=save_as_document,
    )

    return transcription


async def _run_transcription(
    transcription_id: str,
    file_path: str,
    language: Optional[str],
    save_as_document: bool,
):
    from app.db.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Transcription).where(Transcription.id == transcription_id)
        )
        transcription = result.scalar_one_or_none()
        if not transcription:
            return

        transcription.status = TranscriptionStatus.PROCESSING
        await db.commit()

        try:
            data = await transcription_service.transcribe(file_path, language=language)

            transcription.status         = TranscriptionStatus.COMPLETED
            transcription.transcript_text = data["text"]
            transcription.language       = data["language"]
            transcription.duration_seconds = data["duration"]
            transcription.segments       = data["segments"]
            transcription.whisper_model  = data["model"]

            if save_as_document and data["text"]:
                source = "audio" if "audio" in (transcription.mime_type or "") else "video"
                doc = await document_service.create(
                    db,
                    DocumentCreate(
                        title=f"Transcript: {transcription.file_name}",
                        content=data["text"],
                        source_type=source,
                        metadata={
                            "transcription_id": transcription.id,
                            "language":         data["language"],
                            "duration_seconds": data["duration"],
                            "model":            data["model"],
                        },
                    ),
                )
                transcription.document_id = doc.id

        except Exception as e:
            transcription.status        = TranscriptionStatus.FAILED
            transcription.error_message = str(e)
        finally:
            try:
                if os.path.exists(file_path):
                    os.remove(file_path)
            except Exception:
                pass

        await db.commit()


@router.get("/", response_model=PaginatedResponse)
async def list_transcriptions(
    page: int = 1,
    page_size: int = 20,
    status_filter: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query       = select(Transcription)
    count_query = select(func.count(Transcription.id))

    if status_filter:
        try:
            s = TranscriptionStatus(status_filter)
            query       = query.where(Transcription.status == s)
            count_query = count_query.where(Transcription.status == s)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid status filter")

    total  = (await db.execute(count_query)).scalar()
    offset = (page - 1) * page_size
    result = await db.execute(
        query.order_by(desc(Transcription.created_at)).offset(offset).limit(page_size)
    )
    items = [TranscriptionListItem.model_validate(t) for t in result.scalars().all()]

    return {
        "items":     items,
        "total":     total,
        "page":      page,
        "page_size": page_size,
        "pages":     max(1, -(-total // page_size)),
    }


@router.get("/{transcription_id}", response_model=TranscriptionResponse)
async def get_transcription(transcription_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Transcription).where(Transcription.id == transcription_id)
    )
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Transcription not found")
    return t


@router.delete("/{transcription_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_transcription(transcription_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Transcription).where(Transcription.id == transcription_id)
    )
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(status_code=404, detail="Transcription not found")
    await db.delete(t)
    await db.commit()