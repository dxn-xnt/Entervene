"""add competency entity and link to lesson

Revision ID: 20260824_add_competency_entity
Revises: 20260822_add_period_template_slot_and_slot_id
Create Date: 2026-08-24 17:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260824_add_competency_entity'
down_revision: Union[str, Sequence[str], None] = '20260822_add_period_template_slot_and_slot_id'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create competency table if not exists
    op.execute("""
        CREATE TABLE IF NOT EXISTS competency (
            competency_id SERIAL PRIMARY KEY,
            competency_code VARCHAR(100),
            statement TEXT NOT NULL,
            description TEXT,
            order_index INTEGER NOT NULL DEFAULT 1,
            target_hours INTEGER DEFAULT 0,
            is_archived BOOLEAN NOT NULL DEFAULT FALSE,
            subject_id INTEGER NOT NULL REFERENCES subject(subject_id) ON DELETE CASCADE,
            academic_period_id INTEGER REFERENCES academic_period(academic_period_id) ON DELETE SET NULL,
            created_by_staff_id VARCHAR(20) REFERENCES academic_staff(staff_id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
    """)

    op.execute("CREATE INDEX IF NOT EXISTS ix_competency_code ON competency (competency_code);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_competency_subject_id ON competency (subject_id);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_competency_academic_period_id ON competency (academic_period_id);")

    # 2. Add nullable competency_id column to lesson table if not exists
    op.execute("ALTER TABLE lesson ADD COLUMN IF NOT EXISTS competency_id INTEGER REFERENCES competency(competency_id) ON DELETE SET NULL;")
    op.execute("CREATE INDEX IF NOT EXISTS ix_lesson_competency_id ON lesson (competency_id);")


def downgrade() -> None:
    op.execute("ALTER TABLE lesson DROP COLUMN IF EXISTS competency_id;")
    op.execute("DROP TABLE IF EXISTS competency;")
