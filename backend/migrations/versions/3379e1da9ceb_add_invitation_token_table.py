"""add invitation_token table

Revision ID: 20260604_invitation_tokens
Revises: 20260603_security_integrity
Create Date: 2026-06-04
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260604_invitation_tokens"
down_revision = "20260603_security_integrity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Make password_hash nullable so pending users have no password yet
    op.alter_column("user_account", "password_hash", nullable=True)

    op.create_table(
        "invitation_token",
        sa.Column("token_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user_account.user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_invitation_token_user_id",
        "invitation_token",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_invitation_token_user_id", table_name="invitation_token")
    op.drop_table("invitation_token")
    op.alter_column("user_account", "password_hash", nullable=False)