from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Computed,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from portfolio_api.models import Base
from portfolio_api.rag.embedder import EMBEDDING_DIM


class RagDocument(Base):
    """One published item (or the resume) as the chat sees it."""

    __tablename__ = "rag_documents"
    __table_args__ = (UniqueConstraint("source_type", "source_id", name="uq_rag_documents_source"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    source_type: Mapped[str] = mapped_column(String(32))
    source_id: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(300))
    url: Mapped[str] = mapped_column(String(300))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RagChunk(Base):
    """A searchable slice of a document: its embedding plus a generated full-text vector."""

    __tablename__ = "rag_chunks"
    __table_args__ = (
        UniqueConstraint("document_id", "content_hash", name="uq_rag_chunks_document_hash"),
        Index(
            "ix_rag_chunks_embedding",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        Index("ix_rag_chunks_tsv", "tsv", postgresql_using="gin"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("rag_documents.id", ondelete="CASCADE"), index=True
    )
    content: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64))
    embedding: Mapped[list[float]] = mapped_column(Vector(EMBEDDING_DIM))
    embedding_model: Mapped[str] = mapped_column(String(100))
    tsv: Mapped[str] = mapped_column(
        TSVECTOR, Computed("to_tsvector('english', content)", persisted=True)
    )
