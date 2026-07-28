"""merge_heads

Revision ID: b57b02a3f427
Revises: 12aa5108d9e8, 525bfe30afd2
Create Date: 2026-07-28 12:02:23.619255

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b57b02a3f427'
down_revision: Union[str, Sequence[str], None] = ('12aa5108d9e8', '525bfe30afd2')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
