from typing import List, Optional
from fastapi import HTTPException
from sqlalchemy.orm import Session
from app.models.academic.LessonPlanModel import LessonPlanModel
from app.schemas.LessonPlan import LessonPlanCreate, LessonPlanUpdate, LessonPlanResponse

def create_lesson_plan(db: Session, staff_id: str, payload: LessonPlanCreate) -> LessonPlanModel:
    plan = LessonPlanModel(
        status=payload.status or "DRAFT",
        title=payload.title,
        learning_area=payload.learning_area,
        grade_section=payload.grade_section,
        date=payload.date,
        sessions=payload.sessions,
        references=payload.references,
        ai_declaration=payload.ai_declaration,
        intentions=payload.intentions,
        learning_experience=payload.learning_experience,
        assessment=payload.assessment,
        ways_forward=payload.ways_forward,
        teacher_id=staff_id,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan

def get_teacher_lesson_plans(db: Session, staff_id: str) -> List[LessonPlanModel]:
    return db.query(LessonPlanModel).filter(LessonPlanModel.teacher_id == staff_id).order_by(LessonPlanModel.updated_at.desc()).all()

def get_lesson_plan_by_id(db: Session, staff_id: str, plan_id: int) -> LessonPlanModel:
    plan = db.query(LessonPlanModel).filter(
        LessonPlanModel.plan_id == plan_id,
        LessonPlanModel.teacher_id == staff_id
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Lesson plan not found")
    return plan

def update_lesson_plan(db: Session, staff_id: str, plan_id: int, payload: LessonPlanUpdate) -> LessonPlanModel:
    plan = get_lesson_plan_by_id(db, staff_id, plan_id)
    
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(plan, field, value)

    db.commit()
    db.refresh(plan)
    return plan

def delete_lesson_plan(db: Session, staff_id: str, plan_id: int) -> bool:
    plan = get_lesson_plan_by_id(db, staff_id, plan_id)
    db.delete(plan)
    db.commit()
    return True
