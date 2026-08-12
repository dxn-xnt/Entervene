"""Add academic_level_pathway_scope table and seed SY 2026-2027 scope records

Revision ID: 20260812_add_academic_level_pathway_scope
Revises: 20260812_add_academic_pathways_and_join
Create Date: 2026-08-12
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text


revision = "20260812_add_academic_level_pathway_scope"
down_revision = "20260812_add_academic_pathways_and_join"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    # 1. Create table
    op.create_table(
        "academic_level_pathway_scope",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("academic_year_id", sa.Integer(), nullable=False),
        sa.Column("academic_level_id", sa.Integer(), nullable=False),
        sa.Column("requires_pathway", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["academic_year_id"], ["academic_year.academic_year_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["academic_level_id"], ["academic_level.academic_level_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("academic_year_id", "academic_level_id", name="uq_academic_level_pathway_scope_year_level"),
    )
    op.create_index("ix_academic_level_pathway_scope_academic_year_id", "academic_level_pathway_scope", ["academic_year_id"])
    op.create_index("ix_academic_level_pathway_scope_academic_level_id", "academic_level_pathway_scope", ["academic_level_id"])

    # 2. Seed active Academic Year scope rows
    active_year = conn.execute(
        text("SELECT academic_year_id FROM academic_year WHERE is_active IS TRUE LIMIT 1")
    ).fetchone()

    if active_year:
        year_id = active_year[0]
        levels = conn.execute(
            text("SELECT academic_level_id, grade_level FROM academic_level")
        ).fetchall()

        for level_id, grade_level in levels:
            requires = True if grade_level == 11 else False
            conn.execute(
                text(
                    """
                    INSERT INTO academic_level_pathway_scope (academic_year_id, academic_level_id, requires_pathway)
                    VALUES (:year_id, :level_id, :requires)
                    ON CONFLICT(academic_year_id, academic_level_id) DO NOTHING
                    """
                ),
                {"year_id": year_id, "level_id": level_id, "requires": requires},
            )


def downgrade():
    op.drop_index("ix_academic_level_pathway_scope_academic_level_id", table_name="academic_level_pathway_scope")
    op.drop_index("ix_academic_level_pathway_scope_academic_year_id", table_name="academic_level_pathway_scope")
    op.drop_table("academic_level_pathway_scope")
