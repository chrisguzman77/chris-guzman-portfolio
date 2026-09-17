"""init

Revision ID: 37a0a41c316f
Revises:
Create Date: 2026-09-16 21:54:14.446475

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "37a0a41c316f"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
