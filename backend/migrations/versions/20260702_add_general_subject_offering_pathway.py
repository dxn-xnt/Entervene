"""add general subject offering pathway

Revision ID: 20260702_general_pathway
Revises: 20260702_grading_templates
Create Date: 2026-07-02
"""

from alembic import op


revision = "20260702_general_pathway"
down_revision = "20260702_grading_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_subject_offering_pathway", "subject_offering", type_="check")
    op.create_check_constraint(
        "ck_subject_offering_pathway",
        "subject_offering",
        "pathway IN ('general', 'both', 'stem_medical', 'stem_engineering')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_subject_offering_pathway", "subject_offering", type_="check")
    op.create_check_constraint(
        "ck_subject_offering_pathway",
        "subject_offering",
        "pathway IN ('stem_medical', 'stem_engineering', 'both')",
    )
