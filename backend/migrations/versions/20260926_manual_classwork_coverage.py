"""Record dated topic coverage for externally scored manual activities.

Revision ID: 20260926_manual_coverage
Revises: 20260926_intervention_diagnosis
"""

from alembic import op
import sqlalchemy as sa


revision = "20260926_manual_coverage"
down_revision = "20260926_intervention_diagnosis"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "classwork_coverage",
        sa.Column("coverage_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("classwork_id", sa.Integer(), sa.ForeignKey("classwork.classwork_id", ondelete="CASCADE"), nullable=False),
        sa.Column("lesson_id", sa.Integer(), sa.ForeignKey("lesson.lesson_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("competency_id", sa.Integer(), sa.ForeignKey("competency.competency_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("linked_by_staff_id", sa.String(20), sa.ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("removed_by_staff_id", sa.String(20), sa.ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True),
        sa.CheckConstraint("lesson_id IS NOT NULL OR competency_id IS NOT NULL", name="ck_classwork_coverage_target"),
        sa.CheckConstraint("valid_until IS NULL OR valid_until >= valid_from", name="ck_classwork_coverage_interval"),
    )
    op.create_index("ix_classwork_coverage_classwork", "classwork_coverage", ["classwork_id"])
    op.create_index(
        "uq_classwork_coverage_active_lesson", "classwork_coverage", ["classwork_id", "lesson_id"],
        unique=True, postgresql_where=sa.text("valid_until IS NULL AND lesson_id IS NOT NULL"),
        sqlite_where=sa.text("valid_until IS NULL AND lesson_id IS NOT NULL"),
    )
    op.create_index(
        "uq_classwork_coverage_active_competency", "classwork_coverage", ["classwork_id", "competency_id"],
        unique=True, postgresql_where=sa.text("valid_until IS NULL AND lesson_id IS NULL AND competency_id IS NOT NULL"),
        sqlite_where=sa.text("valid_until IS NULL AND lesson_id IS NULL AND competency_id IS NOT NULL"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT count(*) FROM classwork_coverage")).scalar():
        raise RuntimeError("Cannot discard assessment coverage history.")
    op.drop_index("uq_classwork_coverage_active_competency", table_name="classwork_coverage")
    op.drop_index("uq_classwork_coverage_active_lesson", table_name="classwork_coverage")
    op.drop_index("ix_classwork_coverage_classwork", table_name="classwork_coverage")
    op.drop_table("classwork_coverage")
