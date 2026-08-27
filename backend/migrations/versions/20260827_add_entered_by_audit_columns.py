"""add entered_by_staff_id audit columns to student_assessment_score, assessment_item, and student_period_grade

Revision ID: 20260827_add_entered_by_audit_columns
Revises: 20260827_add_teacher_substitution
Create Date: 2026-08-27 14:16:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260827_add_entered_by_audit_columns'
down_revision: Union[str, Sequence[str], None] = '20260827_add_teacher_substitution'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. StudentAssessmentScore
    op.execute("""
        ALTER TABLE student_assessment_score
            ADD COLUMN IF NOT EXISTS entered_by_staff_id VARCHAR(20)
                REFERENCES academic_staff(staff_id) ON DELETE SET NULL;
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_student_assessment_score_entered_by
            ON student_assessment_score(entered_by_staff_id);
    """)

    # 2. AssessmentItem
    op.execute("""
        ALTER TABLE assessment_item
            ADD COLUMN IF NOT EXISTS entered_by_staff_id VARCHAR(20)
                REFERENCES academic_staff(staff_id) ON DELETE SET NULL;
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_assessment_item_entered_by
            ON assessment_item(entered_by_staff_id);
    """)

    # 3. StudentPeriodGrade
    op.execute("""
        ALTER TABLE student_period_grade
            ADD COLUMN IF NOT EXISTS entered_by_staff_id VARCHAR(20)
                REFERENCES academic_staff(staff_id) ON DELETE SET NULL;
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_student_period_grade_entered_by
            ON student_period_grade(entered_by_staff_id);
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_student_period_grade_entered_by;")
    op.execute("ALTER TABLE student_period_grade DROP COLUMN IF EXISTS entered_by_staff_id;")

    op.execute("DROP INDEX IF EXISTS ix_assessment_item_entered_by;")
    op.execute("ALTER TABLE assessment_item DROP COLUMN IF EXISTS entered_by_staff_id;")

    op.execute("DROP INDEX IF EXISTS ix_student_assessment_score_entered_by;")
    op.execute("ALTER TABLE student_assessment_score DROP COLUMN IF EXISTS entered_by_staff_id;")
