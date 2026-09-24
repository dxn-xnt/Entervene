from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.people.AcademicStaff import AcademicStaff
from app.services.academic.SubjectLoadAuthorizationService import (
    SubjectLoadAuthorizationService,
)


@dataclass(frozen=True)
class V3PredictionScopeAccess:
    role: str
    staff_id: str | None
    require_active_enrollment: bool


def _teacher_staff_id(db: Session, current_user: dict) -> str:
    raw_user_id = current_user.get("sub") or current_user.get("user_id")
    try:
        user_id = UUID(str(raw_user_id))
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="A teacher profile is required to access development predictions.",
        )

    staff_id = (
        db.query(AcademicStaff.staff_id)
        .filter(AcademicStaff.user_id == user_id)
        .scalar()
    )
    if not staff_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="A teacher profile is required to access development predictions.",
        )
    return staff_id


def authorize_v3_prediction_view(
    db: Session,
    current_user: dict,
    *,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
) -> V3PredictionScopeAccess:
    role = current_user.get("role")
    if role == "admin":
        return V3PredictionScopeAccess(
            role="admin",
            staff_id=None,
            require_active_enrollment=False,
        )
    if role != "teacher":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    staff_id = _teacher_staff_id(db, current_user)
    SubjectLoadAuthorizationService.assert_can_view(
        db,
        staff_id,
        class_id,
        subject_id,
        academic_period_id,
    )
    return V3PredictionScopeAccess(
        role="teacher",
        staff_id=staff_id,
        require_active_enrollment=True,
    )


def authorize_v3_prediction_write(
    db: Session,
    current_user: dict,
    *,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
) -> V3PredictionScopeAccess:
    role = current_user.get("role")
    if role == "admin":
        return V3PredictionScopeAccess(
            role="admin",
            staff_id=None,
            require_active_enrollment=False,
        )
    if role != "teacher":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    staff_id = _teacher_staff_id(db, current_user)
    SubjectLoadAuthorizationService.assert_can_write(
        db,
        staff_id,
        class_id,
        subject_id,
        academic_period_id,
    )
    return V3PredictionScopeAccess(
        role="teacher",
        staff_id=staff_id,
        require_active_enrollment=True,
    )
