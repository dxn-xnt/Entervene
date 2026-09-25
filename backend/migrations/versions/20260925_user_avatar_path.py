"""Persist the selected profile avatar for cross-account displays.

Revision ID: 20260925_user_avatar_path
Revises: 20260922_development_immutable
"""

from alembic import op
import sqlalchemy as sa


revision = "20260925_user_avatar_path"
down_revision = "20260922_development_immutable"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_account", sa.Column("avatar_path", sa.String(128), nullable=True))


def downgrade() -> None:
    op.drop_column("user_account", "avatar_path")
