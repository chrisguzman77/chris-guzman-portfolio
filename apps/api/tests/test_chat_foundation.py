import uuid
from datetime import date

from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from portfolio_api.config import Settings
from portfolio_api.models import (
    ChatMessage,
    ChatOutcome,
    ChatSession,
    ChatUsageDaily,
    RagChunk,
    RagDocument,
)
from portfolio_api.rag.embedder import EMBEDDING_DIM, EMBEDDING_MODEL, FastEmbedEmbedder
from tests.fakes import FakeEmbedder

Sessions = async_sessionmaker[AsyncSession]


def test_phase5_settings_blank_means_unset() -> None:
    s = Settings(
        groq_api_key="",
        directus_token="",
        internal_secret="",
        chat_hash_salt="",
        embedding_cache_dir="",
    )
    assert s.groq_api_key is None
    assert s.directus_token is None
    assert s.internal_secret is None
    assert s.chat_hash_salt is None
    assert s.embedding_cache_dir is None
    assert s.groq_model == "openai/gpt-oss-120b"
    assert s.directus_url == "http://directus:8055"
    assert s.chat_daily_token_budget == 180_000
    assert s.chat_min_similarity == 0.5


def test_fake_embedder_is_deterministic_and_unit_length() -> None:
    a = FakeEmbedder.vector("FastAPI and Postgres")
    assert a == FakeEmbedder.vector("fastapi AND postgres")
    assert len(a) == EMBEDDING_DIM
    assert abs(sum(x * x for x in a) - 1.0) < 1e-9
    assert FakeEmbedder.vector("")[0] == 1.0


def test_fastembed_embedder_loads_lazily() -> None:
    embedder = FastEmbedEmbedder(cache_dir="/nonexistent")
    assert embedder.model_name == EMBEDDING_MODEL
    assert embedder._model is None  # pyright: ignore[reportPrivateUsage]


async def test_rag_tables_store_vectors_and_tsvector(db: Sessions) -> None:
    async with db.begin() as session:
        doc = RagDocument(source_type="projects", source_id="1", title="ACM", url="/projects/acm")
        session.add(doc)
        await session.flush()
        session.add(
            RagChunk(
                document_id=doc.id,
                content="ACM\n\nBuilt with FastAPI and PostgreSQL.",
                content_hash="h1",
                embedding=FakeEmbedder.vector("built with fastapi and postgresql"),
                embedding_model="fake-embedder",
            )
        )
    query = FakeEmbedder.vector("fastapi postgresql")
    async with db() as session:
        distance = await session.scalar(select(RagChunk.embedding.cosine_distance(query)))
        matched = await session.scalar(
            select(func.count())
            .select_from(RagChunk)
            .where(RagChunk.tsv.op("@@")(func.websearch_to_tsquery("english", "fastapi")))
        )
    assert distance is not None and 0.0 <= distance < 1.0
    assert matched == 1
    async with db.begin() as session:
        await session.execute(delete(RagDocument))
    async with db() as session:
        assert await session.scalar(select(func.count()).select_from(RagChunk)) == 0


async def test_chat_tables_cascade_and_defaults(db: Sessions) -> None:
    sid = uuid.uuid4()
    async with db.begin() as session:
        session.add(ChatSession(id=sid, ip_hash="abc"))
        await session.flush()
        session.add(
            ChatMessage(session_id=sid, question="q?", answer=None, outcome=ChatOutcome.error)
        )
        session.add(ChatUsageDaily(day=date(2026, 10, 2), tokens=10, requests=1))
    async with db() as session:
        row = await session.get(ChatSession, sid)
        assert row is not None and row.question_count == 0
        message = (await session.scalars(select(ChatMessage))).one()
        assert message.sources == [] and message.input_tokens == 0
    async with db.begin() as session:
        await session.execute(text("DELETE FROM chat_sessions"))
    async with db() as session:
        assert await session.scalar(select(func.count()).select_from(ChatMessage)) == 0
