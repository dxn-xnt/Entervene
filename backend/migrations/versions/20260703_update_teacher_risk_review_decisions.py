"""update teacher risk review decisions

Revision ID: 20260703_teacher_review_decisions
Revises: 20260703_period_grade_finalization
Create Date: 2026-07-03
"""

from alembic import op
import sqlalchemy as sa


revision = "20260703_teacher_review_decisions"
down_revision = "20260703_period_grade_finalization"
branch_labels = None
depends_on = None


def _constraint_exists(table_name: str, constraint_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(constraint["name"] == constraint_name for constraint in inspector.get_check_constraints(table_name))


def upgrade() -> None:
    if _constraint_exists("teacher_risk_review", "ck_teacher_risk_review_decision"):
        op.drop_constraint("ck_teacher_risk_review_decision", "teacher_risk_review", type_="check")
    op.create_check_constraint(
        "ck_teacher_risk_review_decision",
        "teacher_risk_review",
        "review_decision IN ('CONFIRMED_RISK', 'DISMISSED_RISK', 'NEEDS_MORE_DATA', 'INTERVENTION_ASSIGNED', 'ESCALATED')",
    )


def downgrade() -> None:
    if _constraint_exists("teacher_risk_review", "ck_teacher_risk_review_decision"):
        op.drop_constraint("ck_teacher_risk_review_decision", "teacher_risk_review", type_="check")
    op.create_check_constraint(
        "ck_teacher_risk_review_decision",
        "teacher_risk_review",
        "review_decision IN ('NEEDS_INTERVENTION', 'CONTINUE_MONITORING', 'NOT_AT_RISK', 'INSUFFICIENT_DATA')",
    )
