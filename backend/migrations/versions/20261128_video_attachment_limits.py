"""Align persisted attachment size constraints with video upload limits.

Revision ID: 20261128_video_attachment_limits
Revises: 20261122_client_grading_templates
Create Date: 2026-11-28
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261128_video_attachment_limits"
down_revision: Union[str, Sequence[str], None] = "20261122_client_grading_templates"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_TABLE_CONSTRAINTS = (
    ("classwork_attachment", "classwork_attachment_size_check"),
    ("submission_attachment", "submission_attachment_size_check"),
)
_VIDEO_MIME_TYPES = ("video/mp4", "video/webm", "video/quicktime")
_DOCUMENT_LIMIT = 10 * 1024 * 1024
_VIDEO_LIMIT = 100 * 1024 * 1024
_LEGACY_LIMIT = 4 * 1024 * 1024


def _size_check_sql() -> str:
    video_types = ", ".join(f"'{mime}'" for mime in _VIDEO_MIME_TYPES)
    return (
        "file_size > 0 AND file_size <= CASE "
        f"WHEN LOWER(TRIM(COALESCE(file_type, ''))) IN ({video_types}) "
        f"THEN {_VIDEO_LIMIT} ELSE {_DOCUMENT_LIMIT} END"
    )


def _invalid_upgrade_count(table_name: str) -> int:
    result = op.get_bind().execute(
        sa.text(
            f"""
            SELECT COUNT(*)
            FROM {table_name}
            WHERE file_size <= 0
               OR file_size > CASE
                    WHEN LOWER(TRIM(COALESCE(file_type, ''))) IN :video_types
                    THEN :video_limit
                    ELSE :document_limit
                  END
            """
        ).bindparams(sa.bindparam("video_types", expanding=True)),
        {
            "video_types": list(_VIDEO_MIME_TYPES),
            "video_limit": _VIDEO_LIMIT,
            "document_limit": _DOCUMENT_LIMIT,
        },
    ).scalar_one()
    return int(result)


def upgrade() -> None:
    for table_name, constraint_name in _TABLE_CONSTRAINTS:
        invalid_count = _invalid_upgrade_count(table_name)
        if invalid_count:
            raise RuntimeError(
                f"Cannot apply video attachment limits: {table_name} contains "
                f"{invalid_count} row(s) that violate the new positive-size or MIME-specific limit."
            )
        op.drop_constraint(constraint_name, table_name, type_="check")
        op.create_check_constraint(constraint_name, table_name, _size_check_sql())


def downgrade() -> None:
    bind = op.get_bind()
    blocking = []
    for table_name, _constraint_name in _TABLE_CONSTRAINTS:
        count = int(
            bind.execute(
                sa.text(f"SELECT COUNT(*) FROM {table_name} WHERE file_size > :legacy_limit"),
                {"legacy_limit": _LEGACY_LIMIT},
            ).scalar_one()
        )
        if count:
            blocking.append(f"{table_name}={count}")
    if blocking:
        raise RuntimeError(
            "Cannot safely restore the legacy 4 MiB attachment constraint while larger "
            f"attachments exist ({', '.join(blocking)}). Remove them explicitly or restore "
            "a pre-migration backup; no attachment was modified."
        )

    for table_name, constraint_name in _TABLE_CONSTRAINTS:
        op.drop_constraint(constraint_name, table_name, type_="check")
        op.create_check_constraint(
            constraint_name,
            table_name,
            f"file_size <= {_LEGACY_LIMIT}",
        )
