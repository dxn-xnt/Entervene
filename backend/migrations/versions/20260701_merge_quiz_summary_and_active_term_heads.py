"""merge quiz summary and active term heads

Revision ID: 20260701_merge_quiz_active_term
Revises: 20260630_active_term_one, 20260630_quiz_summary_release
Create Date: 2026-07-01
"""

from alembic import op


revision = "20260701_merge_quiz_active_term"
down_revision = ("20260630_active_term_one", "20260630_quiz_summary_release")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Merge-only migration: both parent revisions already contain the real changes.
    pass


def downgrade() -> None:
    # Alembic will step back to the two parent heads if this merge revision is downgraded.
    pass
