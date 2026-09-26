"""Add private teacher support drafts for active interventions.

Revision ID: 20260926_intervention_support
Revises: 20260926_manual_coverage
"""

from alembic import op
import sqlalchemy as sa


revision = "20260926_intervention_support"
down_revision = "20260926_manual_coverage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "intervention_support_material",
        sa.Column("material_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("intervention_id", sa.Integer(), sa.ForeignKey("intervention.intervention_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="DRAFT"),
        sa.Column("evidence_basis", sa.JSON(), nullable=False),
        sa.Column("generated_content", sa.JSON(), nullable=True),
        sa.Column("current_content", sa.JSON(), nullable=False),
        sa.Column("created_by_staff_id", sa.String(20), sa.ForeignKey("academic_staff.staff_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("updated_by_staff_id", sa.String(20), sa.ForeignKey("academic_staff.staff_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("kind IN ('STUDENT_REVIEWER', 'REMEDIAL_ASSESSMENT')", name="ck_intervention_support_kind"),
        sa.CheckConstraint("status = 'DRAFT'", name="ck_intervention_support_status"),
        sa.UniqueConstraint("intervention_id", "kind", name="uq_intervention_support_kind"),
    )
    op.create_index("ix_intervention_support_material_intervention_id", "intervention_support_material", ["intervention_id"])


def downgrade() -> None:
    if op.get_bind().execute(sa.text("SELECT count(*) FROM intervention_support_material")).scalar():
        raise RuntimeError("Cannot discard saved intervention support drafts.")
    op.drop_index("ix_intervention_support_material_intervention_id", table_name="intervention_support_material")
    op.drop_table("intervention_support_material")
