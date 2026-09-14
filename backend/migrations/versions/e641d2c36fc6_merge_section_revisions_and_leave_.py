"""merge_section_revisions_and_leave_request_heads

Revision ID: e641d2c36fc6
Revises: da1b36c9a0ef, 20260911_subject_load_section_revisions
Create Date: 2026-09-11 17:56:04.311581

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e641d2c36fc6'
down_revision: Union[str, Sequence[str], None] = ('da1b36c9a0ef', '20260911_subject_load_section_revisions')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
