"""allow reading classwork type

Revision ID: 20260621_reading_type
Revises: 20260617_classwork_archive
Create Date: 2026-06-21
"""

from alembic import op
import sqlalchemy as sa


revision = "20260621_reading_type"
down_revision = "20260617_classwork_archive"
branch_labels = None
depends_on = None


def _check_exists(table_name: str, constraint_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return any(check["name"] == constraint_name for check in inspector.get_check_constraints(table_name))


def upgrade() -> None:
    if _check_exists("classwork", "classwork_classwork_type_check"):
        op.drop_constraint("classwork_classwork_type_check", "classwork", type_="check")
    op.create_check_constraint(
        "classwork_classwork_type_check",
        "classwork",
        "classwork_type IN ('QUIZ', 'ASSIGNMENT', 'ACTIVITY', 'READING')",
    )


def downgrade() -> None:
    if _check_exists("classwork", "classwork_classwork_type_check"):
        op.drop_constraint("classwork_classwork_type_check", "classwork", type_="check")
    op.create_check_constraint(
        "classwork_classwork_type_check",
        "classwork",
        "classwork_type IN ('QUIZ', 'ASSIGNMENT', 'ACTIVITY')",
    )
