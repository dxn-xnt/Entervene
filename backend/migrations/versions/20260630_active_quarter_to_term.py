"""update active quarter one to term one

Revision ID: 20260630_active_term_one
Revises: 20260626_suggestion_drafts
Create Date: 2026-06-30
"""

from alembic import op


revision = "20260630_active_term_one"
down_revision = "20260626_suggestion_drafts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE academic_period
        SET
            period_name = 'Term 1',
            period_type = 'TERM',
            period_sequence = 1,
            total_periods_in_year = 3,
            period_progress_ratio = 0.3333,
            updated_at = now()
        WHERE is_active = true
          AND period_type = 'QUARTER'
          AND period_sequence = 1
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE academic_period
        SET
            period_name = 'Quarter 1',
            period_type = 'QUARTER',
            period_sequence = 1,
            total_periods_in_year = 4,
            period_progress_ratio = 0.2500,
            updated_at = now()
        WHERE is_active = true
          AND period_type = 'TERM'
          AND period_sequence = 1
          AND period_name = 'Term 1'
        """
    )
