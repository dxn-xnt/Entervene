from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime

from sqlalchemy import case, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.cloning.ContentCloning import ContentShareEvent, ContentShareRequest
from app.models.people.AcademicStaff import AcademicStaff
from app.services.cloning.ContentCloningAuthorizationService import (
    ContentCloningAuthorizationService,
    DestinationScope,
)
from app.services.cloning.ContentCloningErrors import ContentCloningError
from app.services.cloning.ContentCloningLifecycleService import (
    effective_request_status,
    expire_request,
    request_expires_at,
    transition_request,
    utc_now,
)


def canonical_fingerprint(value: dict) -> str:
    encoded = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def make_open_request_key(
    *,
    requester_staff_id: str,
    source_owner_staff_id: str,
    subject_id: int,
    source_scope_key: str,
    destination: DestinationScope,
) -> str:
    return ":".join(
        (
            requester_staff_id,
            source_owner_staff_id,
            str(subject_id),
            source_scope_key,
            str(destination.class_id),
            str(destination.subject_id),
            str(destination.academic_period_id),
        )
    )


class ContentCloningRequestService:
    @staticmethod
    def create_request(
        db: Session,
        *,
        requester_staff_id: str,
        idempotency_key: str,
        payload: dict,
        now: datetime | None = None,
    ) -> tuple[ContentShareRequest, bool]:
        clean_key = (idempotency_key or "").strip()
        if not clean_key or len(clean_key) > 128:
            raise ContentCloningError(
                status_code=422,
                code="IDEMPOTENCY_KEY_INVALID",
                message="Idempotency-Key is required and must be at most 128 characters.",
                field="Idempotency-Key",
            )

        fingerprint = canonical_fingerprint(payload)
        existing = (
            db.query(ContentShareRequest)
            .filter(
                ContentShareRequest.requester_staff_id == requester_staff_id,
                ContentShareRequest.create_idempotency_key == clean_key,
            )
            .first()
        )
        if existing is not None:
            if existing.create_request_fingerprint != fingerprint:
                raise ContentCloningError(
                    status_code=409,
                    code="IDEMPOTENCY_KEY_REUSED",
                    message="This idempotency key was already used for a different request.",
                    field="Idempotency-Key",
                )
            return existing, True

        scope = ContentCloningAuthorizationService.resolve_source_scope(
            db,
            mode=payload["source_scope_mode"],
            academic_year_id=payload.get("source_academic_year_id"),
            academic_period_id=payload.get("source_academic_period_id"),
        )
        destination = ContentCloningAuthorizationService.resolve_destination(
            db,
            actor_staff_id=requester_staff_id,
            class_id=payload["destination_class_id"],
            subject_id=payload["destination_subject_id"],
            academic_period_id=payload["destination_academic_period_id"],
        )
        if payload["subject_id"] != destination.subject_id:
            raise ContentCloningError(
                status_code=422,
                code="DESTINATION_SUBJECT_MISMATCH",
                message="The requested subject does not match the destination subject.",
                field="destination_subject_id",
            )
        if requester_staff_id == payload["source_owner_staff_id"]:
            raise ContentCloningError(
                status_code=422,
                code="SOURCE_OWNER_NOT_ELIGIBLE",
                message="Cross-teacher requests must select another eligible teacher.",
                field="source_owner_staff_id",
            )
        ContentCloningAuthorizationService.require_source_teacher(
            db,
            requester_staff_id=requester_staff_id,
            source_owner_staff_id=payload["source_owner_staff_id"],
            subject_id=payload["subject_id"],
            destination_period_id=destination.academic_period_id,
            scope=scope,
        )

        current = now or utc_now()
        open_request_key = make_open_request_key(
            requester_staff_id=requester_staff_id,
            source_owner_staff_id=payload["source_owner_staff_id"],
            subject_id=payload["subject_id"],
            source_scope_key=scope.key,
            destination=destination,
        )
        prior_open = (
            db.query(ContentShareRequest)
            .filter(ContentShareRequest.open_request_key == open_request_key)
            .with_for_update()
            .first()
        )
        if prior_open is not None:
            if effective_request_status(prior_open, now=current) != "EXPIRED":
                raise ContentCloningError(
                    status_code=409,
                    code="DUPLICATE_OPEN_REQUEST",
                    message="An open request already exists for this teacher and destination scope.",
                )
            db.add(expire_request(prior_open, now=current))
            db.flush()

        request = ContentShareRequest(
            requester_staff_id=requester_staff_id,
            source_owner_staff_id=payload["source_owner_staff_id"],
            subject_id=payload["subject_id"],
            source_scope_mode=scope.mode,
            source_scope_key=scope.key,
            source_academic_year_id=scope.academic_year_id,
            source_academic_period_id=scope.academic_period_id,
            destination_class_id=destination.class_id,
            destination_subject_id=destination.subject_id,
            destination_academic_period_id=destination.academic_period_id,
            status="PENDING_OWNER",
            message=payload.get("message"),
            expires_at=request_expires_at(current),
            version=1,
            create_idempotency_key=clean_key,
            create_request_fingerprint=fingerprint,
            open_request_key=open_request_key,
        )
        event = ContentShareEvent(
            request=request,
            actor_staff_id=requester_staff_id,
            event_type="REQUEST_CREATED",
            from_status=None,
            to_status="PENDING_OWNER",
            safe_metadata={"source_scope_mode": scope.mode},
        )
        db.add_all([request, event])
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            replay = (
                db.query(ContentShareRequest)
                .filter(
                    ContentShareRequest.requester_staff_id == requester_staff_id,
                    ContentShareRequest.create_idempotency_key == clean_key,
                )
                .first()
            )
            if replay is not None:
                if replay.create_request_fingerprint == fingerprint:
                    return replay, True
                raise ContentCloningError(
                    status_code=409,
                    code="IDEMPOTENCY_KEY_REUSED",
                    message="This idempotency key was already used for a different request.",
                    field="Idempotency-Key",
                ) from None
            raise ContentCloningError(
                status_code=409,
                code="DUPLICATE_OPEN_REQUEST",
                message="An open request already exists for this teacher and destination scope.",
            ) from None
        db.refresh(request)
        owner_staff = db.get(AcademicStaff, request.source_owner_staff_id)
        requester_staff = db.get(AcademicStaff, requester_staff_id)
        subject = db.get(Subject, request.subject_id)
        dest_class = db.get(Class, destination.class_id)
        if owner_staff and owner_staff.user_id:
            from app.services.cloning.ContentCloningNotification import send_cloning_notification, staff_name
            req_name = staff_name(requester_staff)
            sub_name = subject.subject_name if subject else "materials"
            sec_name = dest_class.section_name if dest_class else "class"
            send_cloning_notification(
                db,
                user_id=owner_staff.user_id,
                notification_type="repost_request_received",
                title=f"New Repost Request: {sub_name}",
                body=f"{req_name} requested course materials for {sec_name}.",
                action_url=f"/teacher/requests?box=incoming&request_id={request.request_id}",
            )
        return request, False

    @staticmethod
    def list_requests(
        db: Session,
        *,
        staff_id: str,
        box: str,
        page: int,
        page_size: int,
        now: datetime | None = None,
    ) -> tuple[list[dict], int, dict[str, int]]:
        requester = aliased(AcademicStaff)
        owner = aliased(AcademicStaff)
        query = (
            db.query(
                ContentShareRequest,
                requester,
                owner,
                Subject,
                Class,
                AcademicPeriod,
            )
            .join(requester, requester.staff_id == ContentShareRequest.requester_staff_id)
            .join(owner, owner.staff_id == ContentShareRequest.source_owner_staff_id)
            .join(Subject, Subject.subject_id == ContentShareRequest.subject_id)
            .join(Class, Class.class_id == ContentShareRequest.destination_class_id)
            .join(
                AcademicPeriod,
                AcademicPeriod.academic_period_id
                == ContentShareRequest.destination_academic_period_id,
            )
        )
        if box == "incoming":
            query = query.filter(ContentShareRequest.source_owner_staff_id == staff_id)
        elif box == "outgoing":
            query = query.filter(ContentShareRequest.requester_staff_id == staff_id)
        else:
            raise ContentCloningError(
                status_code=422,
                code="REQUEST_BOX_INVALID",
                message="Request box must be incoming or outgoing.",
                field="box",
            )

        current = now or utc_now()
        visibility_filter = (
            ContentShareRequest.source_owner_staff_id == staff_id
            if box == "incoming"
            else ContentShareRequest.requester_staff_id == staff_id
        )
        total = (
            db.query(func.count(ContentShareRequest.request_id))
            .filter(visibility_filter)
            .scalar()
            or 0
        )
        open_status = ContentShareRequest.status.in_(("PENDING_OWNER", "PACKAGE_SENT"))
        expired = open_status & (ContentShareRequest.expires_at <= current)
        badge_row = (
            db.query(
                func.sum(
                    case(
                        (
                            (ContentShareRequest.status == "PENDING_OWNER")
                            & (ContentShareRequest.expires_at > current),
                            1,
                        ),
                        else_=0,
                    )
                ),
                func.sum(
                    case(
                        (
                            (ContentShareRequest.status == "PACKAGE_SENT")
                            & (ContentShareRequest.expires_at > current),
                            1,
                        ),
                        else_=0,
                    )
                ),
                func.sum(case((expired, 1), else_=0)),
            )
            .filter(visibility_filter)
            .one()
        )
        badges = {
            "pending": int(badge_row[0] or 0),
            "package_sent": int(badge_row[1] or 0),
            "expired": int(badge_row[2] or 0),
        }
        rows = (
            query.order_by(
                ContentShareRequest.created_at.desc(),
                ContentShareRequest.request_id.desc(),
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        serialized = [
            {
                "request": request,
                "requester_name": _staff_name(requester_staff),
                "source_owner_name": _staff_name(owner_staff),
                "subject_name": subject.subject_name,
                "destination_section_name": destination_class.section_name,
                "destination_period_name": period.period_name,
                "effective_status": effective_request_status(request, now=current),
            }
            for request, requester_staff, owner_staff, subject, destination_class, period in rows
        ]
        return serialized, total, badges

    @staticmethod
    def decline_request(
        db: Session,
        *,
        request_id: uuid.UUID,
        actor_staff_id: str,
        expected_version: int,
        now: datetime | None = None,
    ) -> ContentShareRequest:
        request = (
            db.query(ContentShareRequest)
            .filter(ContentShareRequest.request_id == request_id)
            .with_for_update()
            .first()
        )
        if request is None or request.source_owner_staff_id != actor_staff_id:
            raise ContentCloningError(
                status_code=404,
                code="REQUEST_NOT_FOUND",
                message="Content request not found.",
            )
        if request.status == "DECLINED_BY_OWNER":
            return request
        if effective_request_status(request, now=now or utc_now()) == "EXPIRED":
            event = expire_request(request, now=now)
            db.add(event)
            db.commit()
            raise ContentCloningError(
                status_code=409,
                code="REQUEST_EXPIRED",
                message="This content request has expired.",
            )
        event = transition_request(
            request,
            actor_staff_id=actor_staff_id,
            expected_version=expected_version,
            to_status="DECLINED_BY_OWNER",
            event_type="REQUEST_DECLINED_BY_OWNER",
            now=now,
        )
        db.add(event)
        requester_staff = db.get(AcademicStaff, request.requester_staff_id)
        owner_staff = db.get(AcademicStaff, request.source_owner_staff_id)
        subject = db.get(Subject, request.subject_id)
        if requester_staff and requester_staff.user_id:
            from app.services.cloning.ContentCloningNotification import stage_cloning_notification, staff_name
            own_name = staff_name(owner_staff)
            sub_name = subject.subject_name if subject else "materials"
            stage_cloning_notification(
                db,
                user_id=requester_staff.user_id,
                notification_type="repost_request_declined",
                title=f"Repost Request Declined: {sub_name}",
                body=f"{own_name} declined your material request.",
                action_url=f"/teacher/requests?box=outgoing&request_id={request.request_id}",
            )
        db.commit()
        db.refresh(request)
        return request


def _staff_name(staff: AcademicStaff) -> str:
    return " ".join(
        value
        for value in (staff.first_name, staff.middle_name, staff.last_name, staff.suffix)
        if value
    )
