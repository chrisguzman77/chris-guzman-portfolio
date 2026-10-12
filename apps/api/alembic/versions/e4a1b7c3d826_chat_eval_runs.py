"""chat eval runs: one row per recorded chat-eval run

Revision ID: e4a1b7c3d826
Revises: c5d2f8a1e93b
Create Date: 2026-10-12 18:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e4a1b7c3d826"
down_revision: str | Sequence[str] | None = "c5d2f8a1e93b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CHAT_EVAL_KIND = postgresql.ENUM("answer", "redteam", name="chat_eval_kind", create_type=False)


def upgrade() -> None:
    """Upgrade schema."""
    postgresql.ENUM("answer", "redteam", name="chat_eval_kind").create(op.get_bind())
    op.create_table(
        "chat_eval_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kind", CHAT_EVAL_KIND, nullable=False),  # pyright: ignore[reportUnknownArgumentType]
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("commit", sa.Text(), nullable=True),
        sa.Column("cases", sa.Integer(), nullable=False),
        sa.Column("passed", sa.Integer(), nullable=False),
        sa.Column("answer_pass_rate", sa.Float(), nullable=True),
        sa.Column("refusal_pass_rate", sa.Float(), nullable=True),
        sa.Column("hit_at_5", sa.Float(), nullable=True),
        sa.Column("mrr", sa.Float(), nullable=True),
        sa.Column("latency_p50_ms", sa.Integer(), nullable=False),
        sa.Column("latency_p95_ms", sa.Integer(), nullable=False),
        sa.Column("tokens_per_question", sa.Float(), nullable=False),
        sa.Column("failures", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("chat_eval_runs")
    CHAT_EVAL_KIND.drop(op.get_bind())
