from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ContentSourceScopeMode(str, Enum):
    ANY = "ANY"
    ALL_TERMS = "ALL_TERMS"
    PERIOD = "PERIOD"


class ContentShareRequestStatus(str, Enum):
    PENDING_OWNER = "PENDING_OWNER"
    PACKAGE_SENT = "PACKAGE_SENT"
    ACCEPTED = "ACCEPTED"
    DECLINED_BY_OWNER = "DECLINED_BY_OWNER"
    DECLINED_BY_REQUESTER = "DECLINED_BY_REQUESTER"
    EXPIRED = "EXPIRED"


class DestinationYearState(str, Enum):
    ACTIVE = "ACTIVE"
    PREPARED_FUTURE = "PREPARED_FUTURE"


class ContentCloneMode(str, Enum):
    SHARED_PACKAGE = "SHARED_PACKAGE"
    SELF = "SELF"


class ContentCloneOperationStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"


class ContentCloningErrorDetail(BaseModel):
    code: str
    message: str
    field: str | None = None
    retryable: bool = False


class ContentCloningErrorResponse(BaseModel):
    detail: ContentCloningErrorDetail


class DestinationScopeResponse(BaseModel):
    class_id: int
    section_name: str
    subject_id: int
    subject_name: str
    academic_period_id: int
    period_name: str
    academic_year_id: int
    academic_year_label: str
    year_state: DestinationYearState


class SourceTeacherResponse(BaseModel):
    staff_id: str
    display_name: str


class ContentShareRequestCreate(BaseModel):
    source_owner_staff_id: str = Field(min_length=1, max_length=20)
    subject_id: int
    source_scope_mode: ContentSourceScopeMode = ContentSourceScopeMode.ANY
    source_academic_year_id: int | None = None
    source_academic_period_id: int | None = None
    destination_class_id: int
    destination_subject_id: int
    destination_academic_period_id: int
    message: str | None = Field(default=None, max_length=1000)

    @field_validator("message")
    @classmethod
    def normalize_message(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class ContentShareRequestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    request_id: uuid.UUID
    requester_name: str
    source_owner_name: str
    subject_id: int
    subject_name: str
    source_scope_mode: ContentSourceScopeMode
    source_academic_year_id: int | None
    source_academic_period_id: int | None
    destination_class_id: int
    destination_section_name: str
    destination_subject_id: int
    destination_academic_period_id: int
    destination_period_name: str
    status: ContentShareRequestStatus
    message: str | None
    expires_at: datetime
    version: int
    created_at: datetime
    updated_at: datetime


class RequestBadgeCounts(BaseModel):
    pending: int = 0
    package_sent: int = 0
    expired: int = 0


class ContentShareRequestListResponse(BaseModel):
    items: list[ContentShareRequestResponse]
    total: int
    page: int
    page_size: int
    badges: RequestBadgeCounts


class ContentShareRequestDecline(BaseModel):
    expected_version: int = Field(ge=1)


class ContentSelectionItem(BaseModel):
    item_type: str
    source_entity_id: int
    source_revision_token: str


class ContentSelectionSummary(BaseModel):
    competency_count: int = 0
    lesson_count: int = 0
    classwork_count: int = 0
    attachment_count: int = 0


class PackagePreviewItem(BaseModel):
    item_type: str
    safe_title: str
    display_order: int = 0


class OwnerEligibleMaterialItem(BaseModel):
    item_type: str
    source_entity_id: int
    safe_title: str
    academic_period_id: int | None = None
    academic_period_name: str | None = None
    source_revision_token: str


class OwnerEligibleMaterialsResponse(BaseModel):
    request_id: uuid.UUID
    items: list[OwnerEligibleMaterialItem]
    total: int


class PackageDecision(str, Enum):
    ACCEPT = "ACCEPT"
    DECLINE = "DECLINE"


class PackageCreateRequest(BaseModel):
    expected_version: int = Field(ge=1)
    items: list[ContentSelectionItem] = Field(min_length=1)


class PackageDecisionRequest(BaseModel):
    decision: PackageDecision
    expected_version: int = Field(ge=1)


class RequesterVisiblePackageSummary(BaseModel):
    """PR B response: includes safe item titles and counts; intentionally excludes source IDs and snapshots."""

    package_id: uuid.UUID
    request_id: uuid.UUID
    status: ContentShareRequestStatus
    source_owner_staff_id: str | None = None
    source_owner_name: str | None = None
    subject_id: int | None = None
    subject_name: str | None = None
    source_scope_mode: ContentSourceScopeMode | None = None
    sent_at: datetime
    expires_at: datetime
    summary: ContentSelectionSummary
    items: list[PackagePreviewItem] = Field(default_factory=list)


class ContentCloneOperationResponse(BaseModel):
    operation_id: uuid.UUID
    mode: ContentCloneMode
    status: ContentCloneOperationStatus
    destination_class_id: int
    destination_subject_id: int
    destination_academic_period_id: int
    summary: ContentSelectionSummary
    error_code: str | None = None
    created_at: datetime
    completed_at: datetime | None = None
