from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.db.Base import Base


class ContentShareRequest(Base):
    __tablename__ = "content_share_request"
    __table_args__ = (
        CheckConstraint(
            "source_scope_mode IN ('ANY', 'ALL_TERMS', 'PERIOD')",
            name="ck_content_share_request_source_scope_mode",
        ),
        CheckConstraint(
            "status IN ('PENDING_OWNER', 'PACKAGE_SENT', 'ACCEPTED', "
            "'DECLINED_BY_OWNER', 'DECLINED_BY_REQUESTER', 'EXPIRED')",
            name="ck_content_share_request_status",
        ),
        CheckConstraint(
            "(source_scope_mode = 'ANY' AND source_academic_year_id IS NULL "
            "AND source_academic_period_id IS NULL) OR "
            "(source_scope_mode = 'ALL_TERMS' AND source_academic_year_id IS NOT NULL "
            "AND source_academic_period_id IS NULL) OR "
            "(source_scope_mode = 'PERIOD' AND source_academic_year_id IS NOT NULL "
            "AND source_academic_period_id IS NOT NULL)",
            name="ck_content_share_request_source_scope_shape",
        ),
        CheckConstraint("version > 0", name="ck_content_share_request_version_positive"),
        UniqueConstraint(
            "requester_staff_id",
            "create_idempotency_key",
            name="uq_content_share_request_requester_idempotency",
        ),
        Index(
            "uq_content_share_request_open_scope",
            "open_request_key",
            unique=True,
        ),
        Index("ix_content_share_request_source_owner", "source_owner_staff_id", "status"),
        Index("ix_content_share_request_requester", "requester_staff_id", "status"),
    )

    request_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    requester_staff_id: Mapped[str] = mapped_column(
        String(20),
        ForeignKey("academic_staff.staff_id", ondelete="RESTRICT"),
        nullable=False,
    )
    source_owner_staff_id: Mapped[str] = mapped_column(
        String(20),
        ForeignKey("academic_staff.staff_id", ondelete="RESTRICT"),
        nullable=False,
    )
    subject_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("subject.subject_id", ondelete="RESTRICT"), nullable=False
    )
    source_scope_mode: Mapped[str] = mapped_column(String(20), nullable=False)
    source_scope_key: Mapped[str] = mapped_column(String(64), nullable=False)
    source_academic_year_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("academic_year.academic_year_id", ondelete="RESTRICT"),
        nullable=True,
    )
    source_academic_period_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("academic_period.academic_period_id", ondelete="RESTRICT"),
        nullable=True,
    )
    destination_class_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("class.class_id", ondelete="RESTRICT"), nullable=False
    )
    destination_subject_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("subject.subject_id", ondelete="RESTRICT"), nullable=False
    )
    destination_academic_period_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("academic_period.academic_period_id", ondelete="RESTRICT"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="PENDING_OWNER"
    )
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    create_idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    create_request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    open_request_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    responded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    package: Mapped["ContentSharePackage | None"] = relationship(
        "ContentSharePackage",
        back_populates="request",
        uselist=False,
        cascade="all, delete-orphan",
    )
    events: Mapped[list["ContentShareEvent"]] = relationship(
        "ContentShareEvent", back_populates="request"
    )


class ContentSharePackage(Base):
    __tablename__ = "content_share_package"
    __table_args__ = (
        UniqueConstraint("request_id", name="uq_content_share_package_request"),
        Index("ix_content_share_package_owner", "source_owner_staff_id"),
    )

    package_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    request_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("content_share_request.request_id", ondelete="CASCADE"),
        nullable=False,
    )
    source_owner_staff_id: Mapped[str] = mapped_column(
        String(20),
        ForeignKey("academic_staff.staff_id", ondelete="RESTRICT"),
        nullable=False,
    )
    manifest_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    summary_counts: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    request: Mapped[ContentShareRequest] = relationship(
        "ContentShareRequest", back_populates="package"
    )
    items: Mapped[list["ContentSharePackageItem"]] = relationship(
        "ContentSharePackageItem",
        back_populates="package",
        cascade="all, delete-orphan",
    )


class ContentSharePackageItem(Base):
    __tablename__ = "content_share_package_item"
    __table_args__ = (
        CheckConstraint(
            "item_type IN ('COMPETENCY', 'LESSON', 'CLASSWORK')",
            name="ck_content_share_package_item_type",
        ),
        UniqueConstraint(
            "package_id",
            "item_type",
            "source_entity_id",
            name="uq_content_share_package_item_source",
        ),
    )

    package_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    package_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("content_share_package.package_id", ondelete="CASCADE"),
        nullable=False,
    )
    item_type: Mapped[str] = mapped_column(String(20), nullable=False)
    source_entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    safe_title: Mapped[str] = mapped_column(String(255), nullable=False)
    source_revision_token: Mapped[str] = mapped_column(String(128), nullable=False)
    private_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    snapshot_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    summary_counts: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    package: Mapped[ContentSharePackage] = relationship(
        "ContentSharePackage", back_populates="items"
    )
    assets: Mapped[list["ContentSharePackageAsset"]] = relationship(
        "ContentSharePackageAsset",
        back_populates="package_item",
        cascade="all, delete-orphan",
    )


