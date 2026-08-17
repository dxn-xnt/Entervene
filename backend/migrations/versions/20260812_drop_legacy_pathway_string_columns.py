"""Drop legacy pathway string columns and constraints

Revision ID: 20260812_drop_legacy_pathway_string_columns
Revises: 20260812_add_academic_pathways_and_join
Create Date: 2026-08-12

DEPLOYMENT SAFEGUARD:
Do NOT execute Phase 2 migration until Phase 1 migration is deployed and backend
service-layer validation code (SubjectOfferingShared.py) is verified in place.

Steps:
1. Drop legacy pathway check constraint on class.
2. Drop legacy pathway string column on class.
3. Drop legacy pathway check constraint on subject_offering.
4. Drop legacy scope-pathway unique constraint on subject_offering (replaced by service-layer set-intersection validation).
5. Drop legacy pathway string column on subject_offering.
"""

from alembic import op
import sqlalchemy as sa


revision = "20260812_drop_legacy_pathway_string_columns"
down_revision = "20260812_add_academic_level_pathway_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. Class table cleanup ────────────────────────────────────────────
    op.drop_constraint("ck_class_pathway", "class", type_="check")
    op.drop_column("class", "pathway")

    # ── 2. Subject_offering table cleanup ─────────────────────────────────
    op.drop_constraint("ck_subject_offering_pathway", "subject_offering", type_="check")
    op.drop_constraint("uq_subject_offering_scope_pathway", "subject_offering", type_="unique")
    op.drop_column("subject_offering", "pathway")


def downgrade() -> None:
    op.add_column("subject_offering", sa.Column("pathway", sa.String(30), nullable=True))
    op.create_check_constraint("ck_subject_offering_pathway", "subject_offering", "pathway IN ('general', 'both', 'stem_medical', 'stem_engineering')")
    op.create_unique_constraint("uq_subject_offering_scope_pathway", "subject_offering", ["subject_id", "academic_year_id", "academic_level_id", "academic_period_id", "pathway"])

    op.add_column("class", sa.Column("pathway", sa.String(30), nullable=True, server_default="general"))
    op.create_check_constraint("ck_class_pathway", "class", "pathway IN ('general', 'stem_medical', 'stem_engineering')")
