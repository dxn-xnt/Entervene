"""Create the pre-Alembic core schema for a completely empty PostgreSQL database.

The original schema is frozen in migrations/bootstrap_schema.sql. Existing
databases already past this revision do not run this migration.
"""

from pathlib import Path

from alembic import op
import sqlalchemy as sa


revision = "20260602_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


_CORE_TABLES = (
    "role", "user_account", "user_roles", "academic_year", "academic_level",
    "academic_period", "academic_staff", "student", "subject", "class",
    "subject_load", "student_class", "lesson", "lesson_attachment",
    "lesson_assignment", "classwork", "classwork_assignment",
    "classwork_attachment", "classwork_allowed_file_type", "classwork_lesson",
    "student_submission", "submission_attachment", "user_login_log",
)


def upgrade() -> None:
    # Several existing revision IDs exceed Alembic's default VARCHAR(32).
    op.alter_column("alembic_version", "version_num", type_=sa.String(128))
    schema = Path(__file__).resolve().parents[1] / "bootstrap_schema.sql"
    op.get_bind().exec_driver_sql(schema.read_text(encoding="utf-8"))


def downgrade() -> None:
    for table in reversed(_CORE_TABLES):
        op.drop_table(table)
    # pgcrypto may have existed before this migration; leave the extension alone.
