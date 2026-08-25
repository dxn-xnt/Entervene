"""add tos exam and tos question tables

Revision ID: 20260825_add_tos_exam_tables
Revises: 20260824_add_competency_entity, 20260824_update_teacher_employment_statuses
Create Date: 2026-08-25 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260825_add_tos_exam_tables'
down_revision: Union[str, Sequence[str], None] = (
    '20260824_add_competency_entity',
    '20260824_update_teacher_employment_statuses'
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS tos_exam (
            tos_exam_id SERIAL PRIMARY KEY,
            subject_id INTEGER NOT NULL REFERENCES subject(subject_id) ON DELETE CASCADE,
            created_by_staff_id VARCHAR(20) REFERENCES academic_staff(staff_id) ON DELETE SET NULL,
            title VARCHAR(255) NOT NULL,
            quarter VARCHAR(10) NOT NULL DEFAULT 'Q1',
            status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
            test_parts_json TEXT NOT NULL DEFAULT '[]',
            competencies_json TEXT NOT NULL DEFAULT '[]',
            difficulty_ratio_json TEXT NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_tos_exam_subject_id ON tos_exam (subject_id);")

    op.execute("""
        CREATE TABLE IF NOT EXISTS tos_question (
            tos_question_id SERIAL PRIMARY KEY,
            tos_exam_id INTEGER NOT NULL REFERENCES tos_exam(tos_exam_id) ON DELETE CASCADE,
            competency_id INTEGER REFERENCES competency(competency_id) ON DELETE SET NULL,
            competency_label VARCHAR(500) NOT NULL,
            question_text TEXT NOT NULL,
            question_type VARCHAR(40) NOT NULL,
            difficulty_band VARCHAR(20) NOT NULL,
            cognitive_level VARCHAR(20) NOT NULL,
            display_order INTEGER NOT NULL DEFAULT 1,
            points NUMERIC(8, 2) NOT NULL DEFAULT 1.00,
            explanation TEXT,
            options_json TEXT DEFAULT '[]'
        );
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_tos_question_tos_exam_id ON tos_question (tos_exam_id);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_tos_question_competency_id ON tos_question (competency_id);")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS tos_question;")
    op.execute("DROP TABLE IF EXISTS tos_exam;")
