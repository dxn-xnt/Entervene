"""Freeze evidence-based diagnosis when an intervention candidate is created.

Revision ID: 20260926_intervention_diagnosis
Revises: 20260926_intervention_core
"""

from alembic import op
import sqlalchemy as sa


revision = "20260926_intervention_diagnosis"
down_revision = "20260926_intervention_core"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing candidates cannot be reconstructed from mutable activity rows.
    # Preserve that uncertainty explicitly when deploying after I2.
    op.add_column(
        "intervention",
        sa.Column(
            "diagnosis_snapshot", sa.JSON(), nullable=False,
            server_default=sa.text("'{\"diagnosis_status\":\"HISTORICAL_DETAIL_UNAVAILABLE\"}'"),
        ),
    )
    op.alter_column("intervention", "diagnosis_snapshot", server_default=None)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT count(*) FROM intervention")).scalar():
        raise RuntimeError("Cannot discard persisted intervention diagnoses.")
    op.drop_column("intervention", "diagnosis_snapshot")
