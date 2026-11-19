"""Add repeatable reading-review cycles for Practice Assessment attempts.

Revision ID: 20261120_practice_reading_cycles
Revises: 20261119_multi_slot_loads
"""

from alembic import op
import sqlalchemy as sa


revision = "20261120_practice_reading_cycles"
down_revision = "20261119_multi_slot_loads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "intervention_reading_review",
        sa.Column("review_cycle", sa.Integer(), server_default="1", nullable=False),
    )
    op.drop_constraint(
        "uq_intervention_reading_review_intervention_assignment",
        "intervention_reading_review",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_intervention_reading_review_intervention_assignment_cycle",
        "intervention_reading_review",
        ["intervention_id", "reading_assignment_id", "review_cycle"],
    )
    op.add_column(
        "practice_attempt",
        sa.Column("reading_review_cycle", sa.Integer(), server_default="1", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("practice_attempt", "reading_review_cycle")
    op.drop_constraint(
        "uq_intervention_reading_review_intervention_assignment_cycle",
        "intervention_reading_review",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_intervention_reading_review_intervention_assignment",
        "intervention_reading_review",
        ["intervention_id", "reading_assignment_id"],
    )
    op.drop_column("intervention_reading_review", "review_cycle")
