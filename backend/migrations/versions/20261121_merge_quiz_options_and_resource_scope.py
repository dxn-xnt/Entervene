"""Merge quiz shuffle options and resource repost scope migration branches.

Revision ID: 20261121_merge_quiz_and_scope
Revises: 20261121_quiz_shuffle_options, 20261121_resource_repost_scope
"""

from typing import Sequence, Union


revision: str = "20261121_merge_quiz_and_scope"
down_revision: Union[str, Sequence[str], None] = (
    "20261121_quiz_shuffle_options",
    "20261121_resource_repost_scope",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Join the quiz options and intervention resource scope branches."""


def downgrade() -> None:
    """Split the migration graph back into its two parent heads."""
