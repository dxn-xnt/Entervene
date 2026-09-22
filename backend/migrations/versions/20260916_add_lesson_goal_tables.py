"""Add lesson_goal and lesson_goal_item tables.

Revision ID: 20260916_add_lesson_goals
Revises: 20260916_unified_prediction_risk
Create Date: 2026-09-16 21:05:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "20260916_add_lesson_goals"
down_revision = "20260916_unified_prediction_risk"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "lesson_goal",
        sa.Column("goal_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("class_id", sa.Integer(), nullable=False),
        sa.Column("subject_id", sa.Integer(), nullable=False),
        sa.Column("academic_period_id", sa.Integer(), nullable=False),
        sa.Column("created_by_staff_id", sa.String(length=20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["class_id"], ["class.class_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subject_id"], ["subject.subject_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["academic_period_id"], ["academic_period.academic_period_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_staff_id"], ["academic_staff.staff_id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("goal_id"),
        sa.UniqueConstraint("class_id", "subject_id", "academic_period_id", name="uq_lesson_goal_class_subject_period"),
    )
    op.create_index(op.f("ix_lesson_goal_class_id"), "lesson_goal", ["class_id"], unique=False)
    op.create_index(op.f("ix_lesson_goal_subject_id"), "lesson_goal", ["subject_id"], unique=False)
    op.create_index(op.f("ix_lesson_goal_academic_period_id"), "lesson_goal", ["academic_period_id"], unique=False)

    op.create_table(
        "lesson_goal_item",
        sa.Column("goal_item_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("goal_id", sa.Integer(), nullable=False),
        sa.Column("item_type", sa.String(length=20), nullable=False),
        sa.Column("lesson_id", sa.Integer(), nullable=True),
        sa.Column("classwork_id", sa.Integer(), nullable=True),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="1"),
        sa.ForeignKeyConstraint(["goal_id"], ["lesson_goal.goal_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lesson_id"], ["lesson.lesson_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["classwork_id"], ["classwork.classwork_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("goal_item_id"),
    )
    op.create_index(op.f("ix_lesson_goal_item_goal_id"), "lesson_goal_item", ["goal_id"], unique=False)


def downgrade():
    op.drop_index(op.f("ix_lesson_goal_item_goal_id"), table_name="lesson_goal_item")
    op.drop_table("lesson_goal_item")
    op.drop_index(op.f("ix_lesson_goal_academic_period_id"), table_name="lesson_goal")
    op.drop_index(op.f("ix_lesson_goal_subject_id"), table_name="lesson_goal")
    op.drop_index(op.f("ix_lesson_goal_class_id"), table_name="lesson_goal")
    op.drop_table("lesson_goal")
