import re
from typing import List, Optional, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, desc
from app.models.models import Document, DocumentChunk
from app.schemas.schemas import DocumentCreate


CHUNK_SIZE = 800      # characters per chunk
CHUNK_OVERLAP = 100   # overlap between chunks


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """Split text into overlapping chunks."""
    if len(text) <= chunk_size:
        return [text]

    chunks = []
    start = 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        # Try to break at sentence boundary
        if end < len(text):
            last_period = text.rfind(".", start, end)
            last_newline = text.rfind("\n", start, end)
            boundary = max(last_period, last_newline)
            if boundary > start + chunk_size // 2:
                end = boundary + 1
        chunks.append(text[start:end].strip())
        start = end - overlap
    return [c for c in chunks if c]


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


class DocumentService:
    async def create(self, db: AsyncSession, data: DocumentCreate) -> Document:
        doc = Document(
            title=data.title,
            content=data.content,
            source_type=data.source_type,
            metadata_=data.metadata or {},
        )
        db.add(doc)
        await db.flush()  # get doc.id

        # Chunk and store
        chunks = chunk_text(data.content)
        for i, chunk_text_val in enumerate(chunks):
            chunk = DocumentChunk(
                document_id=doc.id,
                chunk_index=i,
                content=chunk_text_val,
                token_count=estimate_tokens(chunk_text_val),
            )
            db.add(chunk)

        doc.chunk_count = len(chunks)
        await db.commit()
        await db.refresh(doc)
        return doc

    async def get(self, db: AsyncSession, doc_id: str) -> Optional[Document]:
        result = await db.execute(select(Document).where(Document.id == doc_id))
        return result.scalar_one_or_none()

    async def list(
        self,
        db: AsyncSession,
        page: int = 1,
        page_size: int = 20,
        source_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        query = select(Document)
        count_query = select(func.count(Document.id))
        if source_type:
            query = query.where(Document.source_type == source_type)
            count_query = count_query.where(Document.source_type == source_type)

        total = (await db.execute(count_query)).scalar()
        offset = (page - 1) * page_size
        result = await db.execute(
            query.order_by(desc(Document.created_at)).offset(offset).limit(page_size)
        )
        items = result.scalars().all()
        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": max(1, -(-total // page_size)),
        }

    async def delete(self, db: AsyncSession, doc_id: str) -> bool:
        doc = await self.get(db, doc_id)
        if not doc:
            return False
        await db.delete(doc)
        await db.commit()
        return True

    async def keyword_search(
        self,
        db: AsyncSession,
        query: str,
        limit: int = 5,
        source_types: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Simple keyword-based search over document chunks.
        In production, swap this for a vector search (pgvector / Pinecone).
        """
        keywords = re.findall(r"\w+", query.lower())
        if not keywords:
            return []

        chunk_query = select(DocumentChunk)
        conditions = [
            DocumentChunk.content.ilike(f"%{kw}%") for kw in keywords
        ]
        chunk_query = chunk_query.where(or_(*conditions)).limit(limit * 3)

        result = await db.execute(chunk_query)
        chunks = result.scalars().all()

        doc_scores: Dict[str, float] = {}
        doc_chunks: Dict[str, DocumentChunk] = {}

        for chunk in chunks:
            score = sum(
                chunk.content.lower().count(kw) for kw in keywords
            )
            if chunk.document_id not in doc_scores or score > doc_scores[chunk.document_id]:
                doc_scores[chunk.document_id] = float(score)
                doc_chunks[chunk.document_id] = chunk

        top_doc_ids = sorted(doc_scores, key=doc_scores.get, reverse=True)[:limit]

        results = []
        for doc_id in top_doc_ids:
            doc = await self.get(db, doc_id)
            if not doc:
                continue
            if source_types and doc.source_type not in source_types:
                continue
            max_score = max(doc_scores.values()) if doc_scores else 1
            results.append({
                "document": doc,
                "relevance_score": round(doc_scores[doc_id] / max_score, 4),
                "matched_chunk": doc_chunks[doc_id].content[:300],
            })

        return results

    async def get_context_for_rag(
        self,
        db: AsyncSession,
        query: str,
        document_ids: Optional[List[str]] = None,
        limit: int = 3,
    ) -> List[str]:
        """Return top-k chunk texts to inject as RAG context."""
        if document_ids:
            result = await db.execute(
                select(DocumentChunk)
                .where(DocumentChunk.document_id.in_(document_ids))
                .order_by(DocumentChunk.chunk_index)
                .limit(limit * 2)
            )
            chunks = result.scalars().all()
            return [c.content for c in chunks[:limit]]

        search_results = await self.keyword_search(db, query, limit=limit)
        return [r["matched_chunk"] for r in search_results if r.get("matched_chunk")]


document_service = DocumentService()