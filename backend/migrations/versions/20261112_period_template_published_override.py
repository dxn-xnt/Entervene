"""Add effective-dated period-template and subject-load revisions.

Revision ID: 20261112_period_template_override
Revises: 20261102_practice_assessment
"""

from alembic import op
import sqlalchemy as sa


revision = "20261112_period_template_override"
down_revision = "20261102_practice_assessment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "period_template_revision",
        sa.Column("revision_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("base_template_group", sa.String(length=50), nullable=False),
        sa.Column("version_template_group", sa.String(length=50), nullable=False),
        sa.Column("academic_year_id", sa.Integer(), nullable=False),
        sa.Column("revision_number", sa.Integer(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="scheduled", nullable=False),
        sa.Column("created_by", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["academic_year_id"], ["academic_year.academic_year_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("revision_id"),
        sa.UniqueConstraint("base_template_group", "academic_year_id", "revision_number", name="uq_period_template_revision_number"),
        sa.UniqueConstraint("version_template_group", name="uq_period_template_revision_group"),
    )
    op.create_index("ix_period_template_revision_base_template_group", "period_template_revision", ["base_template_group"])
    op.create_index("ix_period_template_revision_version_template_group", "period_template_revision", ["version_template_group"])
    op.create_index("ix_period_template_revision_academic_year_id", "period_template_revision", ["academic_year_id"])
    op.create_index("ix_period_template_revision_effective_from", "period_template_revision", ["effective_from"])

    op.create_table(
        "period_template_override_preview",
        sa.Column("preview_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("token", sa.String(length=128), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("academic_year_id", sa.Integer(), nullable=False),
        sa.Column("academic_period_id", sa.Integer(), nullable=False),
        sa.Column("base_template_group", sa.String(length=50), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("impact", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
        sa.Column("created_by", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["academic_year_id"], ["academic_year.academic_year_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["academic_period_id"], ["academic_period.academic_period_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("preview_id"),
        sa.UniqueConstraint("token"),
    )
    op.create_index("ix_period_template_override_preview_token", "period_template_override_preview", ["token"])

    op.add_column("subject_load", sa.Column("template_revision_id", sa.Integer(), nullable=True))
    op.add_column("subject_load", sa.Column("effective_from", sa.Date(), nullable=True))
    op.add_column("subject_load", sa.Column("effective_to", sa.Date(), nullable=True))
    op.create_foreign_key(
        "fk_subject_load_template_revision",
        "subject_load",
        "period_template_revision",
        ["template_revision_id"],
        ["revision_id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_subject_load_template_revision", "subject_load", type_="foreignkey")
    op.drop_column("subject_load", "effective_to")
    op.drop_column("subject_load", "effective_from")
    op.drop_column("subject_load", "template_revision_id")
    op.drop_index("ix_period_template_override_preview_token", table_name="period_template_override_preview")
    op.drop_table("period_template_override_preview")
    op.drop_index("ix_period_template_revision_effective_from", table_name="period_template_revision")
    op.drop_index("ix_period_template_revision_academic_year_id", table_name="period_template_revision")
    op.drop_index("ix_period_template_revision_version_template_group", table_name="period_template_revision")
    op.drop_index("ix_period_template_revision_base_template_group", table_name="period_template_revision")
    op.drop_table("period_template_revision")
