"""Persist the originating intervention for teacher-created support readings.

Revision ID: 20261121_resource_origin
Revises: 20261121_cw_assignment_recipients
"""

from alembic import op
import sqlalchemy as sa


revision = "20261121_resource_origin"
down_revision = "20261121_cw_assignment_recipients"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "classwork",
        sa.Column("intervention_resource_origin_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_classwork_intervention_resource_origin",
        "classwork",
        "intervention",
        ["intervention_resource_origin_id"],
        ["intervention_id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_classwork_intervention_resource_origin_id",
        "classwork",
        ["intervention_resource_origin_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_classwork_intervention_resource_origin_id",
        table_name="classwork",
    )
    op.drop_constraint(
        "fk_classwork_intervention_resource_origin",
        "classwork",
        type_="foreignkey",
    )
    op.drop_column("classwork", "intervention_resource_origin_id")
