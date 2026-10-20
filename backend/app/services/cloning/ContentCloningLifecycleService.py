from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.models.cloning.ContentCloning import ContentShareEvent, ContentShareRequest
from app.services.cloning.ContentCloningErrors import ContentCloningError


REQUEST_RESPONSE_WINDOW = timedelta(days=7)
PACKAGE_ACCEPTANCE_WINDOW = timedelta(days=7)
OPEN_REQUEST_STATUSES = frozenset({"PENDING_OWNER", "PACKAGE_SENT"})


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def request_expires_at(now: datetime | None = None) -> datetime:
    return (now or utc_now()) + REQUEST_RESPONSE_WINDOW


def package_expires_at(now: datetime | None = None) -> datetime:
    return (now or utc_now()) + PACKAGE_ACCEPTANCE_WINDOW


def effective_request_status(
    request: ContentShareRequest,
    *,
    now: datetime | None = None,
) -> str:
    current = now or utc_now()
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    expires_at = request.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if request.status in OPEN_REQUEST_STATUSES and expires_at <= current:
        return "EXPIRED"
    return request.status


def transition_request(
    request: ContentShareRequest,
    *,
    actor_staff_id: str | None,
    expected_version: int,
    to_status: str,
    event_type: str,
    now: datetime | None = None,
) -> ContentShareEvent:
    current = now or utc_now()
    effective = effective_request_status(request, now=current)
    if effective == "EXPIRED":
        raise ContentCloningError(
            status_code=409,
            code="REQUEST_EXPIRED",
            message="This content request has expired.",
        )
    if request.version != expected_version:
        raise ContentCloningError(
            status_code=409,
            code="REQUEST_VERSION_CONFLICT",
            message="This content request changed. Refresh it before trying again.",
            field="expected_version",
            retryable=True,
        )
    if request.status != "PENDING_OWNER":
        raise ContentCloningError(
            status_code=409,
            code="REQUEST_STATE_CONFLICT",
            message="This action is not valid for the request's current status.",
        )

    from_status = request.status
    request.status = to_status
    request.version += 1
    request.responded_at = current
    request.open_request_key = None
    return ContentShareEvent(
        request=request,
        actor_staff_id=actor_staff_id,
        event_type=event_type,
        from_status=from_status,
        to_status=to_status,
        safe_metadata={},
    )


def expire_request(
    request: ContentShareRequest,
    *,
    now: datetime | None = None,
) -> ContentShareEvent:
    current = now or utc_now()
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    if effective_request_status(request, now=current) != "EXPIRED":
        raise ContentCloningError(
            status_code=409,
            code="REQUEST_STATE_CONFLICT",
            message="This request has not expired.",
        )
    from_status = request.status
    request.status = "EXPIRED"
    request.version += 1
    request.responded_at = current
    request.open_request_key = None
    return ContentShareEvent(
        request=request,
        actor_staff_id=None,
        event_type="REQUEST_EXPIRED",
        from_status=from_status,
        to_status="EXPIRED",
        safe_metadata={},
    )
