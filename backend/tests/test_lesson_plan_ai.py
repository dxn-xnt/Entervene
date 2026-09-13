import uuid
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.AIAssist import router as ai_assist_router
from app.api.v1.routes.Auth import get_current_user
from app.core.Config import settings
from app.core.Dependencies import get_staff_id
from app.services.academic.LessonPlanAIService import (
    clean_ai_output,
    generate_lesson_plan_suggestion,
)


@pytest.fixture
def test_client():
    app = FastAPI()
    app.include_router(ai_assist_router, prefix="/api/v1/ai")

    identity = {"sub": str(uuid.uuid4()), "role": "teacher"}
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_staff_id] = lambda: "STAFF-001"

    with TestClient(app) as client:
        yield client


def test_clean_ai_output():
    raw_ai_text = """
    ```markdown
    **Learning Objectives:**
    1. Identify the steps of the scientific method with 90% accuracy.
    2. Formulate a hypothesis based on an observation.
    *Note: Hope this helps!*
    ```
    """
    cleaned = clean_ai_output(raw_ai_text)
    assert "Identify the steps of the scientific method" in cleaned
    assert "Formulate a hypothesis based on an observation." in cleaned
    assert "**" not in cleaned
    assert "Hope this helps" not in cleaned


def test_lesson_plan_assist_endpoint_success(test_client):
    with patch(
        "app.api.v1.routes.AIAssist.generate_lesson_plan_suggestion",
        new_callable=AsyncMock,
    ) as mock_generate:
        mock_generate.return_value = "Explain the concepts of force and motion."
        payload = {
            "field": "objectives",
            "title": "Laws of Motion",
            "learning_area": "Science 8",
            "grade_section": "Grade 8 - Newton",
        }
        res = test_client.post("/api/v1/ai/lesson-plan-assist", json=payload)
        assert res.status_code == 200
        assert res.json() == {"suggestion": "Explain the concepts of force and motion."}
        mock_generate.assert_awaited_once_with(
            field="objectives",
            title="Laws of Motion",
            learning_area="Science 8",
            grade_section="Grade 8 - Newton",
        )


def test_lesson_suggestion_uses_bounded_shared_gateway():
    import asyncio
    with patch("app.services.academic.LessonPlanAIService.generate_text", new_callable=AsyncMock) as gateway:
        gateway.return_value = "Explain force."
        result = asyncio.run(generate_lesson_plan_suggestion("objectives", "Force", "Science", "7"))
        assert result == "Explain force."
        assert gateway.await_count == 1
        assert gateway.call_args.kwargs["max_tokens"] == 768


def test_settings_has_groq_model():
    assert hasattr(settings, "groq_model")
    assert settings.groq_model in [
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
        "qwen/qwen3.8-27b",
        "groq/compound",
    ]
