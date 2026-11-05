"""Add independent practice assessment, question, attempt, and answer snapshot tables.

Revision ID: 20261102_practice_assessment
Revises: 20261028_lesson_delivery
"""

from alembic import op
import sqlalchemy as sa


revision = "20261102_practice_assessment"
down_revision = "20261028_lesson_delivery"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Practice Assessment Configuration
    op.create_table(
        "practice_assessment",
        sa.Column("practice_assessment_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("intervention_id", sa.Integer(), nullable=False),
        sa.Column(
            "title",
            sa.String(length=255),
            server_default="Practice Assessment",
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default="DRAFT",
            nullable=False,
        ),
        sa.Column(
            "gatekeeper_policy",
            sa.String(length=30),
            server_default="REQUIRE_PASS",
            nullable=False,
        ),
        sa.Column(
            "passing_percentage",
            sa.Numeric(precision=5, scale=2),
            server_default="75.00",
            nullable=False,
        ),
        sa.Column(
            "version",
            sa.Integer(),
            server_default="1",
            nullable=False,
        ),
        sa.Column(
            "shuffle_options",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column("created_by_staff_id", sa.String(length=20), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["intervention_id"],
            ["intervention.intervention_id"],
            name="fk_practice_assessment_intervention",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_staff_id"],
            ["academic_staff.staff_id"],
            name="fk_practice_assessment_staff",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("practice_assessment_id"),
        sa.UniqueConstraint("intervention_id", name="uq_practice_assessment_intervention"),
        sa.CheckConstraint(
            "status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')",
            name="ck_practice_assessment_status",
        ),
        sa.CheckConstraint(
            "gatekeeper_policy IN ('REQUIRE_PASS', 'REQUIRE_ATTEMPT', 'OPTIONAL')",
            name="ck_practice_assessment_gatekeeper_policy",
        ),
        sa.CheckConstraint(
            "passing_percentage >= 0.0 AND passing_percentage <= 100.0",
            name="ck_practice_assessment_passing_percentage",
        ),
        sa.CheckConstraint(
            "version > 0",
            name="ck_practice_assessment_version_positive",
        ),
    )
    op.create_index(
        "ix_practice_assessment_intervention",
        "practice_assessment",
        ["intervention_id"],
    )

    # 2. Practice Questions
    op.create_table(
        "practice_question",
        sa.Column("practice_question_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("practice_assessment_id", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column(
            "question_type",
            sa.String(length=40),
            server_default="MULTIPLE_CHOICE",
            nullable=False,
        ),
        sa.Column(
            "points",
            sa.Numeric(precision=8, scale=2),
            server_default="1.00",
            nullable=False,
        ),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column(
            "is_ai_generated",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["practice_assessment_id"],
            ["practice_assessment.practice_assessment_id"],
            name="fk_practice_question_assessment",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("practice_question_id"),
        sa.UniqueConstraint(
            "practice_assessment_id",
            "version",
            "display_order",
            name="uq_practice_question_order_version",
        ),
        sa.CheckConstraint(
            "question_type IN ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'IDENTIFICATION')",
            name="ck_practice_question_type",
        ),
        sa.CheckConstraint("points > 0", name="ck_practice_question_points_positive"),
        sa.CheckConstraint("display_order > 0", name="ck_practice_question_display_order_positive"),
        sa.CheckConstraint("version > 0", name="ck_practice_question_version_positive"),
    )
    op.create_index(
        "ix_practice_question_assessment",
        "practice_question",
        ["practice_assessment_id"],
    )

    # 3. Practice Question Options
    op.create_table(
        "practice_question_option",
        sa.Column("option_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("practice_question_id", sa.Integer(), nullable=False),
        sa.Column("option_text", sa.Text(), nullable=False),
        sa.Column(
            "is_correct",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("option_order", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["practice_question_id"],
            ["practice_question.practice_question_id"],
            name="fk_practice_option_question",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("option_id"),
        sa.UniqueConstraint(
            "practice_question_id",
            "option_order",
            name="uq_practice_question_option_order",
        ),
        sa.CheckConstraint("option_order > 0", name="ck_practice_question_option_order_positive"),
    )
    op.create_index(
        "ix_practice_question_option_question",
        "practice_question_option",
        ["practice_question_id"],
    )

    # 4. Student Practice Attempts
    op.create_table(
        "practice_attempt",
        sa.Column("attempt_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("practice_assessment_id", sa.Integer(), nullable=False),
        sa.Column("student_id", sa.UUID(), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default="STARTED",
            nullable=False,
        ),
        sa.Column("assessment_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "total_score",
            sa.Numeric(precision=8, scale=2),
            server_default="0.00",
            nullable=False,
        ),
        sa.Column(
            "max_score",
            sa.Numeric(precision=8, scale=2),
            server_default="0.00",
            nullable=False,
        ),
        sa.Column(
            "score_percentage",
            sa.Numeric(precision=5, scale=2),
            server_default="0.00",
            nullable=False,
        ),
        sa.Column(
            "passing_threshold_snapshot",
            sa.Numeric(precision=5, scale=2),
            server_default="75.00",
            nullable=False,
        ),
        sa.Column(
            "is_passed",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("question_order", sa.JSON(), nullable=False),
        sa.Column("option_order_map", sa.JSON(), nullable=True),
        sa.Column("attempt_snapshot", sa.JSON(), nullable=True),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["practice_assessment_id"],
            ["practice_assessment.practice_assessment_id"],
            name="fk_practice_attempt_assessment",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["student_id"],
            ["student.student_id"],
            name="fk_practice_attempt_student",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("attempt_id"),
        sa.UniqueConstraint(
            "practice_assessment_id",
            "student_id",
            "attempt_number",
            name="uq_practice_attempt_student_number",
        ),
        sa.CheckConstraint("attempt_number > 0", name="ck_practice_attempt_number_positive"),
        sa.CheckConstraint(
            "status IN ('STARTED', 'SUBMITTED', 'ABANDONED')",
            name="ck_practice_attempt_status",
        ),
        sa.CheckConstraint("total_score >= 0.0", name="ck_practice_attempt_total_score_non_negative"),
        sa.CheckConstraint("max_score >= 0.0", name="ck_practice_attempt_max_score_non_negative"),
        sa.CheckConstraint(
            "score_percentage >= 0.0 AND score_percentage <= 100.0",
            name="ck_practice_attempt_score_percentage_range",
        ),
        sa.CheckConstraint(
            "passing_threshold_snapshot >= 0.0 AND passing_threshold_snapshot <= 100.0",
            name="ck_practice_attempt_passing_threshold_range",
        ),
    )
    op.create_index(
        "ix_practice_attempt_assessment_student",
        "practice_attempt",
        ["practice_assessment_id", "student_id"],
    )
    op.create_index(
        "ix_practice_attempt_student",
        "practice_attempt",
        ["student_id"],
    )

    # 5. Practice Attempt Answers & Snapshots
    op.create_table(
        "practice_attempt_answer",
        sa.Column("attempt_answer_id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("attempt_id", sa.Integer(), nullable=False),
        sa.Column("practice_question_id", sa.Integer(), nullable=True),
        sa.Column("question_text_snapshot", sa.Text(), nullable=False),
        sa.Column("question_type_snapshot", sa.String(length=40), nullable=False),
        sa.Column("selected_option_id", sa.Integer(), nullable=True),
        sa.Column("student_answer_text", sa.Text(), nullable=True),
        sa.Column("correct_answer_text", sa.Text(), nullable=False),
        sa.Column("explanation_snapshot", sa.Text(), nullable=True),
        sa.Column(
            "is_correct",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "points_awarded",
            sa.Numeric(precision=8, scale=2),
            server_default="0.00",
            nullable=False,
        ),
        sa.Column(
            "points_possible",
            sa.Numeric(precision=8, scale=2),
            server_default="1.00",
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["attempt_id"],
            ["practice_attempt.attempt_id"],
            name="fk_practice_attempt_answer_attempt",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["practice_question_id"],
            ["practice_question.practice_question_id"],
            name="fk_practice_attempt_answer_question",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["selected_option_id"],
            ["practice_question_option.option_id"],
            name="fk_practice_attempt_answer_selected_option",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("attempt_answer_id"),
        sa.UniqueConstraint(
            "attempt_id",
            "practice_question_id",
            name="uq_practice_attempt_answer_question",
        ),
        sa.CheckConstraint(
            "points_awarded >= 0.0",
            name="ck_practice_attempt_answer_points_awarded",
        ),
        sa.CheckConstraint(
            "points_possible > 0.0",
            name="ck_practice_attempt_answer_points_possible",
        ),
    )
    op.create_index(
        "ix_practice_attempt_answer_attempt",
        "practice_attempt_answer",
        ["attempt_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_practice_attempt_answer_attempt", table_name="practice_attempt_answer")
    op.drop_table("practice_attempt_answer")
    op.drop_index("ix_practice_attempt_student", table_name="practice_attempt")
    op.drop_index("ix_practice_attempt_assessment_student", table_name="practice_attempt")
    op.drop_table("practice_attempt")
    op.drop_index("ix_practice_question_option_question", table_name="practice_question_option")
    op.drop_table("practice_question_option")
    op.drop_index("ix_practice_question_assessment", table_name="practice_question")
    op.drop_table("practice_question")
    op.drop_index("ix_practice_assessment_intervention", table_name="practice_assessment")
    op.drop_table("practice_assessment")

