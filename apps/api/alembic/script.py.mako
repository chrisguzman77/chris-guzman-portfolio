<%!
def dquote(value):
    """repr() that prefers double quotes, matching this project's ruff format style."""
    return repr(value).replace("'", '"')
%>"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

"""

from collections.abc import Sequence

import sqlalchemy as sa  # noqa: F401

from alembic import op  # noqa: F401
${imports if imports else ""}
# revision identifiers, used by Alembic.
revision: str = ${dquote(up_revision)}
down_revision: str | Sequence[str] | None = ${dquote(down_revision)}
branch_labels: str | Sequence[str] | None = ${dquote(branch_labels)}
depends_on: str | Sequence[str] | None = ${dquote(depends_on)}


def upgrade() -> None:
    """Upgrade schema."""
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    """Downgrade schema."""
    ${downgrades if downgrades else "pass"}
