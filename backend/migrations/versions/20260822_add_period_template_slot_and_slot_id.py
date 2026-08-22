"""add period_template_slot table and subject_load slot_id column

Revision ID: 20260822_add_period_template_slot_and_slot_id
Revises: 20260821_fix_classwork_category_check
Create Date: 2026-08-22 19:25:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260822_add_period_template_slot_and_slot_id'
down_revision: Union[str, Sequence[str], None] = '20260821_fix_classwork_category_check'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create period_template_slot table if not exists
    op.execute("""
        CREATE TABLE IF NOT EXISTS period_template_slot (
            slot_id SERIAL PRIMARY KEY,
            template_group VARCHAR(50) NOT NULL,
            slot_name VARCHAR(100) NOT NULL,
            slot_type VARCHAR(20) NOT NULL DEFAULT 'CLASS',
            start_time VARCHAR(10) NOT NULL,
            end_time VARCHAR(10) NOT NULL,
            is_locked_break BOOLEAN NOT NULL DEFAULT FALSE,
            display_order INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
    """)

    op.execute("CREATE INDEX IF NOT EXISTS ix_period_template_slot_template_group ON period_template_slot (template_group);")

    # 2. Add slot_id column to subject_load table if not exists
    op.execute("ALTER TABLE subject_load ADD COLUMN IF NOT EXISTS slot_id INTEGER REFERENCES period_template_slot(slot_id) ON DELETE SET NULL;")

    # 3. Add period_template_group column to class table if not exists
    op.execute("ALTER TABLE class ADD COLUMN IF NOT EXISTS period_template_group VARCHAR(50) NOT NULL DEFAULT 'JHS_45MIN';")

    # 4. Insert default period template slots if table is empty
    op.execute("""
        INSERT INTO period_template_slot (template_group, slot_name, slot_type, start_time, end_time, is_locked_break, display_order)
        SELECT * FROM (VALUES
            ('JHS_45MIN', 'Homeroom Guidance', 'HOMEROOM', '07:30', '08:00', true, 1),
            ('JHS_45MIN', 'Period 1', 'CLASS', '08:00', '08:45', false, 2),
            ('JHS_45MIN', 'Period 2', 'CLASS', '08:45', '09:30', false, 3),
            ('JHS_45MIN', 'Morning Recess', 'RECESS', '09:30', '09:45', true, 4),
            ('JHS_45MIN', 'Period 3', 'CLASS', '09:45', '10:30', false, 5),
            ('JHS_45MIN', 'Period 4', 'CLASS', '10:30', '11:15', false, 6),
            ('JHS_45MIN', 'Period 5', 'CLASS', '11:15', '12:00', false, 7),
            ('JHS_45MIN', 'Lunch Break', 'LUNCH', '12:00', '13:00', true, 8),
            ('JHS_45MIN', 'Enhanced Period 1', 'CLASS', '13:00', '14:00', false, 9),
            ('JHS_45MIN', 'Enhanced Period 2', 'CLASS', '14:00', '15:00', false, 10),
            ('JHS_45MIN', 'Afternoon Recess', 'RECESS', '15:00', '15:30', true, 11),
            ('JHS_45MIN', 'Period 6', 'CLASS', '15:30', '16:15', false, 12),
            ('JHS_45MIN', 'Period 7', 'CLASS', '16:15', '17:00', false, 13),
            ('SHS_CAMPOS_ZARA', 'Homeroom Guidance', 'HOMEROOM', '07:30', '08:00', true, 1),
            ('SHS_CAMPOS_ZARA', 'Period 1', 'CLASS', '08:00', '09:00', false, 2),
            ('SHS_CAMPOS_ZARA', 'Period 2', 'CLASS', '09:00', '10:00', false, 3),
            ('SHS_CAMPOS_ZARA', 'Morning Recess', 'RECESS', '10:00', '10:24', true, 4),
            ('SHS_CAMPOS_ZARA', 'Lab Block', 'CLASS', '10:24', '12:00', false, 5),
            ('SHS_CAMPOS_ZARA', 'Lunch Break', 'LUNCH', '12:00', '13:00', true, 6),
            ('SHS_CAMPOS_ZARA', 'Period 3', 'CLASS', '13:00', '14:00', false, 7),
            ('SHS_CAMPOS_ZARA', 'Period 4', 'CLASS', '14:00', '15:00', false, 8),
            ('SHS_CAMPOS_ZARA', 'Afternoon Recess', 'RECESS', '15:00', '15:30', true, 9),
            ('SHS_CAMPOS_ZARA', 'Period 5', 'CLASS', '15:30', '16:30', false, 10),
            ('SHS_DELMUNDO_REYES', 'Homeroom Guidance', 'HOMEROOM', '07:30', '08:00', true, 1),
            ('SHS_DELMUNDO_REYES', 'Period 1', 'CLASS', '08:00', '09:12', false, 2),
            ('SHS_DELMUNDO_REYES', 'Period 2', 'CLASS', '09:12', '10:24', false, 3),
            ('SHS_DELMUNDO_REYES', 'Morning Recess', 'RECESS', '10:24', '10:48', true, 4),
            ('SHS_DELMUNDO_REYES', 'Period 3', 'CLASS', '10:48', '12:00', false, 5),
            ('SHS_DELMUNDO_REYES', 'Lunch Break', 'LUNCH', '12:00', '13:00', true, 6),
            ('SHS_DELMUNDO_REYES', 'Period 4', 'CLASS', '13:00', '14:12', false, 7),
            ('SHS_DELMUNDO_REYES', 'Period 5', 'CLASS', '14:12', '15:24', false, 8),
            ('SHS_DELMUNDO_REYES', 'Afternoon Recess', 'RECESS', '15:24', '15:50', true, 9),
            ('SHS_DELMUNDO_REYES', 'Period 6 (PE)', 'CLASS', '15:50', '16:50', false, 10)
        ) AS v(template_group, slot_name, slot_type, start_time, end_time, is_locked_break, display_order)
        WHERE NOT EXISTS (SELECT 1 FROM period_template_slot LIMIT 1);
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE subject_load DROP COLUMN IF EXISTS slot_id;")
    op.execute("ALTER TABLE class DROP COLUMN IF EXISTS period_template_group;")
    op.execute("DROP TABLE IF EXISTS period_template_slot;")
