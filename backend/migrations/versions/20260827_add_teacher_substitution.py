"""add teacher substitution table

Revision ID: 20260827_add_teacher_substitution
Revises: 20260825_add_tos_exam_tables, 56ff08b67dc7
Create Date: 2026-08-27 14:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260827_add_teacher_substitution'
down_revision: Union[str, Sequence[str], None] = (
    '20260825_add_tos_exam_tables',
    '56ff08b67dc7'
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist;")

    op.execute("""
        CREATE TABLE IF NOT EXISTS teacher_substitution (
            substitution_id     SERIAL PRIMARY KEY,
            subject_load_id     INT NOT NULL REFERENCES subject_load(subject_load_id) ON DELETE RESTRICT,
            original_staff_id   VARCHAR(20) NOT NULL REFERENCES academic_staff(staff_id) ON DELETE RESTRICT,
            substitute_staff_id VARCHAR(20) NOT NULL REFERENCES academic_staff(staff_id) ON DELETE RESTRICT,
            start_date          DATE NOT NULL,
            end_date            DATE,
            status              VARCHAR(20) NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'completed', 'cancelled')),
            reason              TEXT,
            created_by_admin_id VARCHAR(20) REFERENCES academic_staff(staff_id) ON DELETE SET NULL,
            ended_by_admin_id   VARCHAR(20) REFERENCES academic_staff(staff_id) ON DELETE SET NULL,
            ended_at            TIMESTAMP WITH TIME ZONE,
            created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            EXCLUDE USING GIST (
                subject_load_id WITH =,
                daterange(start_date, COALESCE(end_date, '9999-12-31'::date), '[]') WITH &&
            ) WHERE (status = 'active')
        );
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_teacher_substitution_subject_load ON teacher_substitution(subject_load_id);
        CREATE INDEX IF NOT EXISTS ix_teacher_substitution_original_staff ON teacher_substitution(original_staff_id);
        CREATE INDEX IF NOT EXISTS ix_teacher_substitution_substitute_staff ON teacher_substitution(substitute_staff_id);
        CREATE INDEX IF NOT EXISTS ix_teacher_substitution_active ON teacher_substitution(status, start_date, end_date) WHERE status = 'active';
    """)

    op.execute("""
        CREATE OR REPLACE FUNCTION fn_auto_complete_expired_substitutions()
        RETURNS TRIGGER AS $$
        BEGIN
            IF pg_trigger_depth() > 1 THEN
                RETURN NULL;
            END IF;

            UPDATE teacher_substitution
            SET    status   = 'completed',
                   ended_at = NOW(),
                   end_date = COALESCE(end_date, CURRENT_DATE)
            WHERE  status   = 'active'
              AND  end_date IS NOT NULL
              AND  end_date < CURRENT_DATE;
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
    """)

    op.execute("""
        DROP TRIGGER IF EXISTS trg_auto_complete_expired_substitutions ON teacher_substitution;
        CREATE TRIGGER trg_auto_complete_expired_substitutions
            BEFORE INSERT OR UPDATE ON teacher_substitution
            FOR EACH STATEMENT
            EXECUTE FUNCTION fn_auto_complete_expired_substitutions();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_auto_complete_expired_substitutions ON teacher_substitution;")
    op.execute("DROP FUNCTION IF EXISTS fn_auto_complete_expired_substitutions;")
    op.execute("DROP TABLE IF EXISTS teacher_substitution;")
