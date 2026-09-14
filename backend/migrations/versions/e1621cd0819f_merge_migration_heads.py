"""merge migration heads

Revision ID: e1621cd0819f
Revises: 4a8f111c67a0, e3a5ee4dd468
Create Date: 2026-09-12 14:56:50.564447

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1621cd0819f'
down_revision: Union[str, Sequence[str], None] = ('4a8f111c67a0', 'e3a5ee4dd468')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
