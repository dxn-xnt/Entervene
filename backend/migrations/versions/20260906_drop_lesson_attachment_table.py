"""drop lesson_attachment table

Revision ID: 20260906_drop_lesson_attachment
Revises: 20260906_drop_legacy_user_account_columns
Create Date: 2026-09-06 23:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260906_drop_lesson_attachment'
down_revision: Union[str, Sequence[str], None] = '20260906_drop_legacy_user_account_columns'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table('lesson_attachment')


def downgrade() -> None:
    op.create_table(
        'lesson_attachment',
        sa.Column('lesson_attachment_id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('lesson_id', sa.Integer(), sa.ForeignKey('lesson.lesson_id', ondelete='CASCADE'), nullable=False),
        sa.Column('file_name', sa.String(length=255), nullable=False),
        sa.Column('file_path', sa.Text(), nullable=False),
        sa.Column('file_type', sa.String(length=100), nullable=True),
        sa.Column('file_size', sa.BigInteger(), nullable=False),
        sa.Column('uploaded_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
    )
