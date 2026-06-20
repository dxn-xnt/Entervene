"""add classwork archive flag

Revision ID: 20260617_classwork_archive
Revises: 20260606_class_adviser_year
Create Date: 2026-06-17
"""

from alembic import op
import sqlalchemy as sa


revision = "20260617_classwork_archive"
down_revision = "20260606_class_adviser_year"
branch_labels = None
depends_on = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    if not _column_exists("classwork", "is_archived"):
        op.add_column(
            "classwork",
            sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.alter_column("classwork", "is_archived", server_default=None)


def downgrade() -> None:
    if _column_exists("classwork", "is_archived"):
        op.drop_column("classwork", "is_archived")
