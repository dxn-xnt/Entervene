"""Protect development current-term prediction history from updates and deletes.

Revision ID: 20260922_development_immutable
Revises: 20260922_development_prediction
"""

from alembic import op


revision = "20260922_development_immutable"
down_revision = "20260922_development_prediction"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE FUNCTION guard_development_current_term_prediction() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'Development current-term predictions are immutable' USING ERRCODE = '23514';
        END $$
    """)
    op.execute("""
        CREATE TRIGGER immutable_development_current_term_prediction
        BEFORE UPDATE OR DELETE ON development_current_term_prediction
        FOR EACH ROW EXECUTE FUNCTION guard_development_current_term_prediction()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER immutable_development_current_term_prediction ON development_current_term_prediction")
    op.execute("DROP FUNCTION guard_development_current_term_prediction()")
