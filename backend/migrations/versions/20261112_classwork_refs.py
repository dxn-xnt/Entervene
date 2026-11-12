"""Add teacher-provided reference links to classwork.

Revision ID: 20261112_classwork_refs
Revises: 20261112_submission_links
"""

from alembic import op
import sqlalchemy as sa


revision = "20261112_classwork_refs"
down_revision = "20261112_submission_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "classwork_reference_link",
        sa.Column("classwork_reference_link_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("classwork_id", sa.Integer(), sa.ForeignKey("classwork.classwork_id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("title", sa.String(255), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.UniqueConstraint("classwork_id", "position", name="uq_classwork_reference_link_position"),
    )
    op.create_index("ix_classwork_reference_link_classwork_id", "classwork_reference_link", ["classwork_id"])


def downgrade() -> None:
    op.drop_index("ix_classwork_reference_link_classwork_id", table_name="classwork_reference_link")
    op.drop_table("classwork_reference_link")
