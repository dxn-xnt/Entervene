"""add prediction outcome evaluation fields

Revision ID: 20260703_prediction_outcome_eval
Revises: 20260702_general_pathway
Create Date: 2026-07-03
"""

from alembic import op
import sqlalchemy as sa


revision = "20260703_prediction_outcome_eval"
down_revision = "20260702_general_pathway"
branch_labels = None
depends_on = None


def _column_exists(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    columns = (
        ("prediction_error", sa.Column("prediction_error", sa.Numeric(8, 2), nullable=True)),
        ("absolute_error", sa.Column("absolute_error", sa.Numeric(8, 2), nullable=True)),
        ("actual_passed", sa.Column("actual_passed", sa.Boolean(), nullable=True)),
        ("actual_risk_label", sa.Column("actual_risk_label", sa.String(length=30), nullable=True)),
        ("outcome_status", sa.Column("outcome_status", sa.String(length=30), nullable=True)),
        ("evaluated_at", sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=True)),
    )
    for column_name, column in columns:
        if not _column_exists("prediction_outcome", column_name):
            op.add_column("prediction_outcome", column)


def downgrade() -> None:
    for column_name in (
        "evaluated_at",
        "outcome_status",
        "actual_risk_label",
        "actual_passed",
        "absolute_error",
        "prediction_error",
    ):
        if _column_exists("prediction_outcome", column_name):
            op.drop_column("prediction_outcome", column_name)
