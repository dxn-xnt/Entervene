"""Add Unified prediction risk-assessment status.

Revision ID: 20260916_unified_prediction_risk
Revises: 20260916_unified_current_term_purpose
Create Date: 2026-09-16 00:00:01.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260916_unified_prediction_risk"
down_revision = "20260916_unified_current_term_purpose"
branch_labels = None
depends_on = None


OLD_STATUSES = (
    "EVALUATED",
    "NOT_EVALUATED_FOR_CURRENT_PERIOD_MODEL",
    "INSUFFICIENT_RISK_EVIDENCE",
)

NEW_STATUSES = (
    "EVALUATED",
    "NOT_EVALUATED_FOR_CURRENT_PERIOD_MODEL",
    "NOT_EVALUATED_FOR_UNIFIED_MODEL",
    "INSUFFICIENT_RISK_EVIDENCE",
)


def _status_sql(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade():
    conn = op.get_bind()
    by_status = conn.execute(
        sa.text(
            """
            SELECT risk_assessment_status, count(*) AS count
            FROM ai_prediction
            GROUP BY risk_assessment_status
            ORDER BY risk_assessment_status
            """
        )
    ).fetchall()
    print("[Migration preflight] ai_prediction risk_assessment_status=", [(row[0], row[1]) for row in by_status])

    op.drop_constraint("ck_ai_prediction_risk_assessment_status", "ai_prediction", type_="check")
    op.create_check_constraint(
        "ck_ai_prediction_risk_assessment_status",
        "ai_prediction",
        f"risk_assessment_status IN ({_status_sql(NEW_STATUSES)})",
    )


def downgrade():
    conn = op.get_bind()
    unified_count = conn.execute(
        sa.text(
            "SELECT count(*) FROM ai_prediction WHERE risk_assessment_status = 'NOT_EVALUATED_FOR_UNIFIED_MODEL'"
        )
    ).scalar()
    if unified_count:
        raise RuntimeError(
            "Cannot downgrade risk_assessment_status constraint while Unified prediction rows exist."
        )

    op.drop_constraint("ck_ai_prediction_risk_assessment_status", "ai_prediction", type_="check")
    op.create_check_constraint(
        "ck_ai_prediction_risk_assessment_status",
        "ai_prediction",
        f"risk_assessment_status IN ({_status_sql(OLD_STATUSES)})",
    )
