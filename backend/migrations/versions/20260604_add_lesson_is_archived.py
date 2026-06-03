"""add lesson archive flag

Revision ID: 20260604_add_lesson_is_archived
Revises: 20260603_security_integrity
Create Date: 2026-06-04
"""

from alembic import op
import sqlalchemy as sa


revision = "20260604_add_lesson_is_archived"
down_revision = "20260603_security_integrity"
branch_labels = None
depends_on = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    if not _column_exists("lesson", "is_archived"):
        op.add_column(
            "lesson",
            sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.alter_column("lesson", "is_archived", server_default=None)


def downgrade() -> None:
    if _column_exists("lesson", "is_archived"):
        op.drop_column("lesson", "is_archived")
