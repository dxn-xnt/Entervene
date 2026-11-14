"""Preserve the class and academic period of new study suggestions.

Revision ID: 20261114_suggestion_period_origin
Revises: 20261113_suggestion_links
"""

from alembic import op
import sqlalchemy as sa


revision = "20261114_suggestion_period_origin"
down_revision = "20261113_suggestion_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("student_suggestion", sa.Column("origin_class_id", sa.Integer(), nullable=True))
    op.add_column("student_suggestion", sa.Column("origin_academic_period_id", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_student_suggestion_origin_pair", "student_suggestion",
        "(origin_class_id IS NULL AND origin_academic_period_id IS NULL) OR "
        "(origin_class_id IS NOT NULL AND origin_academic_period_id IS NOT NULL)",
    )
    op.create_foreign_key(
        "fk_student_suggestion_origin_class", "student_suggestion", "class",
        ["origin_class_id"], ["class_id"], ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_student_suggestion_origin_period", "student_suggestion", "academic_period",
        ["origin_academic_period_id"], ["academic_period_id"], ondelete="RESTRICT",
    )
    op.create_index(
        "ix_student_suggestion_origin_period", "student_suggestion",
        ["origin_academic_period_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_student_suggestion_origin_period", table_name="student_suggestion")
    op.drop_constraint("fk_student_suggestion_origin_period", "student_suggestion", type_="foreignkey")
    op.drop_constraint("fk_student_suggestion_origin_class", "student_suggestion", type_="foreignkey")
    op.drop_constraint("ck_student_suggestion_origin_pair", "student_suggestion", type_="check")
    op.drop_column("student_suggestion", "origin_academic_period_id")
    op.drop_column("student_suggestion", "origin_class_id")
