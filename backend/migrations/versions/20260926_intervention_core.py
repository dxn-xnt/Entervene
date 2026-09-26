"""Add durable interventions linked to corrected prediction revisions.

Revision ID: 20260926_intervention_core
Revises: 20260925_user_avatar_path
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260926_intervention_core"
down_revision = "20260925_user_avatar_path"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "intervention",
        sa.Column("intervention_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("student.student_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("class_id", sa.Integer(), sa.ForeignKey("class.class_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subject.subject_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("academic_period_id", sa.Integer(), sa.ForeignKey("academic_period.academic_period_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("source_prediction_id", sa.Integer(), sa.ForeignKey("development_current_term_prediction.prediction_id", ondelete="RESTRICT"), nullable=False, unique=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="CANDIDATE"),
        sa.Column("resolution_reason", sa.String(80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("activated_by_staff_id", sa.String(20), sa.ForeignKey("academic_staff.staff_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('CANDIDATE', 'ACTIVE', 'RESOLVED')", name="ck_intervention_status"),
        sa.CheckConstraint(
            "(status = 'RESOLVED' AND resolution_reason IS NOT NULL AND resolved_at IS NOT NULL) "
            "OR (status <> 'RESOLVED' AND resolution_reason IS NULL AND resolved_at IS NULL)",
            name="ck_intervention_resolution",
        ),
        sa.CheckConstraint(
            "(activated_at IS NULL AND activated_by_staff_id IS NULL) OR "
            "(activated_at IS NOT NULL AND activated_by_staff_id IS NOT NULL)",
            name="ck_intervention_activation_pair",
        ),
        sa.CheckConstraint("status <> 'ACTIVE' OR activated_at IS NOT NULL", name="ck_intervention_active_requires_activation"),
    )
    op.create_index(
        "uq_intervention_open_scope",
        "intervention",
        ["student_id", "class_id", "subject_id", "academic_period_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('CANDIDATE', 'ACTIVE')"),
        sqlite_where=sa.text("status IN ('CANDIDATE', 'ACTIVE')"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT count(*) FROM intervention")).scalar():
        raise RuntimeError("Cannot downgrade while intervention history exists.")
    op.drop_index("uq_intervention_open_scope", table_name="intervention")
    op.drop_table("intervention")
