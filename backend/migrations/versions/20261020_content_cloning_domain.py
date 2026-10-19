"""Add the content-sharing and cloning domain foundation.

Revision ID: 20261020_content_cloning_domain
Revises: 20261018_three_grading_templates
"""

from alembic import op
import sqlalchemy as sa


revision = "20261020_content_cloning_domain"
down_revision = "20261018_three_grading_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "content_share_request",
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("requester_staff_id", sa.String(length=20), nullable=False),
        sa.Column("source_owner_staff_id", sa.String(length=20), nullable=False),
        sa.Column("subject_id", sa.Integer(), nullable=False),
        sa.Column("source_scope_mode", sa.String(length=20), nullable=False),
        sa.Column("source_scope_key", sa.String(length=64), nullable=False),
        sa.Column("source_academic_year_id", sa.Integer(), nullable=True),
        sa.Column("source_academic_period_id", sa.Integer(), nullable=True),
        sa.Column("destination_class_id", sa.Integer(), nullable=False),
        sa.Column("destination_subject_id", sa.Integer(), nullable=False),
        sa.Column("destination_academic_period_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("create_idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("create_request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("open_request_key", sa.String(length=512), nullable=True),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "source_scope_mode IN ('ANY', 'ALL_TERMS', 'PERIOD')",
            name="ck_content_share_request_source_scope_mode",
        ),
        sa.CheckConstraint(
            "status IN ('PENDING_OWNER', 'PACKAGE_SENT', 'ACCEPTED', "
            "'DECLINED_BY_OWNER', 'DECLINED_BY_REQUESTER', 'EXPIRED')",
            name="ck_content_share_request_status",
        ),
        sa.CheckConstraint(
            "(source_scope_mode = 'ANY' AND source_academic_year_id IS NULL "
            "AND source_academic_period_id IS NULL) OR "
            "(source_scope_mode = 'ALL_TERMS' AND source_academic_year_id IS NOT NULL "
            "AND source_academic_period_id IS NULL) OR "
            "(source_scope_mode = 'PERIOD' AND source_academic_year_id IS NOT NULL "
            "AND source_academic_period_id IS NOT NULL)",
            name="ck_content_share_request_source_scope_shape",
        ),
        sa.CheckConstraint("version > 0", name="ck_content_share_request_version_positive"),
        sa.ForeignKeyConstraint(["requester_staff_id"], ["academic_staff.staff_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["source_owner_staff_id"], ["academic_staff.staff_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["subject_id"], ["subject.subject_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["source_academic_year_id"], ["academic_year.academic_year_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["source_academic_period_id"], ["academic_period.academic_period_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["destination_class_id"], ["class.class_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["destination_subject_id"], ["subject.subject_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["destination_academic_period_id"], ["academic_period.academic_period_id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("request_id"),
        sa.UniqueConstraint(
            "requester_staff_id",
            "create_idempotency_key",
            name="uq_content_share_request_requester_idempotency",
        ),
    )
    op.create_index("uq_content_share_request_open_scope", "content_share_request", ["open_request_key"], unique=True)
    op.create_index("ix_content_share_request_source_owner", "content_share_request", ["source_owner_staff_id", "status"])
    op.create_index("ix_content_share_request_requester", "content_share_request", ["requester_staff_id", "status"])

    op.create_table(
        "content_share_package",
        sa.Column("package_id", sa.Uuid(), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False),
        sa.Column("source_owner_staff_id", sa.String(length=20), nullable=False),
        sa.Column("manifest_hash", sa.String(length=64), nullable=False),
        sa.Column("summary_counts", sa.JSON(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["request_id"], ["content_share_request.request_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_owner_staff_id"], ["academic_staff.staff_id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("package_id"),
        sa.UniqueConstraint("request_id", name="uq_content_share_package_request"),
    )
    op.create_index("ix_content_share_package_owner", "content_share_package", ["source_owner_staff_id"])

    op.create_table(
        "content_share_package_item",
        sa.Column("package_item_id", sa.Uuid(), nullable=False),
        sa.Column("package_id", sa.Uuid(), nullable=False),
        sa.Column("item_type", sa.String(length=20), nullable=False),
        sa.Column("source_entity_id", sa.Integer(), nullable=False),
        sa.Column("safe_title", sa.String(length=255), nullable=False),
        sa.Column("source_revision_token", sa.String(length=128), nullable=False),
        sa.Column("private_snapshot", sa.JSON(), nullable=False),
        sa.Column("snapshot_hash", sa.String(length=64), nullable=False),
        sa.Column("summary_counts", sa.JSON(), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "item_type IN ('COMPETENCY', 'LESSON', 'CLASSWORK')",
            name="ck_content_share_package_item_type",
        ),
        sa.ForeignKeyConstraint(["package_id"], ["content_share_package.package_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("package_item_id"),
        sa.UniqueConstraint("package_id", "item_type", "source_entity_id", name="uq_content_share_package_item_source"),
    )

    op.create_table(
        "content_share_package_asset",
        sa.Column("package_asset_id", sa.Uuid(), nullable=False),
        sa.Column("package_item_id", sa.Uuid(), nullable=False),
        sa.Column("private_staged_path", sa.String(length=1024), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("media_type", sa.String(length=255), nullable=True),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("checksum_sha256", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["package_item_id"], ["content_share_package_item.package_item_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("package_asset_id"),
        sa.UniqueConstraint(
            "package_item_id",
            "checksum_sha256",
            "original_filename",
            name="uq_content_share_package_asset_identity",
        ),
    )

    op.create_table(
        "content_clone_operation",
        sa.Column("operation_id", sa.Uuid(), nullable=False),
        sa.Column("mode", sa.String(length=20), nullable=False),
        sa.Column("actor_staff_id", sa.String(length=20), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=True),
        sa.Column("package_id", sa.Uuid(), nullable=True),
        sa.Column("destination_class_id", sa.Integer(), nullable=False),
        sa.Column("destination_subject_id", sa.Integer(), nullable=False),
        sa.Column("destination_academic_period_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("summary_counts", sa.JSON(), nullable=False),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("mode IN ('SHARED_PACKAGE', 'SELF')", name="ck_content_clone_operation_mode"),
        sa.CheckConstraint("status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')", name="ck_content_clone_operation_status"),
        sa.CheckConstraint(
            "(mode = 'SHARED_PACKAGE' AND request_id IS NOT NULL AND package_id IS NOT NULL) "
            "OR (mode = 'SELF' AND request_id IS NULL AND package_id IS NULL)",
            name="ck_content_clone_operation_parent_shape",
        ),
        sa.ForeignKeyConstraint(["actor_staff_id"], ["academic_staff.staff_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["request_id"], ["content_share_request.request_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["package_id"], ["content_share_package.package_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["destination_class_id"], ["class.class_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["destination_subject_id"], ["subject.subject_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["destination_academic_period_id"], ["academic_period.academic_period_id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("operation_id"),
        sa.UniqueConstraint("actor_staff_id", "idempotency_key", name="uq_content_clone_operation_actor_idempotency"),
    )
    op.create_index("ix_content_clone_operation_request", "content_clone_operation", ["request_id"])

    op.create_table(
        "content_clone_item_map",
        sa.Column("clone_item_map_id", sa.Uuid(), nullable=False),
        sa.Column("operation_id", sa.Uuid(), nullable=False),
        sa.Column("entity_type", sa.String(length=20), nullable=False),
        sa.Column("source_entity_ref", sa.String(length=128), nullable=False),
        sa.Column("destination_entity_ref", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "entity_type IN ('COMPETENCY', 'LESSON', 'CLASSWORK', 'QUIZ', "
            "'QUESTION', 'OPTION', 'ATTACHMENT')",
            name="ck_content_clone_item_map_entity_type",
        ),
        sa.ForeignKeyConstraint(["operation_id"], ["content_clone_operation.operation_id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("clone_item_map_id"),
        sa.UniqueConstraint("operation_id", "entity_type", "source_entity_ref", name="uq_content_clone_item_map_source"),
    )

    op.create_table(
        "content_share_event",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=True),
        sa.Column("operation_id", sa.Uuid(), nullable=True),
        sa.Column("actor_staff_id", sa.String(length=20), nullable=True),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("from_status", sa.String(length=32), nullable=True),
        sa.Column("to_status", sa.String(length=32), nullable=True),
        sa.Column("safe_metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("request_id IS NOT NULL OR operation_id IS NOT NULL", name="ck_content_share_event_parent"),
        sa.ForeignKeyConstraint(["request_id"], ["content_share_request.request_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["operation_id"], ["content_clone_operation.operation_id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["actor_staff_id"], ["academic_staff.staff_id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("event_id"),
    )
    op.create_index("ix_content_share_event_request", "content_share_event", ["request_id", "created_at"])
    op.create_index("ix_content_share_event_operation", "content_share_event", ["operation_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_content_share_event_operation", table_name="content_share_event")
    op.drop_index("ix_content_share_event_request", table_name="content_share_event")
    op.drop_table("content_share_event")
    op.drop_table("content_clone_item_map")
    op.drop_index("ix_content_clone_operation_request", table_name="content_clone_operation")
    op.drop_table("content_clone_operation")
    op.drop_table("content_share_package_asset")
    op.drop_table("content_share_package_item")
    op.drop_index("ix_content_share_package_owner", table_name="content_share_package")
    op.drop_table("content_share_package")
    op.drop_index("ix_content_share_request_requester", table_name="content_share_request")
    op.drop_index("ix_content_share_request_source_owner", table_name="content_share_request")
    op.drop_index("uq_content_share_request_open_scope", table_name="content_share_request")
    op.drop_table("content_share_request")
