"""Add a single-student recipient and intervention provenance to classwork assignments."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260926_targeted_classwork"
down_revision = "20260926_remediation_plan"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("classwork_assignment", sa.Column("recipient_student_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("classwork_assignment", sa.Column("source_intervention_id", sa.Integer(), nullable=True))
    op.add_column("classwork_assignment", sa.Column("remediation_request_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_classwork_target_student", "classwork_assignment", "student", ["recipient_student_id"], ["student_id"], ondelete="RESTRICT")
    op.create_foreign_key("fk_classwork_source_intervention", "classwork_assignment", "intervention", ["source_intervention_id"], ["intervention_id"], ondelete="RESTRICT")
    op.create_unique_constraint("uq_classwork_remediation_request", "classwork_assignment", ["remediation_request_id"])
    op.create_check_constraint("ck_classwork_targeted_pair", "classwork_assignment", "(recipient_student_id IS NULL AND source_intervention_id IS NULL AND remediation_request_id IS NULL) OR (recipient_student_id IS NOT NULL AND source_intervention_id IS NOT NULL AND remediation_request_id IS NOT NULL)")


def downgrade():
    op.drop_constraint("ck_classwork_targeted_pair", "classwork_assignment", type_="check")
    op.drop_constraint("uq_classwork_remediation_request", "classwork_assignment", type_="unique")
    op.drop_constraint("fk_classwork_source_intervention", "classwork_assignment", type_="foreignkey")
    op.drop_constraint("fk_classwork_target_student", "classwork_assignment", type_="foreignkey")
    op.drop_column("classwork_assignment", "remediation_request_id")
    op.drop_column("classwork_assignment", "source_intervention_id")
    op.drop_column("classwork_assignment", "recipient_student_id")
