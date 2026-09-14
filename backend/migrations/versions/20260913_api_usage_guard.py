"""Persistent AI reservations shared across API workers."""
from alembic import op
import sqlalchemy as sa

revision = "20260913_api_usage_guard"
down_revision = "20260913_lesson_plan_subject_class"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("api_usage_counter",
                    sa.Column("scope", sa.String(100), primary_key=True),
                    sa.Column("period", sa.String(80), primary_key=True),
                    sa.Column("used", sa.Integer(), nullable=False))


def downgrade():
    op.drop_table("api_usage_counter")
