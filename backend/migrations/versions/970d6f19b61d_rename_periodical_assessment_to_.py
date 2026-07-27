"""rename periodical_assessment to quarterly_assessment

Revision ID: 970d6f19b61d
Revises: 20260703_teacher_review_decisions
Create Date: 2026-07-27 17:39:25.072249

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '970d6f19b61d'
down_revision: Union[str, Sequence[str], None] = '20260703_teacher_review_decisions'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use alter_column to rename to preserve data
    op.alter_column('student_period_grade', 'periodical_assessment_percent', new_column_name='quarterly_assessment_percent')

def downgrade() -> None:
    op.alter_column('student_period_grade', 'quarterly_assessment_percent', new_column_name='periodical_assessment_percent')
