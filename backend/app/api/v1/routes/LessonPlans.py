from typing import List
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.Dependencies import get_staff_id
from app.db.Session import get_db
from app.schemas.LessonPlan import LessonPlanCreate, LessonPlanUpdate, LessonPlanResponse
from app.services.academic.LessonPlanService import (
    create_lesson_plan,
    get_teacher_lesson_plans,
    get_lesson_plan_by_id,
    update_lesson_plan,
    delete_lesson_plan,
)

router = APIRouter()

@router.post("", response_model=LessonPlanResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=LessonPlanResponse, status_code=status.HTTP_201_CREATED)
def create_plan(
    payload: LessonPlanCreate,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return create_lesson_plan(db, staff_id, payload)

@router.get("", response_model=List[LessonPlanResponse])
@router.get("/", response_model=List[LessonPlanResponse])
def get_plans(
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return get_teacher_lesson_plans(db, staff_id)

@router.get("/{plan_id}", response_model=LessonPlanResponse)
def get_plan(
    plan_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return get_lesson_plan_by_id(db, staff_id, plan_id)

@router.put("/{plan_id}", response_model=LessonPlanResponse)
def update_plan(
    plan_id: int,
    payload: LessonPlanUpdate,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return update_lesson_plan(db, staff_id, plan_id, payload)

@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan(
    plan_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    delete_lesson_plan(db, staff_id, plan_id)
    return None
