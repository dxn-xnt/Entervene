"""Tests for PR 2C.3: Teacher AI Remediation Generation API.

Verifies:
1. Authentication & authorization:
   - Unauthenticated access returns 401.
   - Non-teacher roles (student, admin) return 403.
   - Teachers unauthorized for intervention subject/class return 403.
   - Inactive intervention returns 409.
   - Non-existent intervention returns 404.
2. Complete Quiz/Summative generation via POST endpoint:
   - Complete targeted questions, options, teacher answer keys, explanations, points.
   - DB remains unmodified (never auto-publishes, never assigns, never changes grades).
3. Complete Classwork/PT generation via POST endpoint:
   - Complete student instructions, tasks, exact deliverables, supported upload formats, rubric levels.
4. Reading material grounding integration:
   - Inclusion of teacher-selected reading classwork.
   - Rejection of out-of-scope reading classworks with 422.
5. Error handling & provider failures:
   - Rate limit (429) propagation with Retry-After header.
   - Timeout (504) and service unavailable (503) propagation.
   - Malformed AI output or boundary violation returns 502.
6. Route alias compatibility:
   - Both /generate-draft and /draft function identically.

Uses mocked providers; no live Groq or Gemini requests.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.TeacherInterventions import router as teacher_interventions_router
from app.db.Session import get_db
from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonDelivery import LessonDelivery
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_teacher_intervention_review import candidate_context, _id, _other_staff, _staff
from tests.test_remediation_draft_generation import _mapped_records, _question_snapshot


# ── Helpers ──

def _client(ctx, role: str = "teacher", user_id=None, omit_auth: bool = False) -> TestClient:
    app = FastAPI()
    app.include_router(teacher_interventions_router, prefix="/api/v1/teacher/interventions")
    app.dependency_overrides[get_db] = lambda: ctx["db"]
    if not omit_auth:
        effective_user_id = user_id or ctx["staff"].user_id
        app.dependency_overrides[get_current_user] = lambda: {
            "role": role,
            "sub": str(effective_user_id),
        }
    return TestClient(app)


def _prepare_active_intervention(ctx) -> tuple[Competency, Lesson, datetime]:
    """Prepares an ACTIVE intervention with a verified taught lesson delivered before frozen cutoff."""
    db = ctx["db"]
    staff_id = _staff(ctx)
    intervention = ctx["candidate"]

    competency, lesson = _mapped_records(ctx)
    _question_snapshot(ctx, competency, lesson)

    intervention.status = "ACTIVE"
    intervention.activated_at = datetime.now(timezone.utc)
    intervention.activated_by_staff_id = staff_id
    db.commit()

    cutoff = datetime.fromisoformat(intervention.diagnosis_snapshot["evidence_cutoff_at"])
    if cutoff.tzinfo is None:
        cutoff = cutoff.replace(tzinfo=timezone.utc)

    delivery = LessonDelivery(
        lesson_id=lesson.lesson_id,
        class_id=intervention.class_id,
        subject_id=intervention.subject_id,
        academic_period_id=intervention.academic_period_id,
        delivered_by_staff_id=staff_id,
        delivered_at=cutoff - timedelta(days=2),
    )
    db.add(delivery)
    db.commit()

    return competency, lesson, cutoff


# ── Authentication & Authorization Tests ──

def test_generate_draft_endpoint_unauthenticated_returns_401(candidate_context):
    ctx = candidate_context
    client = _client(ctx, omit_auth=True)
    resp = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/generate-draft",
        json={
            "draft_format": "QUIZ",
            "target_component": "WRITTEN_WORK",
            "grade_treatment": "WRITTEN_WORK",
        },
    )
    assert resp.status_code == 401


def test_generate_draft_endpoint_forbidden_for_student_and_admin(candidate_context):
    ctx = candidate_context
    _prepare_active_intervention(ctx)

    for forbidden_role in ("student", "admin"):
        client = _client(ctx, role=forbidden_role)
        resp = client.post(
            f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/generate-draft",
            json={
                "draft_format": "QUIZ",
                "target_component": "WRITTEN_WORK",
                "grade_treatment": "WRITTEN_WORK",
            },
        )
        assert resp.status_code == 403


def test_generate_draft_endpoint_forbidden_for_unauthorized_teacher(candidate_context):
    ctx = candidate_context
    _prepare_active_intervention(ctx)
    other = _other_staff(ctx)

    client = _client(ctx, role="teacher", user_id=other.user_id)
    resp = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/generate-draft",
        json={
            "draft_format": "QUIZ",
            "target_component": "WRITTEN_WORK",
            "grade_treatment": "WRITTEN_WORK",
        },
    )
    assert resp.status_code == 403
    assert "active teaching permissions" in resp.json()["detail"]


def test_generate_draft_endpoint_nonexistent_intervention_returns_404(candidate_context):
    ctx = candidate_context
    client = _client(ctx)
    resp = client.post(
        "/api/v1/teacher/interventions/999999/remediation/generate-draft",
        json={
            "draft_format": "QUIZ",
            "target_component": "WRITTEN_WORK",
            "grade_treatment": "WRITTEN_WORK",
        },
    )
    assert resp.status_code == 404


def test_generate_draft_endpoint_inactive_intervention_returns_409(candidate_context):
    ctx = candidate_context
    # Intervention is still CANDIDATE (not ACTIVE)
    client = _client(ctx)
    resp = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/generate-draft",
        json={
            "draft_format": "QUIZ",
            "target_component": "WRITTEN_WORK",
            "grade_treatment": "WRITTEN_WORK",
        },
    )
    assert resp.status_code == 409
    assert "Intervention must be ACTIVE" in resp.json()["detail"]


# ── Complete Quiz Generation API Test ──

@pytest.mark.anyio
async def test_generate_draft_endpoint_quiz_success(candidate_context, monkeypatch):
    ctx = candidate_context
    competency, lesson, cutoff = _prepare_active_intervention(ctx)
    client = _client(ctx)

    ai_quiz_output = {
        "draft_format": "QUIZ",
        "target_component": "WRITTEN_WORK",
        "grade_treatment": "WRITTEN_WORK",
        "title": "Remediation Quiz: Solving Ratios",
        "instructions": "Answer all questions thoroughly.",
        "total_points": 10.0,
        "questions": [
            {
                "question_text": "What is the simplified ratio of 4 to 8?",
                "question_type": "MULTIPLE_CHOICE",
                "points": 5.0,
                "display_order": 1,
                "targeted_competency_id": competency.competency_id,
                "targeted_lesson_id": lesson.lesson_id,
                "options": [
                    {"option_text": "1:2", "option_order": 1},
                    {"option_text": "2:1", "option_order": 2},
                    {"option_text": "1:4", "option_order": 3},
                ],
                "teacher_answer_key": {
                    "correct_answer": "1:2",
                    "explanation": "Divide both numbers by their greatest common factor 4.",
                    "scoring_guide": "Full credit for choice 1:2.",
                },
            },
            {
                "question_text": "State the ratio of 3 boys to 6 girls in lowest terms.",
                "question_type": "SHORT_ANSWER",
                "points": 5.0,
                "display_order": 2,
                "targeted_competency_id": competency.competency_id,
                "targeted_lesson_id": lesson.lesson_id,
                "options": [],
                "teacher_answer_key": {
                    "correct_answer": "1:2",
                    "explanation": "3/6 simplifies to 1/2.",
                    "scoring_guide": "1:2 or 1/2 accepted.",
                },
            },
        ],
    }

    mock_generate = AsyncMock(return_value=json.dumps(ai_quiz_output))
    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_generate)

    # Initial count of Classwork / Quiz items to ensure no DB rows are created
    initial_classworks = ctx["db"].query(Classwork).count()

    req_payload = {
        "draft_format": "QUIZ",
        "target_component": "WRITTEN_WORK",
        "grade_treatment": "WRITTEN_WORK",
        "item_count": 2,
        "total_points": 10.0,
    }

    resp = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/generate-draft",
        json=req_payload,
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["draft_format"] == "QUIZ"
    assert data["title"] == "Remediation Quiz: Solving Ratios"
    assert data["total_points"] == 10.0
    assert len(data["questions"]) == 2

    # Check complete question content and teacher answer key
    q1 = data["questions"][0]
    assert q1["question_type"] == "MULTIPLE_CHOICE"
    assert q1["points"] == 5.0
    assert len(q1["options"]) == 3
    assert q1["teacher_answer_key"]["correct_answer"] == "1:2"
    assert "Divide both numbers" in q1["teacher_answer_key"]["explanation"]

    q2 = data["questions"][1]
    assert q2["question_type"] == "SHORT_ANSWER"
    assert q2["points"] == 5.0
    assert q2["teacher_answer_key"]["correct_answer"] == "1:2"

    # Verify database was NOT modified (draft is returned for review, never auto-saved or published)
    assert ctx["db"].query(Classwork).count() == initial_classworks


# ── Complete Classwork / PT Generation API Test ──

@pytest.mark.anyio
async def test_generate_draft_endpoint_classwork_pt_success(candidate_context, monkeypatch):
    ctx = candidate_context
    competency, lesson, cutoff = _prepare_active_intervention(ctx)
    client = _client(ctx)

    ai_classwork_output = {
        "draft_format": "CLASSWORK",
        "target_component": "WRITTEN_WORK",
        "grade_treatment": "WRITTEN_WORK",
        "title": "Ratio Construction Workshop",
        "description": "Construct real-world scale models demonstrating proportional reasoning.",
        "student_instructions": "Follow the three steps below to calculate and record scale ratios.",
        "total_points": 20.0,
        "activity_mode": "ONLINE",
        "tasks": [
            {
                "task_number": 1,
                "title": "Measure Dimensions",
                "instructions": "Measure the room dimensions and document values in meters.",
                "targeted_competency_id": competency.competency_id,
                "targeted_lesson_id": lesson.lesson_id,
            },
            {
                "task_number": 2,
                "title": "Scale Computation",
                "instructions": "Convert measured dimensions to a 1:50 scale model ratio.",
                "targeted_competency_id": competency.competency_id,
                "targeted_lesson_id": lesson.lesson_id,
            },
        ],
        "deliverables": [
            {
                "deliverable_name": "Scale Calculation Sheet",
                "deliverable_type": "DOCUMENT",
                "description": "Completed table of original and scaled measurements.",
            },
            {
                "deliverable_name": "Model Blueprint",
                "deliverable_type": "PDF",
                "description": "Drawn layout diagram.",
            },
        ],
        "supported_upload_formats": [".pdf", ".docx"],
        "rubric_levels": [
            {
                "level_name": "Exemplary",
                "description": "Accurate ratio calculations and clear blueprint layout.",
                "points": 20.0,
                "display_order": 0,
            },
            {
                "level_name": "Proficient",
                "description": "Minor calculation flaws with recognizable ratios.",
                "points": 14.0,
                "display_order": 1,
            },
            {
                "level_name": "Developing",
                "description": "Incomplete scaling and significant errors.",
                "points": 8.0,
                "display_order": 2,
            },
        ],
        "teacher_guide": {
            "exemplar_or_expected_response": "Correct table: length 5m -> 10cm, width 3m -> 6cm.",
            "evaluation_notes": "Check for unit conversion accuracy.",
            "common_misconceptions": ["Inverting ratio numerator and denominator."],
        },
    }

    mock_generate = AsyncMock(return_value=json.dumps(ai_classwork_output))
    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_generate)

    req_payload = {
        "draft_format": "CLASSWORK",
        "target_component": "WRITTEN_WORK",
        "grade_treatment": "WRITTEN_WORK",
        "item_count": 2,
        "total_points": 20.0,
    }

    resp = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/generate-draft",
        json=req_payload,
    )

    assert resp.status_code == 200, resp.json()
    data = resp.json()
    assert data["draft_format"] == "CLASSWORK"
    assert data["target_component"] == "WRITTEN_WORK"
    assert len(data["tasks"]) == 2
    assert len(data["deliverables"]) == 2
    assert data["supported_upload_formats"] == [".pdf", ".docx"]
    assert len(data["rubric_levels"]) == 3
    assert data["rubric_levels"][0]["points"] == 20.0
    assert data["teacher_guide"]["exemplar_or_expected_response"] is not None


# ── Reading Material Grounding via API ──

@pytest.mark.anyio
async def test_generate_draft_endpoint_with_reading_material_grounding(candidate_context, monkeypatch):
    ctx = candidate_context
    competency, lesson, cutoff = _prepare_active_intervention(ctx)
    staff_id = _staff(ctx)
    client = _client(ctx)

    # Create an eligible reading classwork
    reading = Classwork(
        title="Proportions Handbook",
        description="Reading material on solving ratios",
        classwork_type="READING",
        is_graded=False,
        is_archived=False,
        is_published=True,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=staff_id,
    )
    ctx["db"].add(reading)
    ctx["db"].flush()
    ctx["db"].add(
        ClassworkAssignment(
            classwork_id=reading.classwork_id,
            class_id=ctx["class"].class_id,
            academic_period_id=ctx["period"].academic_period_id,
            assigned_by_staff_id=staff_id,
        )
    )
    ctx["db"].add(
        ClassworkCoverage(
            classwork_id=reading.classwork_id,
            lesson_id=lesson.lesson_id,
            competency_id=competency.competency_id,
        )
    )
    ctx["db"].commit()

    captured_prompt = None

    async def mock_gen(prompt, system_prompt, **kwargs):
        nonlocal captured_prompt
        captured_prompt = prompt
        return json.dumps({
            "draft_format": "QUIZ",
            "target_component": "WRITTEN_WORK",
            "grade_treatment": "WRITTEN_WORK",
            "title": "Grounded Ratio Quiz",
            "instructions": "Solve based on the Proportions Handbook.",
            "total_points": 5.0,
            "questions": [
                {
                    "question_text": "What is the fundamental property of proportions?",
                    "question_type": "SHORT_ANSWER",
                    "points": 5.0,
                    "display_order": 1,
                    "targeted_competency_id": competency.competency_id,
                    "targeted_lesson_id": lesson.lesson_id,
                    "options": [],
                    "teacher_answer_key": {
                        "correct_answer": "Cross products are equal.",
                        "explanation": "Directly stated in handbook.",
                    },
                }
            ],
        })

    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_gen)

    # 1. Request with valid reading ID
    resp = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/generate-draft",
        json={
            "draft_format": "QUIZ",
            "target_component": "WRITTEN_WORK",
            "grade_treatment": "WRITTEN_WORK",
            "item_count": 1,
            "total_points": 5.0,
            "selected_reading_ids": [reading.classwork_id],
        },
    )
    assert resp.status_code == 200, resp.json()
    assert captured_prompt is not None
    assert "Proportions Handbook" in captured_prompt

    # 2. Request with foreign reading ID returns 422
    resp_invalid = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/generate-draft",
        json={
            "draft_format": "QUIZ",
            "target_component": "WRITTEN_WORK",
            "grade_treatment": "WRITTEN_WORK",
            "item_count": 1,
            "total_points": 5.0,
            "selected_reading_ids": [999999],
        },
    )
    assert resp_invalid.status_code == 422
    assert "outside the intervention subject/class scope" in resp_invalid.json()["detail"]


# ── AI Boundary & Schema Violations ──

@pytest.mark.anyio
async def test_generate_draft_endpoint_rejects_ai_boundary_violation(candidate_context, monkeypatch):
    ctx = candidate_context
    competency, lesson, cutoff = _prepare_active_intervention(ctx)
    client = _client(ctx)

    # AI returns a question targeting an untaught / unassessed lesson
    bad_ai_resp = {
        "draft_format": "QUIZ",
        "target_component": "WRITTEN_WORK",
        "grade_treatment": "WRITTEN_WORK",
        "title": "Boundary Violating Quiz",
        "instructions": "Solve calculus items.",
        "total_points": 5.0,
        "questions": [
            {
                "question_text": "What is the limit as x approaches 0?",
                "question_type": "SHORT_ANSWER",
                "points": 5.0,
                "display_order": 1,
                "targeted_competency_id": competency.competency_id,
                "targeted_lesson_id": 88888,  # Not in scope!
                "options": [],
                "teacher_answer_key": {"correct_answer": "1", "explanation": "Limit rule."},
            }
        ],
    }

    mock_generate = AsyncMock(return_value=json.dumps(bad_ai_resp))
    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_generate)

    resp = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/generate-draft",
        json={
            "draft_format": "QUIZ",
            "target_component": "WRITTEN_WORK",
            "grade_treatment": "WRITTEN_WORK",
            "item_count": 1,
            "total_points": 5.0,
        },
    )
    assert resp.status_code == 502
    assert "failed boundary validation" in resp.json()["detail"]


@pytest.mark.anyio
async def test_generate_draft_endpoint_rejects_ai_schema_violation(candidate_context, monkeypatch):
    ctx = candidate_context
    competency, lesson, cutoff = _prepare_active_intervention(ctx)
    client = _client(ctx)

    # AI returns points that do not sum to total_points (5.0 != 10.0)
    bad_ai_resp = {
        "draft_format": "QUIZ",
        "target_component": "WRITTEN_WORK",
        "grade_treatment": "WRITTEN_WORK",
        "title": "Mismatched Points Quiz",
        "instructions": "Solve items.",
        "total_points": 10.0,
        "questions": [
            {
                "question_text": "What is 2+2?",
                "question_type": "SHORT_ANSWER",
                "points": 5.0,  # 5 != 10
                "display_order": 1,
                "targeted_competency_id": competency.competency_id,
                "targeted_lesson_id": lesson.lesson_id,
                "options": [],
                "teacher_answer_key": {"correct_answer": "4", "explanation": "Addition."},
            }
        ],
    }

    mock_generate = AsyncMock(return_value=json.dumps(bad_ai_resp))
    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_generate)

    resp = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/generate-draft",
        json={
            "draft_format": "QUIZ",
            "target_component": "WRITTEN_WORK",
            "grade_treatment": "WRITTEN_WORK",
            "item_count": 1,
            "total_points": 10.0,
        },
    )
    assert resp.status_code == 502
    assert "failed schema validation" in resp.json()["detail"]


# ── Provider Failures & Rate Limits ──

@pytest.mark.anyio
async def test_generate_draft_endpoint_propagates_groq_rate_limit(candidate_context, monkeypatch):
    ctx = candidate_context
    _prepare_active_intervention(ctx)
    client = _client(ctx)

    # Provider raises 429 rate limit
    mock_generate = AsyncMock(
        side_effect=HTTPException(
            status_code=429,
            detail="AI provider rate limit reached. Continue with manual authoring or try again later.",
            headers={"Retry-After": "45"},
        )
    )
    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_generate)

    resp = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/generate-draft",
        json={
            "draft_format": "QUIZ",
            "target_component": "WRITTEN_WORK",
            "grade_treatment": "WRITTEN_WORK",
            "item_count": 1,
            "total_points": 5.0,
        },
    )
    assert resp.status_code == 429
    assert "rate limit reached" in resp.json()["detail"]
    assert resp.headers.get("Retry-After") == "45"


@pytest.mark.anyio
async def test_generate_draft_endpoint_propagates_groq_timeout_and_service_errors(candidate_context, monkeypatch):
    ctx = candidate_context
    _prepare_active_intervention(ctx)
    client = _client(ctx)

    # Timeout (504)
    monkeypatch.setattr(
        "app.services.ai.Provider.generate_text",
        AsyncMock(side_effect=HTTPException(status_code=504, detail="AI generation timed out.")),
    )
    resp_504 = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/generate-draft",
        json={
            "draft_format": "QUIZ",
            "target_component": "WRITTEN_WORK",
            "grade_treatment": "WRITTEN_WORK",
        },
    )
    assert resp_504.status_code == 504

    # Service Unavailable (503)
    monkeypatch.setattr(
        "app.services.ai.Provider.generate_text",
        AsyncMock(side_effect=HTTPException(status_code=503, detail="AI provider is unavailable.")),
    )
    resp_503 = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/generate-draft",
        json={
            "draft_format": "QUIZ",
            "target_component": "WRITTEN_WORK",
            "grade_treatment": "WRITTEN_WORK",
        },
    )
    assert resp_503.status_code == 503


# ── Route Alias Compatibility ──

@pytest.mark.anyio
async def test_generate_draft_endpoint_alias_route(candidate_context, monkeypatch):
    ctx = candidate_context
    competency, lesson, cutoff = _prepare_active_intervention(ctx)
    client = _client(ctx)

    ai_quiz_output = {
        "draft_format": "QUIZ",
        "target_component": "WRITTEN_WORK",
        "grade_treatment": "WRITTEN_WORK",
        "title": "Alias Quiz Draft",
        "instructions": "Solve.",
        "total_points": 5.0,
        "questions": [
            {
                "question_text": "What is 5 x 5?",
                "question_type": "SHORT_ANSWER",
                "points": 5.0,
                "display_order": 1,
                "targeted_competency_id": competency.competency_id,
                "targeted_lesson_id": lesson.lesson_id,
                "options": [],
                "teacher_answer_key": {"correct_answer": "25", "explanation": "5*5=25."},
            }
        ],
    }

    mock_generate = AsyncMock(return_value=json.dumps(ai_quiz_output))
    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_generate)

    # Calling /remediation/draft (alias) instead of /remediation/generate-draft
    resp = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/draft",
        json={
            "draft_format": "QUIZ",
            "target_component": "WRITTEN_WORK",
            "grade_treatment": "WRITTEN_WORK",
            "item_count": 1,
            "total_points": 5.0,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["title"] == "Alias Quiz Draft"
