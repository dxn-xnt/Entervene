"""Add customizable Activity scoring rubric levels.

Revision ID: 20260920_activity_rubrics
Revises: 20260916_add_lesson_goals
Create Date: 2026-09-20 10:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260920_activity_rubrics"
down_revision = "20260916_add_lesson_goals"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "activity_rubric_level",
        sa.Column("rubric_level_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("classwork_id", sa.Integer(), nullable=False),
        sa.Column("level_name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("points", sa.Numeric(8, 2), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["classwork_id"], ["classwork.classwork_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("rubric_level_id"),
    )
    op.create_index(
        "ix_activity_rubric_level_classwork_id",
        "activity_rubric_level",
        ["classwork_id"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_activity_rubric_level_classwork_id", table_name="activity_rubric_level")
    op.drop_table("activity_rubric_level")
