"""seed_school_metadata_settings

Revision ID: e3a5ee4dd468
Revises: e641d2c36fc6
Create Date: 2026-09-11 18:25:46.304797

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e3a5ee4dd468'
down_revision: Union[str, Sequence[str], None] = 'e641d2c36fc6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text("""
            INSERT INTO setting (key, value, type, "group", is_public, description)
            VALUES
                ('school_name', 'Medellin National Science and Technology School (MNSTS)', 'STRING', 'school', true, 'Official school name'),
                ('school_id', '303012', 'STRING', 'school', true, 'DepEd School ID'),
                ('school_region', 'IV', 'STRING', 'school', true, 'DepEd Region designation'),
                ('school_division', 'Fourth District', 'STRING', 'school', true, 'DepEd Division designation')
            ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                description = EXCLUDED.description;
        """)
    )


def downgrade() -> None:
    op.execute(
        sa.text("""
            DELETE FROM setting
            WHERE key IN ('school_name', 'school_id', 'school_region', 'school_division');
        """)
    )
