"""add pathway column to class table

Revision ID: 20260728_add_class_pathway
Revises: 20260703_teacher_review_decisions
Create Date: 2026-07-28
"""

from alembic import op
import sqlalchemy as sa


revision = "20260728_add_class_pathway"
down_revision = ("ea616545b5c4", "d56daec34451")
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "class",
        sa.Column("pathway", sa.String(length=30), nullable=False, server_default="general"),
    )
    op.create_check_constraint(
        "ck_class_pathway",
        "class",
        "pathway IN ('general', 'stem_medical', 'stem_engineering')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_class_pathway", "class", type_="check")
    op.drop_column("class", "pathway")
