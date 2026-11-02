"""API endpoints for Intervention Practice Assessments.

Provides teacher assessment management, question CRUD, AI generation, and quiz import,
as well as student attempt execution, automatic scoring, diagnostic feedback review,
and progression evaluation.
"""

from __future__ import annotations

from typing import Any
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.api.v1.routes.TeacherInterventions import (
    require_development_intervention_api,
    require_intervention_teacher,
)
from app.core.Dependencies import get_staff_id, get_student_record, require_role
from app.db.Session import get_db
from app.models.intervention.Intervention import Intervention
from app.models.intervention.PracticeQuestion import PracticeQuestion
from app.models.people.Student import Student
from app.schemas.PracticeAssessment import (
    AIGeneratePracticeQuestionsRequest,
    PracticeAssessmentCreate,
    PracticeAssessmentRead,
    PracticeAssessmentUpdate,
    PracticeAttemptFeedbackResponse,
    PracticeAttemptStartResponse,
    PracticeAttemptSubmitRequest,
    PracticeAttemptSummary,
    PracticeOptionRead,
    PracticeProgressionEvaluation,
    PracticeQuestionBatchSave,
    PracticeQuestionCreate,
    PracticeQuestionRead,
    PracticeQuestionsImportPreviewResponse,
    PracticeQuestionsReorderRequest,
    PracticeQuestionUpdate,
)
from app.services.intervention.PracticeAssessmentAIService import (
    generate_practice_questions_ai,
)
from app.services.intervention.PracticeAssessmentImportService import (
    preview_practice_quiz_import,
)
from app.services.intervention.PracticeAssessmentService import (
    add_question,
    archive_assessment,
    batch_save_questions,
    delete_question,
    evaluate_practice_progression,
    format_assessment_read,
    get_assessment,
    get_attempt_feedback,
    get_or_create_assessment,
    get_student_assessment_metadata,
    list_student_attempts,
    list_teacher_attempts,
    publish_assessment,
    reorder_questions,
    start_or_resume_attempt,
    submit_attempt,
    update_assessment_config,
    update_question,
)


def _format_question_read(q: PracticeQuestion) -> PracticeQuestionRead:
    opts = sorted(q.options, key=lambda o: o.option_order)
    return PracticeQuestionRead(
        practice_question_id=q.practice_question_id,
        version=q.version,
        question_text=q.question_text,
        question_type=q.question_type,
        points=q.points,
        explanation=q.explanation,
        display_order=q.display_order,
        is_ai_generated=q.is_ai_generated,
        options=[PracticeOptionRead.model_validate(opt) for opt in opts],
    )


# ---------------------------------------------------------------------------
# Teacher Practice Assessment Router
# ---------------------------------------------------------------------------

teacher_practice_router = APIRouter(
    dependencies=[Depends(require_development_intervention_api)],
)


