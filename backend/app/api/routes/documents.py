from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.db.database import get_db
from app.services.document_service import document_service
from app.schemas.schemas import (
    DocumentCreate,
    DocumentResponse,
    DocumentListItem,
    DocumentSearchRequest,
    PaginatedResponse,
)

router = APIRouter()


@router.post("/", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
async def create_document(
    data: DocumentCreate,
    db: AsyncSession = Depends(get_db),
):
    doc = await document_service.create(db, data)
    return DocumentResponse.from_orm_safe(doc)


@router.get("/", response_model=PaginatedResponse)
async def list_documents(
    page: int = 1,
    page_size: int = 20,
    source_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    result = await document_service.list(
        db, page=page, page_size=page_size, source_type=source_type
    )
    result["items"] = [DocumentListItem.model_validate(d) for d in result["items"]]
    return result


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(document_id: str, db: AsyncSession = Depends(get_db)):
    doc = await document_service.get(db, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return DocumentResponse.from_orm_safe(doc)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(document_id: str, db: AsyncSession = Depends(get_db)):
    deleted = await document_service.delete(db, document_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")


@router.post("/search", response_model=list)
async def search_documents(
    data: DocumentSearchRequest,
    db: AsyncSession = Depends(get_db),
):
    results = await document_service.keyword_search(
        db, query=data.query, limit=data.limit, source_types=data.source_types
    )
    return [
        {
            "document_id":     r["document"].id,
            "title":           r["document"].title,
            "source_type":     r["document"].source_type,
            "relevance_score": r["relevance_score"],
            "matched_chunk":   r["matched_chunk"],
        }
        for r in results
    ]