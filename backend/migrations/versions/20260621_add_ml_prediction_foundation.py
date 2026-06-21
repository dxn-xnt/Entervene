"""add ml prediction foundation tables

Revision ID: 20260621_ml_foundation
Revises: 20260621_reading_type
Create Date: 2026-06-21
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260621_ml_foundation"
down_revision = "20260621_reading_type"
branch_labels = None
depends_on = None


def _column_exists(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def _constraint_exists(table_name: str, constraint_name: str, constraint_type: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    if constraint_type == "check":
        constraints = inspector.get_check_constraints(table_name)
    elif constraint_type == "unique":
        constraints = inspector.get_unique_constraints(table_name)
    else:
        raise ValueError(f"Unsupported constraint type: {constraint_type}")
    return any(constraint["name"] == constraint_name for constraint in constraints)


def _drop_period_type_checks() -> None:
    inspector = sa.inspect(op.get_bind())
    for constraint in inspector.get_check_constraints("academic_period"):
        sqltext = constraint.get("sqltext") or ""
        name = constraint.get("name")
        if name and "period_type" in sqltext:
            op.drop_constraint(name, "academic_period", type_="check")


def _add_academic_period_columns() -> None:
    bind = op.get_bind()

    if not _column_exists("academic_period", "period_sequence"):
        op.add_column("academic_period", sa.Column("period_sequence", sa.Integer(), nullable=True))
    if not _column_exists("academic_period", "total_periods_in_year"):
        op.add_column("academic_period", sa.Column("total_periods_in_year", sa.Integer(), nullable=True))
    if not _column_exists("academic_period", "period_progress_ratio"):
        op.add_column("academic_period", sa.Column("period_progress_ratio", sa.Numeric(6, 4), nullable=True))
    if not _column_exists("academic_period", "updated_at"):
        op.add_column(
            "academic_period",
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        )

    bind.execute(
        sa.text(
            """
            WITH numbered AS (
                SELECT
                    academic_period_id,
                    row_number() OVER (
                        PARTITION BY academic_year_id, period_type
                        ORDER BY start_date, end_date, academic_period_id
                    ) AS sequence,
                    count(*) OVER (PARTITION BY academic_year_id, period_type) AS total
                FROM academic_period
            )
            UPDATE academic_period ap
            SET
                period_sequence = COALESCE(ap.period_sequence, numbered.sequence),
                total_periods_in_year = COALESCE(ap.total_periods_in_year, numbered.total),
                period_progress_ratio = COALESCE(
                    ap.period_progress_ratio,
                    round((numbered.sequence::numeric / numbered.total::numeric), 4)
                ),
                updated_at = COALESCE(ap.updated_at, ap.created_at, now())
            FROM numbered
            WHERE numbered.academic_period_id = ap.academic_period_id
            """
        )
    )

    op.alter_column("academic_period", "period_sequence", nullable=False)
    op.alter_column("academic_period", "total_periods_in_year", nullable=False)
    op.alter_column("academic_period", "period_progress_ratio", nullable=False)
    op.alter_column("academic_period", "updated_at", nullable=False)
    op.alter_column("academic_period", "updated_at", server_default=None)

    _drop_period_type_checks()
    op.create_check_constraint(
        "ck_academic_period_period_type",
        "academic_period",
        "period_type IN ('QUARTER', 'TERM', 'SEMESTER')",
    )
    op.create_check_constraint(
        "ck_academic_period_sequence_positive",
        "academic_period",
        "period_sequence > 0",
    )
    op.create_check_constraint(
        "ck_academic_period_total_positive",
        "academic_period",
        "total_periods_in_year > 0",
    )
    op.create_check_constraint(
        "ck_academic_period_progress_ratio",
        "academic_period",
        "period_progress_ratio = round((period_sequence * 1.0 / total_periods_in_year), 4)",
    )
    op.create_unique_constraint(
        "uq_academic_period_year_type_sequence",
        "academic_period",
        ["academic_year_id", "period_type", "period_sequence"],
    )


def upgrade() -> None:
    _add_academic_period_columns()

    op.create_table(
        "assessment_item",
        sa.Column("assessment_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("class_id", sa.Integer(), sa.ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False),
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "academic_period_id",
            sa.Integer(),
            sa.ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("component_type", sa.String(length=40), nullable=False),
        sa.Column("item_number", sa.Integer(), nullable=False),
        sa.Column("max_score", sa.Numeric(8, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint(
            "component_type IN ('WRITTEN_WORK', 'PERFORMANCE_TASK', 'PERIODICAL_ASSESSMENT')",
            name="ck_assessment_item_component_type",
        ),
        sa.CheckConstraint("max_score > 0", name="ck_assessment_item_max_score_positive"),
        sa.UniqueConstraint(
            "class_id",
            "subject_id",
            "academic_period_id",
            "component_type",
            "item_number",
            name="uq_assessment_item_scope_item",
        ),
    )
    op.create_index("ix_assessment_item_class_id", "assessment_item", ["class_id"])
    op.create_index("ix_assessment_item_subject_id", "assessment_item", ["subject_id"])
    op.create_index("ix_assessment_item_academic_period_id", "assessment_item", ["academic_period_id"])

    op.create_table(
        "student_assessment_score",
        sa.Column("score_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("assessment_id", sa.Integer(), sa.ForeignKey("assessment_item.assessment_id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("student.student_id", ondelete="CASCADE"), nullable=False),
        sa.Column("raw_score", sa.Numeric(8, 2), nullable=True),
        sa.Column("score_status", sa.String(length=30), nullable=False),
        sa.Column("encoded_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint(
            "score_status IN ('RECORDED', 'MISSING_NOT_ENCODED', 'ABSENT', 'NOT_APPLICABLE')",
            name="ck_student_assessment_score_status",
        ),
        sa.UniqueConstraint("assessment_id", "student_id", name="uq_student_assessment_score_assessment_student"),
    )
    op.create_index("ix_student_assessment_score_assessment_id", "student_assessment_score", ["assessment_id"])
    op.create_index("ix_student_assessment_score_student_id", "student_assessment_score", ["student_id"])

    op.create_table(
        "student_period_grade",
        sa.Column("period_grade_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("student.student_id", ondelete="CASCADE"), nullable=False),
        sa.Column("class_id", sa.Integer(), sa.ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False),
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "academic_period_id",
            sa.Integer(),
            sa.ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("written_work_percent", sa.Numeric(6, 2), nullable=True),
        sa.Column("performance_task_percent", sa.Numeric(6, 2), nullable=True),
        sa.Column("periodical_assessment_percent", sa.Numeric(6, 2), nullable=True),
        sa.Column("initial_grade", sa.Numeric(6, 2), nullable=True),
        sa.Column("transmuted_grade", sa.Numeric(6, 2), nullable=True),
        sa.Column("final_period_grade", sa.Numeric(6, 2), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("source_file_name", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("student_id", "class_id", "subject_id", "academic_period_id", name="uq_student_period_grade_scope"),
    )
    op.create_index("ix_student_period_grade_student_id", "student_period_grade", ["student_id"])
    op.create_index("ix_student_period_grade_class_id", "student_period_grade", ["class_id"])
    op.create_index("ix_student_period_grade_subject_id", "student_period_grade", ["subject_id"])
    op.create_index("ix_student_period_grade_academic_period_id", "student_period_grade", ["academic_period_id"])

    op.create_table(
        "ai_model_version",
        sa.Column("model_version_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("model_name", sa.String(length=150), nullable=False),
        sa.Column("model_type", sa.String(length=30), nullable=False),
        sa.Column("algorithm", sa.String(length=150), nullable=False),
        sa.Column("trained_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("training_row_count", sa.Integer(), nullable=True),
        sa.Column("test_row_count", sa.Integer(), nullable=True),
        sa.Column("mae", sa.Numeric(10, 4), nullable=True),
        sa.Column("rmse", sa.Numeric(10, 4), nullable=True),
        sa.Column("r2_score", sa.Numeric(10, 4), nullable=True),
        sa.Column("feature_schema_json", sa.JSON(), nullable=True),
        sa.Column("artifact_path", sa.String(length=500), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.CheckConstraint("model_type IN ('REGRESSOR', 'CLASSIFIER', 'ANOMALY')", name="ck_ai_model_version_model_type"),
    )
    op.create_index("ix_ai_model_version_model_name_type", "ai_model_version", ["model_name", "model_type"])
    op.create_index(
        "uq_ai_model_version_active_model",
        "ai_model_version",
        ["model_name", "model_type"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
    )

    op.create_table(
        "risk_threshold",
        sa.Column("threshold_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("threshold_name", sa.String(length=150), nullable=False),
        sa.Column("condition_type", sa.String(length=100), nullable=False),
        sa.Column("condition_value", sa.Numeric(10, 4), nullable=False),
        sa.Column("risk_level", sa.String(length=30), nullable=False),
        sa.Column("effective_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("effective_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint(
            "risk_level IN ('LOW_RISK', 'NEEDS_MONITORING', 'MODERATE_RISK', 'HIGH_RISK', 'INSUFFICIENT_DATA')",
            name="ck_risk_threshold_risk_level",
        ),
    )

    op.create_table(
        "ai_prediction",
        sa.Column("prediction_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("student.student_id", ondelete="CASCADE"), nullable=False),
        sa.Column("class_id", sa.Integer(), sa.ForeignKey("class.class_id", ondelete="CASCADE"), nullable=False),
        sa.Column("subject_id", sa.Integer(), sa.ForeignKey("subject.subject_id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_period_id", sa.Integer(), sa.ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_period_id", sa.Integer(), sa.ForeignKey("academic_period.academic_period_id", ondelete="CASCADE"), nullable=False),
        sa.Column("predicted_period_grade", sa.Numeric(6, 2), nullable=True),
        sa.Column("risk_score", sa.Numeric(8, 4), nullable=True),
        sa.Column("risk_level", sa.String(length=30), nullable=False),
        sa.Column("data_status", sa.String(length=30), nullable=False),
        sa.Column("model_version_id", sa.Integer(), sa.ForeignKey("ai_model_version.model_version_id", ondelete="RESTRICT"), nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint(
            "risk_level IN ('LOW_RISK', 'NEEDS_MONITORING', 'MODERATE_RISK', 'HIGH_RISK', 'INSUFFICIENT_DATA')",
            name="ck_ai_prediction_risk_level",
        ),
        sa.CheckConstraint(
            "data_status IN ('SUFFICIENT', 'INSUFFICIENT_DATA', 'COLD_START')",
            name="ck_ai_prediction_data_status",
        ),
    )
    op.create_index("ix_ai_prediction_student_id", "ai_prediction", ["student_id"])
    op.create_index("ix_ai_prediction_class_id", "ai_prediction", ["class_id"])
    op.create_index("ix_ai_prediction_subject_id", "ai_prediction", ["subject_id"])
    op.create_index("ix_ai_prediction_source_period_id", "ai_prediction", ["source_period_id"])
    op.create_index("ix_ai_prediction_target_period_id", "ai_prediction", ["target_period_id"])
    op.create_index("ix_ai_prediction_model_version_id", "ai_prediction", ["model_version_id"])

    op.create_table(
        "ai_prediction_feature",
        sa.Column("feature_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("prediction_id", sa.Integer(), sa.ForeignKey("ai_prediction.prediction_id", ondelete="CASCADE"), nullable=False),
        sa.Column("feature_name", sa.String(length=150), nullable=False),
        sa.Column("feature_value", sa.Numeric(12, 4), nullable=True),
        sa.Column("feature_contribution", sa.Numeric(12, 6), nullable=True),
        sa.Column("direction", sa.String(length=30), nullable=False),
        sa.Column("feature_rank", sa.Integer(), nullable=True),
        sa.Column("explanation_method", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint(
            "direction IN ('INCREASES_RISK', 'DECREASES_RISK', 'NEUTRAL')",
            name="ck_ai_prediction_feature_direction",
        ),
        sa.CheckConstraint(
            "explanation_method IN ('RULE', 'PERMUTATION', 'SHAP', 'OTHER')",
            name="ck_ai_prediction_feature_explanation_method",
        ),
    )
    op.create_index("ix_ai_prediction_feature_prediction_id", "ai_prediction_feature", ["prediction_id"])

    op.create_table(
        "teacher_risk_review",
        sa.Column("review_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("prediction_id", sa.Integer(), sa.ForeignKey("ai_prediction.prediction_id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("student.student_id", ondelete="CASCADE"), nullable=False),
        sa.Column("reviewed_by_staff_id", sa.String(length=20), sa.ForeignKey("academic_staff.staff_id", ondelete="SET NULL"), nullable=True),
        sa.Column("review_decision", sa.String(length=30), nullable=False),
        sa.Column("teacher_notes", sa.Text(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint(
            "review_decision IN ('NEEDS_INTERVENTION', 'CONTINUE_MONITORING', 'NOT_AT_RISK', 'INSUFFICIENT_DATA')",
            name="ck_teacher_risk_review_decision",
        ),
    )
    op.create_index("ix_teacher_risk_review_prediction_id", "teacher_risk_review", ["prediction_id"])
    op.create_index("ix_teacher_risk_review_student_id", "teacher_risk_review", ["student_id"])
    op.create_index("ix_teacher_risk_review_reviewed_by_staff_id", "teacher_risk_review", ["reviewed_by_staff_id"])

    op.create_table(
        "prediction_outcome",
        sa.Column("outcome_id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("prediction_id", sa.Integer(), sa.ForeignKey("ai_prediction.prediction_id", ondelete="CASCADE"), nullable=False),
        sa.Column("actual_period_grade", sa.Numeric(6, 2), nullable=True),
        sa.Column("actual_risk_status", sa.String(length=30), nullable=True),
        sa.Column("intervention_given", sa.Boolean(), nullable=True),
        sa.Column("intervention_result", sa.Text(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_prediction_outcome_prediction_id", "prediction_outcome", ["prediction_id"])


def downgrade() -> None:
    op.drop_index("ix_prediction_outcome_prediction_id", table_name="prediction_outcome")
    op.drop_table("prediction_outcome")

    op.drop_index("ix_teacher_risk_review_reviewed_by_staff_id", table_name="teacher_risk_review")
    op.drop_index("ix_teacher_risk_review_student_id", table_name="teacher_risk_review")
    op.drop_index("ix_teacher_risk_review_prediction_id", table_name="teacher_risk_review")
    op.drop_table("teacher_risk_review")

    op.drop_index("ix_ai_prediction_feature_prediction_id", table_name="ai_prediction_feature")
    op.drop_table("ai_prediction_feature")

    op.drop_index("ix_ai_prediction_model_version_id", table_name="ai_prediction")
    op.drop_index("ix_ai_prediction_target_period_id", table_name="ai_prediction")
    op.drop_index("ix_ai_prediction_source_period_id", table_name="ai_prediction")
    op.drop_index("ix_ai_prediction_subject_id", table_name="ai_prediction")
    op.drop_index("ix_ai_prediction_class_id", table_name="ai_prediction")
    op.drop_index("ix_ai_prediction_student_id", table_name="ai_prediction")
    op.drop_table("ai_prediction")

    op.drop_table("risk_threshold")

    op.drop_index("uq_ai_model_version_active_model", table_name="ai_model_version")
    op.drop_index("ix_ai_model_version_model_name_type", table_name="ai_model_version")
    op.drop_table("ai_model_version")

    op.drop_index("ix_student_period_grade_academic_period_id", table_name="student_period_grade")
    op.drop_index("ix_student_period_grade_subject_id", table_name="student_period_grade")
    op.drop_index("ix_student_period_grade_class_id", table_name="student_period_grade")
    op.drop_index("ix_student_period_grade_student_id", table_name="student_period_grade")
    op.drop_table("student_period_grade")

    op.drop_index("ix_student_assessment_score_student_id", table_name="student_assessment_score")
    op.drop_index("ix_student_assessment_score_assessment_id", table_name="student_assessment_score")
    op.drop_table("student_assessment_score")

    op.drop_index("ix_assessment_item_academic_period_id", table_name="assessment_item")
    op.drop_index("ix_assessment_item_subject_id", table_name="assessment_item")
    op.drop_index("ix_assessment_item_class_id", table_name="assessment_item")
    op.drop_table("assessment_item")

    if _constraint_exists("academic_period", "uq_academic_period_year_type_sequence", "unique"):
        op.drop_constraint("uq_academic_period_year_type_sequence", "academic_period", type_="unique")
    for constraint_name in (
        "ck_academic_period_progress_ratio",
        "ck_academic_period_total_positive",
        "ck_academic_period_sequence_positive",
        "ck_academic_period_period_type",
    ):
        if _constraint_exists("academic_period", constraint_name, "check"):
            op.drop_constraint(constraint_name, "academic_period", type_="check")

    op.create_check_constraint(
        "academic_period_period_type_check",
        "academic_period",
        "period_type IN ('QUARTER', 'SEMESTER')",
    )

    for column_name in ("updated_at", "period_progress_ratio", "total_periods_in_year", "period_sequence"):
        if _column_exists("academic_period", column_name):
            op.drop_column("academic_period", column_name)
