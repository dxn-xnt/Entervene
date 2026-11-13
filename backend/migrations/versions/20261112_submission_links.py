"""Add independent URL deliverables to student submissions.

Revision ID: 20261112_submission_links
Revises: 20261102_practice_assessment
"""

from alembic import op
import sqlalchemy as sa


revision = "20261112_submission_links"
down_revision = "20261102_practice_assessment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "submission_link",
        sa.Column("submission_link_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("submission_id", sa.Integer(), sa.ForeignKey("student_submission.submission_id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("title", sa.String(255), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.UniqueConstraint("submission_id", "position", name="uq_submission_link_position"),
    )
    op.create_index("ix_submission_link_submission_id", "submission_link", ["submission_id"])


def downgrade() -> None:
    op.drop_index("ix_submission_link_submission_id", table_name="submission_link")
    op.drop_table("submission_link")
