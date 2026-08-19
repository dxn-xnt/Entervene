import uuid
from unittest.mock import AsyncMock, patch, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.AIAssist import router as ai_assist_router
from app.api.v1.routes.Auth import get_current_user
from app.core.Dependencies import get_staff_id
from app.db.Session import get_db
from app.models.academic.Subject import Subject
from app.models.academic.Lesson import Lesson
from app.models.classwork.Classwork import Classwork


def test_teacher_can_generate_quiz():
    app = FastAPI()
    app.include_router(ai_assist_router, prefix="/api/v1/ai")

    identity = {"sub": uuid.uuid4(), "role": "teacher"}
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_staff_id] = lambda: "STAFF-001"

    # Mock DB session
    mock_db = MagicMock()
    mock_subject = MagicMock(spec=Subject)
    mock_subject.subject_id = 10
    mock_subject.subject_name = "Science 7"

    mock_lesson = MagicMock(spec=Lesson)
    mock_lesson.lesson_id = 101
    mock_lesson.title = "Cell Structure"
    mock_lesson.description = "Organelles and functions."
    mock_lesson.content = "Cells have nuclei, mitochondria, and cell membranes."

    def mock_query(model):
        q = MagicMock()
        if model == Subject:
            q.filter.return_value.first.return_value = mock_subject
        elif model == Lesson:
            q.filter.return_value.all.return_value = [mock_lesson]
        elif model == Classwork:
            q.join.return_value.filter.return_value.all.return_value = []
        return q

    mock_db.query.side_effect = mock_query
    app.dependency_overrides[get_db] = lambda: mock_db

    mock_generated = [
        {
            "question_text": "What is the cell membrane?",
            "question_type": "MULTIPLE_CHOICE",
            "points": 1.0,
            "display_order": 1,
            "difficulty_level": "EASY",
            "explanation": "Controls passage of materials.",
            "lesson_id": None,
            "options": [
                {"option_text": "Outer boundary", "is_correct": True, "option_order": 1},
                {"option_text": "Energy generator", "is_correct": False, "option_order": 2},
                {"option_text": "Protein factory", "is_correct": False, "option_order": 3},
                {"option_text": "Genetic store", "is_correct": False, "option_order": 4},
            ],
        }
    ]

    with patch(
        "app.api.v1.routes.AIAssist.generate_quiz_questions",
        new_callable=AsyncMock,
        return_value=mock_generated,
    ) as mock_ai_call:
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.post(
                "/api/v1/ai/generate-quiz",
                json={
                    "subject_id": 10,
                    "lesson_ids": [101],
                    "test_parts": [{"type": "MULTIPLE_CHOICE", "count": 1}],
                    "difficulty": "EASY",
                },
            )

        assert response.status_code == 200
        body = response.json()
        assert len(body["questions"]) == 1
        assert body["questions"][0]["question_text"] == "What is the cell membrane?"
        assert body["questions"][0]["question_type"] == "MULTIPLE_CHOICE"
        assert len(body["questions"][0]["options"]) == 4
        assert body["questions"][0]["options"][0]["is_correct"] is True

        mock_ai_call.assert_called_once()
        call_kwargs = mock_ai_call.call_args.kwargs
        assert call_kwargs["subject"] == "Science 7"
        assert "Cell Structure" in call_kwargs["lessons"]
        assert "Organelles and functions" in call_kwargs["content_text"]
