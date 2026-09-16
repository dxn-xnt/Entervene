"""Add Unified current-term model purpose.

Revision ID: 20260916_unified_current_term_purpose
Revises: 20260915_risk_assessment_status
Create Date: 2026-09-16 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260916_unified_current_term_purpose"
down_revision = "20260915_risk_assessment_status"
branch_labels = None
depends_on = None


OLD_PURPOSES = (
    "NEXT_PERIOD_BASELINE_FORECAST",
    "CURRENT_PERIOD_FINAL_GRADE_PROJECTION",
)

NEW_PURPOSES = (
    "NEXT_PERIOD_BASELINE_FORECAST",
    "CURRENT_PERIOD_FINAL_GRADE_PROJECTION",
    "UNIFIED_CURRENT_TERM_PROJECTION",
)


def _purpose_sql(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade():
    conn = op.get_bind()

    by_purpose = conn.execute(
        sa.text(
            """
            SELECT model_purpose, count(*) AS count
            FROM ai_model_version
            GROUP BY model_purpose
            ORDER BY model_purpose
            """
        )
    ).fetchall()
    print("[Migration preflight] ai_model_version rows by purpose:", [(row[0], row[1]) for row in by_purpose])

    op.drop_constraint("ck_ai_model_version_model_purpose", "ai_model_version", type_="check")
    op.create_check_constraint(
        "ck_ai_model_version_model_purpose",
        "ai_model_version",
        f"model_purpose IN ({_purpose_sql(NEW_PURPOSES)})",
    )


def downgrade():
    conn = op.get_bind()
    unified_count = conn.execute(
        sa.text(
            "SELECT count(*) FROM ai_model_version WHERE model_purpose = 'UNIFIED_CURRENT_TERM_PROJECTION'"
        )
    ).scalar()
    if unified_count:
        raise RuntimeError(
            "Cannot downgrade model_purpose constraint while UNIFIED_CURRENT_TERM_PROJECTION rows exist."
        )

    op.drop_constraint("ck_ai_model_version_model_purpose", "ai_model_version", type_="check")
    op.create_check_constraint(
        "ck_ai_model_version_model_purpose",
        "ai_model_version",
        f"model_purpose IN ({_purpose_sql(OLD_PURPOSES)})",
    )
