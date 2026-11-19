"""Allow multiple active meeting-slot rows per (class_id, subject_id, academic_period_id).

Revision ID: 20261119_multi_slot_loads
Revises: 20261118_remediation_evidence
Create Date: 2026-11-19 18:00:00.000000

Replaces the legacy partial UNIQUE index `uq_subject_load_active_academic`
(introduced in 20260911_subject_load_section_revisions) with a non-unique
partial lookup index `ix_subject_load_active_academic`. Per-slot active and
draft uniqueness remains enforced by `uq_subject_load_active` and
`uq_subject_load_draft` on `logical_load_id`.
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20261119_multi_slot_loads"
down_revision: Union[str, Sequence[str], None] = "20261118_remediation_evidence"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_subject_load_active_academic;")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_subject_load_active_academic "
        "ON subject_load(class_id, subject_id, academic_period_id) "
        "WHERE is_active_version = TRUE;"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_subject_load_active_academic;")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_subject_load_active_academic "
        "ON subject_load(class_id, subject_id, academic_period_id) "
        "WHERE is_active_version = TRUE;"
    )
