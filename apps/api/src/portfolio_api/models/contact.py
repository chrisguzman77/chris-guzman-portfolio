import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from portfolio_api.models import Base


class EmailStatus(enum.StrEnum):
    pending = "pending"
    sent = "sent"
    failed = "failed"


def _enum_values(e: type[EmailStatus]) -> list[str]:
    return [m.value for m in e]


class ContactSubmission(Base):
    """A contact-form message, saved before any email is attempted."""

    __tablename__ = "contact_submissions"
    __table_args__ = (Index("ix_contact_submissions_status_updated", "email_status", "updated_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(254))
    message: Mapped[str] = mapped_column(Text)
    email_status: Mapped[EmailStatus] = mapped_column(
        Enum(EmailStatus, name="email_status", values_callable=_enum_values),
        server_default=EmailStatus.pending.value,
    )
    attempts: Mapped[int] = mapped_column(Integer, server_default="0")
    last_error: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
