from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.Dependencies import get_staff_id, get_student_record, require_role
from app.db.Session import get_db
from app.schemas.lesson_delivery import (
    LessonDeliveryConfirmRequest,
    LessonDeliveryCorrectionRequest,
    LessonDeliveryResponse,
    LessonDeliveryStatusResponse,
)
from app.services.academic.ContentAuthorizationService import resolve_content_staff_id
from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService
from app.services.lesson.LessonDeliveryService import (
    build_delivery_response,
    confirm_lesson_delivery,
    correct_lesson_delivery,
    get_active_deliveries_as_of,
    get_lesson_delivery_status,
)
from app.services.lesson.LessonShared import ensure_student_enrolled

router = APIRouter()


@router.post("/confirm", response_model=LessonDeliveryResponse, status_code=status.HTTP_200_OK)
def confirm_delivery(
    body: LessonDeliveryConfirmRequest,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """Confirm that a lesson has been delivered to a class in a grading period."""
    delivery = confirm_lesson_delivery(
        db=db,
        lesson_id=body.lesson_id,
        class_id=body.class_id,
        subject_id=body.subject_id,
        academic_period_id=body.academic_period_id,
        staff_id=staff_id,
    )
    return build_delivery_response(delivery)


@router.put("/{delivery_id}/correct", response_model=LessonDeliveryResponse)
def correct_delivery(
    delivery_id: int,
    body: LessonDeliveryCorrectionRequest,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """Correct or revoke a teacher-confirmed lesson delivery with audit note."""
    delivery = correct_lesson_delivery(
        db=db,
        delivery_id=delivery_id,
        reason=body.reason,
        staff_id=staff_id,
    )
    return build_delivery_response(delivery)


@router.get(
    "/class/{class_id}/subject/{subject_id}",
    response_model=List[LessonDeliveryResponse],
)
def list_class_subject_deliveries(
    class_id: int,
    subject_id: int,
    academic_period_id: int = Query(..., description="Grading period / term ID"),
    as_of: Optional[datetime] = Query(None, description="Optional historical cutoff timestamp"),
    current_user: dict = Depends(require_role("teacher", "admin", "student")),
    db: Session = Depends(get_db),
):
    """List verified lesson deliveries for a class and subject in a grading period."""
    role = current_user.get("role")
    if role == "student":
        student = get_student_record(current_user, db)
        ensure_student_enrolled(db, student.student_id, class_id)
    elif role == "teacher":
        staff_id = resolve_content_staff_id(db, current_user)
        SubjectLoadAuthorizationService.assert_can_view(
            db, staff_id, class_id, subject_id, academic_period_id,
        )

    deliveries = get_active_deliveries_as_of(
        db=db,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
        as_of=as_of,
    )
    return [build_delivery_response(d) for d in deliveries]


@router.get(
    "/class/{class_id}/subject/{subject_id}/lesson/{lesson_id}",
    response_model=LessonDeliveryStatusResponse,
)
def get_lesson_delivery(
    class_id: int,
    subject_id: int,
    lesson_id: int,
    academic_period_id: int = Query(..., description="Grading period / term ID"),
    current_user: dict = Depends(require_role("teacher", "admin", "student")),
    db: Session = Depends(get_db),
):
    """Get the current delivery status and full audit history for a single lesson."""
    role = current_user.get("role")
    if role == "student":
        student = get_student_record(current_user, db)
        ensure_student_enrolled(db, student.student_id, class_id)
    elif role == "teacher":
        staff_id = resolve_content_staff_id(db, current_user)
        SubjectLoadAuthorizationService.assert_can_view(
            db, staff_id, class_id, subject_id, academic_period_id,
        )

    return get_lesson_delivery_status(
        db=db,
        lesson_id=lesson_id,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
    )
