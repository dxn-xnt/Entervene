"""
20261003_add_identification_question_type_schema.py

Schema migration: widen the ck_question_type CHECK constraint on the `question` table
to allow the new 'IDENTIFICATION' type alongside the existing 'MULTIPLE_CHOICE' and 'SHORT_ANSWER'.

TESTED on a throwaway database only. Do NOT run on activity_db or entervene_db without:
  1. Taking a pg_dump backup first.
  2. Running the pre-migration SELECT to verify counts (see README section below).

Pre-migration SELECT (run on target DB, read-only):
    SELECT question_type, COUNT(*) FROM question GROUP BY question_type ORDER BY question_type;

Expected output before upgrade:
    MULTIPLE_CHOICE | <N>
    SHORT_ANSWER    | 19

After upgrade the constraint will also permit IDENTIFICATION.
"""
from alembic import op


revision = "20261003a_ident_type_schema"
down_revision = "20260928_remedial_exam_link"  # last migration in the chain — update if chain changes
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop the old constraint and re-add it with IDENTIFICATION included.
    # The constraint name in both activity_db and entervene_db is 'ck_question_type'.
    op.execute(
        "ALTER TABLE question DROP CONSTRAINT IF EXISTS ck_question_type"
    )
    op.execute(
        "ALTER TABLE question ADD CONSTRAINT ck_question_type "
        "CHECK (question_type IN ('MULTIPLE_CHOICE', 'SHORT_ANSWER', 'IDENTIFICATION'))"
    )


def downgrade() -> None:
    # Before restoring the 2-type CHECK constraint, safely convert any remaining
    # IDENTIFICATION rows to SHORT_ANSWER so the constraint alteration does not fail.
    op.execute(
        "UPDATE question SET question_type = 'SHORT_ANSWER' WHERE question_type = 'IDENTIFICATION'"
    )
    op.execute(
        "ALTER TABLE question DROP CONSTRAINT IF EXISTS ck_question_type"
    )
    op.execute(
        "ALTER TABLE question ADD CONSTRAINT ck_question_type "
        "CHECK (question_type IN ('MULTIPLE_CHOICE', 'SHORT_ANSWER'))"
    )

