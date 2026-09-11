"""add subject load section revisions and assignment audit log

Revision ID: 20260911_subject_load_section_revisions
Revises: 20260911_drop_leave_request, 20260911_prediction_evidence_scope
Create Date: 2026-09-11 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260911_subject_load_section_revisions"
down_revision: Union[str, Sequence[str], None] = (
    "20260911_drop_leave_request",
    "20260911_prediction_evidence_scope",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    sl_cols = [c["name"] for c in inspector.get_columns("subject_load")]
    if "logical_load_id" not in sl_cols:
        op.add_column("subject_load", sa.Column("logical_load_id", sa.String(length=64), nullable=True))
    if "section_revision" not in sl_cols:
        op.add_column("subject_load", sa.Column("section_revision", sa.Integer(), nullable=False, server_default="1"))
    if "base_revision" not in sl_cols:
        op.add_column("subject_load", sa.Column("base_revision", sa.Integer(), nullable=True))

    # Backfill deterministic logical_load_id for existing subject loads
    op.execute(
        "UPDATE subject_load SET logical_load_id = CONCAT('LL_', class_id, '_', subject_id, '_', academic_period_id) "
        "WHERE logical_load_id IS NULL OR logical_load_id = '';"
    )
    op.alter_column("subject_load", "logical_load_id", nullable=False)

    # Normalize legacy status values to 'published'
    op.execute("UPDATE subject_load SET status = 'published' WHERE status = 'active';")

    # De-duplicate legacy active published rows: archive older duplicates, keeping newest
    op.execute(
        "UPDATE subject_load SET is_active_version = FALSE, status = 'archived' "
        "WHERE is_active_version = TRUE "
        "AND subject_load_id NOT IN ("
        "  SELECT MAX(subject_load_id) "
        "  FROM subject_load "
        "  WHERE is_active_version = TRUE "
        "  GROUP BY class_id, subject_id, academic_period_id"
        ");"
    )

    # De-duplicate legacy drafts: delete older duplicate drafts, keeping newest
    op.execute(
        "DELETE FROM subject_load "
        "WHERE status = 'draft' "
        "AND subject_load_id NOT IN ("
        "  SELECT MAX(subject_load_id) "
        "  FROM subject_load "
        "  WHERE status = 'draft' "
        "  GROUP BY class_id, subject_id, academic_period_id"
        ");"
    )

    # Partial unique indexes to enforce single active published version and single draft per logical load
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_subject_load_active ON subject_load(logical_load_id) WHERE is_active_version = TRUE;"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_subject_load_active_academic ON subject_load(class_id, subject_id, academic_period_id) WHERE is_active_version = TRUE;"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_subject_load_draft ON subject_load(logical_load_id) WHERE status = 'draft';"
    )

    tables = inspector.get_table_names()
    if "subject_load_assignment_log" not in tables:
        op.create_table(
            "subject_load_assignment_log",
            sa.Column("log_id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("logical_load_id", sa.String(length=64), nullable=False),
            sa.Column(
                "subject_load_id",
                sa.Integer(),
                sa.ForeignKey("subject_load.subject_load_id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("class_id", sa.Integer(), sa.ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False),
            sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False),
            sa.Column(
                "academic_period_id",
                sa.Integer(),
                sa.ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("old_staff_id", sa.String(length=20), sa.ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True),
            sa.Column("new_staff_id", sa.String(length=20), sa.ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True),
            sa.Column("changed_by", sa.String(length=50), nullable=False),
            sa.Column("change_reason", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index(
            "ix_subject_load_assignment_log_logical",
            "subject_load_assignment_log",
            ["logical_load_id"],
        )
        op.create_index(
            "ix_subject_load_assignment_log_academic",
            "subject_load_assignment_log",
            ["class_id", "subject_id", "academic_period_id"],
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    tables = inspector.get_table_names()

    if "subject_load_assignment_log" in tables:
        op.drop_table("subject_load_assignment_log")

    op.execute("DROP INDEX IF EXISTS uq_subject_load_draft;")
    op.execute("DROP INDEX IF EXISTS uq_subject_load_active_academic;")
    op.execute("DROP INDEX IF EXISTS uq_subject_load_active;")

    sl_cols = [c["name"] for c in inspector.get_columns("subject_load")]
    if "base_revision" in sl_cols:
        op.drop_column("subject_load", "base_revision")
    if "section_revision" in sl_cols:
        op.drop_column("subject_load", "section_revision")
    if "logical_load_id" in sl_cols:
        op.drop_column("subject_load", "logical_load_id")
