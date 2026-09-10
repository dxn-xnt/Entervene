"""standardize_exams_and_repair_subject_templates

Revision ID: 20260911_exams_standard
Revises: c2ad67099617
Create Date: 2026-09-11 01:45:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '20260911_exams_standard'
down_revision: Union[str, Sequence[str], None] = 'c2ad67099617'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Rename existing third components to 'Exams'
    op.execute(
        sa.text("""
            UPDATE grading_template_component
            SET component_name = 'Exams'
            WHERE component_name IN ('Quarterly/Term Assessment', 'Quarterly Assessment')
        """)
    )

    # 2. Repair only subjects with missing or known placeholder values to active 'Core Subjects'
    # Preserves all valid templates such as 'Elective Susbjects', 'Enhanced Math Subjects', etc.
    op.execute(
        sa.text("""
            UPDATE subject
            SET default_grading_template = 'Core Subjects'
            WHERE default_grading_template IN ('Default SHS Grading', 'Default SHS', 'JHS Default Grading', 'None')
               OR default_grading_template IS NULL
        """)
    )


def downgrade() -> None:
    # 1. Revert component names for known templates
    op.execute(
        sa.text("""
            UPDATE grading_template_component
            SET component_name = 'Quarterly/Term Assessment'
            WHERE component_name = 'Exams' AND grading_template_id IN (1, 3, 4)
        """)
    )
    op.execute(
        sa.text("""
            UPDATE grading_template_component
            SET component_name = 'Quarterly Assessment'
            WHERE component_name = 'Exams' AND grading_template_id = 2
        """)
    )
