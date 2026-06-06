"""enforce one student class per academic year

Revision ID: 20260606_student_class_year
Revises: 20260604_invitation_tokens, 20260604_add_lesson_is_archived
Create Date: 2026-06-06
"""

from alembic import op
import sqlalchemy as sa


revision = "20260606_student_class_year"
down_revision = ("20260604_invitation_tokens", "20260604_add_lesson_is_archived")
branch_labels = None
depends_on = None


def _validate_no_orphaned_classes(bind) -> None:
    orphaned = bind.execute(
        sa.text(
            """
            SELECT sc.student_class_id, sc.class_id
            FROM student_class sc
            LEFT JOIN class c ON c.class_id = sc.class_id
            WHERE c.class_id IS NULL
            ORDER BY sc.student_class_id
            """
        )
    ).fetchall()
    if orphaned:
        details = "; ".join(
            f"student_class_id={row.student_class_id}, class_id={row.class_id}"
            for row in orphaned
        )
        raise RuntimeError(
            "Cannot migrate student_class because orphaned class references exist: "
            f"{details}. Review these records manually before rerunning the migration."
        )


def _validate_no_duplicate_student_years(bind) -> None:
    duplicates = bind.execute(
        sa.text(
            """
            SELECT
                student_id,
                academic_year_id,
                array_agg(class_id ORDER BY class_id) AS class_ids
            FROM student_class
            GROUP BY student_id, academic_year_id
            HAVING count(*) > 1
            ORDER BY student_id, academic_year_id
            """
        )
    ).fetchall()
    if duplicates:
        details = "; ".join(
            "student_id={student_id}, academic_year_id={academic_year_id}, "
            "conflicting class_ids={class_ids}".format(
                student_id=row.student_id,
                academic_year_id=row.academic_year_id,
                class_ids=list(row.class_ids),
            )
            for row in duplicates
        )
        raise RuntimeError(
            "Cannot enforce one class per student per academic year because duplicate "
            f"assignments exist: {details}. Review these records manually before "
            "rerunning the migration."
        )


def _drop_existing_class_foreign_key() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for foreign_key in inspector.get_foreign_keys("student_class"):
        if (
            foreign_key["referred_table"] == "class"
            and foreign_key["constrained_columns"] == ["class_id"]
        ):
            op.drop_constraint(foreign_key["name"], "student_class", type_="foreignkey")
            return
    raise RuntimeError(
        "Cannot replace the student_class class foreign key because the existing "
        "class_id foreign key was not found."
    )


def upgrade() -> None:
    bind = op.get_bind()

    op.add_column("student_class", sa.Column("academic_year_id", sa.Integer(), nullable=True))

    _validate_no_orphaned_classes(bind)
    bind.execute(
        sa.text(
            """
            UPDATE student_class sc
            SET academic_year_id = c.academic_year_id
            FROM class c
            WHERE c.class_id = sc.class_id
            """
        )
    )
    _validate_no_duplicate_student_years(bind)

    op.alter_column("student_class", "academic_year_id", nullable=False)
    op.create_unique_constraint(
        "uq_class_class_id_academic_year_id",
        "class",
        ["class_id", "academic_year_id"],
    )
    _drop_existing_class_foreign_key()
    op.create_foreign_key(
        "fk_student_class_class_academic_year",
        "student_class",
        "class",
        ["class_id", "academic_year_id"],
        ["class_id", "academic_year_id"],
        ondelete="CASCADE",
    )
    op.create_unique_constraint(
        "uq_student_class_student_academic_year",
        "student_class",
        ["student_id", "academic_year_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_student_class_student_academic_year",
        "student_class",
        type_="unique",
    )
    op.drop_constraint(
        "fk_student_class_class_academic_year",
        "student_class",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "student_class_class_id_fkey",
        "student_class",
        "class",
        ["class_id"],
        ["class_id"],
        ondelete="CASCADE",
    )
    op.drop_constraint(
        "uq_class_class_id_academic_year_id",
        "class",
        type_="unique",
    )
    op.drop_column("student_class", "academic_year_id")
