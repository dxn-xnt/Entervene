"""Merge Automatic AI Feedback and Main Historical Suggestions heads.

Revision ID: 20261116_merge_feedback_and_main
Revises: ('20261116_merge_historical_suggestions_main', '20261116_add_feedback_focus_points')
Create Date: 2026-11-16 22:30:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20261116_merge_feedback_and_main"
down_revision: Union[str, Sequence[str], None] = (
    "20261116_merge_historical_suggestions_main",
    "20261116_add_feedback_focus_points",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
