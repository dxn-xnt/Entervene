"""add suggestion draft recommendation states

Revision ID: 20260626_suggestion_drafts
Revises: 20260626_suggestion_mvp
Create Date: 2026-06-26
"""

from alembic import op


revision = "20260626_suggestion_drafts"
down_revision = "20260626_suggestion_mvp"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_student_suggestion_type", "student_suggestion", type_="check")
    op.drop_constraint("ck_student_suggestion_status", "student_suggestion", type_="check")
    op.create_check_constraint(
        "ck_student_suggestion_type",
        "student_suggestion",
        "suggestion_type IN ('MANUAL', 'AUTOMATED')",
    )
    op.create_check_constraint(
        "ck_student_suggestion_status",
        "student_suggestion",
        "status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'DISMISSED', 'ARCHIVED')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_student_suggestion_status", "student_suggestion", type_="check")
    op.drop_constraint("ck_student_suggestion_type", "student_suggestion", type_="check")
    op.create_check_constraint(
        "ck_student_suggestion_status",
        "student_suggestion",
        "status IN ('ACTIVE', 'COMPLETED', 'DISMISSED', 'ARCHIVED')",
    )
    op.create_check_constraint(
        "ck_student_suggestion_type",
        "student_suggestion",
        "suggestion_type IN ('MANUAL')",
    )
