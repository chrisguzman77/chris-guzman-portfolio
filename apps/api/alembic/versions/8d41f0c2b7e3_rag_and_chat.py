"""rag index and chat tables

Revision ID: 8d41f0c2b7e3
Revises: 5c2e8a1f9d40
Create Date: 2026-10-02 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8d41f0c2b7e3"
down_revision: str | Sequence[str] | None = "5c2e8a1f9d40"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CHAT_OUTCOME = postgresql.ENUM(
    "answered", "no_match", "uncited", "error", name="chat_outcome", create_type=False
)


def upgrade() -> None:
    """Upgrade schema."""
    # No-op where the init script already created it (prod, dev); needed on a bare CI database.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    postgresql.ENUM("answered", "no_match", "uncited", "error", name="chat_outcome").create(
        op.get_bind()
    )
    op.create_table(
        "rag_documents",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_type", sa.String(length=32), nullable=False),
        sa.Column("source_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("url", sa.String(length=300), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_type", "source_id", name="uq_rag_documents_source"),
    )
    op.create_table(
        "rag_chunks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("document_id", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("embedding", Vector(384), nullable=False),
        sa.Column("embedding_model", sa.String(length=100), nullable=False),
        sa.Column(
            "tsv",
            postgresql.TSVECTOR(),
            sa.Computed("to_tsvector('english', content)", persisted=True),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["document_id"], ["rag_documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_id", "content_hash", name="uq_rag_chunks_document_hash"),
    )
    op.create_index("ix_rag_chunks_document_id", "rag_chunks", ["document_id"])
    op.create_index(
        "ix_rag_chunks_embedding",
        "rag_chunks",
        ["embedding"],
        postgresql_using="hnsw",
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )
    op.create_index("ix_rag_chunks_tsv", "rag_chunks", ["tsv"], postgresql_using="gin")
    op.create_table(
        "chat_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("ip_hash", sa.String(length=64), nullable=False),
        sa.Column("question_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_sessions_created_at", "chat_sessions", ["created_at"])
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=True),
        sa.Column("outcome", CHAT_OUTCOME, nullable=False),  # pyright: ignore[reportUnknownArgumentType]
        sa.Column(
            "sources",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("input_tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("output_tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["session_id"], ["chat_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_messages_session_id", "chat_messages", ["session_id"])
    op.create_table(
        "chat_usage_daily",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("tokens", sa.Integer(), server_default="0", nullable=False),
        sa.Column("requests", sa.Integer(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("day"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("chat_usage_daily")
    op.drop_index("ix_chat_messages_session_id", table_name="chat_messages")
    op.drop_table("chat_messages")
    op.drop_index("ix_chat_sessions_created_at", table_name="chat_sessions")
    op.drop_table("chat_sessions")
    op.drop_index("ix_rag_chunks_tsv", table_name="rag_chunks")
    op.drop_index("ix_rag_chunks_embedding", table_name="rag_chunks")
    op.drop_index("ix_rag_chunks_document_id", table_name="rag_chunks")
    op.drop_table("rag_chunks")
    op.drop_table("rag_documents")
    CHAT_OUTCOME.drop(op.get_bind())
    # The vector extension stays: the init script owns it.
