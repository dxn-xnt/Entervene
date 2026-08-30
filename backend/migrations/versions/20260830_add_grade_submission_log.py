"""add grade_submission_log table

Revision ID: 20260830_grade_submission_log
Revises: 20260829_exam_subtype
Create Date: 2026-08-30 20:35:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = '20260830_grade_submission_log'
down_revision: Union[str, Sequence[str], None] = '20260829_exam_subtype'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'grade_submission_log',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('student_period_grade_id', sa.Integer(), sa.ForeignKey('student_period_grade.period_grade_id', ondelete='SET NULL'), nullable=True),
        sa.Column('student_id', UUID(as_uuid=True), sa.ForeignKey('student.student_id', ondelete='CASCADE'), nullable=False),
        sa.Column('class_id', sa.Integer(), sa.ForeignKey('class.class_id', ondelete='CASCADE'), nullable=False),
        sa.Column('subject_id', sa.Integer(), sa.ForeignKey('subject.subject_id', ondelete='CASCADE'), nullable=False),
        sa.Column('academic_period_id', sa.Integer(), sa.ForeignKey('academic_period.academic_period_id', ondelete='CASCADE'), nullable=False),
        sa.Column('written_work_percent', sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column('performance_task_percent', sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column('quarterly_assessment_percent', sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column('initial_grade', sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column('transmuted_grade', sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column('final_period_grade', sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column('submitted_by_staff_id', sa.String(length=20), sa.ForeignKey('academic_staff.staff_id', ondelete='SET NULL'), nullable=True),
        sa.Column('submitted_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('submission_type', sa.String(length=20), nullable=False, server_default='single'),
        sa.Column('remarks', sa.Text(), nullable=True),
    )
    op.create_index('ix_grade_submission_log_period_grade_id', 'grade_submission_log', ['student_period_grade_id'])
    op.create_index('ix_grade_submission_log_student_id', 'grade_submission_log', ['student_id'])
    op.create_index('ix_grade_submission_log_scope', 'grade_submission_log', ['class_id', 'subject_id', 'academic_period_id'])
    op.create_index('ix_grade_submission_log_submitted_by', 'grade_submission_log', ['submitted_by_staff_id'])


def downgrade() -> None:
    op.drop_index('ix_grade_submission_log_submitted_by', table_name='grade_submission_log')
    op.drop_index('ix_grade_submission_log_scope', table_name='grade_submission_log')
    op.drop_index('ix_grade_submission_log_student_id', table_name='grade_submission_log')
    op.drop_index('ix_grade_submission_log_period_grade_id', table_name='grade_submission_log')
    op.drop_table('grade_submission_log')
