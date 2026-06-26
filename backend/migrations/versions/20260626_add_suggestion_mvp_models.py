"""add manual suggestion mvp models

Revision ID: 20260626_suggestion_mvp
Revises: 20260625_student_dob
Create Date: 2026-06-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260626_suggestion_mvp"
down_revision = "20260625_student_dob"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "student_suggestion",
        sa.Column("student_suggestion_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("suggestion_type", sa.String(length=30), nullable=False),
        sa.Column("resource_type", sa.String(length=30), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("resource_links", sa.JSON(), nullable=True),
        sa.Column("priority", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("is_viewed", sa.Boolean(), nullable=False),
        sa.Column("viewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column(
            "student_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("student.student_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False),
        sa.Column("lesson_id", sa.Integer(), sa.ForeignKey("lesson.lesson_id", ondelete="SET NULL"), nullable=True),
        sa.Column(
            "created_by_staff_id",
            sa.String(length=20),
            sa.ForeignKey("academic_staff.staff_id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.CheckConstraint("resource_type IN ('LESSON', 'CLASSWORK')", name="ck_student_suggestion_resource_type"),
        sa.CheckConstraint("suggestion_type IN ('MANUAL')", name="ck_student_suggestion_type"),
        sa.CheckConstraint("priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')", name="ck_student_suggestion_priority"),
        sa.CheckConstraint(
            "status IN ('ACTIVE', 'COMPLETED', 'DISMISSED', 'ARCHIVED')",
            name="ck_student_suggestion_status",
        ),
        sa.CheckConstraint(
            "(resource_type = 'LESSON' AND lesson_id IS NOT NULL) OR "
            "(resource_type = 'CLASSWORK' AND lesson_id IS NULL)",
            name="ck_student_suggestion_resource_link",
        ),
    )
    op.create_index(
        "ix_student_suggestion_student_status",
        "student_suggestion",
        ["student_id", "status"],
    )
    op.create_index(
        "ix_student_suggestion_subject_status",
        "student_suggestion",
        ["subject_id", "status"],
    )
    op.create_index(
        "uq_student_suggestion_active_lesson",
        "student_suggestion",
        ["student_id", "subject_id", "lesson_id"],
        unique=True,
        postgresql_where=sa.text("status = 'ACTIVE' AND lesson_id IS NOT NULL"),
        sqlite_where=sa.text("status = 'ACTIVE' AND lesson_id IS NOT NULL"),
    )

    op.create_table(
        "suggestion_classwork",
        sa.Column("suggestion_classwork_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "student_suggestion_id",
            sa.Integer(),
            sa.ForeignKey("student_suggestion.student_suggestion_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "classwork_assignment_id",
            sa.Integer(),
            sa.ForeignKey("classwork_assignment.classwork_assignment_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("is_completed", sa.Boolean(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("score_before", sa.Numeric(8, 2), nullable=True),
        sa.Column("score_after", sa.Numeric(8, 2), nullable=True),
        sa.CheckConstraint(
            "score_before IS NULL OR score_before >= 0",
            name="ck_suggestion_classwork_score_before_non_negative",
        ),
        sa.CheckConstraint(
            "score_after IS NULL OR score_after >= 0",
            name="ck_suggestion_classwork_score_after_non_negative",
        ),
        sa.UniqueConstraint("student_suggestion_id", name="uq_suggestion_classwork_suggestion"),
    )
    op.create_index(
        "ix_suggestion_classwork_assignment_id",
        "suggestion_classwork",
        ["classwork_assignment_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_suggestion_classwork_assignment_id", table_name="suggestion_classwork")
    op.drop_table("suggestion_classwork")

    op.drop_index("uq_student_suggestion_active_lesson", table_name="student_suggestion")
    op.drop_index("ix_student_suggestion_subject_status", table_name="student_suggestion")
    op.drop_index("ix_student_suggestion_student_status", table_name="student_suggestion")
    op.drop_table("student_suggestion")
