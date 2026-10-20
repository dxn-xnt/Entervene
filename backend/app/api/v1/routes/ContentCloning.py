from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Header, Query, Response, status
from sqlalchemy.orm import Session

from app.core.Dependencies import get_staff_id, require_role
from app.db.Session import get_db
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.cloning.ContentCloning import ContentShareRequest
from app.models.people.AcademicStaff import AcademicStaff
from app.schemas.ContentCloning import (
    ContentShareRequestCreate,
    ContentShareRequestDecline,
    ContentShareRequestListResponse,
    ContentShareRequestResponse,
    DestinationScopeResponse,
    OwnerEligibleMaterialsResponse,
    PackageCreateRequest,
    PackageDecisionRequest,
    RequesterVisiblePackageSummary,
    SourceTeacherResponse,
)
from app.services.cloning.ContentCloningAuthorizationService import (
    ContentCloningAuthorizationService,
)
from app.services.cloning.ContentCloningPackageService import (
    ContentCloningPackageService,
)
from app.services.cloning.ContentCloningRequestService import (
    ContentCloningRequestService,
)


router = APIRouter(dependencies=[Depends(require_role("teacher"))])


def _staff_name(staff: AcademicStaff) -> str:
    return " ".join(
        value
        for value in (staff.first_name, staff.middle_name, staff.last_name, staff.suffix)
        if value
    )


def _request_response(
    db: Session,
    request: ContentShareRequest,
    *,
    effective_status: str | None = None,
    requester_name: str | None = None,
    source_owner_name: str | None = None,
    subject_name: str | None = None,
    destination_section_name: str | None = None,
    destination_period_name: str | None = None,
) -> ContentShareRequestResponse:
    requester = None
    owner = None
    subject = None
    destination_class = None
    period = None
    if requester_name is None:
        requester = db.get(AcademicStaff, request.requester_staff_id)
        requester_name = _staff_name(requester)
    if source_owner_name is None:
        owner = db.get(AcademicStaff, request.source_owner_staff_id)
        source_owner_name = _staff_name(owner)
    if subject_name is None:
        subject = db.get(Subject, request.subject_id)
        subject_name = subject.subject_name
    if destination_section_name is None:
        destination_class = db.get(Class, request.destination_class_id)
        destination_section_name = destination_class.section_name
    if destination_period_name is None:
        period = db.get(AcademicPeriod, request.destination_academic_period_id)
        destination_period_name = period.period_name

    return ContentShareRequestResponse(
        request_id=request.request_id,
        requester_name=requester_name,
        source_owner_name=source_owner_name,
        subject_id=request.subject_id,
        subject_name=subject_name,
        source_scope_mode=request.source_scope_mode,
        source_academic_year_id=request.source_academic_year_id,
        source_academic_period_id=request.source_academic_period_id,
        destination_class_id=request.destination_class_id,
        destination_section_name=destination_section_name,
        destination_subject_id=request.destination_subject_id,
        destination_academic_period_id=request.destination_academic_period_id,
        destination_period_name=destination_period_name,
        status=effective_status or request.status,
        message=request.message,
        expires_at=request.expires_at,
        version=request.version,
        created_at=request.created_at,
        updated_at=request.updated_at,
    )


