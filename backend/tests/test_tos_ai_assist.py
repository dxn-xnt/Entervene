import json
import uuid
from unittest.mock import AsyncMock, patch
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.AIAssist import router as ai_assist_router
from app.api.v1.routes.Auth import get_current_user
from app.core.Dependencies import get_staff_id


@pytest.fixture
def test_client():
    app = FastAPI()
    app.include_router(ai_assist_router, prefix="/api/v1/ai")

    identity = {"sub": str(uuid.uuid4()), "role": "teacher"}
    app.dependency_overrides[get_current_user] = lambda: identity
    app.dependency_overrides[get_staff_id] = lambda: "STAFF-001"

    with TestClient(app) as client:
        yield client


def test_suggest_tos_competencies(test_client):
    mock_ai_output = json.dumps({
        "competencies": [
            {"code": "LC-01", "label": "Describe the functions of the circulatory system.", "days": 4},
            {"code": "LC-02", "label": "Explain the mechanism of pulmonary respiration.", "days": 5},
            {"code": "LC-03", "label": "Demonstrate understanding of blood circulation.", "days": 3},
        ]
    })

    with patch("app.services.ai.AITOSAssistService.generate_text", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = mock_ai_output

        payload = {
            "field": "suggest_competencies",
            "subject_name": "Science 9",
            "term": "Term 1",
            "language": "English",
        }
        res = test_client.post("/api/v1/ai/tos-assist", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["field"] == "suggest_competencies"
        assert len(data["competencies"]) == 3
        assert data["competencies"][0]["code"] == "LC-01"
        assert data["competencies"][0]["days"] == 4
        assert "circulatory system" in data["competencies"][0]["label"]


def test_suggest_tos_title(test_client):
    mock_ai_output = json.dumps({
        "title": "First Periodic Examination in Science 9"
    })

    with patch("app.services.ai.AITOSAssistService.generate_text", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = mock_ai_output

        payload = {
            "field": "suggest_title",
            "subject_name": "Science 9",
            "term": "Term 1",
            "language": "English",
        }
        res = test_client.post("/api/v1/ai/tos-assist", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["field"] == "suggest_title"
        assert data["title"] == "First Periodic Examination in Science 9"


def test_suggest_tos_test_parts(test_client):
    mock_ai_output = json.dumps({
        "test_parts": [
            {"type": "MULTIPLE_CHOICE", "count": 20},
            {"type": "TRUE_FALSE", "count": 5},
            {"type": "IDENTIFICATION", "count": 5},
        ]
    })

    with patch("app.services.ai.AITOSAssistService.generate_text", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = mock_ai_output

        payload = {
            "field": "suggest_test_parts",
            "subject_name": "Mathematics 10",
            "total_items": 30,
        }
        res = test_client.post("/api/v1/ai/tos-assist", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["field"] == "suggest_test_parts"
        assert len(data["test_parts"]) == 3
        total = sum(p["count"] for p in data["test_parts"])
        assert total == 30
