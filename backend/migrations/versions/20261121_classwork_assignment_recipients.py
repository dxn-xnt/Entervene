"""Add classwork_assignment_recipient table for scoped student resource visibility.

Revision ID: 20261121_cw_assignment_recipients
Revises: 20261120_practice_reading_cycles
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PG_UUID


revision = "20261121_cw_assignment_recipients"
down_revision = "20261120_practice_reading_cycles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "classwork_assignment_recipient",
        sa.Column("recipient_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("classwork_assignment_id", sa.Integer(), nullable=False),
        sa.Column("student_id", PG_UUID(as_uuid=True), nullable=False),
        sa.Column("assigned_by_staff_id", sa.String(length=20), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(
            ["classwork_assignment_id"],
            ["classwork_assignment.classwork_assignment_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["student_id"],
            ["student.student_id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["assigned_by_staff_id"],
            ["academic_staff.staff_id"],
        ),
        sa.PrimaryKeyConstraint("recipient_id"),
        sa.UniqueConstraint(
            "classwork_assignment_id",
            "student_id",
            name="uq_cw_assignment_recipient",
        ),
    )
    op.create_index(
        "ix_cw_assignment_recipient_assignment",
        "classwork_assignment_recipient",
        ["classwork_assignment_id"],
        unique=False,
    )
    op.create_index(
        "ix_cw_assignment_recipient_student",
        "classwork_assignment_recipient",
        ["student_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_cw_assignment_recipient_student",
        table_name="classwork_assignment_recipient",
    )
    op.drop_index(
        "ix_cw_assignment_recipient_assignment",
        table_name="classwork_assignment_recipient",
    )
    op.drop_table("classwork_assignment_recipient")
