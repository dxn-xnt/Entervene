"""Link a targeted remedial Examination assignment to its original assignment."""

from alembic import op
import sqlalchemy as sa

revision = "20260928_remedial_exam_link"
down_revision = "20260926_targeted_classwork"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("classwork_assignment", sa.Column("original_exam_assignment_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_remedial_original_exam", "classwork_assignment", "classwork_assignment", ["original_exam_assignment_id"], ["classwork_assignment_id"], ondelete="RESTRICT")
    op.create_check_constraint("ck_remedial_exam_has_target", "classwork_assignment", "original_exam_assignment_id IS NULL OR (recipient_student_id IS NOT NULL AND original_exam_assignment_id <> classwork_assignment_id)")
    op.create_index("ix_remedial_original_exam", "classwork_assignment", ["original_exam_assignment_id"])


def downgrade():
    op.drop_index("ix_remedial_original_exam", table_name="classwork_assignment")
    op.drop_constraint("ck_remedial_exam_has_target", "classwork_assignment", type_="check")
    op.drop_constraint("fk_remedial_original_exam", "classwork_assignment", type_="foreignkey")
    op.drop_column("classwork_assignment", "original_exam_assignment_id")
