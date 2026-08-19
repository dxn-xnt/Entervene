from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.Dependencies import get_staff_id
from app.db.Session import get_db
from app.models.academic.Lesson import Lesson
from app.models.academic.Subject import Subject
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.schemas.AIQuiz import AIQuizGenerateRequest, AIQuizGenerateResponse
from app.schemas.Quiz import QuizQuestionIn
from app.services.academic.LessonPlanAIService import AISuggestField, generate_lesson_plan_suggestion
from app.services.ai.AIQuizGeneratorService import generate_quiz_questions

router = APIRouter()


class AIAssistRequest(BaseModel):
    field: AISuggestField
    title: str = ""
    learning_area: str = ""
    grade_section: str = ""


class AIAssistResponse(BaseModel):
    suggestion: str


@router.post("/lesson-plan-assist", response_model=AIAssistResponse)
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


@router.post("/generate-quiz", response_model=AIQuizGenerateResponse)
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
            .filter(
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
                ClassworkLesson.lesson_id.in_(body.lesson_ids),
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
    )

    questions = [QuizQuestionIn(**q) for q in generated_raw]
    return AIQuizGenerateResponse(questions=questions, warnings=warnings)
