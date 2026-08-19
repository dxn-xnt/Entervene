"""set_math_science_flags

Revision ID: e0119a67e334
Revises: 22b964f8c2e2
Create Date: 2026-08-19 15:52:21.916594

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e0119a67e334'
down_revision: Union[str, Sequence[str], None] = '22b964f8c2e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("""
        UPDATE subject 
        SET is_math_or_science = TRUE
        WHERE subject_name IN (
            'Enhanced Mathematics 9', 
            'Enhanced Science 9', 
            'Mathematics 7', 
            'Science 7',
            'Mathematics 8', 
            'Science 8', 
            'Mathematics 10', 
            'Science 10',
            'Mathematics (Generic)', 
            'Science (Generic)',
            'General Mathematics', 
            'Earth and Life Science'
        )
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("""
        UPDATE subject 
        SET is_math_or_science = FALSE
        WHERE subject_name IN (
            'Enhanced Mathematics 9', 
            'Enhanced Science 9', 
            'Mathematics 7', 
            'Science 7',
            'Mathematics 8', 
            'Science 8', 
            'Mathematics 10', 
            'Science 10',
            'Mathematics (Generic)', 
            'Science (Generic)',
            'General Mathematics', 
            'Earth and Life Science'
        )
    """)
