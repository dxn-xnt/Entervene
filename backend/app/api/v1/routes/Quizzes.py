from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.Dependencies import get_staff_id, get_student_record
from app.db.Session import get_db
from app.schemas.Quiz import (
    QuizAnalysisResponse,
    QuizAttemptResponse,
    QuizBuilderResponse,
    QuizBuilderUpsert,
    QuizImportPreviewResponse,
    QuizReadinessResponse,
    QuizSubmitRequest,
)
from app.services.quiz.QuizAttemptService import (
    get_student_quiz_attempt,
    start_student_quiz_attempt,
    submit_student_quiz_attempt,
)
from app.services.quiz.QuizAnalysisService import build_teacher_quiz_analysis
from app.services.quiz.QuizBuilderService import (
    build_quiz_response,
    delete_quiz_builder,
    get_quiz_for_classwork,
    get_teacher_quiz_classwork,
    quiz_readiness,
    upsert_quiz_builder,
)
from app.services.quiz.QuizImportService import preview_quiz_import


router = APIRouter()


@router.post("/import-preview", response_model=QuizImportPreviewResponse)
async def import_quiz_preview(
    file: UploadFile = File(...),
    _: str = Depends(get_staff_id),
):
    return await preview_quiz_import(file)


@router.get("/assignment/{assignment_id}/attempt", response_model=QuizAttemptResponse)
def get_quiz_attempt(
    assignment_id: int,
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    return get_student_quiz_attempt(db, student, assignment_id)


@router.post("/assignment/{assignment_id}/start", response_model=QuizAttemptResponse)
def start_quiz_attempt(
    assignment_id: int,
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    return start_student_quiz_attempt(db, student, assignment_id)


@router.post("/assignment/{assignment_id}/submit", response_model=QuizAttemptResponse)
def submit_quiz_attempt(
    assignment_id: int,
    body: QuizSubmitRequest,
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    return submit_student_quiz_attempt(db, student, assignment_id, body)


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


@router.get("/classwork/{classwork_id}/analysis", response_model=QuizAnalysisResponse)
def get_quiz_analysis(
    classwork_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return build_teacher_quiz_analysis(db, staff_id, classwork_id)


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
