"""Add immutable remediation-generation teaching evidence snapshots.

Revision ID: 20261118_remediation_evidence
Revises: 20261116_merge_feedback_and_main
"""

from alembic import op
import sqlalchemy as sa


revision = "20261118_remediation_evidence"
down_revision = "20261116_merge_feedback_and_main"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "remediation_generation_evidence_snapshot",
        sa.Column("snapshot_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("intervention_id", sa.Integer(), sa.ForeignKey("intervention.intervention_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("original_evidence_cutoff_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("active_remediation_cutoff_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("refreshed_by_staff_id", sa.String(length=20), sa.ForeignKey("academic_staff.staff_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("evidence_payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("intervention_id", "version", name="uq_remediation_generation_evidence_version"),
    )
    op.create_index(
        "ix_remediation_generation_evidence_intervention",
        "remediation_generation_evidence_snapshot",
        ["intervention_id", "version"],
    )


def downgrade() -> None:
    op.drop_index("ix_remediation_generation_evidence_intervention", table_name="remediation_generation_evidence_snapshot")
    op.drop_table("remediation_generation_evidence_snapshot")
