"""Add audit-only WW/PT remediation-to-original assignment linkage."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20261026_remediation_link"
down_revision = "20261022_passing_policy_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "remediation_assignment_link",
        sa.Column("remediation_link_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("source_intervention_id", sa.Integer(), nullable=False),
        sa.Column("remediation_assignment_id", sa.Integer(), nullable=False),
        sa.Column("original_assignment_id", sa.Integer(), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("component", sa.String(length=32), nullable=False),
        sa.Column("score_adjustment_cap", sa.Numeric(precision=5, scale=2), server_default="75.00", nullable=False),
        sa.Column("created_by_staff_id", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint("remediation_assignment_id <> original_assignment_id", name="ck_remediation_link_distinct_assignments"),
        sa.CheckConstraint("component IN ('WRITTEN_WORK', 'PERFORMANCE_TASK')", name="ck_remediation_link_component"),
        sa.CheckConstraint("score_adjustment_cap >= 0 AND score_adjustment_cap < 100", name="ck_remediation_link_cap_range"),
        sa.ForeignKeyConstraint(["source_intervention_id"], ["intervention.intervention_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["remediation_assignment_id"], ["classwork_assignment.classwork_assignment_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["original_assignment_id"], ["classwork_assignment.classwork_assignment_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["student_id"], ["student.student_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_staff_id"], ["academic_staff.staff_id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("remediation_link_id"),
        sa.UniqueConstraint("remediation_assignment_id", name="uq_remediation_link_attempt"),
        sa.UniqueConstraint("original_assignment_id", "student_id", name="uq_remediation_link_original_student"),
    )
    op.create_index("ix_remediation_link_original", "remediation_assignment_link", ["original_assignment_id"])
    op.create_index("ix_remediation_link_intervention", "remediation_assignment_link", ["source_intervention_id"])


def downgrade() -> None:
    op.drop_index("ix_remediation_link_intervention", table_name="remediation_assignment_link")
    op.drop_index("ix_remediation_link_original", table_name="remediation_assignment_link")
    op.drop_table("remediation_assignment_link")
