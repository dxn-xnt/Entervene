"""Merge historical suggestions and latest main grading revisions heads.

Revision ID: 20261116_merge_historical_suggestions_main
Revises: ('20261116_grading_revisions', '20261114_merge_suggestion_duration')
Create Date: 2026-11-16 21:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20261116_merge_historical_suggestions_main"
down_revision: Union[str, Sequence[str], None] = (
    "20261116_grading_revisions",
    "20261114_merge_suggestion_duration",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
