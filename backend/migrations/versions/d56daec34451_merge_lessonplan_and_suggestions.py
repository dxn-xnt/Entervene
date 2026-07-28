"""merge_lessonplan_and_suggestions

Revision ID: d56daec34451
Revises: 12aa5108d9e8, 525bfe30afd2
Create Date: 2026-07-28 11:40:00.126193

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd56daec34451'
down_revision: Union[str, Sequence[str], None] = ('12aa5108d9e8', '525bfe30afd2')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
