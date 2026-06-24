"""add quiz mvp models

Revision ID: 20260624_quiz_mvp_models
Revises: 20260621_ml_foundation
Create Date: 2026-06-24
"""

from alembic import op
import sqlalchemy as sa


revision = "20260624_quiz_mvp_models"
down_revision = "20260621_ml_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "quiz",
        sa.Column("quiz_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("classwork_id", sa.Integer(), sa.ForeignKey("classwork.classwork_id", ondelete="CASCADE"), nullable=False),
        sa.Column("total_items", sa.Integer(), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=True),
        sa.Column("accessible_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.CheckConstraint("total_items >= 0", name="ck_quiz_total_items_non_negative"),
        sa.CheckConstraint("duration_minutes IS NULL OR duration_minutes > 0", name="ck_quiz_duration_positive"),
        sa.CheckConstraint("status IN ('DRAFT', 'READY', 'PUBLISHED', 'ARCHIVED')", name="ck_quiz_status"),
        sa.UniqueConstraint("classwork_id", name="uq_quiz_classwork"),
    )
    op.create_index("ix_quiz_classwork_id", "quiz", ["classwork_id"])

    op.create_table(
        "quiz_setting",
        sa.Column("quiz_setting_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("classwork_id", sa.Integer(), sa.ForeignKey("classwork.classwork_id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_shuffle_questions", sa.Boolean(), nullable=False),
        sa.Column("enable_per_question_scoring", sa.Boolean(), nullable=False),
        sa.Column("enable_per_question_time_limits", sa.Boolean(), nullable=False),
        sa.Column("max_attempts", sa.Integer(), nullable=True),
        sa.Column("show_correct_answers", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.CheckConstraint("max_attempts IS NULL OR max_attempts > 0", name="ck_quiz_setting_max_attempts_positive"),
        sa.UniqueConstraint("classwork_id", name="uq_quiz_setting_classwork"),
    )
    op.create_index("ix_quiz_setting_classwork_id", "quiz_setting", ["classwork_id"])

    op.create_table(
        "question",
        sa.Column("question_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("question_type", sa.String(length=40), nullable=False),
        sa.Column("difficulty_level", sa.String(length=30), nullable=True),
        sa.Column("points", sa.Numeric(8, 2), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("is_ai_generated", sa.Boolean(), nullable=False),
        sa.Column("expected_answer_type", sa.String(length=40), nullable=True),
        sa.Column("max_file_size_mb", sa.Integer(), nullable=True),
        sa.Column("lesson_id", sa.Integer(), sa.ForeignKey("lesson.lesson_id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.CheckConstraint("question_type IN ('MULTIPLE_CHOICE', 'SHORT_ANSWER')", name="ck_question_type"),
        sa.CheckConstraint("difficulty_level IS NULL OR difficulty_level IN ('EASY', 'MEDIUM', 'HARD')", name="ck_question_difficulty"),
        sa.CheckConstraint("points > 0", name="ck_question_points_positive"),
        sa.CheckConstraint("max_file_size_mb IS NULL OR max_file_size_mb > 0", name="ck_question_max_file_size_positive"),
    )
    op.create_index("ix_question_lesson_id", "question", ["lesson_id"])
    op.create_index("ix_question_question_type", "question", ["question_type"])

    op.create_table(
        "question_option",
        sa.Column("option_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("question_id", sa.Integer(), sa.ForeignKey("question.question_id", ondelete="CASCADE"), nullable=False),
        sa.Column("option_text", sa.Text(), nullable=False),
        sa.Column("is_correct", sa.Boolean(), nullable=False),
        sa.Column("option_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.CheckConstraint("option_order > 0", name="ck_question_option_order_positive"),
        sa.UniqueConstraint("question_id", "option_order", name="uq_question_option_order"),
    )
    op.create_index("ix_question_option_question_id", "question_option", ["question_id"])

    op.create_table(
        "quiz_question",
        sa.Column("quiz_question_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("quiz_id", sa.Integer(), sa.ForeignKey("quiz.quiz_id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", sa.Integer(), sa.ForeignKey("question.question_id", ondelete="CASCADE"), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.CheckConstraint("display_order > 0", name="ck_quiz_question_display_order_positive"),
        sa.UniqueConstraint("quiz_id", "display_order", name="uq_quiz_question_display_order"),
        sa.UniqueConstraint("quiz_id", "question_id", name="uq_quiz_question_question"),
    )
    op.create_index("ix_quiz_question_quiz_id", "quiz_question", ["quiz_id"])
    op.create_index("ix_quiz_question_question_id", "quiz_question", ["question_id"])

    op.create_table(
        "quiz_answer",
        sa.Column("answer_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("quiz_question_id", sa.Integer(), sa.ForeignKey("quiz_question.quiz_question_id", ondelete="CASCADE"), nullable=False),
        sa.Column("submission_id", sa.Integer(), sa.ForeignKey("student_submission.submission_id", ondelete="CASCADE"), nullable=False),
        sa.Column("answer_text", sa.Text(), nullable=True),
        sa.Column("is_correct", sa.Boolean(), nullable=True),
        sa.Column("points_awarded", sa.Numeric(8, 2), nullable=True),
        sa.CheckConstraint("points_awarded IS NULL OR points_awarded >= 0", name="ck_quiz_answer_points_non_negative"),
        sa.UniqueConstraint("submission_id", "quiz_question_id", name="uq_quiz_answer_submission_question"),
    )
    op.create_index("ix_quiz_answer_quiz_question_id", "quiz_answer", ["quiz_question_id"])
    op.create_index("ix_quiz_answer_submission_id", "quiz_answer", ["submission_id"])


def downgrade() -> None:
    op.drop_index("ix_quiz_answer_submission_id", table_name="quiz_answer")
    op.drop_index("ix_quiz_answer_quiz_question_id", table_name="quiz_answer")
    op.drop_table("quiz_answer")

    op.drop_index("ix_quiz_question_question_id", table_name="quiz_question")
    op.drop_index("ix_quiz_question_quiz_id", table_name="quiz_question")
    op.drop_table("quiz_question")

    op.drop_index("ix_question_option_question_id", table_name="question_option")
    op.drop_table("question_option")

    op.drop_index("ix_question_question_type", table_name="question")
    op.drop_index("ix_question_lesson_id", table_name="question")
    op.drop_table("question")

    op.drop_index("ix_quiz_setting_classwork_id", table_name="quiz_setting")
    op.drop_table("quiz_setting")

    op.drop_index("ix_quiz_classwork_id", table_name="quiz")
    op.drop_table("quiz")
