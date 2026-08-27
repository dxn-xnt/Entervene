"""add batch_id to teacher_substitution

Revision ID: 20260827_add_batch_id_to_teacher_substitution
Revises: 20260827_add_entered_by_audit_columns
Create Date: 2026-08-27 16:08:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260827_add_batch_id_to_teacher_substitution'
down_revision: Union[str, Sequence[str], None] = '20260827_add_entered_by_audit_columns'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE teacher_substitution
            ADD COLUMN IF NOT EXISTS batch_id UUID;
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_teacher_substitution_batch_status
            ON teacher_substitution(batch_id, status);
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_teacher_substitution_batch_status;")
    op.execute("ALTER TABLE teacher_substitution DROP COLUMN IF EXISTS batch_id;")
