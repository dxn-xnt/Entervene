"""merge subject load migration heads

Revision ID: 4a8f111c67a0
Revises: 20260911_subject_load_section_revisions, da1b36c9a0ef
Create Date: 2026-09-12 12:53:26.771765

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4a8f111c67a0'
down_revision: Union[str, Sequence[str], None] = ('20260911_subject_load_section_revisions', 'da1b36c9a0ef')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
