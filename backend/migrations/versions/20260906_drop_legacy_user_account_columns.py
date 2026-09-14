"""drop legacy user_account columns (invitation_token, ref_type, ref_id)

Revision ID: 20260906_drop_legacy_user_account_columns
Revises: 20260902_update_attendance_unique_constraint
Create Date: 2026-09-06 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260906_drop_legacy_user_account_columns'
down_revision: Union[str, Sequence[str], None] = '20260902_update_attendance_unique_constraint'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Drop unused index if it exists
    op.execute("DROP INDEX IF EXISTS idx_user_account_ref;")

    # 2. Drop check constraint on ref_type if it exists
    op.execute("""
        DO $$
        DECLARE
            r RECORD;
        BEGIN
            FOR r IN (
                SELECT conname
                FROM pg_constraint c
                JOIN pg_class t ON c.conrelid = t.oid
                WHERE t.relname = 'user_account' AND conname LIKE '%ref_type%'
            ) LOOP
                EXECUTE 'ALTER TABLE user_account DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
            END LOOP;
        END $$;
    """)

    # 3. Drop legacy columns from user_account
    op.drop_column('user_account', 'invitation_token')
    op.drop_column('user_account', 'ref_type')
    op.drop_column('user_account', 'ref_id')


def downgrade() -> None:
    op.add_column('user_account', sa.Column('ref_id', sa.String(50), nullable=True))
    op.add_column('user_account', sa.Column('ref_type', sa.String(50), nullable=True))
    op.add_column('user_account', sa.Column('invitation_token', sa.String(255), nullable=True))
