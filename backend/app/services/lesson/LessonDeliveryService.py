"""Teacher-verified lesson delivery service.

Establishes reliable evidence of which lessons have actually been taught,
scoped strictly by class, subject, and grading period, with full auditability
and frozen intervention evidence protection.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonDelivery import LessonDelivery
from app.models.academic.Subject import Subject
from app.models.intervention.Intervention import Intervention
from app.schemas.lesson_delivery import LessonDeliveryResponse, LessonDeliveryStatusResponse
from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _validate_academic_scope(
    db: Session,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
) -> tuple[Class, Subject, AcademicPeriod]:
    class_obj = db.get(Class, class_id)
    if not class_obj:
        raise HTTPException(status_code=404, detail="Class not found")

    subject_obj = db.get(Subject, subject_id)
    if not subject_obj:
        raise HTTPException(status_code=404, detail="Subject not found")

    period_obj = db.get(AcademicPeriod, academic_period_id)
    if not period_obj:
        raise HTTPException(status_code=404, detail="Academic period not found")

    if class_obj.academic_year_id != period_obj.academic_year_id:
        raise HTTPException(
            status_code=409,
            detail="Class and academic period belong to different academic years",
        )

    return class_obj, subject_obj, period_obj


def _validate_lesson_and_assignment(
    db: Session,
    lesson_id: int,
    class_id: int,
    subject_id: int,
) -> Lesson:
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")

    if lesson.subject_id != subject_id:
        raise HTTPException(
            status_code=422,
            detail="Lesson does not belong to the specified subject",
        )

    if lesson.is_archived:
        raise HTTPException(
            status_code=422,
            detail="Cannot record delivery of an archived lesson",
        )

    # If the lesson is assigned to specific classes, it must be assigned to this class.
    if lesson.assignments:
        assigned_here = any(a.class_id == class_id for a in lesson.assignments)
        if not assigned_here:
            raise HTTPException(
                status_code=403,
                detail="Lesson is not assigned to this class",
            )

    return lesson


def _assert_no_frozen_intervention_conflict(
    db: Session,
    delivery: LessonDelivery,
) -> None:
    """Prevent retroactive changes to lessons frozen in intervention evidence."""
    interventions = (
        db.query(Intervention)
        .filter(
            Intervention.class_id == delivery.class_id,
            Intervention.subject_id == delivery.subject_id,
            Intervention.academic_period_id == delivery.academic_period_id,
            Intervention.status.in_(["CANDIDATE", "ACTIVE", "RESOLVED"]),
        )
        .all()
    )

    delivery_time = _utc(delivery.delivered_at)

    for intervention in interventions:
        snapshot = intervention.diagnosis_snapshot if isinstance(intervention.diagnosis_snapshot, dict) else {}
        cutoff_text = snapshot.get("evidence_cutoff_at")
        if cutoff_text:
            try:
                cutoff = _utc(datetime.fromisoformat(cutoff_text))
            except (ValueError, TypeError):
                cutoff = None

            # Only evaluate if delivery occurred prior to or at the frozen cutoff
            if cutoff is None or delivery_time <= cutoff:
                # Check supporting activities
                for act in snapshot.get("supporting_activities") or []:
                    if act.get("lesson_id") == delivery.lesson_id:
                        raise HTTPException(
                            status_code=409,
                            detail=f"Cannot alter delivery of lesson {delivery.lesson_id} referenced in frozen intervention evidence",
                        )

                # Check lowest supported competencies supporting scores
                for comp in snapshot.get("lowest_supported_competencies") or []:
                    for score in comp.get("supporting_scores") or []:
                        if score.get("lesson_id") == delivery.lesson_id:
                            raise HTTPException(
                                status_code=409,
                                detail=f"Cannot alter delivery of lesson {delivery.lesson_id} referenced in frozen intervention evidence",
                            )

                # Check manual assessment coverage
                for cov in snapshot.get("manual_assessment_coverage") or []:
                    for covered in cov.get("covered_lessons") or []:
                        if covered.get("lesson_id") == delivery.lesson_id:
                            raise HTTPException(
                                status_code=409,
                                detail=f"Cannot alter delivery of lesson {delivery.lesson_id} referenced in frozen intervention evidence",
                            )

        # Check remediation plan resources
        plan = intervention.remediation_plan if isinstance(intervention.remediation_plan, dict) else {}
        for res in plan.get("selected_resources") or []:
            if isinstance(res, dict) and res.get("kind") == "LESSON" and res.get("id") == delivery.lesson_id:
                raise HTTPException(
                    status_code=409,
                    detail=f"Cannot alter delivery of lesson {delivery.lesson_id} referenced in intervention remediation plan",
                )


def confirm_lesson_delivery(
    db: Session,
    lesson_id: int,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
    staff_id: str,
) -> LessonDelivery:
    """Confirm that a lesson was delivered/taught.
    
    Idempotent: Repeated requests for an already active delivery return
    the existing record without error.
    """
    _validate_academic_scope(db, class_id, subject_id, academic_period_id)
    _validate_lesson_and_assignment(db, lesson_id, class_id, subject_id)

    # Authorize teacher write access for this class, subject, and period
    SubjectLoadAuthorizationService.assert_can_write(
        db, staff_id, class_id, subject_id, academic_period_id,
    )

    # Idempotency check: return existing active delivery if already confirmed
    existing = (
        db.query(LessonDelivery)
        .filter(
            LessonDelivery.lesson_id == lesson_id,
            LessonDelivery.class_id == class_id,
            LessonDelivery.subject_id == subject_id,
            LessonDelivery.academic_period_id == academic_period_id,
            LessonDelivery.revoked_at.is_(None),
        )
        .first()
    )
    if existing:
        return existing

    server_now = datetime.now(timezone.utc)
    delivery = LessonDelivery(
        lesson_id=lesson_id,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
        delivered_by_staff_id=staff_id,
        delivered_at=server_now,
    )
    db.add(delivery)
    db.commit()
    db.refresh(delivery)
    return delivery


def correct_lesson_delivery(
    db: Session,
    delivery_id: int,
    reason: str,
    staff_id: str,
) -> LessonDelivery:
    """Correct or revoke a teacher-confirmed lesson delivery with full audit trail."""
    delivery = db.get(LessonDelivery, delivery_id)
    if not delivery:
        raise HTTPException(status_code=404, detail="Lesson delivery record not found")

    if delivery.revoked_at is not None:
        raise HTTPException(
            status_code=409,
            detail="Lesson delivery record has already been revoked or corrected",
        )

    # Authorize teacher write access
    SubjectLoadAuthorizationService.assert_can_write(
        db, staff_id, delivery.class_id, delivery.subject_id, delivery.academic_period_id,
    )

    # Prevent retroactive changes to frozen intervention evidence
    _assert_no_frozen_intervention_conflict(db, delivery)

    cleaned_reason = reason.strip()
    if len(cleaned_reason) < 3:
        raise HTTPException(status_code=422, detail="A valid correction reason is required")

    server_now = datetime.now(timezone.utc)
    delivery.revoked_at = server_now
    delivery.revoked_by_staff_id = staff_id
    delivery.correction_reason = cleaned_reason

    db.commit()
    db.refresh(delivery)
    return delivery


def get_active_deliveries_as_of(
    db: Session,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
    as_of: datetime | None = None,
) -> list[LessonDelivery]:
    """Return all lesson deliveries active in the scope at a historical cutoff or current time."""
    query = (
        db.query(LessonDelivery)
        .filter(
            LessonDelivery.class_id == class_id,
            LessonDelivery.subject_id == subject_id,
            LessonDelivery.academic_period_id == academic_period_id,
        )
    )
    if as_of is None:
        query = query.filter(LessonDelivery.revoked_at.is_(None))
    else:
        as_of_utc = _utc(as_of)
        query = query.filter(
            LessonDelivery.delivered_at <= as_of_utc,
            or_(
                LessonDelivery.revoked_at.is_(None),
                LessonDelivery.revoked_at > as_of_utc,
            ),
        )
    return query.order_by(LessonDelivery.delivered_at.asc()).all()


def get_delivered_lesson_ids_as_of(
    db: Session,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
    as_of: datetime | None = None,
) -> set[int]:
    """Return lesson IDs that have verified active delivery as of the specified cutoff."""
    deliveries = get_active_deliveries_as_of(
        db, class_id, subject_id, academic_period_id, as_of=as_of,
    )
    return {d.lesson_id for d in deliveries}


def is_lesson_delivered_as_of(
    db: Session,
    lesson_id: int,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
    as_of: datetime | None = None,
) -> bool:
    """Check if a specific lesson has verified active delivery as of the specified cutoff."""
    delivered_ids = get_delivered_lesson_ids_as_of(
        db, class_id, subject_id, academic_period_id, as_of=as_of,
    )
    return lesson_id in delivered_ids


def get_delivery_history(
    db: Session,
    lesson_id: int,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
) -> list[LessonDelivery]:
    """Return the entire audit history (active and revoked) for a lesson in a class/period."""
    return (
        db.query(LessonDelivery)
        .filter(
            LessonDelivery.lesson_id == lesson_id,
            LessonDelivery.class_id == class_id,
            LessonDelivery.subject_id == subject_id,
            LessonDelivery.academic_period_id == academic_period_id,
        )
        .order_by(LessonDelivery.delivered_at.desc())
        .all()
    )


def build_delivery_response(delivery: LessonDelivery) -> LessonDeliveryResponse:
    lesson_title = delivery.lesson.title if delivery.lesson else None
    return LessonDeliveryResponse(
        delivery_id=delivery.delivery_id,
        lesson_id=delivery.lesson_id,
        lesson_title=lesson_title,
        class_id=delivery.class_id,
        subject_id=delivery.subject_id,
        academic_period_id=delivery.academic_period_id,
        delivered_by_staff_id=delivery.delivered_by_staff_id,
        delivered_at=delivery.delivered_at,
        is_active=delivery.revoked_at is None,
        revoked_at=delivery.revoked_at,
        revoked_by_staff_id=delivery.revoked_by_staff_id,
        correction_reason=delivery.correction_reason,
        created_at=delivery.created_at,
    )


def get_lesson_delivery_status(
    db: Session,
    lesson_id: int,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
) -> LessonDeliveryStatusResponse:
    history = get_delivery_history(db, lesson_id, class_id, subject_id, academic_period_id)
    active = next((d for d in history if d.revoked_at is None), None)

    return LessonDeliveryStatusResponse(
        lesson_id=lesson_id,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
        is_delivered=active is not None,
        active_delivery=build_delivery_response(active) if active else None,
        history=[build_delivery_response(d) for d in history],
    )
