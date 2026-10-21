"""Authorized synchronous package acceptance and self-cloning."""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.cloning.ContentCloning import (
    ContentCloneOperation, ContentShareEvent, ContentSharePackage,
    ContentShareRequest,
)
from app.models.quiz.Question import Question
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.services.classwork.ClassworkResponseService import resolve_classwork_file_path
from app.services.cloning import ContentCloningEngine as engine
from app.services.cloning.ContentCloningAuthorizationService import (
    ContentCloningAuthorizationService, DestinationScope,
)
from app.services.cloning.ContentCloningErrors import ContentCloningError
from app.services.cloning.ContentCloningLifecycleService import (
    effective_request_status, expire_request, utc_now,
)
from app.services.cloning.ContentCloningPackageService import (
    _canonical_json, build_classwork_snapshot, build_competency_snapshot,
    build_lesson_snapshot, compute_classwork_revision_token,
    compute_competency_revision_token, compute_lesson_revision_token,
)
from app.services.cloning.ContentCloningRequestService import canonical_fingerprint


def _valid_key(raw: str | None) -> str:
    key = (raw or "").strip()
    if not key or len(key) > 128:
        raise ContentCloningError(
            status_code=422, code="IDEMPOTENCY_KEY_INVALID",
            message="Idempotency-Key is required and must be at most 128 characters.",
            field="Idempotency-Key",
        )
    return key


def _period_for_lesson(lesson: Lesson) -> int | None:
    periods = {
        assignment.class_.academic_period_id
        for assignment in lesson.assignments
        if assignment.class_ and assignment.class_.academic_period_id is not None
    }
    if lesson.competency and lesson.competency.academic_period_id is not None:
        periods.add(lesson.competency.academic_period_id)
    return next(iter(periods)) if len(periods) == 1 else None


def _period_for_classwork(classwork: Classwork) -> int | None:
    periods = {
        assignment.academic_period_id or (
            assignment.class_.academic_period_id if assignment.class_ else None
        )
        for assignment in classwork.assignments
        if assignment.recipient_student_id is None
        and assignment.source_intervention_id is None
        and assignment.remediation_request_id is None
        and assignment.original_exam_assignment_id is None
    }
    periods.discard(None)
    return next(iter(periods)) if len(periods) == 1 else None


