"""enforce one advisory class per adviser per academic year

Revision ID: 20260606_class_adviser_year
Revises: 20260606_student_class_year
Create Date: 2026-06-06
"""

from alembic import op
import sqlalchemy as sa


revision = "20260606_class_adviser_year"
down_revision = "20260606_student_class_year"
branch_labels = None
depends_on = None


def _validate_no_duplicate_adviser_years(bind) -> None:
    duplicates = bind.execute(
        sa.text(
            """
            SELECT
                adviser_staff_id,
                academic_year_id,
                array_agg(class_id ORDER BY class_id) AS class_ids,
                array_agg(section_name ORDER BY class_id) AS section_names
            FROM class
            WHERE adviser_staff_id IS NOT NULL
            GROUP BY adviser_staff_id, academic_year_id
            HAVING count(*) > 1
            ORDER BY adviser_staff_id, academic_year_id
            """
        )
    ).fetchall()
    if duplicates:
        details = "; ".join(
            "adviser_staff_id={adviser_staff_id}, academic_year_id={academic_year_id}, "
            "conflicting class_ids={class_ids}, conflicting section_names={section_names}".format(
                adviser_staff_id=row.adviser_staff_id,
                academic_year_id=row.academic_year_id,
                class_ids=list(row.class_ids),
                section_names=list(row.section_names),
            )
            for row in duplicates
        )
        raise RuntimeError(
            "Cannot enforce one advisory class per adviser per academic year because "
            f"duplicate assignments exist: {details}. Review these records manually "
            "before rerunning the migration."
        )


def upgrade() -> None:
    _validate_no_duplicate_adviser_years(op.get_bind())
    op.create_unique_constraint(
        "uq_class_adviser_academic_year",
        "class",
        ["adviser_staff_id", "academic_year_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_class_adviser_academic_year",
        "class",
        type_="unique",
    )
