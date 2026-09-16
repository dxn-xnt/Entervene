from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.Dependencies import get_current_user, get_optional_staff_id, require_role
from app.db.Session import get_db
from app.schemas.lesson_goal import LessonGoalResponse, LessonGoalSetRequest
from app.services.lesson.LessonGoalService import (
    clear_curated_lesson_goal,
    get_curated_lesson_goal,
    save_curated_lesson_goal,
)

router = APIRouter()


@router.get("/class/{class_id}/subject/{subject_id}", response_model=LessonGoalResponse)
def get_lesson_goals(
    class_id: int,
    subject_id: int,
    academic_period_id: Optional[int] = Query(None, description="Optional academic period / term ID"),
    current_user: dict = Depends(require_role("teacher", "student", "admin")),
    db: Session = Depends(get_db),
):
    return get_curated_lesson_goal(
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
        current_user=current_user,
        db=db,
    )


@router.put("/class/{class_id}/subject/{subject_id}", response_model=LessonGoalResponse)
def update_lesson_goals(
    class_id: int,
    subject_id: int,
    body: LessonGoalSetRequest,
    current_user: dict = Depends(require_role("teacher", "admin")),
    staff_id: Optional[str] = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    return save_curated_lesson_goal(
        class_id=class_id,
        subject_id=subject_id,
        request=body,
        staff_id=staff_id,
        current_user=current_user,
        db=db,
    )


@router.delete("/class/{class_id}/subject/{subject_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lesson_goals(
    class_id: int,
    subject_id: int,
    academic_period_id: int = Query(..., description="Academic period / term ID"),
    current_user: dict = Depends(require_role("teacher", "admin")),
    db: Session = Depends(get_db),
):
    clear_curated_lesson_goal(
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
        db=db,
    )
