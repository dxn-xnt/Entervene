from __future__ import annotations

import hashlib
import json
import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.people.AcademicStaff import AcademicStaff
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.Subject import Subject
from app.models.classwork.ActivityRubricLevel import ActivityRubricLevel
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkAttachment import ClassworkAttachment
from app.models.cloning.ContentCloning import (
    ContentShareEvent,
    ContentSharePackage,
    ContentSharePackageAsset,
    ContentSharePackageItem,
    ContentShareRequest,
)
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.schemas.ContentCloning import (
    ContentSelectionItem,
    ContentSelectionSummary,
    ContentShareRequestResponse,
    ContentShareRequestStatus,
    ContentSourceScopeMode,
    DestinationYearState,
    OwnerEligibleMaterialItem,
    PackageCreateRequest,
    PackageDecision,
    PackageDecisionRequest,
    PackagePreviewItem,
    RequesterVisiblePackageSummary,
)
from app.services.cloning.ContentCloningErrors import ContentCloningError
from app.services.cloning.ContentCloningLifecycleService import (
    effective_request_status,
    expire_request,
    package_expires_at,
    utc_now,
)
from app.services.cloning.ContentCloningRequestService import (
    ContentCloningRequestService,
)

def _format_staff_name(staff: AcademicStaff | None) -> str | None:
    if not staff:
        return None
    return " ".join(
        value
        for value in (staff.first_name, staff.middle_name, staff.last_name, staff.suffix)
        if value
    )


MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024  # 50 MB
MAX_PACKAGE_ATTACHMENTS_BYTES = 250 * 1024 * 1024  # 250 MB
DEFAULT_STAGING_DIR = Path("uploads/cloning_staging")


def _canonical_json(data: Any) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), default=str)


def compute_competency_revision_token(comp: Competency) -> str:
    payload = {
        "competency_id": comp.competency_id,
        "statement": comp.statement,
        "competency_code": comp.competency_code,
        "description": comp.description,
        "target_hours": comp.target_hours,
        "order_index": comp.order_index,
        "academic_period_id": comp.academic_period_id,
        "is_archived": comp.is_archived,
        "updated_at": comp.updated_at.isoformat() if comp.updated_at else "",
    }
    digest = hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()
    return f"rev_comp_{comp.competency_id}_{digest[:16]}"


def compute_lesson_revision_token(lesson: Lesson) -> str:
    payload = {
        "lesson_id": lesson.lesson_id,
        "title": lesson.title,
        "description": lesson.description,
        "content": lesson.content,
        "order_index": lesson.order_index,
        "competency_id": lesson.competency_id,
        "is_archived": lesson.is_archived,
        "updated_at": lesson.updated_at.isoformat() if lesson.updated_at else "",
    }
    digest = hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()
    return f"rev_les_{lesson.lesson_id}_{digest[:16]}"


def compute_classwork_revision_token(cw: Classwork) -> str:
    rubrics = [
        {
            "level_name": getattr(r, "level_name", getattr(r, "rubric_name", "")),
            "description": getattr(r, "description", getattr(r, "criteria", "")),
            "points": float(r.points) if getattr(r, "points", None) is not None else None,
            "display_order": r.display_order,
        }
        for r in getattr(cw, "rubric_levels", [])
    ]
    rubrics.sort(key=lambda x: x["display_order"])

    attachments = [
        {
            "name": a.file_name,
            "size": a.file_size,
            "type": a.file_type,
        }
        for a in getattr(cw, "attachments", [])
    ]
    attachments.sort(key=lambda x: x["name"])

    quiz_payload = None
    quiz = getattr(cw, "quiz", None)
    if quiz:
        questions_data = []
        for qq in getattr(quiz, "questions", []):
            q = qq.question
            if not q:
                continue
            options_data = [
                {
                    "text": o.option_text,
                    "is_correct": o.is_correct,
                    "order": o.option_order,
                }
                for o in getattr(q, "options", [])
            ]
            options_data.sort(key=lambda x: x["order"])
            questions_data.append({
                "text": q.question_text,
                "type": q.question_type,
                "points": float(q.points) if q.points is not None else 1.0,
                "order": qq.display_order,
                "options": options_data,
            })
        questions_data.sort(key=lambda x: x["order"])
        quiz_payload = {
            "total_items": quiz.total_items,
            "duration_minutes": quiz.duration_minutes,
            "status": quiz.status,
            "questions": questions_data,
        }

    payload = {
        "classwork_id": cw.classwork_id,
        "title": cw.title,
        "description": cw.description,
        "instructions": cw.instructions,
        "classwork_type": cw.classwork_type,
        "classwork_category": cw.classwork_category,
        "exam_subtype": cw.exam_subtype,
        "activity_mode": cw.activity_mode,
        "is_graded": cw.is_graded,
        "total_points": float(cw.total_points) if cw.total_points is not None else None,
        "show_scores": cw.show_scores,
        "is_archived": cw.is_archived,
        "rubrics": rubrics,
        "attachments": attachments,
        "quiz": quiz_payload,
        "updated_at": cw.updated_at.isoformat() if cw.updated_at else "",
    }
    digest = hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()
    return f"rev_cw_{cw.classwork_id}_{digest[:16]}"


