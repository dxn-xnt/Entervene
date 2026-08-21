"""fix classwork_category check constraint to include QUARTERLY_ASSESSMENT

Revision ID: 20260821_fix_classwork_category_check
Revises: 20260821_add_reading_focused_seconds
Create Date: 2026-08-21 16:58:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260821_fix_classwork_category_check'
down_revision: Union[str, Sequence[str], None] = '20260821_add_reading_focused_seconds'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TABLE classwork DROP CONSTRAINT IF EXISTS classwork_classwork_category_check;")
    op.execute("ALTER TABLE classwork DROP CONSTRAINT IF EXISTS ck_classwork_classwork_category;")

    op.execute(
        "UPDATE classwork SET classwork_category = 'QUARTERLY_ASSESSMENT' "
        "WHERE classwork_category IN ('PERIODICAL_EXAM', 'PERIODICAL_ASSESSMENT')"
    )

    op.create_check_constraint(
        'ck_classwork_classwork_category',
        'classwork',
        "classwork_category IS NULL OR classwork_category IN ('WRITTEN_WORK', 'PERFORMANCE_TASK', 'QUARTERLY_ASSESSMENT')"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("ALTER TABLE classwork DROP CONSTRAINT IF EXISTS ck_classwork_classwork_category;")
    op.execute(
        "UPDATE classwork SET classwork_category = 'PERIODICAL_EXAM' "
        "WHERE classwork_category = 'QUARTERLY_ASSESSMENT'"
    )
    op.create_check_constraint(
        'classwork_classwork_category_check',
        'classwork',
        "classwork_category IS NULL OR classwork_category IN ('WRITTEN_WORK', 'PERFORMANCE_TASK', 'PERIODICAL_EXAM')"
    )
