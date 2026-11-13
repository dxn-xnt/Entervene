"""Add standalone external links to student study suggestions.

Revision ID: 20261113_suggestion_links
Revises: 20261112_classwork_refs
"""

from alembic import op
import sqlalchemy as sa


revision = "20261113_suggestion_links"
down_revision = "20261112_classwork_refs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("student_suggestion", sa.Column("external_url", sa.Text(), nullable=True))
    op.drop_constraint("ck_student_suggestion_resource_type", "student_suggestion", type_="check")
    op.drop_constraint("ck_student_suggestion_resource_link", "student_suggestion", type_="check")
    op.create_check_constraint(
        "ck_student_suggestion_resource_type", "student_suggestion",
        "resource_type IN ('LESSON', 'CLASSWORK', 'LINK')",
    )
    op.create_check_constraint(
        "ck_student_suggestion_resource_link", "student_suggestion",
        "(resource_type = 'LESSON' AND lesson_id IS NOT NULL AND external_url IS NULL) OR "
        "(resource_type = 'CLASSWORK' AND lesson_id IS NULL AND external_url IS NULL) OR "
        "(resource_type = 'LINK' AND lesson_id IS NULL AND "
        "external_url IS NOT NULL AND length(trim(external_url)) BETWEEN 1 AND 2048)",
    )
    op.create_index(
        "uq_student_suggestion_active_link", "student_suggestion",
        ["student_id", "subject_id", "external_url"], unique=True,
        postgresql_where=sa.text("status = 'ACTIVE' AND resource_type = 'LINK'"),
        sqlite_where=sa.text("status = 'ACTIVE' AND resource_type = 'LINK'"),
    )


def downgrade() -> None:
    existing = op.get_bind().execute(sa.text(
        "SELECT 1 FROM student_suggestion WHERE resource_type = 'LINK' LIMIT 1"
    )).first()
    if existing:
        raise RuntimeError("Archive or migrate LINK suggestions before downgrading")
    op.drop_index("uq_student_suggestion_active_link", table_name="student_suggestion")
    op.drop_constraint("ck_student_suggestion_resource_link", "student_suggestion", type_="check")
    op.drop_constraint("ck_student_suggestion_resource_type", "student_suggestion", type_="check")
    op.create_check_constraint(
        "ck_student_suggestion_resource_type", "student_suggestion",
        "resource_type IN ('LESSON', 'CLASSWORK')",
    )
    op.create_check_constraint(
        "ck_student_suggestion_resource_link", "student_suggestion",
        "(resource_type = 'LESSON' AND lesson_id IS NOT NULL) OR "
        "(resource_type = 'CLASSWORK' AND lesson_id IS NULL)",
    )
    op.drop_column("student_suggestion", "external_url")
