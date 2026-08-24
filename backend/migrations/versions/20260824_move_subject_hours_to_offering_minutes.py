"""move subject hours to subject_offering minutes and apply pathway-based migration

Revision ID: 20260824_move_subject_hours_to_offering_minutes
Revises: 20260822_add_period_template_slot_and_slot_id
Create Date: 2026-08-24 20:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260824_move_subject_hours_to_offering_minutes'
down_revision: Union[str, Sequence[str], None] = '20260822_add_period_template_slot_and_slot_id'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add minutes column to subject_offering
    op.execute("""
        ALTER TABLE subject_offering
        ADD COLUMN IF NOT EXISTS minutes INTEGER;
    """)

    # 2. Delete stale subject_offering_pathway entries for BIO1 (engineering) and PRECAL11 (medical)
    op.execute("""
        DELETE FROM subject_offering_pathway
        WHERE subject_offering_id IN (
            SELECT so.subject_offering_id
            FROM subject_offering so
            JOIN subject s ON so.subject_id = s.subject_id
            WHERE s.subject_codename = 'BIO1'
        )
        AND pathway_id IN (
            SELECT id FROM academic_pathway WHERE code = 'engineering-math'
        );
    """)

    op.execute("""
        DELETE FROM subject_offering_pathway
        WHERE subject_offering_id IN (
            SELECT so.subject_offering_id
            FROM subject_offering so
            JOIN subject s ON so.subject_id = s.subject_id
            WHERE s.subject_codename = 'PRECAL11'
        )
        AND pathway_id IN (
            SELECT id FROM academic_pathway WHERE code = 'medical-courses'
        );
    """)

    # 3. Data Migration for existing SubjectOffering rows

    # 3a. JHS Enhanced Math & Science (60 mins)
    op.execute("""
        UPDATE subject_offering
        SET minutes = 60
        WHERE academic_level_id IN (1, 2, 3, 4)
        AND subject_id IN (
            SELECT subject_id FROM subject
            WHERE subject_codename IN ('MATH7', 'SCI7', 'EMATH8', 'ESCIE8', 'MATH9', 'SCI9', 'MATH10', 'SCI10')
            OR subject_name ILIKE '%Enhanced Mathematics%'
            OR subject_name ILIKE '%Enhanced Science%'
        );
    """)

    # 3b. JHS Standard Subjects (45 mins)
    op.execute("""
        UPDATE subject_offering
        SET minutes = 45
        WHERE academic_level_id IN (1, 2, 3, 4)
        AND minutes IS NULL
        AND subject_id IN (
            SELECT subject_id FROM subject
            WHERE subject_codename IN (
                'ENG7', 'FIL7', 'VE', 'ENG', 'HEALTH', 'RSRCH1', 'MUSIC', 'PE',
                'PERDEV', 'AP9', 'FRE9', 'ENG9', 'FIL9', 'SCIRES9', 'TLE9',
                'MAPEH9', 'VALED9', 'FIL8', 'TLE8', 'MAPEH8', 'AP8', 'SRES8',
                'FRE8', 'VE8', 'ENG8'
            )
            OR subject_codename LIKE 'AP%'
            OR subject_codename LIKE 'ENG%'
            OR subject_codename LIKE 'FIL%'
            OR subject_codename LIKE 'FRE%'
            OR subject_codename LIKE 'MAPEH%'
            OR subject_codename LIKE 'TLE%'
            OR subject_codename LIKE 'VE%'
            OR subject_codename LIKE 'VALED%'
            OR subject_codename LIKE 'SRES%'
            OR subject_codename LIKE 'SCIRES%'
            OR subject_codename LIKE 'RSRCH%'
        );
    """)

    # 3c. SHS Confirmed Subjects:
    # BIO1 (Zara / Medical) -> 96 mins
    op.execute("""
        UPDATE subject_offering
        SET minutes = 96
        WHERE academic_level_id IN (5, 6)
        AND subject_id IN (
            SELECT subject_id FROM subject WHERE subject_codename = 'BIO1'
        );
    """)

    # PRECAL11 (Campos / Engineering) -> 96 mins
    op.execute("""
        UPDATE subject_offering
        SET minutes = 96
        WHERE academic_level_id IN (5, 6)
        AND subject_id IN (
            SELECT subject_id FROM subject WHERE subject_codename = 'PRECAL11'
        );
    """)

    # PHYS1 (Campos / Engineering -> 96 mins, Del Mundo/Reyes / General -> 72 mins)
    op.execute("""
        UPDATE subject_offering
        SET minutes = 96
        WHERE academic_level_id IN (5, 6)
        AND subject_id IN (
            SELECT subject_id FROM subject WHERE subject_codename = 'PHYS1'
        )
        AND subject_offering_id IN (
            SELECT sop.subject_offering_id
            FROM subject_offering_pathway sop
            JOIN academic_pathway ap ON sop.pathway_id = ap.id
            WHERE ap.code = 'engineering-math'
        );
    """)

    op.execute("""
        UPDATE subject_offering
        SET minutes = 72
        WHERE academic_level_id IN (5, 6)
        AND subject_id IN (
            SELECT subject_id FROM subject WHERE subject_codename = 'PHYS1'
        )
        AND minutes IS NULL;
    """)

    # GENMATH11 (Campos/Zara) -> 60 mins
    op.execute("""
        UPDATE subject_offering
        SET minutes = 60
        WHERE academic_level_id IN (5, 6)
        AND subject_id IN (
            SELECT subject_id FROM subject WHERE subject_codename = 'GENMATH11'
        );
    """)

    # WI12 (Del Mundo / Reyes) -> 72 mins
    op.execute("""
        UPDATE subject_offering
        SET minutes = 72
        WHERE academic_level_id IN (5, 6)
        AND subject_id IN (
            SELECT subject_id FROM subject WHERE subject_codename = 'WI12'
        );
    """)

    # PE (SHS) -> 60 mins
    op.execute("""
        UPDATE subject_offering
        SET minutes = 60
        WHERE academic_level_id IN (5, 6)
        AND subject_id IN (
            SELECT subject_id FROM subject WHERE subject_codename = 'PE'
        );
    """)

    # 4. Drop hours column from subject table
    op.execute("""
        ALTER TABLE subject
        DROP COLUMN IF EXISTS hours;
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE subject
        ADD COLUMN IF NOT EXISTS hours INTEGER;
    """)
    op.execute("""
        ALTER TABLE subject_offering
        DROP COLUMN IF EXISTS minutes;
    """)
