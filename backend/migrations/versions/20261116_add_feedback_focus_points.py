"""Add feedback focus points to student_submission and submission_feedback_draft.

Revision ID: 20261116_add_feedback_focus_points
Revises: 20261115_add_auto_ai_feedback
"""

from alembic import op
import sqlalchemy as sa


revision = "20261116_add_feedback_focus_points"
down_revision = "20261115_add_auto_ai_feedback"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    sub_cols = [c["name"] for c in inspector.get_columns("student_submission")]
    if "feedback_focus_points" not in sub_cols:
        op.add_column(
            "student_submission",
            sa.Column("feedback_focus_points", sa.JSON(), nullable=True),
        )

    tables = inspector.get_table_names()
    if "submission_feedback_draft" in tables:
        draft_cols = [c["name"] for c in inspector.get_columns("submission_feedback_draft")]
        if "focus_points" not in draft_cols:
            op.add_column(
                "submission_feedback_draft",
                sa.Column("focus_points", sa.JSON(), nullable=True),
            )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    tables = inspector.get_table_names()
    if "submission_feedback_draft" in tables:
        draft_cols = [c["name"] for c in inspector.get_columns("submission_feedback_draft")]
        if "focus_points" in draft_cols:
            op.drop_column("submission_feedback_draft", "focus_points")

    sub_cols = [c["name"] for c in inspector.get_columns("student_submission")]
    if "feedback_focus_points" in sub_cols:
        op.drop_column("student_submission", "feedback_focus_points")