def _self_items(
    db: Session,
    *,
    actor_staff_id: str,
    destination: DestinationScope,
    selections: list[dict],
) -> list[engine.CloneItem]:
    keys = [(item["item_type"], item["source_entity_id"]) for item in selections]
    if len(set(keys)) != len(keys):
        raise ContentCloningError(
            status_code=422, code="DUPLICATE_ITEM_SELECTION",
            message="The same material was selected more than once.", field="items",
        )
    if any(kind not in {"COMPETENCY", "LESSON", "CLASSWORK"} for kind, _ in keys):
        raise ContentCloningError(
            status_code=422, code="ITEM_TYPE_INVALID",
            message="A selected material type is unsupported.", field="items",
        )
    verified_periods = ContentCloningAuthorizationService.verified_source_period_ids(
        db, owner_staff_id=actor_staff_id, subject_id=destination.subject_id,
        destination_period_id=destination.academic_period_id,
        previous_year_only=True,
    )
    ids = lambda kind: [entity_id for item_kind, entity_id in keys if item_kind == kind]
    competencies = {
        item.competency_id: item for item in db.query(Competency).filter(
            Competency.competency_id.in_(ids("COMPETENCY")),
            Competency.created_by_staff_id == actor_staff_id,
            Competency.subject_id == destination.subject_id,
        ).all()
    }
    lessons = {
        item.lesson_id: item for item in db.query(Lesson).filter(
            Lesson.lesson_id.in_(ids("LESSON")),
            Lesson.created_by_staff_id == actor_staff_id,
            Lesson.subject_id == destination.subject_id,
        ).options(
            joinedload(Lesson.competency),
            joinedload(Lesson.assignments).joinedload(LessonAssignment.class_),
        ).all()
    }
    classworks = {
        item.classwork_id: item for item in db.query(Classwork).filter(
            Classwork.classwork_id.in_(ids("CLASSWORK")),
            Classwork.created_by_staff_id == actor_staff_id,
            Classwork.subject_id == destination.subject_id,
        ).options(
            joinedload(Classwork.assignments),
            joinedload(Classwork.attachments),
            joinedload(Classwork.lessons),
            joinedload(Classwork.rubric_levels),
            joinedload(Classwork.coverage_history),
            joinedload(Classwork.quiz_setting),
            joinedload(Classwork.quiz)
            .joinedload(Quiz.questions)
            .joinedload(QuizQuestion.question)
            .joinedload(Question.options),
        ).all()
    }
    collections = {
        "COMPETENCY": competencies, "LESSON": lessons, "CLASSWORK": classworks
    }
    token_makers = {
        "COMPETENCY": compute_competency_revision_token,
        "LESSON": compute_lesson_revision_token,
        "CLASSWORK": compute_classwork_revision_token,
    }
    snapshot_makers = {
        "COMPETENCY": build_competency_snapshot,
        "LESSON": build_lesson_snapshot,
        "CLASSWORK": build_classwork_snapshot,
    }
    result = []
    for selection in selections:
        kind, source_id = selection["item_type"], selection["source_entity_id"]
        source = collections[kind].get(source_id)
        if source is None:
            raise ContentCloningError(
                status_code=404, code="ITEM_NOT_FOUND",
                message="A selected material was not found or is not owned by you.",
                field="items",
            )
        source_period_id = (
            source.academic_period_id if kind == "COMPETENCY"
            else _period_for_lesson(source) if kind == "LESSON"
            else _period_for_classwork(source)
        )
        if source_period_id not in verified_periods:
            raise ContentCloningError(
                status_code=404, code="SOURCE_PERIOD_UNVERIFIED",
                message="A selected material has no verified prior-year teaching scope.",
                field="items",
            )
        if token_makers[kind](source) != selection["source_revision_token"]:
            raise ContentCloningError(
                status_code=409, code="SOURCE_CONTENT_CHANGED",
                message="A selected material changed. Refresh the selection.",
                field="source_revision_token", retryable=True,
            )
        snapshot = snapshot_makers[kind](source)
        snapshot["academic_period_id"] = source_period_id
        assets = []
        if kind == "CLASSWORK":
            if len(source.attachments) > 100:
                raise ContentCloningError(
                    status_code=422, code="PACKAGE_ATTACHMENTS_EXCEEDED",
                    message="Too many attachments were selected.",
                )
            for attachment in source.attachments:
                path = resolve_classwork_file_path(attachment.file_path)
                path = engine.validate_source_path(
                    path, root=engine.DEFAULT_SOURCE_ROOT
                )
                try:
                    size, digest = engine.checksum_file(path)
                except OSError as exc:
                    raise ContentCloningError(
                        status_code=409, code="CLONE_ASSET_INVALID",
                        message="A selected attachment is unavailable.",
                    ) from exc
                assets.append(engine.CloneAsset(
                    source_path=path, original_filename=attachment.file_name,
                    media_type=attachment.file_type, byte_size=size,
                    checksum_sha256=digest,
                    source_ref=f"{source_id}:{attachment.classwork_attachment_id}",
                ))
        result.append(engine.CloneItem(
            item_type=kind, source_entity_id=source_id,
            snapshot=snapshot,
            snapshot_hash=hashlib.sha256(
                _canonical_json(snapshot).encode("utf-8")
            ).hexdigest(),
            assets=tuple(assets),
        ))
    return result


