"""contact submissions and github activity cache

Revision ID: 5c2e8a1f9d40
Revises: 37a0a41c316f
Create Date: 2026-10-02 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5c2e8a1f9d40"
down_revision: str | Sequence[str] | None = "37a0a41c316f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

EMAIL_STATUS = postgresql.ENUM("pending", "sent", "failed", name="email_status", create_type=False)


def upgrade() -> None:
    """Upgrade schema."""
    postgresql.ENUM("pending", "sent", "failed", name="email_status").create(op.get_bind())
    op.create_table(
        "contact_submissions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column[str]("email_status", EMAIL_STATUS, server_default="pending", nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_contact_submissions_status_updated",
        "contact_submissions",
        ["email_status", "updated_at"],
    )
    op.create_table(
        "github_activity_cache",
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("github_activity_cache")
    op.drop_index("ix_contact_submissions_status_updated", table_name="contact_submissions")
    op.drop_table("contact_submissions")
    postgresql.ENUM(name="email_status").drop(op.get_bind())
