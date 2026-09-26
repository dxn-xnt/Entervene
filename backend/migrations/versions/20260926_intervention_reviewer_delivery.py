"""Record one teacher-approved reviewer delivery.

Revision ID: 20260926_reviewer_delivery
Revises: 20260926_intervention_support
"""

from alembic import op
import sqlalchemy as sa


revision = "20260926_reviewer_delivery"
down_revision = "20260926_intervention_support"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_intervention_support_status", "intervention_support_material", type_="check")
    op.add_column("intervention_support_material", sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("intervention_support_material", sa.Column(
        "sent_by_staff_id", sa.String(20), sa.ForeignKey("academic_staff.staff_id", ondelete="RESTRICT"), nullable=True,
    ))
    op.create_check_constraint(
        "ck_intervention_support_status", "intervention_support_material", "status IN ('DRAFT', 'SENT')",
    )
    op.create_check_constraint(
        "ck_intervention_support_sent_pair", "intervention_support_material",
        "(status = 'SENT' AND sent_at IS NOT NULL AND sent_by_staff_id IS NOT NULL) OR "
        "(status = 'DRAFT' AND sent_at IS NULL AND sent_by_staff_id IS NULL)",
    )


def downgrade() -> None:
    if op.get_bind().execute(sa.text(
        "SELECT count(*) FROM intervention_support_material WHERE status = 'SENT'",
    )).scalar():
        raise RuntimeError("Cannot discard sent intervention reviewers.")
    op.drop_constraint("ck_intervention_support_sent_pair", "intervention_support_material", type_="check")
    op.drop_constraint("ck_intervention_support_status", "intervention_support_material", type_="check")
    op.create_check_constraint("ck_intervention_support_status", "intervention_support_material", "status = 'DRAFT'")
    op.drop_column("intervention_support_material", "sent_by_staff_id")
    op.drop_column("intervention_support_material", "sent_at")
