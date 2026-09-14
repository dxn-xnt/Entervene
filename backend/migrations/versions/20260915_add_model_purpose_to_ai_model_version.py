"""Add model_purpose column and active-purpose unique index to ai_model_version.

Revision ID: 20260915_add_model_purpose
Revises: 20260914_prediction_integrity
Create Date: 2026-09-15 00:35:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260915_add_model_purpose"
down_revision = "20260914_prediction_integrity"
branch_labels = None
depends_on = None

VALID_PURPOSES = (
    "NEXT_PERIOD_BASELINE_FORECAST",
    "CURRENT_PERIOD_FINAL_GRADE_PROJECTION",
)

MODEL_NAME_TO_PURPOSE = {
    "entervene_next_period_grade_rf": "NEXT_PERIOD_BASELINE_FORECAST",
    "entervene_current_period_grade_rf_v1": "CURRENT_PERIOD_FINAL_GRADE_PROJECTION",
}


def upgrade():
    conn = op.get_bind()

    # --- Preflight Audit ---
    existing_rows = conn.execute(
        sa.text("SELECT model_version_id, model_name, model_type, algorithm, is_active FROM ai_model_version")
    ).fetchall()

    print(f"\n[Migration Preflight] Enumerating {len(existing_rows)} existing ai_model_version row(s):")
    for row in existing_rows:
        mv_id, m_name, m_type, algo, active = row
        print(f"  ID={mv_id}, name={m_name}, type={m_type}, algorithm={algo}, is_active={active}")
        if m_name not in MODEL_NAME_TO_PURPOSE:
            raise RuntimeError(
                f"[Migration Preflight ABORT] Found unrecognized model_name '{m_name}' (ID={mv_id}) "
                f"which cannot be safely mapped to a known ModelPurpose."
            )

    # 1. Add model_purpose column as nullable
    op.add_column(
        "ai_model_version",
        sa.Column("model_purpose", sa.String(length=64), nullable=True),
    )

    # 2. Deterministic backfill
    for m_name, purpose in MODEL_NAME_TO_PURPOSE.items():
        conn.execute(
            sa.text("UPDATE ai_model_version SET model_purpose = :purpose WHERE model_name = :name"),
            {"purpose": purpose, "name": m_name},
        )

    # 3. Verify zero NULLs before setting NOT NULL
    null_count = conn.execute(
        sa.text("SELECT count(*) FROM ai_model_version WHERE model_purpose IS NULL")
    ).scalar()

    if null_count > 0:
        raise RuntimeError(
            f"[Migration Post-Backfill ABORT] Found {null_count} rows with NULL model_purpose after backfill."
        )

    print(f"[Migration Post-Backfill] Successfully backfilled {len(existing_rows)} row(s). Zero NULLs verified.")

    # 4. Alter column to NOT NULL
    op.alter_column("ai_model_version", "model_purpose", nullable=False)

    # 5. Add check constraint on valid purposes
    purpose_list_sql = ", ".join(f"'{p}'" for p in VALID_PURPOSES)
    op.create_check_constraint(
        "ck_ai_model_version_model_purpose",
        "ai_model_version",
        f"model_purpose IN ({purpose_list_sql})",
    )

    # 6. Drop old active model index
    op.drop_index("uq_ai_model_version_active_model", table_name="ai_model_version")

    # 7. Create new partial unique index enforcing exactly ONE active model per model_purpose
    op.create_index(
        "uq_ai_model_version_active_purpose",
        "ai_model_version",
        ["model_purpose"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
        sqlite_where=sa.text("is_active = 1"),
    )
    print("[Migration] Applied partial unique index: model_purpose WHERE is_active = true\n")


def downgrade():
    # 1. Drop new active-purpose unique index
    op.drop_index("uq_ai_model_version_active_purpose", table_name="ai_model_version")

    # 2. Re-create old active-model unique index on (model_name, model_type)
    op.create_index(
        "uq_ai_model_version_active_model",
        "ai_model_version",
        ["model_name", "model_type"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
        sqlite_where=sa.text("is_active = 1"),
    )

    # 3. Drop check constraint
    op.drop_constraint("ck_ai_model_version_model_purpose", "ai_model_version", type_="check")

    # 4. Drop column model_purpose
    op.drop_column("ai_model_version", "model_purpose")
