"""Merge subject-code reconciliation and intervention resource schema branches.

Revision ID: 20261121_merge_resources
Revises: 20261120_reconcile_subject_codes, 20261121_resource_origin
"""

from typing import Sequence, Union


revision: str = "20261121_merge_resources"
down_revision: Union[str, Sequence[str], None] = (
    "20261120_reconcile_subject_codes",
    "20261121_resource_origin",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Join the two independently developed migration branches."""


def downgrade() -> None:
    """Split the migration graph back into its two parent heads."""
