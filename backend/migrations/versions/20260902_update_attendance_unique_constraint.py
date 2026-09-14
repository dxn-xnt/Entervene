"""update attendance unique constraint to include subject_id

Revision ID: 20260902_update_attendance_unique_constraint
Revises: 20260901_comp_subject_staff_idx
Create Date: 2026-09-02 15:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260902_update_attendance_unique_constraint'
down_revision: Union[str, Sequence[str], None] = '20260901_comp_subject_staff_idx'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop old daily unique constraint
    op.drop_constraint('uq_attendance_student_class_date', 'attendance_record', type_='unique')
    # Create per-subject unique constraint
    op.create_unique_constraint(
        'uq_attendance_student_class_subject_date',
        'attendance_record',
        ['student_id', 'class_id', 'subject_id', 'date']
    )


def downgrade() -> None:
    op.drop_constraint('uq_attendance_student_class_subject_date', 'attendance_record', type_='unique')
    op.create_unique_constraint(
        'uq_attendance_student_class_date',
        'attendance_record',
        ['student_id', 'class_id', 'date']
    )
