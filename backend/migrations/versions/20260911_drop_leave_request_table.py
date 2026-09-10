"""drop leave_request table

Revision ID: 20260911_drop_leave_request
Revises: c2ad67099617
Create Date: 2026-09-11 02:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260911_drop_leave_request'
down_revision: Union[str, Sequence[str], None] = 'c2ad67099617'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'leave_request' in tables:
        op.drop_table('leave_request')


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()
    if 'leave_request' not in tables:
        op.create_table(
            'leave_request',
            sa.Column('leave_request_id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('student_id', sa.UUID(), nullable=False),
            sa.Column('class_id', sa.Integer(), nullable=False),
            sa.Column('start_date', sa.Date(), nullable=False),
            sa.Column('end_date', sa.Date(), nullable=False),
            sa.Column('reason', sa.Text(), nullable=False),
            sa.Column('status', sa.String(length=20), nullable=False),
            sa.Column('reviewed_by_staff_id', sa.String(length=20), nullable=True),
            sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
            sa.ForeignKeyConstraint(['class_id'], ['class.class_id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['reviewed_by_staff_id'], ['academic_staff.staff_id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['student_id'], ['student.student_id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('leave_request_id')
        )
