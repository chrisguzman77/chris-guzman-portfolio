"""newsletter subscribers, sends and deliveries

Revision ID: b7c3e9a2d514
Revises: 8d41f0c2b7e3
Create Date: 2026-10-07 20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7c3e9a2d514"
down_revision: str | Sequence[str] | None = "8d41f0c2b7e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SUBSCRIBER_STATUS = postgresql.ENUM(
    "pending", "confirmed", name="subscriber_status", create_type=False
)


def upgrade() -> None:
    """Upgrade schema."""
    postgresql.ENUM("pending", "confirmed", name="subscriber_status").create(op.get_bind())
    op.create_table(
        "newsletter_subscribers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("status", SUBSCRIBER_STATUS, server_default="pending", nullable=False),
        sa.Column("confirm_token_hash", sa.String(length=64), nullable=True),
        sa.Column("confirm_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("confirm_token_hash"),
        sa.UniqueConstraint("email"),
    )
    op.create_table(
        "newsletter_sends",
        sa.Column("post_id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recipients", sa.Integer(), nullable=True),
        sa.PrimaryKeyConstraint("post_id"),
    )
    op.create_table(
        "newsletter_deliveries",
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("subscriber_id", sa.Uuid(), nullable=False),
        sa.Column(
            "sent_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["post_id"], ["newsletter_sends.post_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["subscriber_id"], ["newsletter_subscribers.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("post_id", "subscriber_id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("newsletter_deliveries")
    op.drop_table("newsletter_sends")
    op.drop_table("newsletter_subscribers")
    SUBSCRIBER_STATUS.drop(op.get_bind())
