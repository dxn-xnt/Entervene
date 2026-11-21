"""Add is_shuffle_options to quiz_setting.

Revision ID: 20261121_quiz_shuffle_options
Revises: 20261121_merge_resources
Create Date: 2026-11-21
"""

from alembic import op
import sqlalchemy as sa


revision = "20261121_quiz_shuffle_options"
down_revision = "20261121_merge_resources"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "quiz_setting",
        sa.Column(
            "is_shuffle_options",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.alter_column("quiz_setting", "is_shuffle_options", server_default=None)


def downgrade() -> None:
    op.drop_column("quiz_setting", "is_shuffle_options")
