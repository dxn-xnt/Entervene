"""add grading template tables

Revision ID: 20260702_grading_templates
Revises: 20260702_subject_offering
Create Date: 2026-07-02
"""

from alembic import op
import sqlalchemy as sa


revision = "20260702_grading_templates"
down_revision = "20260702_subject_offering"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "grading_template",
        sa.Column("grading_template_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("template_name", sa.String(length=150), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("academic_level_id", sa.Integer(), sa.ForeignKey("academic_level.academic_level_id"), nullable=True),
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subject.subject_id"), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('active', 'archived')", name="ck_grading_template_status"),
    )
    op.alter_column("grading_template", "status", server_default=None)
    op.create_index("ix_grading_template_academic_level_id", "grading_template", ["academic_level_id"])
    op.create_index("ix_grading_template_subject_id", "grading_template", ["subject_id"])
    op.create_index("ix_grading_template_status", "grading_template", ["status"])

    op.create_table(
        "grading_template_component",
        sa.Column("component_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "grading_template_id",
            sa.Integer(),
            sa.ForeignKey("grading_template.grading_template_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("component_name", sa.String(length=100), nullable=False),
        sa.Column("weight", sa.Numeric(6, 2), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("weight > 0", name="ck_grading_template_component_weight_positive"),
        sa.UniqueConstraint(
            "grading_template_id",
            "display_order",
            name="uq_grading_template_component_order",
        ),
    )
    op.create_index(
        "ix_grading_template_component_template_id",
        "grading_template_component",
        ["grading_template_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_grading_template_component_template_id", table_name="grading_template_component")
    op.drop_table("grading_template_component")
    op.drop_index("ix_grading_template_status", table_name="grading_template")
    op.drop_index("ix_grading_template_subject_id", table_name="grading_template")
    op.drop_index("ix_grading_template_academic_level_id", table_name="grading_template")
    op.drop_table("grading_template")
