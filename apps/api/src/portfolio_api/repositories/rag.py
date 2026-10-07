from collections.abc import Collection, Sequence
from dataclasses import dataclass

from sqlalchemy import Text, cast, delete, func, select
from sqlalchemy.dialects.postgresql import TSQUERY, insert
from sqlalchemy.ext.asyncio import AsyncSession

from portfolio_api.models import RagChunk, RagDocument
from portfolio_api.rag.documents import SourceDocument


@dataclass(frozen=True)
class StoredDocument:
    id: int
    title: str
    url: str
    hashes: frozenset[str]


@dataclass(frozen=True)
class ChunkHit:
    chunk_id: int
    document_id: int
    title: str
    url: str
    content: str
    similarity: float | None  # cosine similarity; None for keyword-only hits


async def load_index(session: AsyncSession) -> dict[tuple[str, str], StoredDocument]:
    docs = (
        await session.execute(
            select(
                RagDocument.id,
                RagDocument.source_type,
                RagDocument.source_id,
                RagDocument.title,
                RagDocument.url,
            )
        )
    ).all()
    hashes: dict[int, set[str]] = {}
    for document_id, h in (
        await session.execute(select(RagChunk.document_id, RagChunk.content_hash))
    ).all():
        hashes.setdefault(document_id, set()).add(h)
    return {
        (source_type, source_id): StoredDocument(
            doc_id, title, url, frozenset(hashes.get(doc_id, set()))
        )
        for doc_id, source_type, source_id, title, url in docs
    }


async def upsert_document(session: AsyncSession, doc: SourceDocument) -> int:
    stmt = insert(RagDocument).values(
        source_type=doc.source_type, source_id=doc.source_id, title=doc.title, url=doc.url
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_rag_documents_source",
        set_={"title": stmt.excluded.title, "url": stmt.excluded.url, "updated_at": func.now()},
    ).returning(RagDocument.id)
    return (await session.execute(stmt)).scalar_one()


async def add_chunks(
    session: AsyncSession,
    document_id: int,
    chunks: Sequence[tuple[str, str, list[float]]],
    model: str,
) -> None:
    """Insert (hash, content, embedding) rows for one document."""
    for h, content, embedding in chunks:
        session.add(
            RagChunk(
                document_id=document_id,
                content=content,
                content_hash=h,
                embedding=embedding,
                embedding_model=model,
            )
        )
    await session.flush()


async def delete_chunks(session: AsyncSession, document_id: int, hashes: Collection[str]) -> None:
    if hashes:
        await session.execute(
            delete(RagChunk).where(
                RagChunk.document_id == document_id, RagChunk.content_hash.in_(list(hashes))
            )
        )


async def delete_documents(session: AsyncSession, ids: Collection[int]) -> None:
    if ids:
        await session.execute(delete(RagDocument).where(RagDocument.id.in_(list(ids))))


async def vector_search(
    session: AsyncSession, embedding: list[float], limit: int
) -> list[ChunkHit]:
    distance = RagChunk.embedding.cosine_distance(embedding)
    rows = (
        await session.execute(
            select(
                RagChunk.id,
                RagChunk.document_id,
                RagDocument.title,
                RagDocument.url,
                RagChunk.content,
                distance.label("distance"),
            )
            .join(RagDocument, RagDocument.id == RagChunk.document_id)
            .order_by(distance)
            .limit(limit)
        )
    ).all()
    return [ChunkHit(r[0], r[1], r[2], r[3], r[4], 1.0 - float(r[5])) for r in rows]


async def keyword_search(session: AsyncSession, query: str, limit: int) -> list[ChunkHit]:
    # Any term may match (OR), ranked by how many do: plainto_tsquery ANDs its lexemes, and
    # its text form ('a' & 'b') becomes 'a' | 'b'. Lexemes are quoted and never contain spaces.
    tsquery = cast(
        func.replace(cast(func.plainto_tsquery("english", query), Text), " & ", " | "), TSQUERY
    )
    rows = (
        await session.execute(
            select(
                RagChunk.id,
                RagChunk.document_id,
                RagDocument.title,
                RagDocument.url,
                RagChunk.content,
            )
            .join(RagDocument, RagDocument.id == RagChunk.document_id)
            .where(RagChunk.tsv.op("@@")(tsquery))
            .order_by(func.ts_rank_cd(RagChunk.tsv, tsquery).desc(), RagChunk.id)
            .limit(limit)
        )
    ).all()
    return [ChunkHit(r[0], r[1], r[2], r[3], r[4], None) for r in rows]
