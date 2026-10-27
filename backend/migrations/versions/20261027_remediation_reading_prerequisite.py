"""Add immutable per-activity remediation Reading prerequisites."""

from alembic import op
import sqlalchemy as sa


revision = "20261027_reading_prerequisite"
down_revision = "20261026_remediation_link"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "remediation_reading_prerequisite",
        sa.Column("prerequisite_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("remediation_assignment_id", sa.Integer(), nullable=False),
        sa.Column("reading_classwork_id", sa.Integer(), nullable=False),
        sa.Column("reading_assignment_id", sa.Integer(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "display_order > 0",
            name="ck_remediation_reading_prerequisite_order_positive",
        ),
        sa.ForeignKeyConstraint(
            ["remediation_assignment_id"],
            ["classwork_assignment.classwork_assignment_id"],
            name="fk_remediation_reading_prerequisite_remediation",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["reading_classwork_id"],
            ["classwork.classwork_id"],
            name="fk_remediation_reading_prerequisite_classwork",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["reading_assignment_id"],
            ["classwork_assignment.classwork_assignment_id"],
            name="fk_remediation_reading_prerequisite_assignment",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("prerequisite_id"),
        sa.UniqueConstraint(
            "remediation_assignment_id",
            "display_order",
            name="uq_remediation_reading_prerequisite_order",
        ),
        sa.UniqueConstraint(
            "remediation_assignment_id",
            "reading_assignment_id",
            name="uq_remediation_reading_prerequisite_reading",
        ),
    )
    op.create_index(
        "ix_remediation_reading_prerequisite_remediation",
        "remediation_reading_prerequisite",
        ["remediation_assignment_id"],
    )
    op.create_index(
        "ix_remediation_reading_prerequisite_reading_assignment",
        "remediation_reading_prerequisite",
        ["reading_assignment_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_remediation_reading_prerequisite_reading_assignment",
        table_name="remediation_reading_prerequisite",
    )
    op.drop_index(
        "ix_remediation_reading_prerequisite_remediation",
        table_name="remediation_reading_prerequisite",
    )
    op.drop_table("remediation_reading_prerequisite")
