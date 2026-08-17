"""merge heads

Revision ID: 572462a5b498
Revises: 20260729_make_subject_load_staff_id_nullable, fe064f391d28
Create Date: 2026-08-02 13:41:27.667571

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '572462a5b498'
down_revision: Union[str, Sequence[str], None] = ('20260729_make_subject_load_staff_id_nullable', 'fe064f391d28')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
