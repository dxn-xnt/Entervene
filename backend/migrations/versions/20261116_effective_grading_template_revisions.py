"""Add immutable grading-template revisions, period overrides, and grade snapshots.

Revision ID: 20261116_grading_revisions
Revises: 20261115_academic_year_identity
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20261116_grading_revisions"
down_revision = "20261115_academic_year_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("grading_template", sa.Column("template_family_code", sa.String(100), nullable=True))
    op.add_column("grading_template", sa.Column("revision", sa.Integer(), nullable=True))
    op.add_column("grading_template", sa.Column("supersedes_template_id", sa.Integer(), nullable=True))
    op.add_column("grading_template", sa.Column("policy_reference", sa.String(255), nullable=True))
    op.add_column("grading_template", sa.Column("change_reason", sa.Text(), nullable=True))
    op.add_column("grading_template", sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute("UPDATE grading_template SET template_family_code = 'template-' || grading_template_id, revision = 1")
    op.alter_column("grading_template", "template_family_code", nullable=False)
    op.alter_column("grading_template", "revision", nullable=False)
    op.drop_constraint("uq_grading_template_name", "grading_template", type_="unique")
    op.create_unique_constraint("uq_grading_template_family_revision", "grading_template", ["template_family_code", "revision"])
    op.create_foreign_key("fk_grading_template_supersedes", "grading_template", "grading_template", ["supersedes_template_id"], ["grading_template_id"], ondelete="RESTRICT")
    op.drop_constraint("ck_grading_template_status", "grading_template", type_="check")
    op.create_check_constraint("ck_grading_template_status", "grading_template", "status IN ('draft', 'active', 'superseded', 'archived')")

    op.create_table(
        "subject_period_grading_template",
        sa.Column("subject_period_grading_template_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("subject_id", sa.Integer(), nullable=False),
        sa.Column("academic_period_id", sa.Integer(), nullable=False),
        sa.Column("grading_template_id", sa.Integer(), nullable=False),
        sa.Column("policy_reference", sa.String(255), nullable=True),
        sa.Column("change_reason", sa.String(1000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["subject_id"], ["subject.subject_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["academic_period_id"], ["academic_period.academic_period_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["grading_template_id"], ["grading_template.grading_template_id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("subject_period_grading_template_id"),
        sa.UniqueConstraint("subject_id", "academic_period_id", name="uq_subject_period_grading_template_scope"),
    )
    op.create_index("ix_subject_period_grading_template_subject_id", "subject_period_grading_template", ["subject_id"])
    op.create_index("ix_subject_period_grading_template_academic_period_id", "subject_period_grading_template", ["academic_period_id"])
    op.create_index("ix_subject_period_grading_template_grading_template_id", "subject_period_grading_template", ["grading_template_id"])

    for table in ("student_period_grade", "grade_submission_log"):
        op.add_column(table, sa.Column("applied_grading_template_id", sa.Integer(), nullable=True))
        op.add_column(table, sa.Column("written_work_weight", sa.Numeric(6, 2), nullable=True))
        op.add_column(table, sa.Column("performance_task_weight", sa.Numeric(6, 2), nullable=True))
        op.add_column(table, sa.Column("examination_weight", sa.Numeric(6, 2), nullable=True))
        op.add_column(table, sa.Column("grading_policy_reference", sa.String(255), nullable=True))
        op.create_foreign_key(f"fk_{table}_applied_grading_template", table, "grading_template", ["applied_grading_template_id"], ["grading_template_id"], ondelete="RESTRICT")
        op.create_check_constraint(f"ck_{table}_grading_weights", table, "(written_work_weight IS NULL OR written_work_weight BETWEEN 0 AND 100) AND (performance_task_weight IS NULL OR performance_task_weight BETWEEN 0 AND 100) AND (examination_weight IS NULL OR examination_weight BETWEEN 0 AND 100)")


def downgrade() -> None:
    connection = op.get_bind()
    revision_count = connection.execute(
        sa.text("SELECT COUNT(*) FROM grading_template WHERE revision > 1 OR status NOT IN ('active', 'archived')")
    ).scalar_one()
    period_override_count = connection.execute(
        sa.text("SELECT COUNT(*) FROM subject_period_grading_template")
    ).scalar_one()
    snapshot_count = sum(
        connection.execute(
            sa.text(f"SELECT COUNT(*) FROM {table} WHERE applied_grading_template_id IS NOT NULL")
        ).scalar_one()
        for table in ("student_period_grade", "grade_submission_log")
    )
    if revision_count or period_override_count or snapshot_count:
        raise RuntimeError(
            "Effective-dated grading data cannot be removed safely. Restore the verified pre-migration backup instead."
        )
    for table in ("grade_submission_log", "student_period_grade"):
        op.drop_constraint(f"ck_{table}_grading_weights", table, type_="check")
        op.drop_constraint(f"fk_{table}_applied_grading_template", table, type_="foreignkey")
        for column in ("grading_policy_reference", "examination_weight", "performance_task_weight", "written_work_weight", "applied_grading_template_id"):
            op.drop_column(table, column)
    op.drop_table("subject_period_grading_template")
    op.drop_constraint("ck_grading_template_status", "grading_template", type_="check")
    op.create_check_constraint("ck_grading_template_status", "grading_template", "status IN ('active', 'archived')")
    op.drop_constraint("fk_grading_template_supersedes", "grading_template", type_="foreignkey")
    op.drop_constraint("uq_grading_template_family_revision", "grading_template", type_="unique")
    op.create_unique_constraint("uq_grading_template_name", "grading_template", ["template_name"])
    for column in ("created_by_user_id", "change_reason", "policy_reference", "supersedes_template_id", "revision", "template_family_code"):
        op.drop_column("grading_template", column)
