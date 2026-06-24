from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.Dependencies import get_staff_id
from app.db.Session import get_db
from app.schemas.Quiz import QuizBuilderResponse, QuizBuilderUpsert, QuizReadinessResponse
from app.services.quiz.QuizBuilderService import (
    build_quiz_response,
    delete_quiz_builder,
    get_quiz_for_classwork,
    get_teacher_quiz_classwork,
    quiz_readiness,
    upsert_quiz_builder,
)


router = APIRouter()


@router.get("/classwork/{classwork_id}", response_model=QuizBuilderResponse)
def get_quiz_builder(
    classwork_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    classwork = get_teacher_quiz_classwork(db, staff_id, classwork_id)
    quiz = get_quiz_for_classwork(db, classwork_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz has not been created")
    return build_quiz_response(db, classwork, quiz)


@router.put("/classwork/{classwork_id}", response_model=QuizBuilderResponse)
def upsert_quiz(
    classwork_id: int,
    body: QuizBuilderUpsert,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    classwork = get_teacher_quiz_classwork(db, staff_id, classwork_id)
    try:
        response = upsert_quiz_builder(db, classwork, body)
        db.commit()
        return response
    except Exception:
        db.rollback()
        raise


@router.delete("/classwork/{classwork_id}")
def delete_quiz(
    classwork_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    classwork = get_teacher_quiz_classwork(db, staff_id, classwork_id)
    try:
        delete_quiz_builder(db, classwork)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"message": "Quiz builder reset", "classwork_id": classwork_id}


@router.get("/classwork/{classwork_id}/readiness", response_model=QuizReadinessResponse)
def get_quiz_readiness(
    classwork_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    classwork = get_teacher_quiz_classwork(db, staff_id, classwork_id)
    return quiz_readiness(db, classwork)
