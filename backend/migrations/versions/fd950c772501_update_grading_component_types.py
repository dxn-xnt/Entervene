"""update_grading_component_types

Revision ID: fd950c772501
Revises: 970d6f19b61d
Create Date: 2026-07-27 18:01:01.639515

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fd950c772501'
down_revision: Union[str, Sequence[str], None] = '970d6f19b61d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 0. Drop old check constraints if present using IF EXISTS so transaction is preserved
    op.execute("ALTER TABLE classwork DROP CONSTRAINT IF EXISTS classwork_classwork_category_check;")
    op.execute("ALTER TABLE classwork DROP CONSTRAINT IF EXISTS ck_classwork_classwork_category;")

    # 1. Update data in classwork table
    op.execute(
        "UPDATE classwork SET classwork_category = 'QUARTERLY_ASSESSMENT' "
        "WHERE classwork_category IN ('PERIODICAL_EXAM', 'PERIODICAL_ASSESSMENT')"
    )
    # 2. Update data in assessment_item table
    op.execute(
        "UPDATE assessment_item SET component_type = 'QUARTERLY_ASSESSMENT' "
        "WHERE component_type = 'PERIODICAL_ASSESSMENT'"
    )
    # 3. Drop old check constraint if it exists and create new check constraint
    op.execute("ALTER TABLE assessment_item DROP CONSTRAINT IF EXISTS ck_assessment_item_component_type;")

    op.create_check_constraint(
        'ck_assessment_item_component_type',
        'assessment_item',
        "component_type IN ('WRITTEN_WORK', 'PERFORMANCE_TASK', 'QUARTERLY_ASSESSMENT')"
    )


def downgrade() -> None:
    try:
        op.drop_constraint('ck_assessment_item_component_type', 'assessment_item', type_='check')
    except Exception:
        pass

    op.create_check_constraint(
        'ck_assessment_item_component_type',
        'assessment_item',
        "component_type IN ('WRITTEN_WORK', 'PERFORMANCE_TASK', 'PERIODICAL_ASSESSMENT')"
    )
    op.execute(
        "UPDATE assessment_item SET component_type = 'PERIODICAL_ASSESSMENT' "
        "WHERE component_type = 'QUARTERLY_ASSESSMENT'"
    )
    op.execute(
        "UPDATE classwork SET classwork_category = 'PERIODICAL_EXAM' "
        "WHERE classwork_category = 'QUARTERLY_ASSESSMENT'"
    )
