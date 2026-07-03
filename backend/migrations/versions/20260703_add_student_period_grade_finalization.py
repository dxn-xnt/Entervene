"""add student period grade finalization fields

Revision ID: 20260703_period_grade_finalization
Revises: 20260703_prediction_outcome_eval
Create Date: 2026-07-03
"""

from alembic import op
import sqlalchemy as sa


revision = "20260703_period_grade_finalization"
down_revision = "20260703_prediction_outcome_eval"
branch_labels = None
depends_on = None


def _column_exists(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def _foreign_key_exists(table_name: str, constraint_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(constraint["name"] == constraint_name for constraint in inspector.get_foreign_keys(table_name))


def upgrade() -> None:
    if not _column_exists("student_period_grade", "is_finalized"):
        op.add_column(
            "student_period_grade",
            sa.Column("is_finalized", sa.Boolean(), server_default=sa.false(), nullable=False),
        )
        op.alter_column("student_period_grade", "is_finalized", server_default=None)
    if not _column_exists("student_period_grade", "finalized_at"):
        op.add_column("student_period_grade", sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True))
    if not _column_exists("student_period_grade", "finalized_by_staff_id"):
        op.add_column("student_period_grade", sa.Column("finalized_by_staff_id", sa.String(length=20), nullable=True))

    if not _foreign_key_exists("student_period_grade", "fk_student_period_grade_finalized_by_staff_id"):
        op.create_foreign_key(
            "fk_student_period_grade_finalized_by_staff_id",
            "student_period_grade",
            "academic_staff",
            ["finalized_by_staff_id"],
            ["staff_id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    if _foreign_key_exists("student_period_grade", "fk_student_period_grade_finalized_by_staff_id"):
        op.drop_constraint("fk_student_period_grade_finalized_by_staff_id", "student_period_grade", type_="foreignkey")
    for column_name in ("finalized_by_staff_id", "finalized_at", "is_finalized"):
        if _column_exists("student_period_grade", column_name):
            op.drop_column("student_period_grade", column_name)
