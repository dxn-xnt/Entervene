"""Update teacher employment status options

Revision ID: 20260824_update_teacher_employment_statuses
Revises: 20260824_move_subject_hours_to_offering_minutes
Create Date: 2026-08-24 21:57:00

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20260824_update_teacher_employment_statuses'
down_revision = '20260824_move_subject_hours_to_offering_minutes'
branch_labels = None
depends_on = None


def upgrade():
    # Migrate existing Contractual to Probationary
    op.execute(
        sa.text("UPDATE academic_staff SET employment_status = 'Probationary' WHERE employment_status ILIKE 'contractual'")
    )
    # Migrate existing Regular to Regular/Permanent
    op.execute(
        sa.text("UPDATE academic_staff SET employment_status = 'Regular/Permanent' WHERE employment_status ILIKE 'regular'")
    )


def downgrade():
    op.execute(
        sa.text("UPDATE academic_staff SET employment_status = 'Contractual' WHERE employment_status = 'Probationary'")
    )
    op.execute(
        sa.text("UPDATE academic_staff SET employment_status = 'Regular' WHERE employment_status = 'Regular/Permanent'")
    )
