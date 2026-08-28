"""merge 20260824 heads

Revision ID: 56ff08b67dc7
Revises: 20260824_add_competency_entity, 20260824_update_teacher_employment_statuses
Create Date: 2026-08-25 18:59:04.872394

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '56ff08b67dc7'
down_revision: Union[str, Sequence[str], None] = ('20260824_add_competency_entity', '20260824_update_teacher_employment_statuses')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
