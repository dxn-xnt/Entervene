"""
20261003b_promote_keyed_short_answer_to_identification.py

Data migration: promotes existing SHORT_ANSWER rows that have at least one correct-flagged
option to IDENTIFICATION. SHORT_ANSWER rows with no options remain SHORT_ANSWER.

Pre-check findings (from read-only investigation, 2026-10-03):
  activity_db:   19 SHORT_ANSWER, all 19 have answer keys → all become IDENTIFICATION
  entervene_db:  19 SHORT_ANSWER, all 19 have NO keys    → all remain SHORT_ANSWER
  Both DBs:       0 AI-generated SHORT_ANSWER rows.

The rule is: if the question has at least one question_option row with is_correct=TRUE,
it was always intended as Identification and is promoted to IDENTIFICATION.
If it has no option rows, it is open-ended / essay and stays SHORT_ANSWER.

DEPENDS ON: 20261003a_ident_type_schema must be applied first.

Pre-migration SELECT (read-only validation before running upgrade):
    SELECT
        q.question_type,
        CASE WHEN opt.question_id IS NOT NULL THEN 'has_key' ELSE 'no_key' END AS key_status,
        COUNT(*) AS cnt
    FROM question q
    LEFT JOIN (
        SELECT DISTINCT question_id FROM question_option WHERE is_correct = TRUE
    ) opt ON opt.question_id = q.question_id
    WHERE q.question_type = 'SHORT_ANSWER'
    GROUP BY 1, 2
    ORDER BY 1, 2;

Expected before upgrade on activity_db:
    SHORT_ANSWER | has_key | 19

pg_dump reminder:
    pg_dump -Fc -h localhost -U postgres activity_db > activity_db_backup_$(date +%Y%m%d_%H%M%S).dump
    pg_dump -Fc -h localhost -U postgres entervene_db > entervene_db_backup_$(date +%Y%m%d_%H%M%S).dump
"""
from alembic import op
import sqlalchemy as sa


revision = "20261003b_ident_type_data"
down_revision = "20261003a_ident_type_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Promote keyed SHORT_ANSWER rows to IDENTIFICATION."""
    op.execute(
        """
        UPDATE question
        SET question_type = 'IDENTIFICATION'
        WHERE question_type = 'SHORT_ANSWER'
          AND question_id IN (
              SELECT DISTINCT question_id
              FROM question_option
              WHERE is_correct = TRUE
          )
        """
    )


def downgrade() -> None:
    """Revert IDENTIFICATION back to SHORT_ANSWER (for questions that once had keys)."""
    op.execute(
        """
        UPDATE question
        SET question_type = 'SHORT_ANSWER'
        WHERE question_type = 'IDENTIFICATION'
          AND question_id IN (
              SELECT DISTINCT question_id
              FROM question_option
              WHERE is_correct = TRUE
          )
        """
    )
