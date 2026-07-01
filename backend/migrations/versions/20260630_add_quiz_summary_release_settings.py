"""add quiz summary release settings

Revision ID: 20260630_quiz_summary_release
Revises: 20260626_suggestion_drafts
Create Date: 2026-06-30
"""

from alembic import op
import sqlalchemy as sa


revision = "20260630_quiz_summary_release"
down_revision = "20260626_suggestion_drafts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "quiz_setting",
        sa.Column(
            "summary_release_mode",
            sa.String(length=32),
            nullable=False,
            server_default="IMMEDIATE",
        ),
    )
    op.add_column(
        "quiz_setting",
        sa.Column("summary_release_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "ck_quiz_setting_summary_release_mode",
        "quiz_setting",
        "summary_release_mode IN ('IMMEDIATE', 'SCHEDULED', 'AFTER_DUE_DATE', 'NEVER')",
    )
    op.alter_column("quiz_setting", "summary_release_mode", server_default=None)


def downgrade() -> None:
    op.drop_constraint("ck_quiz_setting_summary_release_mode", "quiz_setting", type_="check")
    op.drop_column("quiz_setting", "summary_release_at")
    op.drop_column("quiz_setting", "summary_release_mode")
