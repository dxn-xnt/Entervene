from typing import Optional
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.Dependencies import get_staff_id, require_role
from app.core.Config import settings
from app.services.ai.UsageGuard import actor, staff_usage_snapshot, usage_snapshot, fill_missing_usage
from starlette.concurrency import run_in_threadpool
from app.db.Session import get_db
from app.models.academic.Lesson import Lesson
from app.models.academic.Subject import Subject
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.schemas.AIQuiz import AIQuizGenerateRequest, AIQuizGenerateResponse
from app.schemas.AITOS import (
    AITOSAssistRequest,
    AITOSAssistResponse,
    AITOSGenerateRequest,
    AITOSGenerateResponse,
    AITOSRepairRequest,
    AITOSRepairResponse,
    TOSRowRequest,
    TOSQuestionIn,
)
from app.schemas.Quiz import QuizQuestionIn
from app.services.academic.LessonPlanAIService import AISuggestField, generate_lesson_plan_suggestion
from app.services.ai.AIQuizGeneratorService import generate_quiz_questions
from app.services.ai.AITOSAssistService import handle_tos_assist
from app.services.ai.tos_generation import generate_tos_row_questions, blueprint_cells, missing_cells
from app.services.ai.tos_generation_session import exam_generation
from app.models.tos.TOSExam import TOSExam
from app.services.tos.TOSService import get_tos_exam_detail, append_tos_questions

async def ai_identity(staff_id: str = Depends(get_staff_id)):
    token = actor.set(str(staff_id))
    try:
        yield
    finally:
        actor.reset(token)


router = APIRouter()


@router.get("/usage")
async def ai_usage(user: dict = Depends(require_role("admin"))):
    return await run_in_threadpool(usage_snapshot)


@router.get("/my-usage")
async def my_ai_usage(staff_id: str = Depends(get_staff_id)):
    return await run_in_threadpool(staff_usage_snapshot, staff_id)


class AIAssistRequest(BaseModel):
    field: AISuggestField
    title: str = Field(default="", max_length=300)
    learning_area: str = Field(default="", max_length=200)
    grade_section: str = Field(default="", max_length=100)


class AIAssistResponse(BaseModel):
    suggestion: str


@router.post("/lesson-plan-assist", response_model=AIAssistResponse, dependencies=[Depends(ai_identity)])
async def lesson_plan_ai_assist(
    body: AIAssistRequest,
    staff_id: str = Depends(get_staff_id),
) -> AIAssistResponse:
    """
    Generate AI-powered suggestions for a specific lesson plan field.
    Powered by Google Gemini / Groq.
    """
    suggestion = await generate_lesson_plan_suggestion(
        field=body.field,
        title=body.title,
        learning_area=body.learning_area,
        grade_section=body.grade_section,
    )
    return AIAssistResponse(suggestion=suggestion)


