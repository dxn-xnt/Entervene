"""Add reusable teacher rubric templates.

Revision ID: 20261007_rubric_templates
Revises: 20261003b_ident_type_data
"""

from alembic import op
import sqlalchemy as sa


revision = "20261007_rubric_templates"
down_revision = "20261003b_ident_type_data"
branch_labels = None
depends_on = None


def upgrade() -> None:
    table = op.create_table(
        "rubric_template",
        sa.Column("rubric_template_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("owner_staff_id", sa.String(length=20), sa.ForeignKey("academic_staff.staff_id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=300), nullable=False),
        sa.Column("levels", sa.JSON(), nullable=False),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("owner_staff_id", "name", name="uq_rubric_template_owner_name"),
    )
    op.create_index("ix_rubric_template_owner_staff_id", "rubric_template", ["owner_staff_id"])
    op.bulk_insert(table, [{
        "owner_staff_id": None,
        "name": "Standard Performance Levels",
        "description": "The existing five-level classwork scoring rubric.",
        "is_system": True,
        "levels": [
            {"level_name": "Excellent", "description": "Displays all required components clearly and accurately.", "points": 100, "display_order": 0},
            {"level_name": "Good", "description": "Most components are present with minor errors.", "points": 80, "display_order": 1},
            {"level_name": "Fair", "description": "Some required parts are missing or unclear.", "points": 60, "display_order": 2},
            {"level_name": "Needs Improvement", "description": "Many required elements are missing.", "points": 40, "display_order": 3},
            {"level_name": "Poor", "description": "Work is incomplete or not submitted.", "points": 20, "display_order": 4},
        ],
    }])


def downgrade() -> None:
    op.drop_index("ix_rubric_template_owner_staff_id", table_name="rubric_template")
    op.drop_table("rubric_template")
