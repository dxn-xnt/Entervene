"""Add teacher-verified lesson delivery table and audit tracking.

Revision ID: 20261028_lesson_delivery
Revises: 20261027_reading_review
"""

from alembic import op
import sqlalchemy as sa


revision = "20261028_lesson_delivery"
down_revision = "20261027_reading_review"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lesson_delivery",
        sa.Column("delivery_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("lesson_id", sa.Integer(), nullable=False),
        sa.Column("class_id", sa.Integer(), nullable=False),
        sa.Column("subject_id", sa.Integer(), nullable=False),
        sa.Column("academic_period_id", sa.Integer(), nullable=False),
        sa.Column("delivered_by_staff_id", sa.String(length=20), nullable=True),
        sa.Column(
            "delivered_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by_staff_id", sa.String(length=20), nullable=True),
        sa.Column("correction_reason", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(
            ["academic_period_id"],
            ["academic_period.academic_period_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["class_id"], ["class.class_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["delivered_by_staff_id"],
            ["academic_staff.staff_id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["lesson_id"], ["lesson.lesson_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["revoked_by_staff_id"],
            ["academic_staff.staff_id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["subject_id"], ["subject.subject_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("delivery_id"),
        sa.CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= delivered_at",
            name="ck_lesson_delivery_chronology",
        ),
        sa.CheckConstraint(
            "(revoked_at IS NULL AND revoked_by_staff_id IS NULL) OR "
            "(revoked_at IS NOT NULL AND revoked_by_staff_id IS NOT NULL)",
            name="ck_lesson_delivery_revocation_pair",
        ),
    )
    op.create_index(
        "uq_lesson_delivery_active",
        "lesson_delivery",
        ["lesson_id", "class_id", "subject_id", "academic_period_id"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
        sqlite_where=sa.text("revoked_at IS NULL"),
    )
    op.create_index(
        "ix_lesson_delivery_scope",
        "lesson_delivery",
        ["class_id", "subject_id", "academic_period_id"],
        unique=False,
    )
    op.create_index(
        "ix_lesson_delivery_lesson_class",
        "lesson_delivery",
        ["lesson_id", "class_id"],
        unique=False,
    )
    op.create_index(
        "ix_lesson_delivery_lesson_id", "lesson_delivery", ["lesson_id"], unique=False
    )
    op.create_index(
        "ix_lesson_delivery_class_id", "lesson_delivery", ["class_id"], unique=False
    )
    op.create_index(
        "ix_lesson_delivery_subject_id", "lesson_delivery", ["subject_id"], unique=False
    )
    op.create_index(
        "ix_lesson_delivery_academic_period_id",
        "lesson_delivery",
        ["academic_period_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_lesson_delivery_academic_period_id", table_name="lesson_delivery"
    )
    op.drop_index("ix_lesson_delivery_subject_id", table_name="lesson_delivery")
    op.drop_index("ix_lesson_delivery_class_id", table_name="lesson_delivery")
    op.drop_index("ix_lesson_delivery_lesson_id", table_name="lesson_delivery")
    op.drop_index("ix_lesson_delivery_lesson_class", table_name="lesson_delivery")
    op.drop_index("ix_lesson_delivery_scope", table_name="lesson_delivery")
    op.drop_index("uq_lesson_delivery_active", table_name="lesson_delivery")
    op.drop_table("lesson_delivery")
