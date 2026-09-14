"""add Phase 1 prediction evidence scope columns

Revision ID: 20260911_prediction_evidence_scope
Revises: 20260911_exams_standard
Create Date: 2026-09-11 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260911_prediction_evidence_scope"
down_revision: Union[str, Sequence[str], None] = "20260911_exams_standard"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "classwork_assignment",
        sa.Column("academic_period_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_classwork_assignment_academic_period_id",
        "classwork_assignment",
        "academic_period",
        ["academic_period_id"],
        ["academic_period_id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_classwork_assignment_period_class",
        "classwork_assignment",
        ["academic_period_id", "class_id"],
    )

    op.add_column("ai_prediction", sa.Column("evidence_snapshot", sa.JSON(), nullable=True))
    op.add_column("ai_prediction", sa.Column("generation_request_id", sa.String(length=100), nullable=True))
    op.create_unique_constraint(
        "uq_ai_prediction_generation_request_id",
        "ai_prediction",
        ["generation_request_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_ai_prediction_generation_request_id", "ai_prediction", type_="unique")
    op.drop_column("ai_prediction", "generation_request_id")
    op.drop_column("ai_prediction", "evidence_snapshot")

    op.drop_index("ix_classwork_assignment_period_class", table_name="classwork_assignment")
    op.drop_constraint(
        "fk_classwork_assignment_academic_period_id",
        "classwork_assignment",
        type_="foreignkey",
    )
    op.drop_column("classwork_assignment", "academic_period_id")
