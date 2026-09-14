import uuid
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openai import APIError

from app.api.v1.routes.AIAssist import router as ai_assist_router
from app.api.v1.routes.Auth import get_current_user
from app.core.Config import settings
from app.core.Dependencies import get_staff_id
from app.services.academic.LessonPlanAIService import (
    clean_ai_output,
    generate_lesson_plan_suggestion,
    _generate_with_groq,
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


def test_groq_fallback_when_model_decommissioned():
    """Verify that a decommissioned model error triggers fallback to next model."""
    import asyncio

    async def _run():
        mock_client = MagicMock()
        mock_models_res = MagicMock()
        mock_m1 = MagicMock(id="old-decommissioned-model")
        mock_m2 = MagicMock(id="openai/gpt-oss-120b")
        mock_models_res.data = [mock_m1, mock_m2]
        mock_client.models.list = AsyncMock(return_value=mock_models_res)

        decommissioned_error = APIError(
            message="The model has been decommissioned and is no longer supported.",
            request=MagicMock(),
            body={"error": {"code": "model_decommissioned"}},
        )

        success_resp = MagicMock()
        mock_choice = MagicMock()
        mock_choice.message.content = "Understand cell membrane structures."
        success_resp.choices = [mock_choice]

        mock_client.chat.completions.create = AsyncMock(
            side_effect=[decommissioned_error, success_resp]
        )

        with patch(
            "app.services.academic.LessonPlanAIService.AsyncOpenAI",
            return_value=mock_client,
        ):
            result = await _generate_with_groq("dummy-key", "Generate objectives")
            assert "Understand cell membrane structures." in result
            assert mock_client.chat.completions.create.await_count == 2

    asyncio.run(_run())


def test_settings_has_groq_model():
    assert hasattr(settings, "groq_model")
    assert settings.groq_model in [
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
        "qwen/qwen3.8-27b",
        "groq/compound",
    ]