def _run_copy(
    db: Session,
    *,
    operation: ContentCloneOperation,
    destination: DestinationScope,
    items: list[engine.CloneItem],
    asset_root: Path,
    period_mappings: list[dict[str, int]],
    fallback_source_period_id: int | None = None,
    request: ContentShareRequest | None = None,
    now: datetime,
) -> ContentCloneOperation:
    engine.validate_period_mappings(
        items, destination.academic_period_id, period_mappings,
        fallback_source_period_id=fallback_source_period_id,
    )
    db.add(operation)
    try:
        db.flush()  # Existing actor/key uniqueness also protects concurrent retries.
        operation.status = "RUNNING"
        operation.started_at = now
        counts = engine.clone_snapshot_graph(
            db, items=items, destination=destination,
            actor_staff_id=operation.actor_staff_id, operation=operation,
            asset_root=asset_root, output_root=engine.DEFAULT_CLONE_ROOT,
        )
        # Recheck the exact destination immediately before the final commit.
        ContentCloningAuthorizationService.resolve_destination(
            db, actor_staff_id=operation.actor_staff_id,
            class_id=destination.class_id, subject_id=destination.subject_id,
            academic_period_id=destination.academic_period_id,
        )
        operation.summary_counts = counts
        operation.status = "SUCCEEDED"
        operation.completed_at = now
        if request is not None:
            request.status = "ACCEPTED"
            request.version += 1
            request.responded_at = now
            request.open_request_key = None
        db.add(ContentShareEvent(
            request_id=request.request_id if request else None,
            operation_id=operation.operation_id,
            actor_staff_id=operation.actor_staff_id,
            event_type="PACKAGE_ACCEPTED" if request else "SELF_CLONE_COMPLETED",
            from_status="PACKAGE_SENT" if request else None,
            to_status="ACCEPTED" if request else "SUCCEEDED",
            safe_metadata={"counts": counts},
        ))
        db.commit()
        return operation
    except Exception as exc:
        db.rollback()
        try:
            engine.cleanup_clone_files(
                operation.operation_id, root=engine.DEFAULT_CLONE_ROOT
            )
        except Exception as cleanup_exc:
            raise ContentCloningError(
                status_code=500, code="CLONE_CLEANUP_FAILED",
                message="The clone failed and its files need administrator cleanup.",
            ) from cleanup_exc
        if isinstance(exc, ContentCloningError):
            raise
        if isinstance(exc, IntegrityError):
            raise ContentCloningError(
                status_code=409, code="CLONE_CONFLICT",
                message="Another clone operation completed for this request. Refresh it.",
                retryable=True,
            ) from exc
        raise ContentCloningError(
            status_code=500, code="CLONE_FAILED",
            message="The content could not be cloned. No changes were saved.",
        ) from exc


