"""add_user_account_email_status

Revision ID: c2ad67099617
Revises: 20260906_drop_lesson_attachment
Create Date: 2026-09-09 15:48:45.004936

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c2ad67099617'
down_revision: Union[str, Sequence[str], None] = '20260906_drop_lesson_attachment'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('user_account')]
    if 'email_status' not in columns:
        op.add_column(
            'user_account',
            sa.Column('email_status', sa.String(length=20), server_default='pending', nullable=False),
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    columns = [c['name'] for c in inspector.get_columns('user_account')]
    if 'email_status' in columns:
        op.drop_column('user_account', 'email_status')
