"""add subject_id and class_id to lesson_plan

Revision ID: 20260913_lesson_plan_subject_class
Revises: e1621cd0819f
Create Date: 2026-09-13 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260913_lesson_plan_subject_class'
down_revision: Union[str, Sequence[str], None] = 'e1621cd0819f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('lesson_plan', sa.Column('subject_id', sa.Integer(), nullable=True))
    op.add_column('lesson_plan', sa.Column('class_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_lesson_plan_subject_id', 'lesson_plan', 'subject', ['subject_id'], ['subject_id'], ondelete='SET NULL')
    op.create_foreign_key('fk_lesson_plan_class_id', 'lesson_plan', 'class', ['class_id'], ['class_id'], ondelete='SET NULL')
    op.create_index('idx_lesson_plan_subject_id', 'lesson_plan', ['subject_id'])
    op.create_index('idx_lesson_plan_class_id', 'lesson_plan', ['class_id'])


def downgrade() -> None:
    op.drop_index('idx_lesson_plan_class_id', table_name='lesson_plan')
    op.drop_index('idx_lesson_plan_subject_id', table_name='lesson_plan')
    op.drop_constraint('fk_lesson_plan_class_id', 'lesson_plan', type_='foreignkey')
    op.drop_constraint('fk_lesson_plan_subject_id', 'lesson_plan', type_='foreignkey')
    op.drop_column('lesson_plan', 'class_id')
    op.drop_column('lesson_plan', 'subject_id')
