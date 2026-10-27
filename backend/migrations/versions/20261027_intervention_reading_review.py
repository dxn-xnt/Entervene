"""Add intervention-specific Reading review acknowledgments."""

from alembic import op
import sqlalchemy as sa


revision = "20261027_reading_review"
down_revision = "20261027_reading_prerequisite"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "intervention_reading_review",
        sa.Column("review_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("intervention_id", sa.Integer(), nullable=False),
        sa.Column("reading_assignment_id", sa.Integer(), nullable=False),
        sa.Column("student_id", sa.UUID(), nullable=False),
        sa.Column(
            "acknowledged_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["intervention_id"],
            ["intervention.intervention_id"],
            name="fk_intervention_reading_review_intervention",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["reading_assignment_id"],
            ["classwork_assignment.classwork_assignment_id"],
            name="fk_intervention_reading_review_reading_assignment",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["student_id"],
            ["student.student_id"],
            name="fk_intervention_reading_review_student",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("review_id"),
        sa.UniqueConstraint(
            "intervention_id",
            "reading_assignment_id",
            name="uq_intervention_reading_review_intervention_assignment",
        ),
    )
    op.create_index(
        "ix_intervention_reading_review_intervention",
        "intervention_reading_review",
        ["intervention_id"],
    )
    op.create_index(
        "ix_intervention_reading_review_reading_assignment",
        "intervention_reading_review",
        ["reading_assignment_id"],
    )
    op.create_index(
        "ix_intervention_reading_review_student",
        "intervention_reading_review",
        ["student_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_intervention_reading_review_student",
        table_name="intervention_reading_review",
    )
    op.drop_index(
        "ix_intervention_reading_review_reading_assignment",
        table_name="intervention_reading_review",
    )
    op.drop_index(
        "ix_intervention_reading_review_intervention",
        table_name="intervention_reading_review",
    )
    op.drop_table("intervention_reading_review")
