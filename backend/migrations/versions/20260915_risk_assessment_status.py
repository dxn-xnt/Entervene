"""Add risk assessment status for non-risk academic estimates.

Revision ID: 20260915_risk_assessment_status
Revises: 20260915_add_model_purpose
Create Date: 2026-09-15 13:20:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260915_risk_assessment_status"
down_revision = "20260915_add_model_purpose"
branch_labels = None
depends_on = None


RISK_STATUSES = (
    "EVALUATED",
    "NOT_EVALUATED_FOR_CURRENT_PERIOD_MODEL",
    "INSUFFICIENT_RISK_EVIDENCE",
)


def _scalar(conn, sql: str):
    return conn.execute(sa.text(sql)).scalar()


def upgrade():
    conn = op.get_bind()
    total = _scalar(conn, "SELECT count(*) FROM ai_prediction")
    by_model_purpose = conn.execute(sa.text("""
        SELECT coalesce(v.model_purpose, 'LEGACY_NULL_MODEL_VERSION') AS purpose, count(*) AS count
        FROM ai_prediction p
        LEFT JOIN ai_model_version v ON v.model_version_id = p.model_version_id
        GROUP BY coalesce(v.model_purpose, 'LEGACY_NULL_MODEL_VERSION')
        ORDER BY purpose
    """)).fetchall()
    null_risk_level = _scalar(conn, "SELECT count(*) FROM ai_prediction WHERE risk_level IS NULL")
    null_data_status = _scalar(conn, "SELECT count(*) FROM ai_prediction WHERE data_status IS NULL")
    null_risk_score = _scalar(conn, "SELECT count(*) FROM ai_prediction WHERE risk_score IS NULL")
    print(
        "[Migration preflight] ai_prediction rows=",
        total,
        " by purpose=",
        [(row[0], row[1]) for row in by_model_purpose],
        " null risk_level=",
        null_risk_level,
        " null data_status=",
        null_data_status,
        " null risk_score=",
        null_risk_score,
    )

    op.add_column(
        "ai_prediction",
        sa.Column("risk_assessment_status", sa.String(length=60), nullable=True),
    )

    op.execute("ALTER TABLE ai_prediction DISABLE TRIGGER immutable_audited_prediction")
    try:
        op.execute("""
            UPDATE ai_prediction
            SET risk_assessment_status = CASE
                WHEN risk_level IS NOT NULL AND data_status IS NOT NULL THEN 'EVALUATED'
                ELSE 'INSUFFICIENT_RISK_EVIDENCE'
            END
        """)
    finally:
        op.execute("ALTER TABLE ai_prediction ENABLE TRIGGER immutable_audited_prediction")
    op.alter_column(
        "ai_prediction",
        "risk_assessment_status",
        existing_type=sa.String(length=60),
        nullable=False,
        server_default="EVALUATED",
    )

    op.drop_constraint("ck_ai_prediction_risk_level", "ai_prediction", type_="check")
    op.drop_constraint("ck_ai_prediction_data_status", "ai_prediction", type_="check")
    op.alter_column("ai_prediction", "risk_level", existing_type=sa.String(length=30), nullable=True)
    op.alter_column("ai_prediction", "data_status", existing_type=sa.String(length=30), nullable=True)
    op.create_check_constraint(
        "ck_ai_prediction_risk_level",
        "ai_prediction",
        "risk_level IS NULL OR risk_level IN ('LOW_RISK', 'NEEDS_MONITORING', 'MODERATE_RISK', 'HIGH_RISK', 'INSUFFICIENT_DATA')",
    )
    op.create_check_constraint(
        "ck_ai_prediction_data_status",
        "ai_prediction",
        "data_status IS NULL OR data_status IN ('SUFFICIENT', 'INSUFFICIENT_DATA', 'COLD_START')",
    )
    op.create_check_constraint(
        "ck_ai_prediction_risk_assessment_status",
        "ai_prediction",
        f"risk_assessment_status IN ({', '.join(repr(status) for status in RISK_STATUSES)})",
    )

    postflight = conn.execute(sa.text("""
        SELECT risk_assessment_status, count(*)
        FROM ai_prediction
        GROUP BY risk_assessment_status
        ORDER BY risk_assessment_status
    """)).fetchall()
    print("[Migration postflight] risk_assessment_status=", [(row[0], row[1]) for row in postflight])


def downgrade():
    # Downgrade is schema-compatible with the previous application by mapping
    # non-risk academic estimates to the old insufficient-data placeholders.
    # That mapping is lossy and should be used only for rollback.
    op.execute("ALTER TABLE ai_prediction DISABLE TRIGGER immutable_audited_prediction")
    try:
        op.execute("""
            UPDATE ai_prediction
            SET
                risk_level = coalesce(risk_level, 'INSUFFICIENT_DATA'),
                data_status = coalesce(data_status, 'INSUFFICIENT_DATA')
            WHERE risk_level IS NULL OR data_status IS NULL
        """)
    finally:
        op.execute("ALTER TABLE ai_prediction ENABLE TRIGGER immutable_audited_prediction")
    op.drop_constraint("ck_ai_prediction_risk_assessment_status", "ai_prediction", type_="check")
    op.drop_constraint("ck_ai_prediction_risk_level", "ai_prediction", type_="check")
    op.drop_constraint("ck_ai_prediction_data_status", "ai_prediction", type_="check")
    op.alter_column("ai_prediction", "risk_level", existing_type=sa.String(length=30), nullable=False)
    op.alter_column("ai_prediction", "data_status", existing_type=sa.String(length=30), nullable=False)
    op.create_check_constraint(
        "ck_ai_prediction_risk_level",
        "ai_prediction",
        "risk_level IN ('LOW_RISK', 'NEEDS_MONITORING', 'MODERATE_RISK', 'HIGH_RISK', 'INSUFFICIENT_DATA')",
    )
    op.create_check_constraint(
        "ck_ai_prediction_data_status",
        "ai_prediction",
        "data_status IN ('SUFFICIENT', 'INSUFFICIENT_DATA', 'COLD_START')",
    )
    op.drop_column("ai_prediction", "risk_assessment_status")
