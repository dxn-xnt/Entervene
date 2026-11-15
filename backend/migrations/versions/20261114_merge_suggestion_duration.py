"""Merge suggestion period origin and offering duration heads.

Revision ID: 20261114_merge_suggestion_duration
Revises: ('20261114_offering_duration', '20261114_suggestion_period_origin')
Create Date: 2026-11-14 22:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20261114_merge_suggestion_duration"
down_revision: Union[str, Sequence[str], None] = (
    "20261114_offering_duration",
    "20261114_suggestion_period_origin",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