class ContentSharePackageAsset(Base):
    __tablename__ = "content_share_package_asset"
    __table_args__ = (
        UniqueConstraint(
            "package_item_id",
            "checksum_sha256",
            "original_filename",
            name="uq_content_share_package_asset_identity",
        ),
    )

    package_asset_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    package_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("content_share_package_item.package_item_id", ondelete="CASCADE"),
        nullable=False,
    )
    private_staged_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    media_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    checksum_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    package_item: Mapped[ContentSharePackageItem] = relationship(
        "ContentSharePackageItem", back_populates="assets"
    )


class ContentCloneOperation(Base):
    __tablename__ = "content_clone_operation"
    __table_args__ = (
        CheckConstraint(
            "mode IN ('SHARED_PACKAGE', 'SELF')",
            name="ck_content_clone_operation_mode",
        ),
        CheckConstraint(
            "status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')",
            name="ck_content_clone_operation_status",
        ),
        CheckConstraint(
            "(mode = 'SHARED_PACKAGE' AND request_id IS NOT NULL AND package_id IS NOT NULL) "
            "OR (mode = 'SELF' AND request_id IS NULL AND package_id IS NULL)",
            name="ck_content_clone_operation_parent_shape",
        ),
        UniqueConstraint(
            "actor_staff_id",
            "idempotency_key",
            name="uq_content_clone_operation_actor_idempotency",
        ),
        Index("ix_content_clone_operation_request", "request_id"),
    )

    operation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    mode: Mapped[str] = mapped_column(String(20), nullable=False)
    actor_staff_id: Mapped[str] = mapped_column(
        String(20),
        ForeignKey("academic_staff.staff_id", ondelete="RESTRICT"),
        nullable=False,
    )
    request_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("content_share_request.request_id", ondelete="RESTRICT"),
        nullable=True,
    )
    package_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("content_share_package.package_id", ondelete="RESTRICT"),
        nullable=True,
    )
    destination_class_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("class.class_id", ondelete="RESTRICT"), nullable=False
    )
    destination_subject_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("subject.subject_id", ondelete="RESTRICT"), nullable=False
    )
    destination_academic_period_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("academic_period.academic_period_id", ondelete="RESTRICT"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING")
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    summary_counts: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    item_maps: Mapped[list["ContentCloneItemMap"]] = relationship(
        "ContentCloneItemMap",
        back_populates="operation",
        cascade="all, delete-orphan",
    )
    events: Mapped[list["ContentShareEvent"]] = relationship(
        "ContentShareEvent", back_populates="operation"
    )


class ContentCloneItemMap(Base):
    __tablename__ = "content_clone_item_map"
    __table_args__ = (
        CheckConstraint(
            "entity_type IN ('COMPETENCY', 'LESSON', 'CLASSWORK', 'QUIZ', "
            "'QUESTION', 'OPTION', 'ATTACHMENT')",
            name="ck_content_clone_item_map_entity_type",
        ),
        UniqueConstraint(
            "operation_id",
            "entity_type",
            "source_entity_ref",
            name="uq_content_clone_item_map_source",
        ),
    )

    clone_item_map_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    operation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("content_clone_operation.operation_id", ondelete="CASCADE"),
        nullable=False,
    )
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)
    source_entity_ref: Mapped[str] = mapped_column(String(128), nullable=False)
    destination_entity_ref: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    operation: Mapped[ContentCloneOperation] = relationship(
        "ContentCloneOperation", back_populates="item_maps"
    )


class ContentShareEvent(Base):
    __tablename__ = "content_share_event"
    __table_args__ = (
        CheckConstraint(
            "request_id IS NOT NULL OR operation_id IS NOT NULL",
            name="ck_content_share_event_parent",
        ),
        Index("ix_content_share_event_request", "request_id", "created_at"),
        Index("ix_content_share_event_operation", "operation_id", "created_at"),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    request_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("content_share_request.request_id", ondelete="RESTRICT"),
        nullable=True,
    )
    operation_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("content_clone_operation.operation_id", ondelete="RESTRICT"),
        nullable=True,
    )
    actor_staff_id: Mapped[str | None] = mapped_column(
        String(20),
        ForeignKey("academic_staff.staff_id", ondelete="SET NULL"),
        nullable=True,
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    safe_metadata: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    request: Mapped[ContentShareRequest | None] = relationship(
        "ContentShareRequest", back_populates="events"
    )
    operation: Mapped[ContentCloneOperation | None] = relationship(
        "ContentCloneOperation", back_populates="events"
    )
