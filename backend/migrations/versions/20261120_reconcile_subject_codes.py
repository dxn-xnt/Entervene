"""Reconcile existing subject codes to canonical SubjectCodeGenerator values and add uniqueness indexes.

Revision ID: 20261120_reconcile_subject_codes
Revises: 20261120_practice_reading_cycles
Create Date: 2026-11-20 19:25:00.000000

Reconciliation scope (code-only; zero subjects renamed or deleted):
- Reconciles 18 existing subject rows whose subject_codename diverges from
  SubjectCodeGenerator.generate_subject_code(subject_name, grade_level).
- Frees the colliding legacy RSRCH1 code on IDs 17 (Research, G7, archived -> RSRCH7)
  and 33 (Research 10, G10, active -> RSRCH10) before moving ID 38 (Research 1, G11,
  active -> RSRCH1).
- Handles the archived duplicate English 7 row (ID 58, status='archived', 0 FK
  dependencies) without deleting or renaming it by clearing its conflicting legacy
  code ('ENG 7' -> NULL) while preserving active ID 4 ('English 7' -> 'ENG7').
- Adds two PostgreSQL expression unique indexes:
  1. uq_subject_normalized_codename: global uniqueness across all non-blank codes
     (active and archived).
  2. uq_subject_active_grade_normalized_name: normalized same-grade subject-name
     uniqueness across active subjects (partial on active rows so archived duplicate
     ID 58 is preserved without deletion or renaming).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261120_reconcile_subject_codes"
down_revision: Union[str, Sequence[str], None] = "20261120_practice_reading_cycles"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Step 1 frees colliding legacy codes (RSRCH1 on IDs 17 & 33, 'ENG 7' on archived
# duplicate ID 58) before Step 2 assigns RSRCH1 to ID 38 and reconciles all remaining
# subjects. Each tuple is (subject_id, expected_subject_name, old_code, new_code).
_STEP1_FREE_COLLISIONS: tuple[tuple[int, str, str, str | None], ...] = (
    (17, "Research", "RSRCH1", "RSRCH7"),
    (33, "Research 10", "RSRCH1", "RSRCH10"),
    (58, "English7", "ENG 7", None),
)

_STEP2_RECONCILE_CODES: tuple[tuple[int, str, str, str], ...] = (
    (5, "Enhanced Mathematics 8", "EMATH8", "ENMATH8"),
    (6, "Enhanced Science 8", "ESCIE8", "ENSCI8"),
    (7, "Enhanced Mathematics 9", "MATH9", "ENMATH9"),
    (8, "Enhanced Science 9", "SCI9", "ENSCI9"),
    (13, "General Biology 1", "BIO1", "GENBIO1"),
    (15, "General Physics 1", "PHYS1", "GENPHYS1"),
    (34, "Human Anatomy and Physiology", "HAP1", "HAP11"),
    (35, "Health Science Fundamentals", "HSF1", "HSF11"),
    (36, "Introduction to Engineering", "INTROENG1", "INTROENG11"),
    (37, "Computer-Aided Design Fundamentals", "CAD1", "CADF11"),
    (38, "Research 1", "RESEARCH1", "RSRCH1"),
    (39, "Statistics and Probability", "STATPROB", "STATPROB11"),
    (53, "Science Research", "SRES8", "SCIRES8"),
    (55, "Values Education 8", "VE8", "VALED8"),
    (59, "Values Recommendation", "VA10", "VALREC10"),
    (60, "Enhanced Mathematics 10", "EN10", "ENMATH10"),
)


def _apply_code_update(
    conn: sa.Connection,
    *,
    subject_id: int,
    expected_name: str,
    from_code: str | None,
    to_code: str | None,
) -> None:
    if from_code is None:
        stmt = sa.text(
            """
            UPDATE subject
            SET subject_codename = :to_code,
                updated_at = NOW()
            WHERE subject_id = :subject_id
              AND subject_name = :expected_name
              AND subject_codename IS NULL
            """
        )
        conn.execute(
            stmt,
            {
                "subject_id": subject_id,
                "expected_name": expected_name,
                "to_code": to_code,
            },
        )
    else:
        stmt = sa.text(
            """
            UPDATE subject
            SET subject_codename = :to_code,
                updated_at = NOW()
            WHERE subject_id = :subject_id
              AND subject_name = :expected_name
              AND subject_codename = :from_code
            """
        )
        conn.execute(
            stmt,
            {
                "subject_id": subject_id,
                "expected_name": expected_name,
                "from_code": from_code,
                "to_code": to_code,
            },
        )


def upgrade() -> None:
    conn = op.get_bind()

    for subject_id, expected_name, old_code, new_code in _STEP1_FREE_COLLISIONS:
        _apply_code_update(
            conn,
            subject_id=subject_id,
            expected_name=expected_name,
            from_code=old_code,
            to_code=new_code,
        )

    for subject_id, expected_name, old_code, new_code in _STEP2_RECONCILE_CODES:
        _apply_code_update(
            conn,
            subject_id=subject_id,
            expected_name=expected_name,
            from_code=old_code,
            to_code=new_code,
        )

    if conn.dialect.name == "postgresql":
        op.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_subject_normalized_codename
            ON subject (
                UPPER(REGEXP_REPLACE(BTRIM(subject_codename), '[^A-Za-z0-9]+', '', 'g'))
            )
            WHERE subject_codename IS NOT NULL
              AND BTRIM(subject_codename) <> '';
            """
        )
        op.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_subject_active_grade_normalized_name
            ON subject (
                academic_level_id,
                LOWER(
                    BTRIM(
                        REGEXP_REPLACE(
                            REGEXP_REPLACE(
                                REGEXP_REPLACE(
                                    REPLACE(subject_name, '&', ' and '),
                                    '([A-Za-z])([0-9])', '\\1 \\2', 'g'
                                ),
                                '([0-9])([A-Za-z])', '\\1 \\2', 'g'
                            ),
                            '[^A-Za-z0-9]+', ' ', 'g'
                        )
                    )
                )
            )
            WHERE academic_level_id IS NOT NULL
              AND LOWER(COALESCE(status, 'active')) = 'active';
            """
        )


def downgrade() -> None:
    conn = op.get_bind()

    if conn.dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS uq_subject_active_grade_normalized_name;")
        op.execute("DROP INDEX IF EXISTS uq_subject_normalized_codename;")

    # Reverse Step 2 before Step 1 so ID 38 vacates RSRCH1 before IDs 17 & 33 revert.
    for subject_id, expected_name, old_code, new_code in reversed(_STEP2_RECONCILE_CODES):
        _apply_code_update(
            conn,
            subject_id=subject_id,
            expected_name=expected_name,
            from_code=new_code,
            to_code=old_code,
        )

    for subject_id, expected_name, old_code, new_code in reversed(_STEP1_FREE_COLLISIONS):
        _apply_code_update(
            conn,
            subject_id=subject_id,
            expected_name=expected_name,
            from_code=new_code,
            to_code=old_code,
        )
