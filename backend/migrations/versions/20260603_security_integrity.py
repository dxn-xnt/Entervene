"""security hardening and integrity constraints

Revision ID: 20260603_security_integrity
Revises:
Create Date: 2026-06-03
"""

from alembic import op
import sqlalchemy as sa
from passlib.context import CryptContext


revision = "20260603_security_integrity"
down_revision = None
branch_labels = None
depends_on = None

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _is_bcrypt(value: str | None) -> bool:
    return bool(value and value.startswith(("$2a$", "$2b$", "$2y$")))


def upgrade() -> None:
    bind = op.get_bind()

    # Legacy migration: the column is named password_hash but old rows may hold plaintext.
    rows = bind.execute(sa.text("SELECT user_id, password_hash FROM user_account")).fetchall()
    for user_id, password_value in rows:
        if password_value and not _is_bcrypt(password_value):
            bind.execute(
                sa.text("UPDATE user_account SET password_hash = :password_hash WHERE user_id = :user_id"),
                {"password_hash": pwd_context.hash(password_value), "user_id": user_id},
            )

    bind.execute(
        sa.text(
            """
            UPDATE student s
            SET academic_level_id = NULL
            WHERE academic_level_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM academic_level al
                WHERE al.academic_level_id = s.academic_level_id
              )
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE student s
            SET user_id = NULL
            WHERE user_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM user_account ua
                WHERE ua.user_id = s.user_id
              )
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE academic_staff ast
            SET user_id = NULL
            WHERE user_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM user_account ua
                WHERE ua.user_id = ast.user_id
              )
            """
        )
    )

    op.create_index("ix_student_academic_level_id", "student", ["academic_level_id"])
    op.create_index("ix_student_user_id", "student", ["user_id"])
    op.create_foreign_key(
        "fk_student_academic_level_id",
        "student",
        "academic_level",
        ["academic_level_id"],
        ["academic_level_id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_student_user_id",
        "student",
        "user_account",
        ["user_id"],
        ["user_id"],
        ondelete="SET NULL",
    )

    op.create_index("ix_academic_staff_user_id", "academic_staff", ["user_id"])
    op.create_foreign_key(
        "fk_academic_staff_user_id",
        "academic_staff",
        "user_account",
        ["user_id"],
        ["user_id"],
        ondelete="SET NULL",
    )

    op.create_unique_constraint("uq_role_role_name", "role", ["role_name"])
    op.create_index("ix_user_login_log_user_open", "user_login_log", ["user_id", "logout_at"])
    op.create_index(
        "ix_classwork_assignment_class_published_due",
        "classwork_assignment",
        ["class_id", "is_published", "due_date"],
    )
    op.create_index("ix_classwork_assignment_classwork_id", "classwork_assignment", ["classwork_id"])
    op.create_index(
        "ix_student_submission_assignment_student",
        "student_submission",
        ["classwork_assignment_id", "student_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_student_submission_assignment_student", table_name="student_submission")
    op.drop_index("ix_classwork_assignment_classwork_id", table_name="classwork_assignment")
    op.drop_index("ix_classwork_assignment_class_published_due", table_name="classwork_assignment")
    op.drop_index("ix_user_login_log_user_open", table_name="user_login_log")
    op.drop_constraint("uq_role_role_name", "role", type_="unique")
    op.drop_constraint("fk_academic_staff_user_id", "academic_staff", type_="foreignkey")
    op.drop_index("ix_academic_staff_user_id", table_name="academic_staff")
    op.drop_constraint("fk_student_user_id", "student", type_="foreignkey")
    op.drop_constraint("fk_student_academic_level_id", "student", type_="foreignkey")
    op.drop_index("ix_student_user_id", table_name="student")
    op.drop_index("ix_student_academic_level_id", table_name="student")