class ContentCloningExecutionService:
    @staticmethod
    def accept_package(
        db: Session, *, request_id: uuid.UUID, actor_staff_id: str,
        expected_version: int, idempotency_key: str | None,
        period_mappings: list[dict[str, int]], now: datetime | None = None,
    ) -> tuple[ContentCloneOperation, bool]:
        _valid_key(idempotency_key)
        current = now or utc_now()
        request = (
            db.query(ContentShareRequest)
            .filter(ContentShareRequest.request_id == request_id)
            .with_for_update()
            .first()
        )
        if request is None or request.requester_staff_id != actor_staff_id:
            raise ContentCloningError(
                status_code=404, code="REQUEST_NOT_FOUND",
                message="Content request not found.",
            )
        fingerprint = canonical_fingerprint({
            "request_id": str(request_id), "expected_version": expected_version,
            "period_mappings": period_mappings,
        })
        previous = db.query(ContentCloneOperation).filter(
            ContentCloneOperation.request_id == request_id,
            ContentCloneOperation.mode == "SHARED_PACKAGE",
        ).first()
        if previous is not None:
            if previous.status == "SUCCEEDED" and previous.request_fingerprint == fingerprint:
                return previous, True
            raise ContentCloningError(
                status_code=409, code="REQUEST_STATE_CONFLICT",
                message="This package has already been processed.",
            )
        if effective_request_status(request, now=current) == "EXPIRED":
            db.add(expire_request(request, now=current))
            db.commit()
            raise ContentCloningError(
                status_code=409, code="REQUEST_EXPIRED",
                message="This content request has expired.",
            )
        if request.version != expected_version:
            raise ContentCloningError(
                status_code=409, code="REQUEST_VERSION_CONFLICT",
                message="This content request changed. Refresh it before trying again.",
                field="expected_version", retryable=True,
            )
        if request.status != "PACKAGE_SENT":
            raise ContentCloningError(
                status_code=409, code="REQUEST_STATE_CONFLICT",
                message="Only a sent package can be accepted.",
            )
        package = db.query(ContentSharePackage).filter(
            ContentSharePackage.request_id == request_id
        ).with_for_update().first()
        if package is None or package.source_owner_staff_id != request.source_owner_staff_id:
            raise ContentCloningError(
                status_code=409, code="PACKAGE_SNAPSHOT_INVALID",
                message="The sent package is unavailable.",
            )
        expires = package.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires <= current:
            raise ContentCloningError(
                status_code=409, code="REQUEST_EXPIRED",
                message="This package has expired.",
            )
        destination = ContentCloningAuthorizationService.resolve_destination(
            db, actor_staff_id=actor_staff_id,
            class_id=request.destination_class_id,
            subject_id=request.destination_subject_id,
            academic_period_id=request.destination_academic_period_id,
        )
        items = engine.load_package_items(db, package)
        verified_periods = ContentCloningAuthorizationService.verified_source_period_ids(
            db, owner_staff_id=request.source_owner_staff_id,
            subject_id=request.subject_id,
            destination_period_id=destination.academic_period_id,
        )
        selected_periods = engine.validate_period_mappings(
            items, destination.academic_period_id, period_mappings,
            fallback_source_period_id=(
                request.source_academic_period_id
                if request.source_scope_mode == "PERIOD" else None
            ),
        )
        if not selected_periods.issubset(verified_periods):
            raise ContentCloningError(
                status_code=409, code="SOURCE_PERIOD_UNVERIFIED",
                message="Package source terms cannot be verified.",
            )
        operation = ContentCloneOperation(
            operation_id=uuid.uuid4(), mode="SHARED_PACKAGE",
            actor_staff_id=actor_staff_id,
            request_id=request_id, package_id=package.package_id,
            destination_class_id=destination.class_id,
            destination_subject_id=destination.subject_id,
            destination_academic_period_id=destination.academic_period_id,
            status="PENDING", idempotency_key=f"accept:{request_id}",
            request_fingerprint=fingerprint, summary_counts={},
        )
        return _run_copy(
            db, operation=operation, destination=destination, items=items,
            asset_root=engine.DEFAULT_STAGING_ROOT,
            period_mappings=period_mappings,
            fallback_source_period_id=request.source_academic_period_id
                if request.source_scope_mode == "PERIOD" else None,
            request=request, now=current,
        ), False

    @staticmethod
    def clone_self(
        db: Session, *, actor_staff_id: str, idempotency_key: str | None,
        payload: dict, now: datetime | None = None,
    ) -> tuple[ContentCloneOperation, bool]:
        key = _valid_key(idempotency_key)
        stored_key = "self:" + hashlib.sha256(key.encode("utf-8")).hexdigest()
        fingerprint = canonical_fingerprint(payload)
        previous = db.query(ContentCloneOperation).filter(
            ContentCloneOperation.actor_staff_id == actor_staff_id,
            ContentCloneOperation.idempotency_key == stored_key,
        ).first()
        if previous is not None:
            if previous.mode == "SELF" and previous.request_fingerprint == fingerprint and previous.status == "SUCCEEDED":
                return previous, True
            raise ContentCloningError(
                status_code=409, code="IDEMPOTENCY_KEY_REUSED",
                message="This key was used for a different clone operation.",
                field="Idempotency-Key",
            )
        destination = ContentCloningAuthorizationService.resolve_destination(
            db, actor_staff_id=actor_staff_id,
            class_id=payload["destination_class_id"],
            subject_id=payload["destination_subject_id"],
            academic_period_id=payload["destination_academic_period_id"],
        )
        items = _self_items(
            db, actor_staff_id=actor_staff_id,
            destination=destination, selections=payload["items"],
        )
        operation = ContentCloneOperation(
            operation_id=uuid.uuid4(), mode="SELF",
            actor_staff_id=actor_staff_id,
            destination_class_id=destination.class_id,
            destination_subject_id=destination.subject_id,
            destination_academic_period_id=destination.academic_period_id,
            status="PENDING", idempotency_key=stored_key,
            request_fingerprint=fingerprint, summary_counts={},
        )
        return _run_copy(
            db, operation=operation, destination=destination, items=items,
            asset_root=engine.DEFAULT_SOURCE_ROOT,
            period_mappings=payload.get("period_mappings", []),
            now=now or utc_now(),
        ), False

    @staticmethod
    def get_operation(
        db: Session, *, operation_id: uuid.UUID, actor_staff_id: str,
    ) -> ContentCloneOperation:
        operation = db.get(ContentCloneOperation, operation_id)
        if operation is None or operation.actor_staff_id != actor_staff_id:
            raise ContentCloningError(
                status_code=404, code="CLONE_OPERATION_NOT_FOUND",
                message="Clone operation not found.",
            )
        return operation
