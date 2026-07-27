from typing import Literal
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.Dependencies import get_staff_id
from app.services.academic.LessonPlanAIService import AISuggestField, generate_lesson_plan_suggestion

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
    Powered by Google Gemini.
    """
    suggestion = await generate_lesson_plan_suggestion(
        field=body.field,
        title=body.title,
        learning_area=body.learning_area,
        grade_section=body.grade_section,
    )
    return AIAssistResponse(suggestion=suggestion)
