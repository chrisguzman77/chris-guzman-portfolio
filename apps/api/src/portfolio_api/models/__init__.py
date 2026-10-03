from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base for every table in the ``portfolio`` database."""


# Imported after Base so Alembic's autogenerate sees every table through this module.
from portfolio_api.models.chat import (  # noqa: E402
    ChatMessage,
    ChatOutcome,
    ChatSession,
    ChatUsageDaily,
)
from portfolio_api.models.contact import ContactSubmission, EmailStatus  # noqa: E402
from portfolio_api.models.github import GitHubActivityCache  # noqa: E402
from portfolio_api.models.rag import RagChunk, RagDocument  # noqa: E402

__all__ = [
    "Base",
    "ChatMessage",
    "ChatOutcome",
    "ChatSession",
    "ChatUsageDaily",
    "ContactSubmission",
    "EmailStatus",
    "GitHubActivityCache",
    "RagChunk",
    "RagDocument",
]
