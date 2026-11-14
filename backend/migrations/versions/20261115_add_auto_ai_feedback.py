"""Add automatic AI feedback toggle to classwork and create submission_feedback_draft table.

Revision ID: 20261115_add_auto_ai_feedback
Revises: 20261114_suggestion_period_origin
"""

from alembic import op
import sqlalchemy as sa


revision = "20261115_add_auto_ai_feedback"
down_revision = "20261114_suggestion_period_origin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    cw_cols = [c["name"] for c in inspector.get_columns("classwork")]
    if "auto_ai_feedback_enabled" not in cw_cols:
        op.add_column(
            "classwork",
            sa.Column("auto_ai_feedback_enabled", sa.Boolean(), server_default="false", nullable=False),
        )

    tables = inspector.get_table_names()
    if "submission_feedback_draft" not in tables:
        op.create_table(
            "submission_feedback_draft",
            sa.Column("draft_id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("submission_id", sa.Integer(), sa.ForeignKey("student_submission.submission_id", ondelete="CASCADE"), nullable=False),
            sa.Column("status", sa.String(length=30), server_default="QUEUED", nullable=False),
            sa.Column("staff_id", sa.String(length=20), sa.ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True),
            sa.Column("draft_feedback", sa.Text(), nullable=True),
            sa.Column("evidence_fingerprint", sa.String(length=64), nullable=True),
            sa.Column("feedback_fingerprint", sa.String(length=64), nullable=True),
            sa.Column("detail_level", sa.String(length=20), server_default="GENERAL", nullable=False),
            sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("retry_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("max_retries", sa.Integer(), server_default="3", nullable=False),
            sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True),
            sa.Column("claim_token", sa.String(length=64), nullable=True),
            sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
            sa.UniqueConstraint("submission_id", name="uq_submission_feedback_draft_submission"),
        )
        op.create_index(
            "ix_submission_feedback_draft_status",
            "submission_feedback_draft",
            ["status"],
        )
        op.create_index(
            "ix_submission_feedback_draft_queue",
            "submission_feedback_draft",
            ["status", "scheduled_for"],
        )


def downgrade() -> None:
    op.drop_index("ix_submission_feedback_draft_queue", table_name="submission_feedback_draft")
    op.drop_index("ix_submission_feedback_draft_status", table_name="submission_feedback_draft")
    op.drop_table("submission_feedback_draft")
    op.drop_column("classwork", "auto_ai_feedback_enabled")