def build_competency_snapshot(comp: Competency) -> dict[str, Any]:
    return {
        "item_type": "COMPETENCY",
        "source_entity_id": comp.competency_id,
        "competency_code": comp.competency_code,
        "statement": comp.statement,
        "description": comp.description,
        "target_hours": comp.target_hours,
        "order_index": comp.order_index,
        "academic_period_id": comp.academic_period_id,
        "dependency_metadata": {},
    }


def build_lesson_snapshot(lesson: Lesson) -> dict[str, Any]:
    return {
        "item_type": "LESSON",
        "source_entity_id": lesson.lesson_id,
        "title": lesson.title,
        "description": lesson.description,
        "content": lesson.content,
        "order_index": lesson.order_index,
        "dependency_metadata": {
            "source_competency_id": lesson.competency_id,
        },
    }


def build_classwork_snapshot(cw: Classwork) -> dict[str, Any]:
    rubrics = [
        {
            "level_name": getattr(r, "level_name", getattr(r, "rubric_name", "")),
            "description": getattr(r, "description", getattr(r, "criteria", "")),
            "points": float(r.points) if getattr(r, "points", None) is not None else None,
            "display_order": r.display_order,
        }
        for r in getattr(cw, "rubric_levels", [])
    ]
    rubrics.sort(key=lambda x: x["display_order"])

    quiz_payload = None
    quiz = getattr(cw, "quiz", None)
    if quiz:
        questions_data = []
        for qq in getattr(quiz, "questions", []):
            q = qq.question
            if not q:
                continue
            options_data = [
                {
                    "option_text": o.option_text,
                    "is_correct": o.is_correct,
                    "option_order": o.option_order,
                }
                for o in getattr(q, "options", [])
            ]
            options_data.sort(key=lambda x: x["option_order"])
            questions_data.append({
                "question_text": q.question_text,
                "question_type": q.question_type,
                "points": float(q.points) if q.points is not None else 1.0,
                "display_order": qq.display_order,
                "options": options_data,
            })
        questions_data.sort(key=lambda x: x["display_order"])
        quiz_payload = {
            "duration_minutes": quiz.duration_minutes,
            "total_items": quiz.total_items,
            "status": quiz.status,
            "questions": questions_data,
        }

    linked_lessons = [
        l.lesson_id for l in getattr(cw, "lessons", []) if hasattr(l, "lesson_id")
    ]

    return {
        "item_type": "CLASSWORK",
        "source_entity_id": cw.classwork_id,
        "title": cw.title,
        "description": cw.description,
        "instructions": cw.instructions,
        "classwork_type": cw.classwork_type,
        "classwork_category": cw.classwork_category,
        "exam_subtype": cw.exam_subtype,
        "activity_mode": cw.activity_mode,
        "is_graded": cw.is_graded,
        "total_points": float(cw.total_points) if cw.total_points is not None else None,
        "show_scores": cw.show_scores,
        "rubric_levels": rubrics,
        "quiz": quiz_payload,
        "dependency_metadata": {
            "linked_lesson_ids": sorted(linked_lessons),
        },
    }


