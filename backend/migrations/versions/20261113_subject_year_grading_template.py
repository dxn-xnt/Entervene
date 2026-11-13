"""Add year-scoped grading-template assignments for subject offerings.

Revision ID: 20261113_subject_year_template
Revises: 20261112_period_template_override
"""

from alembic import op
import sqlalchemy as sa


revision = "20261113_subject_year_template"
down_revision = "20261112_period_template_override"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "subject_year_grading_template",
        sa.Column(
            "subject_year_grading_template_id",
            sa.Integer(),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("subject_id", sa.Integer(), nullable=False),
        sa.Column("academic_year_id", sa.Integer(), nullable=False),
        sa.Column("grading_template_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True
        ),
        sa.ForeignKeyConstraint(["subject_id"], ["subject.subject_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["academic_year_id"], ["academic_year.academic_year_id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["grading_template_id"],
            ["grading_template.grading_template_id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("subject_year_grading_template_id"),
        sa.UniqueConstraint(
            "subject_id",
            "academic_year_id",
            name="uq_subject_year_grading_template_scope",
        ),
    )
    op.create_index(
        "ix_subject_year_grading_template_subject_id",
        "subject_year_grading_template",
        ["subject_id"],
    )
    op.create_index(
        "ix_subject_year_grading_template_academic_year_id",
        "subject_year_grading_template",
        ["academic_year_id"],
    )
    op.create_index(
        "ix_subject_year_grading_template_grading_template_id",
        "subject_year_grading_template",
        ["grading_template_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_subject_year_grading_template_grading_template_id",
        table_name="subject_year_grading_template",
    )
    op.drop_index(
        "ix_subject_year_grading_template_academic_year_id",
        table_name="subject_year_grading_template",
    )
    op.drop_index(
        "ix_subject_year_grading_template_subject_id",
        table_name="subject_year_grading_template",
    )
    op.drop_table("subject_year_grading_template")
