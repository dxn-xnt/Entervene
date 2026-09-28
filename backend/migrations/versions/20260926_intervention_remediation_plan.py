"""Add private remediation preparation to Intervention.

Revision ID: 20260926_remediation_plan
Revises: 20260926_reviewer_delivery
"""
from alembic import op
import sqlalchemy as sa

revision = "20260926_remediation_plan"
down_revision = "20260926_reviewer_delivery"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("intervention", sa.Column("remediation_plan", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("intervention", "remediation_plan")
