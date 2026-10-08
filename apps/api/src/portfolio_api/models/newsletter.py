import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from portfolio_api.models import Base


class SubscriberStatus(enum.StrEnum):
    pending = "pending"
    confirmed = "confirmed"


def _enum_values(e: type[SubscriberStatus]) -> list[str]:
    return [m.value for m in e]


class NewsletterSubscriber(Base):
    """An email address that asked for new-post emails; deleted on unsubscribe."""

    __tablename__ = "newsletter_subscribers"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(254), unique=True)  # lowercased and trimmed
    status: Mapped[SubscriberStatus] = mapped_column(
        Enum(SubscriberStatus, name="subscriber_status", values_callable=_enum_values),
        server_default=SubscriberStatus.pending.value,
    )
    confirm_token_hash: Mapped[str | None] = mapped_column(String(64), unique=True)
    confirm_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NewsletterSend(Base):
    """One post's send. completed_at is set once every confirmed subscriber has it."""

    __tablename__ = "newsletter_sends"

    post_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    recipients: Mapped[int | None] = mapped_column(Integer)


class NewsletterDelivery(Base):
    """A post accepted by Resend for one subscriber; the key makes a resumed send skip them."""

    __tablename__ = "newsletter_deliveries"

    post_id: Mapped[int] = mapped_column(
        ForeignKey("newsletter_sends.post_id", ondelete="CASCADE"), primary_key=True
    )
    subscriber_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("newsletter_subscribers.id", ondelete="CASCADE"), primary_key=True
    )
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
