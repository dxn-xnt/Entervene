"""Persist authoritative recipient scope for intervention-created readings.

Revision ID: 20261121_resource_repost_scope
Revises: 20261121_merge_resources
"""

from alembic import op
import sqlalchemy as sa


revision = "20261121_resource_repost_scope"
down_revision = "20261121_merge_resources"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "classwork",
        sa.Column(
            "intervention_resource_recipient_scope",
            sa.String(length=40),
            nullable=True,
        ),
    )
    op.create_check_constraint(
        "ck_classwork_intervention_resource_recipient_scope",
        "classwork",
        "intervention_resource_recipient_scope IS NULL OR "
        "intervention_resource_recipient_scope IN "
        "('THIS_STUDENT', 'ENTIRE_CLASS', 'ALL_SUBJECT_STUDENTS')",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_classwork_intervention_resource_recipient_scope",
        "classwork",
        type_="check",
    )
    op.drop_column("classwork", "intervention_resource_recipient_scope")
