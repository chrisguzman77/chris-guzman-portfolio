"""chat feedback: a rating per message and daily rating counts

Revision ID: c5d2f8a1e93b
Revises: b7c3e9a2d514
Create Date: 2026-10-12 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c5d2f8a1e93b"
down_revision: str | Sequence[str] | None = "b7c3e9a2d514"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CHAT_FEEDBACK = postgresql.ENUM("up", "down", name="chat_feedback", create_type=False)


def upgrade() -> None:
    """Upgrade schema."""
    postgresql.ENUM("up", "down", name="chat_feedback").create(op.get_bind())
    op.add_column("chat_messages", sa.Column("feedback", CHAT_FEEDBACK, nullable=True))  # pyright: ignore[reportUnknownArgumentType]
    op.add_column(
        "chat_messages", sa.Column("feedback_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "chat_usage_daily",
        sa.Column("feedback_up", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "chat_usage_daily",
        sa.Column("feedback_down", sa.Integer(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("chat_usage_daily", "feedback_down")
    op.drop_column("chat_usage_daily", "feedback_up")
    op.drop_column("chat_messages", "feedback_at")
    op.drop_column("chat_messages", "feedback")
    CHAT_FEEDBACK.drop(op.get_bind())