@router.get("/reading-classworks")
def get_reading_classworks(
    subject_id: int = Query(..., description="Subject ID to fetch reading classworks for"),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    """
    Return all non-archived READING classworks for a subject, grouped by lesson.
    Used by the AI Quiz Generator's 'By Specific Readings' source mode.
    """
    rows = (
        db.query(
            Classwork.classwork_id,
            Classwork.title,
            Lesson.lesson_id,
            Lesson.title.label("lesson_title"),
        )
        .join(ClassworkLesson, ClassworkLesson.classwork_id == Classwork.classwork_id)
        .join(Lesson, Lesson.lesson_id == ClassworkLesson.lesson_id)
        .filter(
            Lesson.subject_id == subject_id,
            Lesson.created_by_staff_id == staff_id,
            Classwork.classwork_type == "READING",
            Classwork.is_archived == False,
        )
        .order_by(Lesson.title, Classwork.title)
        .all()
    )

    return [
        {
            "classwork_id": row.classwork_id,
            "title": row.title,
            "lesson_id": row.lesson_id,
            "lesson_title": row.lesson_title,
        }
        for row in rows
    ]


@router.post("/generate-quiz", response_model=AIQuizGenerateResponse, dependencies=[Depends(ai_identity)])
async def generate_quiz(
    body: AIQuizGenerateRequest,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
) -> AIQuizGenerateResponse:
    """
    Generate structured quiz questions using AI for a given subject.

    Source modes (mutually exclusive):
    - reading_classwork_ids: hand-picked specific reading classworks
    - lesson_ids: all reading classworks attached to selected lessons

    Both modes support an optional additional_coverage instruction string.
    Test parts now carry per-part difficulty_breakdown dicts.
    """
    subject = db.query(Subject).filter(Subject.subject_id == body.subject_id).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    lesson_titles: list[str] = []
    content_blocks: list[str] = []
    warnings: list[str] = []

    if body.reading_classwork_ids:
        # ── Mode B: specific reading classworks ──────────────────────────────
        classworks = (
            db.query(Classwork)
            .join(ClassworkLesson, ClassworkLesson.classwork_id == Classwork.classwork_id)
            .join(Lesson, Lesson.lesson_id == ClassworkLesson.lesson_id)
            .filter(
                Lesson.subject_id == body.subject_id,
                Lesson.created_by_staff_id == staff_id,
                Classwork.classwork_id.in_(body.reading_classwork_ids),
                Classwork.classwork_type == "READING",
                Classwork.is_archived == False,
            )
            .all()
        )
        found_ids = {cw.classwork_id for cw in classworks}
        missing_ids = set(body.reading_classwork_ids) - found_ids
        if missing_ids:
            warnings.append(f"Some selected readings were not found: {list(missing_ids)}")
        for cw in classworks:
            lesson_titles.append(cw.title)
            parts = [f"Reading Material: {cw.title}"]
            if cw.description:
                parts.append(cw.description)
            if cw.instructions:
                parts.append(cw.instructions)
            content_blocks.append("\n".join(parts))

    elif body.lesson_ids:
        # ── Mode A: full lessons ─────────────────────────────────────────────
        lessons = (
            db.query(Lesson)
            .filter(
                Lesson.lesson_id.in_(body.lesson_ids),
                Lesson.subject_id == body.subject_id,
                Lesson.created_by_staff_id == staff_id,
            )
            .all()
        )
        found_lesson_ids = {l.lesson_id for l in lessons}
        missing_ids = set(body.lesson_ids) - found_lesson_ids
        if missing_ids:
            warnings.append(f"Some selected lessons were not found: {list(missing_ids)}")

        for lesson in lessons:
            lesson_titles.append(lesson.title)
            if lesson.description:
                content_blocks.append(f"Lesson Topic ({lesson.title}):\n{lesson.description}")
            if lesson.content:
                content_blocks.append(f"Lesson Content ({lesson.title}):\n{lesson.content}")

        # Fetch attached Reading classworks for these lessons
        classworks = (
            db.query(Classwork)
            .join(ClassworkLesson, ClassworkLesson.classwork_id == Classwork.classwork_id)
            .filter(
                ClassworkLesson.lesson_id.in_(found_lesson_ids),
                Classwork.classwork_type == "READING",
                Classwork.is_archived == False,
            )
            .all()
        )
        for cw in classworks:
            cw_parts = [f"Attached Reading ({cw.title}):"]
            if cw.description:
                cw_parts.append(cw.description)
            if cw.instructions:
                cw_parts.append(cw.instructions)
            content_blocks.append("\n".join(cw_parts))

    # ── Additional coverage / teacher instructions ───────────────────────────
    if body.additional_coverage and body.additional_coverage.strip():
        content_blocks.append(
            f"Teacher's Additional Coverage / Instructions:\n{body.additional_coverage.strip()}"
        )

    combined_content = "\n\n".join(content_blocks)

    # Build test_parts list for the service (include difficulty_breakdown)
    test_parts = [
        {
            "type": part.type,
            "count": part.count,
            "points_per_item": part.points_per_item,
            "difficulty_breakdown": part.difficulty_breakdown,
        }
        for part in body.test_parts
    ]
    if not test_parts:
        test_parts = [{"type": "MULTIPLE_CHOICE", "count": 5, "points_per_item": 1.0, "difficulty_breakdown": {"EASY": 5}}]

    generated_raw = await generate_quiz_questions(
        subject=subject.subject_name,
        lessons=lesson_titles,
        content_text=combined_content,
        test_parts=test_parts,
        warnings=warnings,
    )

    questions = [QuizQuestionIn(**q) for q in generated_raw]
    return AIQuizGenerateResponse(questions=questions, warnings=warnings)



@router.post("/generate-tos-questions", response_model=AITOSGenerateResponse, dependencies=[Depends(ai_identity)])
async def generate_tos_questions(
    body: AITOSGenerateRequest,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
) -> AITOSGenerateResponse:
    """
    Generate structured TOS exam questions using AI, partitioned per competency row.
    Type counts and reconciled Bloom cells are repaired independently per row.
    """
    subject = db.query(Subject).filter(Subject.subject_id == body.subject_id).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    all_questions: list[TOSQuestionIn] = []
    warnings: list[str] = []
    running_display_order = 1

    requested = Counter()
    for row in body.rows:
        requested.update({kind: count for kind, count in row.type_counts.items() if count})
    async with exam_generation(staff_id, requested) as operation:
        for row in body.rows:
            try:
                row_raw_questions = await generate_tos_row_questions(
                    competency_label=row.label,
                    code=row.code,
                    subject=subject.subject_name,
                    type_counts=row.type_counts,
                    bloom_targets=row.bloom_targets,
                    language=body.language,
                    warnings=warnings,
                    passage=row.passage,
                    grade_level=getattr(getattr(subject, "academic_level", None), "grade_level", None),
                    existing_stems=[*body.existing_stems, *(q.question_text for q in all_questions)],
                )
                for q_data in row_raw_questions:
                    q_data["competency_id"] = row.competency_id
                    q_data["competency_label"] = row.label
                    q_data["display_order"] = running_display_order
                    running_display_order += 1
                    all_questions.append(TOSQuestionIn(**q_data))
            except HTTPException:
                # Provider retries are exhausted or a local guard rejected admission.
                raise
            except (ValueError, TypeError, KeyError):
                raise HTTPException(502, "AI returned invalid questions. Generation stopped.") from None
        operation.final = Counter(q.question_type for q in all_questions)
        operation.completed = True

    return AITOSGenerateResponse(questions=all_questions, warnings=warnings)


@router.post("/tos-exams/{tos_exam_id}/generate-missing", response_model=AITOSRepairResponse,
             dependencies=[Depends(ai_identity)])
async def generate_missing_tos_questions(
    tos_exam_id: int, body: AITOSRepairRequest,
    staff_id: str = Depends(get_staff_id),
    user: dict = Depends(require_role("teacher", "admin")),
    db: Session = Depends(get_db),
) -> AITOSRepairResponse:
    exam = db.query(TOSExam).filter(TOSExam.tos_exam_id == tos_exam_id).first()
    if exam is None:
        raise HTTPException(404, "TOS Exam not found")
    if user.get("role") != "admin" and exam.created_by_staff_id != staff_id:
        raise HTTPException(403, "You do not own this TOS exam")
    saved = get_tos_exam_detail(tos_exam_id, db)
    raw_rows = saved.difficulty_ratio.get("blueprint_rows")
    if not raw_rows:
        raise HTTPException(422, "Save the blueprint in the editor before generating missing items.")
    try:
        request = AITOSGenerateRequest(subject_id=saved.subject_id, subject_name="",
            language=body.language, rows=[TOSRowRequest.model_validate(row) for row in raw_rows])
    except ValueError:
        raise HTTPException(422, "The saved blueprint is invalid. Recalculate and save it first.") from None
    subject = db.query(Subject).filter(Subject.subject_id == saved.subject_id).first()
    if subject is None:
        raise HTTPException(404, "Subject not found")
    requested = Counter()
    for row in request.rows:
        requested.update({kind: count for kind, count in row.type_counts.items() if count})
    existing = [question.model_dump() for question in saved.questions]
    additions, warnings = [], []
    next_order = max((q.display_order for q in saved.questions), default=0) + 1
    free_fills_before = await run_in_threadpool(fill_missing_usage, tos_exam_id)
    async with exam_generation(staff_id, requested) as operation:
        operation.existing = Counter(q["question_type"] for q in existing)
        has_missing = any(missing_cells(blueprint_cells(row.type_counts, row.bloom_targets), [q for q in existing if
            (q["competency_id"] == row.competency_id if row.competency_id is not None else q["competency_label"] == row.label)])
            for row in request.rows)
        if has_missing:
            await operation.reserve_fill(tos_exam_id, len(existing) < sum(requested.values()))
        for row in request.rows:
            row_questions = [q for q in existing if
                (q["competency_id"] == row.competency_id if row.competency_id is not None
                 else q["competency_label"] == row.label)]
            targets = blueprint_cells(row.type_counts, row.bloom_targets)
            if not missing_cells(targets, row_questions):
                continue
            passage = next((q.passage for q in saved.questions if q.passage is not None and
                (q.competency_id == row.competency_id if row.competency_id is not None else q.competency_label == row.label)), None)
            new_questions = await generate_tos_row_questions(
                row.label, row.code, subject.subject_name, row.type_counts, row.bloom_targets,
                language=body.language, warnings=warnings, passage=passage or row.passage,
                grade_level=getattr(getattr(subject, "academic_level", None), "grade_level", None),
                existing_stems=[q["question_text"] for q in [*existing, *(q.model_dump() for q in additions)]],
                existing_questions=row_questions, target_cells=targets, missing_only=True,
            )
            for data in new_questions:
                data.update(competency_id=row.competency_id, competency_label=row.label, display_order=next_order)
                additions.append(TOSQuestionIn(**data))
                next_order += 1
        if additions:
            result = append_tos_questions(tos_exam_id, additions, saved.updated_at, db)
            final_questions = result.questions
        else:
            final_questions = saved.questions
        operation.final = Counter(q.question_type for q in final_questions)
        operation.billable_new_items = bool(additions)
        operation.completed = True
    return AITOSRepairResponse(questions=final_questions, warnings=warnings,
        added_count=len(additions), credits_charged=int(operation.credit_charged),
        free_fills_used=(operation.hold.free_fills_used + int(operation.hold.free and bool(additions))
                         if operation.hold is not None else free_fills_before),
        free_fill_limit=settings.tos_fill_missing_free_limit)


@router.post("/tos-assist", response_model=AITOSAssistResponse, dependencies=[Depends(ai_identity)])
async def tos_ai_assist(
    body: AITOSAssistRequest,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
) -> AITOSAssistResponse:
    """
    Generate AI suggestions for Table of Specifications (TOS) fields:
    - suggest_competencies: Suggest 3-4 curriculum competencies with days taught.
    - suggest_title: Suggest standardized DepEd exam title.
    - suggest_test_parts: Suggest balanced question type composition for target total items.
    """
    if body.subject_id and not body.subject_name:
        sub = db.query(Subject).filter(Subject.subject_id == body.subject_id).first()
        if sub:
            body.subject_name = sub.subject_name

    return await handle_tos_assist(body)
