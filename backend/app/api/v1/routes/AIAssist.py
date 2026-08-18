from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
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
    staff_id: str = Depends(get_staff_id),  # teacher-only
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


@router.post("/generate-quiz", response_model=AIQuizGenerateResponse)
async def generate_quiz(
    body: AIQuizGenerateRequest,
    staff_id: str = Depends(get_staff_id),  # teacher/admin only
    db: Session = Depends(get_db),
) -> AIQuizGenerateResponse:
    """
    Generate structured quiz questions using AI for a given subject and lessons.
    Sourced from lesson topics, lesson content, and attached reading classworks.
    """
    subject = db.query(Subject).filter(Subject.subject_id == body.subject_id).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    lesson_titles: list[str] = []
    content_blocks: list[str] = []
    warnings: list[str] = []

    if body.lesson_ids:
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

        # Fetch attached Classworks (e.g. READING) linked to these lessons
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
            cw_parts = [f"Attached Reading/Classwork ({cw.title}):"]
            if cw.description:
                cw_parts.append(cw.description)
            if cw.instructions:
                cw_parts.append(cw.instructions)
            content_blocks.append("\n".join(cw_parts))

    combined_content = "\n\n".join(content_blocks)
    test_parts = [
        {"type": part.type, "count": part.count}
        for part in body.test_parts
    ]
    if not test_parts:
        test_parts = [{"type": "MULTIPLE_CHOICE", "count": 5}]

    generated_raw = await generate_quiz_questions(
        subject=subject.subject_name,
        lessons=lesson_titles,
        content_text=combined_content,
        test_parts=test_parts,
        difficulty=body.difficulty,
    )

    questions = [QuizQuestionIn(**q) for q in generated_raw]
    return AIQuizGenerateResponse(questions=questions, warnings=warnings)
