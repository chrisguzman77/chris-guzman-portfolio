from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from portfolio_api.models import Base


class GitHubActivityCache(Base):
    """Last good GitHub response per key; served when GitHub is slow or down."""

    __tablename__ = "github_activity_cache"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