@teacher_practice_router.get("", response_model=PracticeAssessmentRead)
def read_teacher_assessment(
    intervention_id: int,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    assessment = get_assessment(db, staff_id, intervention_id)
    return format_assessment_read(assessment)


@teacher_practice_router.post("", response_model=PracticeAssessmentRead)
def initialize_teacher_assessment(
    intervention_id: int,
    payload: PracticeAssessmentCreate | None = None,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    assessment = get_or_create_assessment(db, staff_id, intervention_id, payload)
    return format_assessment_read(assessment)


@teacher_practice_router.patch("", response_model=PracticeAssessmentRead)
def update_teacher_assessment_config(
    intervention_id: int,
    payload: PracticeAssessmentUpdate,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    assessment = update_assessment_config(db, staff_id, intervention_id, payload)
    return format_assessment_read(assessment)


@teacher_practice_router.post("/publish", response_model=PracticeAssessmentRead)
def publish_teacher_assessment(
    intervention_id: int,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    assessment = publish_assessment(db, staff_id, intervention_id)
    return format_assessment_read(assessment)


@teacher_practice_router.post("/archive", response_model=PracticeAssessmentRead)
def archive_teacher_assessment(
    intervention_id: int,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    assessment = archive_assessment(db, staff_id, intervention_id)
    return format_assessment_read(assessment)


@teacher_practice_router.post("/questions", response_model=PracticeQuestionRead)
def add_draft_question(
    intervention_id: int,
    payload: PracticeQuestionCreate,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    question = add_question(db, staff_id, intervention_id, payload)
    return _format_question_read(question)


@teacher_practice_router.patch("/questions/{question_id}", response_model=PracticeQuestionRead)
def update_draft_question(
    intervention_id: int,
    question_id: int,
    payload: PracticeQuestionUpdate,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    question = update_question(db, staff_id, intervention_id, question_id, payload)
    return _format_question_read(question)


@teacher_practice_router.delete("/questions/{question_id}")
def delete_draft_question(
    intervention_id: int,
    question_id: int,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    delete_question(db, staff_id, intervention_id, question_id)
    return {"ok": True}


@teacher_practice_router.post("/questions/reorder", response_model=list[PracticeQuestionRead])
def reorder_draft_questions(
    intervention_id: int,
    payload: PracticeQuestionsReorderRequest,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    questions = reorder_questions(db, staff_id, intervention_id, payload.ordered_question_ids)
    return [_format_question_read(q) for q in questions]


@teacher_practice_router.post("/questions/batch", response_model=list[PracticeQuestionRead])
def batch_save_draft_questions(
    intervention_id: int,
    payload: PracticeQuestionBatchSave,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    questions = batch_save_questions(db, staff_id, intervention_id, payload)
    return [_format_question_read(q) for q in questions]


@teacher_practice_router.post("/ai-generate", response_model=list[PracticeQuestionCreate])
async def generate_questions_ai(
    intervention_id: int,
    payload: AIGeneratePracticeQuestionsRequest,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return await generate_practice_questions_ai(db, staff_id, intervention_id, payload)


@teacher_practice_router.post("/import", response_model=PracticeQuestionsImportPreviewResponse)
async def import_questions_preview(
    intervention_id: int,
    file: UploadFile = File(...),
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    # Authorization verify
    get_assessment(db, staff_id, intervention_id)
    return await preview_practice_quiz_import(file)


@teacher_practice_router.get("/attempts", response_model=list[PracticeAttemptSummary])
def list_attempts_teacher(
    intervention_id: int,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return list_teacher_attempts(db, staff_id, intervention_id)


@teacher_practice_router.get("/attempts/{attempt_id}/feedback", response_model=PracticeAttemptFeedbackResponse)
def get_attempt_feedback_teacher(
    intervention_id: int,
    attempt_id: int,
    teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return get_attempt_feedback(db, teacher, intervention_id, attempt_id)


@teacher_practice_router.get("/progression", response_model=PracticeProgressionEvaluation)
def get_progression_teacher(
    intervention_id: int,
    _teacher: dict = Depends(require_intervention_teacher),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    intervention = db.get(Intervention, intervention_id)
    if intervention is None:
        raise HTTPException(status_code=404, detail="Intervention not found")
    return evaluate_practice_progression(db, intervention_id, intervention.student_id)


# ---------------------------------------------------------------------------
# Student Practice Assessment Router
# ---------------------------------------------------------------------------

student_practice_router = APIRouter(
    dependencies=[Depends(require_development_intervention_api)],
)


@student_practice_router.get("")
def read_student_assessment_metadata(
    intervention_id: int,
    student: Student = Depends(get_student_record),
    db: Session = Depends(get_db),
):
    return get_student_assessment_metadata(db, student.student_id, intervention_id)


@student_practice_router.post("/start", response_model=PracticeAttemptStartResponse)
def start_practice_attempt(
    intervention_id: int,
    student: Student = Depends(get_student_record),
    db: Session = Depends(get_db),
):
    return start_or_resume_attempt(db, student.student_id, intervention_id)


@student_practice_router.post("/attempts/{attempt_id}/submit", response_model=PracticeAttemptFeedbackResponse)
def submit_practice_attempt(
    intervention_id: int,
    attempt_id: int,
    payload: PracticeAttemptSubmitRequest,
    student: Student = Depends(get_student_record),
    db: Session = Depends(get_db),
):
    return submit_attempt(db, student.student_id, intervention_id, attempt_id, payload)


@student_practice_router.get("/attempts", response_model=list[PracticeAttemptSummary])
def list_student_attempts_endpoint(
    intervention_id: int,
    student: Student = Depends(get_student_record),
    db: Session = Depends(get_db),
):
    return list_student_attempts(db, student.student_id, intervention_id)


@student_practice_router.get("/attempts/{attempt_id}/feedback", response_model=PracticeAttemptFeedbackResponse)
def get_attempt_feedback_student(
    intervention_id: int,
    attempt_id: int,
    student: Student = Depends(get_student_record),
    current_user: dict = Depends(require_role("student")),
    db: Session = Depends(get_db),
):
    return get_attempt_feedback(db, current_user, intervention_id, attempt_id)


@student_practice_router.get("/progression", response_model=PracticeProgressionEvaluation)
def get_progression_student(
    intervention_id: int,
    student: Student = Depends(get_student_record),
    db: Session = Depends(get_db),
):
    return evaluate_practice_progression(db, intervention_id, student.student_id)