@router.get("/scopes", response_model=list[DestinationScopeResponse])
def list_destination_scopes(
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return ContentCloningAuthorizationService.list_destination_scopes(
        db, actor_staff_id=staff_id
    )


@router.get("/source-teachers", response_model=list[SourceTeacherResponse])
def list_source_teachers(
    destination_class_id: int,
    destination_subject_id: int,
    destination_academic_period_id: int,
    source_scope_mode: str = Query(default="ANY"),
    source_academic_year_id: int | None = Query(default=None),
    source_academic_period_id: int | None = Query(default=None),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    destination = ContentCloningAuthorizationService.resolve_destination(
        db,
        actor_staff_id=staff_id,
        class_id=destination_class_id,
        subject_id=destination_subject_id,
        academic_period_id=destination_academic_period_id,
    )
    scope = ContentCloningAuthorizationService.resolve_source_scope(
        db,
        mode=source_scope_mode,
        academic_year_id=source_academic_year_id,
        academic_period_id=source_academic_period_id,
    )
    return ContentCloningAuthorizationService.list_source_teachers(
        db,
        requester_staff_id=staff_id,
        subject_id=destination.subject_id,
        destination_period_id=destination.academic_period_id,
        scope=scope,
    )


@router.post(
    "/requests",
    response_model=ContentShareRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_content_request(
    payload: ContentShareRequestCreate,
    response: Response,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    request, replayed = ContentCloningRequestService.create_request(
        db,
        requester_staff_id=staff_id,
        idempotency_key=idempotency_key or "",
        payload=payload.model_dump(mode="json"),
    )
    response.headers["X-Idempotent-Replay"] = "true" if replayed else "false"
    return _request_response(db, request)


@router.get("/requests", response_model=ContentShareRequestListResponse)
def list_content_requests(
    box: str = Query(pattern="^(incoming|outgoing)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    rows, total, badges = ContentCloningRequestService.list_requests(
        db,
        staff_id=staff_id,
        box=box,
        page=page,
        page_size=page_size,
    )
    return ContentShareRequestListResponse(
        items=[
            _request_response(
                db,
                row["request"],
                effective_status=row["effective_status"],
                requester_name=row["requester_name"],
                source_owner_name=row["source_owner_name"],
                subject_name=row["subject_name"],
                destination_section_name=row["destination_section_name"],
                destination_period_name=row["destination_period_name"],
            )
            for row in rows
        ],
        total=total,
        page=page,
        page_size=page_size,
        badges=badges,
    )


@router.post(
    "/requests/{request_id}/decline",
    response_model=ContentShareRequestResponse,
)
def decline_content_request(
    request_id: uuid.UUID,
    payload: ContentShareRequestDecline,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    request = ContentCloningRequestService.decline_request(
        db,
        request_id=request_id,
        actor_staff_id=staff_id,
        expected_version=payload.expected_version,
    )
    return _request_response(db, request)


# ── PR B Routes ─────────────────────────────────────────────────────────────


@router.get(
    "/requests/{request_id}/eligible-materials",
    response_model=OwnerEligibleMaterialsResponse,
)
def list_eligible_materials(
    request_id: uuid.UUID,
    item_type: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    items, total = ContentCloningPackageService.get_eligible_materials(
        db,
        request_id=request_id,
        staff_id=staff_id,
        item_type_filter=item_type,
        page=page,
        page_size=page_size,
    )
    return OwnerEligibleMaterialsResponse(
        request_id=request_id,
        items=items,
        total=total,
    )


@router.post(
    "/requests/{request_id}/package",
    response_model=RequesterVisiblePackageSummary,
    status_code=status.HTTP_201_CREATED,
)
def create_package(
    request_id: uuid.UUID,
    payload: PackageCreateRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return ContentCloningPackageService.create_package(
        db,
        request_id=request_id,
        staff_id=staff_id,
        payload=payload,
        idempotency_key=idempotency_key,
    )


@router.get(
    "/requests/{request_id}/package",
    response_model=RequesterVisiblePackageSummary,
)
def get_package_preview(
    request_id: uuid.UUID,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return ContentCloningPackageService.get_package_preview(
        db,
        request_id=request_id,
        staff_id=staff_id,
    )


@router.post(
    "/requests/{request_id}/package-decision",
    response_model=ContentShareRequestResponse,
)
def decide_package(
    request_id: uuid.UUID,
    payload: PackageDecisionRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    req = ContentCloningPackageService.decide_package(
        db,
        request_id=request_id,
        staff_id=staff_id,
        payload=payload,
        idempotency_key=idempotency_key,
    )
    return _request_response(db, req)