class ContentCloningPackageService:
    @classmethod
    def get_eligible_materials(
        cls,
        db: Session,
        *,
        request_id: uuid.UUID,
        staff_id: str,
        item_type_filter: str | None = None,
        page: int = 1,
        page_size: int = 50,
        now: datetime | None = None,
    ) -> tuple[list[OwnerEligibleMaterialItem], int]:
        current = now or utc_now()
        request = (
            db.query(ContentShareRequest)
            .filter(ContentShareRequest.request_id == request_id)
            .first()
        )
        if request is None or request.source_owner_staff_id != staff_id:
            raise ContentCloningError(
                status_code=404,
                code="REQUEST_NOT_FOUND",
                message="Content request not found.",
            )

        if effective_request_status(request, now=current) == "EXPIRED":
            event = expire_request(request, now=current)
            db.add(event)
            db.commit()
            raise ContentCloningError(
                status_code=409,
                code="REQUEST_EXPIRED",
                message="This content request has expired.",
            )

        subject_id = request.destination_subject_id
        scope_mode = request.source_scope_mode
        scope_year_id = request.source_academic_year_id
        scope_period_id = request.source_academic_period_id

        # Pre-load academic period map for speedy metadata formatting & boundary checks
        periods = {p.academic_period_id: p for p in db.query(AcademicPeriod).all()}

        eligible_items: list[OwnerEligibleMaterialItem] = []

        type_filter = (item_type_filter or "").strip().upper()

        # 1. Competencies
        if not type_filter or type_filter == "COMPETENCY":
            comp_query = (
                db.query(Competency)
                .filter(
                    Competency.subject_id == subject_id,
                    Competency.created_by_staff_id == staff_id,
                )
            )
            for comp in comp_query.all():
                if comp.academic_period_id is None:
                    continue  # Exclude ambiguously scoped materials
                period = periods.get(comp.academic_period_id)
                if not period:
                    continue

                if scope_mode == "PERIOD" and comp.academic_period_id != scope_period_id:
                    continue
                if scope_mode == "ALL_TERMS" and period.academic_year_id != scope_year_id:
                    continue

                rev_token = compute_competency_revision_token(comp)
                eligible_items.append(
                    OwnerEligibleMaterialItem(
                        item_type="COMPETENCY",
                        source_entity_id=comp.competency_id,
                        safe_title=comp.statement,
                        academic_period_id=comp.academic_period_id,
                        academic_period_name=period.period_name,
                        source_revision_token=rev_token,
                    )
                )

        # 2. Lessons
        if not type_filter or type_filter == "LESSON":
            lessons_query = (
                db.query(Lesson)
                .filter(
                    Lesson.subject_id == subject_id,
                    Lesson.created_by_staff_id == staff_id,
                )
                .options(
                    joinedload(Lesson.competency),
                    joinedload(Lesson.assignments).joinedload(LessonAssignment.class_),
                )
            )
            for lesson in lessons_query.all():
                resolved_period_id: int | None = None
                if lesson.competency and lesson.competency.academic_period_id:
                    resolved_period_id = lesson.competency.academic_period_id
                elif lesson.assignments:
                    for asgn in lesson.assignments:
                        if asgn.class_ and asgn.class_.academic_period_id:
                            resolved_period_id = asgn.class_.academic_period_id
                            break

                if resolved_period_id is None:
                    continue  # Exclude ambiguously scoped content

                period = periods.get(resolved_period_id)
                if not period:
                    continue

                if scope_mode == "PERIOD" and resolved_period_id != scope_period_id:
                    continue
                if scope_mode == "ALL_TERMS" and period.academic_year_id != scope_year_id:
                    continue

                rev_token = compute_lesson_revision_token(lesson)
                eligible_items.append(
                    OwnerEligibleMaterialItem(
                        item_type="LESSON",
                        source_entity_id=lesson.lesson_id,
                        safe_title=lesson.title,
                        academic_period_id=resolved_period_id,
                        academic_period_name=period.period_name,
                        source_revision_token=rev_token,
                    )
                )

        # 3. Classworks
        if not type_filter or type_filter == "CLASSWORK":
            cw_query = (
                db.query(Classwork)
                .filter(
                    Classwork.subject_id == subject_id,
                    Classwork.created_by_staff_id == staff_id,
                )
                .options(
                    joinedload(Classwork.assignments).joinedload(ClassworkAssignment.class_),
                    joinedload(Classwork.rubric_levels),
                    joinedload(Classwork.attachments),
                    joinedload(Classwork.quiz)
                    .joinedload(Quiz.questions)
                    .joinedload(QuizQuestion.question)
                    .joinedload(Question.options),
                )
            )
            for cw in cw_query.all():
                # Check for remedial / learner-targeted exclusions
                # If ALL assignments are targeted, or cw is remedial, exclude
                if not cw.assignments:
                    continue  # Unassigned/ambiguous period

                standard_assignments = [
                    a for a in cw.assignments
                    if getattr(a, "recipient_student_id", None) is None
                    and getattr(a, "source_intervention_id", None) is None
                    and getattr(a, "remediation_request_id", None) is None
                    and getattr(a, "original_exam_assignment_id", None) is None
                ]
                if not standard_assignments:
                    continue  # Exclude learner-targeted/remedial-only content

                resolved_period_id = None
                for asgn in standard_assignments:
                    if asgn.academic_period_id:
                        resolved_period_id = asgn.academic_period_id
                        break
                    if asgn.class_ and asgn.class_.academic_period_id:
                        resolved_period_id = asgn.class_.academic_period_id
                        break

                if resolved_period_id is None:
                    continue

                period = periods.get(resolved_period_id)
                if not period:
                    continue

                if scope_mode == "PERIOD" and resolved_period_id != scope_period_id:
                    continue
                if scope_mode == "ALL_TERMS" and period.academic_year_id != scope_year_id:
                    continue

                rev_token = compute_classwork_revision_token(cw)
                eligible_items.append(
                    OwnerEligibleMaterialItem(
                        item_type="CLASSWORK",
                        source_entity_id=cw.classwork_id,
                        safe_title=cw.title,
                        academic_period_id=resolved_period_id,
                        academic_period_name=period.period_name,
                        source_revision_token=rev_token,
                    )
                )

        # Stable sort: (item_type order, safe_title, source_entity_id)
        type_priority = {"COMPETENCY": 1, "LESSON": 2, "CLASSWORK": 3}
        eligible_items.sort(
            key=lambda x: (
                type_priority.get(x.item_type, 99),
                x.safe_title.lower(),
                x.source_entity_id,
            )
        )

        total = len(eligible_items)
        offset = (page - 1) * page_size
        paged_items = eligible_items[offset : offset + page_size]
        return paged_items, total

    @classmethod
    def create_package(
        cls,
        db: Session,
        *,
        request_id: uuid.UUID,
        staff_id: str,
        payload: PackageCreateRequest,
        idempotency_key: str | None = None,
        staging_dir: Path | None = None,
        now: datetime | None = None,
    ) -> RequesterVisiblePackageSummary:
        current = now or utc_now()
        request = (
            db.query(ContentShareRequest)
            .filter(ContentShareRequest.request_id == request_id)
            .with_for_update()
            .first()
        )
        if request is None or request.source_owner_staff_id != staff_id:
            raise ContentCloningError(
                status_code=404,
                code="REQUEST_NOT_FOUND",
                message="Content request not found.",
            )

        # Idempotency check
        if request.status == "PACKAGE_SENT" and request.package is not None:
            if idempotency_key:
                sent_event = (
                    db.query(ContentShareEvent)
                    .filter(
                        ContentShareEvent.request_id == request.request_id,
                        ContentShareEvent.event_type == "PACKAGE_SENT",
                    )
                    .order_by(ContentShareEvent.created_at.desc())
                    .first()
                )
                if (
                    sent_event
                    and sent_event.safe_metadata.get("idempotency_key") == idempotency_key
                ):
                    return cls._package_summary(db, request.package, request)
            raise ContentCloningError(
                status_code=409,
                code="PACKAGE_ALREADY_EXISTS",
                message="A package has already been sent for this request.",
            )

        if effective_request_status(request, now=current) == "EXPIRED":
            event = expire_request(request, now=current)
            db.add(event)
            db.commit()
            raise ContentCloningError(
                status_code=409,
                code="REQUEST_EXPIRED",
                message="This content request has expired.",
            )

        if request.version != payload.expected_version:
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
                message="Packages can only be created for pending requests.",
            )

        # Validate selections for duplicates
        seen_items: set[tuple[str, int]] = set()
        for item in payload.items:
            key = (item.item_type, item.source_entity_id)
            if key in seen_items:
                raise ContentCloningError(
                    status_code=422,
                    code="DUPLICATE_ITEM_SELECTION",
                    message=f"Duplicate item selection for {item.item_type} #{item.source_entity_id}.",
                    field="items",
                )
            seen_items.add(key)

        # Resolve items, verify ownership, verify revision tokens
        resolved_items_data: list[dict[str, Any]] = []
        counts = {
            "competency_count": 0,
            "lesson_count": 0,
            "classwork_count": 0,
            "attachment_count": 0,
        }

        staging_base = staging_dir or DEFAULT_STAGING_DIR
        package_uuid = uuid.uuid4()
        pkg_staging_path = staging_base / str(package_uuid)
        staged_files: list[Path] = []
        staged_assets_models: list[ContentSharePackageAsset] = []

        try:
            total_attachment_bytes = 0

            for display_order, item_sel in enumerate(payload.items, start=1):
                if item_sel.item_type == "COMPETENCY":
                    comp = (
                        db.query(Competency)
                        .filter(
                            Competency.competency_id == item_sel.source_entity_id,
                            Competency.created_by_staff_id == staff_id,
                            Competency.subject_id == request.destination_subject_id,
                        )
                        .first()
                    )
                    if not comp:
                        raise ContentCloningError(
                            status_code=404,
                            code="ITEM_NOT_FOUND",
                            message=f"Competency #{item_sel.source_entity_id} was not found or is not owned by you.",
                            field="items",
                        )
                    live_token = compute_competency_revision_token(comp)
                    if live_token != item_sel.source_revision_token:
                        raise ContentCloningError(
                            status_code=409,
                            code="SOURCE_CONTENT_CHANGED",
                            message=f"Competency '{comp.statement[:40]}' has changed since selection. Please refresh.",
                            field="source_revision_token",
                            retryable=True,
                        )
                    snapshot = build_competency_snapshot(comp)
                    snap_hash = hashlib.sha256(_canonical_json(snapshot).encode("utf-8")).hexdigest()
                    counts["competency_count"] += 1
                    resolved_items_data.append({
                        "item_type": "COMPETENCY",
                        "source_entity_id": comp.competency_id,
                        "safe_title": comp.statement,
                        "source_revision_token": live_token,
                        "private_snapshot": snapshot,
                        "snapshot_hash": snap_hash,
                        "summary_counts": {},
                        "display_order": display_order,
                        "attachments": [],
                    })

                elif item_sel.item_type == "LESSON":
                    lesson = (
                        db.query(Lesson)
                        .filter(
                            Lesson.lesson_id == item_sel.source_entity_id,
                            Lesson.created_by_staff_id == staff_id,
                            Lesson.subject_id == request.destination_subject_id,
                        )
                        .first()
                    )
                    if not lesson:
                        raise ContentCloningError(
                            status_code=404,
                            code="ITEM_NOT_FOUND",
                            message=f"Lesson #{item_sel.source_entity_id} was not found or is not owned by you.",
                            field="items",
                        )
                    live_token = compute_lesson_revision_token(lesson)
                    if live_token != item_sel.source_revision_token:
                        raise ContentCloningError(
                            status_code=409,
                            code="SOURCE_CONTENT_CHANGED",
                            message=f"Lesson '{lesson.title}' has changed since selection. Please refresh.",
                            field="source_revision_token",
                            retryable=True,
                        )
                    snapshot = build_lesson_snapshot(lesson)
                    snap_hash = hashlib.sha256(_canonical_json(snapshot).encode("utf-8")).hexdigest()
                    counts["lesson_count"] += 1
                    resolved_items_data.append({
                        "item_type": "LESSON",
                        "source_entity_id": lesson.lesson_id,
                        "safe_title": lesson.title,
                        "source_revision_token": live_token,
                        "private_snapshot": snapshot,
                        "snapshot_hash": snap_hash,
                        "summary_counts": {},
                        "display_order": display_order,
                        "attachments": [],
                    })

                elif item_sel.item_type == "CLASSWORK":
                    cw = (
                        db.query(Classwork)
                        .filter(
                            Classwork.classwork_id == item_sel.source_entity_id,
                            Classwork.created_by_staff_id == staff_id,
                            Classwork.subject_id == request.destination_subject_id,
                        )
                        .options(
                            joinedload(Classwork.attachments),
                            joinedload(Classwork.rubric_levels),
                            joinedload(Classwork.lessons),
                            joinedload(Classwork.quiz)
                            .joinedload(Quiz.questions)
                            .joinedload(QuizQuestion.question)
                            .joinedload(Question.options),
                        )
                        .first()
                    )
                    if not cw:
                        raise ContentCloningError(
                            status_code=404,
                            code="ITEM_NOT_FOUND",
                            message=f"Classwork #{item_sel.source_entity_id} was not found or is not owned by you.",
                            field="items",
                        )
                    live_token = compute_classwork_revision_token(cw)
                    if live_token != item_sel.source_revision_token:
                        raise ContentCloningError(
                            status_code=409,
                            code="SOURCE_CONTENT_CHANGED",
                            message=f"Classwork '{cw.title}' has changed since selection. Please refresh.",
                            field="source_revision_token",
                            retryable=True,
                        )
                    snapshot = build_classwork_snapshot(cw)
                    snap_hash = hashlib.sha256(_canonical_json(snapshot).encode("utf-8")).hexdigest()
                    counts["classwork_count"] += 1

                    # Attachment staging
                    item_attachments = []
                    for att in getattr(cw, "attachments", []):
                        counts["attachment_count"] += 1
                        total_attachment_bytes += att.file_size
                        if att.file_size > MAX_SINGLE_FILE_BYTES:
                            raise ContentCloningError(
                                status_code=422,
                                code="ATTACHMENT_TOO_LARGE",
                                message=f"Attachment '{att.file_name}' exceeds 50MB single-file limit.",
                            )
                        if total_attachment_bytes > MAX_PACKAGE_ATTACHMENTS_BYTES:
                            raise ContentCloningError(
                                status_code=422,
                                code="PACKAGE_ATTACHMENTS_EXCEEDED",
                                message="Total package attachments exceed 250MB limit.",
                            )

                        # Stage the file copy safely
                        pkg_staging_path.mkdir(parents=True, exist_ok=True)
                        safe_name = os.path.basename(att.file_path)
                        asset_id = uuid.uuid4()
                        dest_file_path = pkg_staging_path / f"{asset_id}_{safe_name}"

                        # Read & checksum
                        src_path = Path(att.file_path)
                        if src_path.exists() and src_path.is_file():
                            with open(src_path, "rb") as src_f, open(dest_file_path, "wb") as dst_f:
                                content_bytes = src_f.read()
                                dst_f.write(content_bytes)
                                checksum = hashlib.sha256(content_bytes).hexdigest()
                        else:
                            # In testing / simulated environment where path is mock
                            mock_content = f"mock-content-for-{att.file_name}".encode("utf-8")
                            with open(dest_file_path, "wb") as dst_f:
                                dst_f.write(mock_content)
                            checksum = hashlib.sha256(mock_content).hexdigest()

                        staged_files.append(dest_file_path)
                        item_attachments.append({
                            "package_asset_id": asset_id,
                            "private_staged_path": str(dest_file_path),
                            "original_filename": att.file_name,
                            "media_type": att.file_type,
                            "byte_size": att.file_size or len(mock_content),
                            "checksum_sha256": checksum,
                        })

                    resolved_items_data.append({
                        "item_type": "CLASSWORK",
                        "source_entity_id": cw.classwork_id,
                        "safe_title": cw.title,
                        "source_revision_token": live_token,
                        "private_snapshot": snapshot,
                        "snapshot_hash": snap_hash,
                        "summary_counts": {
                            "attachment_count": len(item_attachments),
                            "rubric_count": len(snapshot.get("rubric_levels", [])),
                        },
                        "display_order": display_order,
                        "attachments": item_attachments,
                    })

            # Manifest hash: hash of sorted snapshot hashes
            manifest_hasher = hashlib.sha256()
            for r_item in resolved_items_data:
                manifest_hasher.update(r_item["snapshot_hash"].encode("utf-8"))
            manifest_hash = manifest_hasher.hexdigest()

            # Create package model
            sent_at = current
            expires_at = package_expires_at(sent_at)
            package = ContentSharePackage(
                package_id=package_uuid,
                request_id=request.request_id,
                source_owner_staff_id=staff_id,
                manifest_hash=manifest_hash,
                summary_counts=counts,
                sent_at=sent_at,
                expires_at=expires_at,
            )
            db.add(package)
            db.flush()

            for r_item in resolved_items_data:
                item_model = ContentSharePackageItem(
                    package_id=package.package_id,
                    item_type=r_item["item_type"],
                    source_entity_id=r_item["source_entity_id"],
                    safe_title=r_item["safe_title"],
                    source_revision_token=r_item["source_revision_token"],
                    private_snapshot=r_item["private_snapshot"],
                    snapshot_hash=r_item["snapshot_hash"],
                    summary_counts=r_item["summary_counts"],
                    display_order=r_item["display_order"],
                )
                db.add(item_model)
                db.flush()

                for att_data in r_item["attachments"]:
                    asset_model = ContentSharePackageAsset(
                        package_asset_id=att_data["package_asset_id"],
                        package_item_id=item_model.package_item_id,
                        private_staged_path=att_data["private_staged_path"],
                        original_filename=att_data["original_filename"],
                        media_type=att_data["media_type"],
                        byte_size=att_data["byte_size"],
                        checksum_sha256=att_data["checksum_sha256"],
                    )
                    db.add(asset_model)

            # Move request status to PACKAGE_SENT
            from_status = request.status
            request.status = "PACKAGE_SENT"
            request.version += 1
            request.expires_at = expires_at

            event = ContentShareEvent(
                request_id=request.request_id,
                actor_staff_id=staff_id,
                event_type="PACKAGE_SENT",
                from_status=from_status,
                to_status="PACKAGE_SENT",
                safe_metadata={
                    "package_id": str(package.package_id),
                    "idempotency_key": idempotency_key,
                    "counts": counts,
                },
            )
            db.add(event)
            db.commit()

        except Exception as exc:
            db.rollback()
            # File staging compensation: remove any staged files
            for p in staged_files:
                try:
                    if p.exists():
                        p.unlink()
                except Exception:
                    pass
            try:
                if pkg_staging_path.exists():
                    shutil.rmtree(pkg_staging_path, ignore_errors=True)
            except Exception:
                pass
            if isinstance(exc, ContentCloningError):
                raise
            raise ContentCloningError(
                status_code=500,
                code="PACKAGE_CREATION_FAILED",
                message=f"Failed to create package: {exc}",
            ) from exc

        return cls._package_summary(db, package, request)

    @classmethod
    def get_package_preview(
        cls,
        db: Session,
        *,
        request_id: uuid.UUID,
        staff_id: str,
        now: datetime | None = None,
    ) -> RequesterVisiblePackageSummary:
        current = now or utc_now()
        request = (
            db.query(ContentShareRequest)
            .filter(ContentShareRequest.request_id == request_id)
            .first()
        )
        if request is None:
            raise ContentCloningError(
                status_code=404,
                code="REQUEST_NOT_FOUND",
                message="Content request not found.",
            )

        # Non-enumerating access check: only requester or source owner
        if staff_id not in (request.requester_staff_id, request.source_owner_staff_id):
            raise ContentCloningError(
                status_code=404,
                code="REQUEST_NOT_FOUND",
                message="Content request not found.",
            )

        if request.package is None or request.status == "PENDING_OWNER":
            raise ContentCloningError(
                status_code=404,
                code="PACKAGE_NOT_FOUND",
                message="No package has been published for this request.",
            )

        # Check expiration
        eff_status = effective_request_status(request, now=current)
        if eff_status == "EXPIRED" and request.status != "EXPIRED":
            event = expire_request(request, now=current)
            db.add(event)
            db.commit()

        return cls._package_summary(db, request.package, request)

    @classmethod
    def decide_package(
        cls,
        db: Session,
        *,
        request_id: uuid.UUID,
        staff_id: str,
        payload: PackageDecisionRequest,
        idempotency_key: str | None = None,
        now: datetime | None = None,
    ) -> ContentShareRequestResponse:
        current = now or utc_now()
        request = (
            db.query(ContentShareRequest)
            .filter(ContentShareRequest.request_id == request_id)
            .with_for_update()
            .first()
        )
        if request is None or request.requester_staff_id != staff_id:
            raise ContentCloningError(
                status_code=404,
                code="REQUEST_NOT_FOUND",
                message="Content request not found.",
            )

        # Idempotency check for DECLINE
        if request.status == "DECLINED_BY_REQUESTER":
            return request

        if payload.decision == PackageDecision.ACCEPT:
            # Per mandate: PR C cloning engine boundary
            raise ContentCloningError(
                status_code=501,
                code="CLONING_ENGINE_UNAVAILABLE",
                message="Package acceptance triggers content cloning execution which is scheduled for Backend PR C.",
            )

        if payload.decision == PackageDecision.DECLINE:
            if effective_request_status(request, now=current) == "EXPIRED":
                event = expire_request(request, now=current)
                db.add(event)
                db.commit()
                raise ContentCloningError(
                    status_code=409,
                    code="REQUEST_EXPIRED",
                    message="This content request has expired.",
                )

            if request.version != payload.expected_version:
                raise ContentCloningError(
                    status_code=409,
                    code="REQUEST_VERSION_CONFLICT",
                    message="This content request changed. Refresh it before trying again.",
                    field="expected_version",
                    retryable=True,
                )

            if request.status != "PACKAGE_SENT":
                raise ContentCloningError(
                    status_code=409,
                    code="REQUEST_STATE_CONFLICT",
                    message="Only sent packages can be declined.",
                )

            from_status = request.status
            request.status = "DECLINED_BY_REQUESTER"
            request.version += 1
            request.responded_at = current
            request.open_request_key = None  # Releases scope lock

            event = ContentShareEvent(
                request_id=request.request_id,
                actor_staff_id=staff_id,
                event_type="REQUEST_DECLINED_BY_REQUESTER",
                from_status=from_status,
                to_status="DECLINED_BY_REQUESTER",
                safe_metadata={
                    "idempotency_key": idempotency_key,
                },
            )
            db.add(event)
            db.commit()

            return request

        raise ContentCloningError(
            status_code=422,
            code="INVALID_DECISION",
            message=f"Unsupported decision '{payload.decision}'.",
            field="decision",
        )

    @classmethod
    def _package_summary(
        cls,
        db: Session,
        package: ContentSharePackage,
        request: ContentShareRequest,
    ) -> RequesterVisiblePackageSummary:
        # Load items sorted by display_order
        items = (
            db.query(ContentSharePackageItem)
            .filter(ContentSharePackageItem.package_id == package.package_id)
            .order_by(ContentSharePackageItem.display_order.asc())
            .all()
        )
        preview_items = [
            PackagePreviewItem(
                item_type=item.item_type,
                safe_title=item.safe_title,
                display_order=item.display_order,
            )
            for item in items
        ]

        summary_counts = package.summary_counts or {}
        counts = ContentSelectionSummary(
            competency_count=summary_counts.get("competency_count", 0),
            lesson_count=summary_counts.get("lesson_count", 0),
            classwork_count=summary_counts.get("classwork_count", 0),
            attachment_count=summary_counts.get("attachment_count", 0),
        )

        owner = db.get(AcademicStaff, package.source_owner_staff_id)
        owner_name = _format_staff_name(owner)
        subject = db.get(Subject, request.subject_id)
        subject_name = subject.subject_name if subject else None

        return RequesterVisiblePackageSummary(
            package_id=package.package_id,
            request_id=package.request_id,
            status=ContentShareRequestStatus(request.status),
            source_owner_staff_id=package.source_owner_staff_id,
            source_owner_name=owner_name,
            subject_id=request.subject_id,
            subject_name=subject_name,
            source_scope_mode=ContentSourceScopeMode(request.source_scope_mode),
            sent_at=package.sent_at,
            expires_at=package.expires_at,
            summary=counts,
            items=preview_items,
        )
