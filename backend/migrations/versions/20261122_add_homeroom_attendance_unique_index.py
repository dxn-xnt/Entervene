"""add partial unique index for homeroom attendance when subject_id is null

Revision ID: 20261122_add_homeroom_attendance_unique_index
Revises: 20261121_quiz_shuffle_options, 20261121_resource_repost_scope
Create Date: 2026-11-22 04:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20261122_add_homeroom_attendance_unique_index"
down_revision: Union[str, Sequence[str], None] = (
    "20261121_quiz_shuffle_options",
    "20261121_resource_repost_scope",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "uq_attendance_student_class_homeroom_date",
        "attendance_record",
        ["student_id", "class_id", "date"],
        unique=True,
        postgresql_where=sa.text("subject_id IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_attendance_student_class_homeroom_date",
        table_name="attendance_record",
    )
