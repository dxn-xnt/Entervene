"""merge_drop_leave_request_and_prediction_evidence_heads

Revision ID: da1b36c9a0ef
Revises: 20260911_drop_leave_request, 20260911_prediction_evidence_scope
Create Date: 2026-09-11 13:54:18.029243

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'da1b36c9a0ef'
down_revision: Union[str, Sequence[str], None] = ('20260911_drop_leave_request', '20260911_prediction_evidence_scope')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
