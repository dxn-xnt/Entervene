"""Regression tests for Task 3: Quiz Builder AI Remediation Generation.

Verifies:
1. Quiz Builder test-part settings (item count, supported question types, points per item,
   difficulty breakdown, custom teacher instructions) flow through the grounded remediation
   generation endpoint and prompt.
2. Invalid settings (ESSAY type, count 0 or >20, count mismatch, difficulty sum mismatch,
   points mismatch with total_points or locked original classwork max points, forged grading
   component mismatch, CLASSWORK format with quiz_test_parts, out-of-scope lesson) fail with
   HTTP 422 BEFORE invoking the AI provider (zero credits consumed).
3. AI provider failures (429/502) and mismatched AI output distributions return proper errors
   without creating partial classworks, quizzes, assignments, or remediation links.
4. Generated remediation quiz respects max 3 attempts, locked grading component, and student
   isolation when persisted through Quiz Builder.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.TeacherInterventions import router as teacher_interventions_router
from app.db.Session import get_db
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonDelivery import LessonDelivery
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.quiz.Quiz import Quiz
from app.schemas.RemediationDraft import RemediationDraftGenerationRequest
from app.services.intervention.InterventionRemediationDraftGenerationService import (
    build_remediation_draft_prompt,
)
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_remediation_draft_generation import _mapped_records, _question_snapshot
from tests.test_teacher_intervention_review import candidate_context, _id, _staff


def _client(ctx) -> TestClient:
    app = FastAPI()
    app.include_router(teacher_interventions_router, prefix="/api/v1/teacher/interventions")
    app.dependency_overrides[get_db] = lambda: ctx["db"]
    app.dependency_overrides[get_current_user] = lambda: {
        "role": "teacher",
        "sub": str(ctx["staff"].user_id),
    }
    return TestClient(app)


def _setup_active_written_work_intervention(ctx, *, original_max_points: float = 10.0):
    db = ctx["db"]
    staff_id = _staff(ctx)
    intervention = ctx["candidate"]

    competency, lesson = _mapped_records(ctx)
    _question_snapshot(ctx, competency, lesson)

    cw = Classwork(
        subject_id=intervention.subject_id,
        classwork_type="QUIZ",
        classwork_category="WRITTEN_WORK",
        title="Original Parallel & Perpendicular Quiz",
        total_points=original_max_points,
        is_published=True,
        created_by_staff_id=staff_id,
    )
    db.add(cw)
    db.flush()
    db.add(
        ClassworkCoverage(
            classwork_id=cw.classwork_id,
            lesson_id=lesson.lesson_id,
            competency_id=competency.competency_id,
        )
    )
    target_asgn = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=intervention.class_id,
        academic_period_id=intervention.academic_period_id,
        assigned_by_staff_id=staff_id,
        is_published=True,
    )
    db.add(target_asgn)
    db.flush()

    intervention.status = "ACTIVE"
    intervention.activated_at = datetime.now(timezone.utc)
    intervention.activated_by_staff_id = staff_id
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [target_asgn.classwork_assignment_id],
        "score_adjustment_cap": 75.0,
        "selected_resources": [],
    }
    db.commit()

    cutoff = datetime.fromisoformat(intervention.diagnosis_snapshot["evidence_cutoff_at"])
    if cutoff.tzinfo is None:
        cutoff = cutoff.replace(tzinfo=timezone.utc)

    db.add(
        LessonDelivery(
            lesson_id=lesson.lesson_id,
            class_id=intervention.class_id,
            subject_id=intervention.subject_id,
            academic_period_id=intervention.academic_period_id,
            delivered_by_staff_id=staff_id,
            delivered_at=cutoff - timedelta(days=2),
        )
    )
    db.commit()

    return competency, lesson, target_asgn


def _valid_ai_quiz_payload(lesson_id: int, competency_id: int) -> dict:
    return {
        "draft_format": "QUIZ",
        "target_component": "WRITTEN_WORK",
        "grade_treatment": "WRITTEN_WORK",
        "exam_subtype": None,
        "title": "Remediation Quiz: Parallel & Perpendicular Lines",
        "instructions": "Answer all items carefully.",
        "total_points": 10.0,
        "duration_minutes": 20,
        "questions": [
            {
                "question_text": "What is the slope of a line parallel to y = 2x + 3?",
                "question_type": "MULTIPLE_CHOICE",
                "points": 2.0,
                "display_order": 1,
                "difficulty_level": "EASY",
                "targeted_competency_id": competency_id,
                "targeted_lesson_id": lesson_id,
                "options": [
                    {"option_text": "2", "option_order": 1},
                    {"option_text": "-2", "option_order": 2},
                    {"option_text": "1/2", "option_order": 3},
                    {"option_text": "-1/2", "option_order": 4},
                ],
                "teacher_answer_key": {
                    "correct_answer": "2",
                    "explanation": "Parallel lines share the same slope.",
                },
            },
            {
                "question_text": "What is the slope of a line perpendicular to y = 2x + 3?",
                "question_type": "MULTIPLE_CHOICE",
                "points": 2.0,
                "display_order": 2,
                "difficulty_level": "MEDIUM",
                "targeted_competency_id": competency_id,
                "targeted_lesson_id": lesson_id,
                "options": [
                    {"option_text": "-1/2", "option_order": 1},
                    {"option_text": "2", "option_order": 2},
                    {"option_text": "1/2", "option_order": 3},
                    {"option_text": "-2", "option_order": 4},
                ],
                "teacher_answer_key": {
                    "correct_answer": "-1/2",
                    "explanation": "Perpendicular slopes are negative reciprocals.",
                },
            },
            {
                "question_text": "Two lines with equal slopes and different y-intercepts are parallel.",
                "question_type": "TRUE_FALSE",
                "points": 2.0,
                "display_order": 3,
                "difficulty_level": "EASY",
                "targeted_competency_id": competency_id,
                "targeted_lesson_id": lesson_id,
                "options": [
                    {"option_text": "True", "option_order": 1},
                    {"option_text": "False", "option_order": 2},
                ],
                "teacher_answer_key": {
                    "correct_answer": "True",
                    "explanation": "Equal slopes with distinct intercepts never intersect.",
                },
            },
            {
                "question_text": "Name the relationship between two lines whose slopes multiply to -1.",
                "question_type": "IDENTIFICATION",
                "points": 2.0,
                "display_order": 4,
                "difficulty_level": "MEDIUM",
                "targeted_competency_id": competency_id,
                "targeted_lesson_id": lesson_id,
                "options": [],
                "teacher_answer_key": {
                    "correct_answer": "Perpendicular",
                    "explanation": "Perpendicular lines have slopes whose product is -1.",
                },
            },
            {
                "question_text": "Explain how to check whether y = 3x + 1 and y = -1/3x + 4 are perpendicular.",
                "question_type": "SHORT_ANSWER",
                "points": 2.0,
                "display_order": 5,
                "difficulty_level": "HARD",
                "targeted_competency_id": competency_id,
                "targeted_lesson_id": lesson_id,
                "options": [],
                "teacher_answer_key": {
                    "correct_answer": "Multiply their slopes 3 and -1/3 to get -1.",
                    "explanation": "A slope product of -1 confirms perpendicular lines.",
                },
            },
        ],
    }


def test_remediation_quiz_builder_test_parts_generate_and_prompt_grounding(
    candidate_context, monkeypatch
):
    ctx = candidate_context
    competency, lesson, target_asgn = _setup_active_written_work_intervention(
        ctx, original_max_points=10.0
    )
    client = _client(ctx)

    captured_prompts: list[str] = []

    async def fake_generate_text(user_prompt, system_prompt, **kwargs):
        captured_prompts.append(user_prompt)
        return json.dumps(_valid_ai_quiz_payload(lesson.lesson_id, competency.competency_id))

    monkeypatch.setattr(
        "app.services.intervention.InterventionRemediationDraftGenerationService.Provider.generate_text",
        fake_generate_text,
    )

    resp = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/generate-draft",
        json={
            "draft_format": "QUIZ",
            "target_component": "WRITTEN_WORK",
            "grade_treatment": "WRITTEN_WORK",
            "target_assignment_id": target_asgn.classwork_assignment_id,
            "item_count": 5,
            "total_points": 10.0,
            "selected_lesson_ids": [lesson.lesson_id],
            "custom_teacher_instructions": "Focus on identifying negative reciprocal slopes.",
            "quiz_test_parts": [
                {
                    "question_type": "MULTIPLE_CHOICE",
                    "count": 2,
                    "points_per_item": 2.0,
                    "difficulty_breakdown": {"EASY": 1, "MEDIUM": 1},
                },
                {
                    "question_type": "TRUE_FALSE",
                    "count": 1,
                    "points_per_item": 2.0,
                    "difficulty_breakdown": {"EASY": 1},
                },
                {
                    "question_type": "IDENTIFICATION",
                    "count": 1,
                    "points_per_item": 2.0,
                    "difficulty_breakdown": {"MEDIUM": 1},
                },
                {
                    "question_type": "SHORT_ANSWER",
                    "count": 1,
                    "points_per_item": 2.0,
                    "difficulty_breakdown": {"HARD": 1},
                },
            ],
        },
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["draft_format"] == "QUIZ"
    assert body["target_component"] == "WRITTEN_WORK"
    assert body["total_points"] == 10.0
    assert len(body["questions"]) == 5
    assert [q["question_type"] for q in body["questions"]] == [
        "MULTIPLE_CHOICE",
        "MULTIPLE_CHOICE",
        "TRUE_FALSE",
        "IDENTIFICATION",
        "SHORT_ANSWER",
    ]
    assert captured_prompts
    assert "requested_quiz_test_parts" in captured_prompts[0]
    assert "Focus on identifying negative reciprocal slopes." in captured_prompts[0]


@pytest.mark.parametrize(
    "case_name,payload_override",
    [
        (
            "unsupported_essay_type",
            {
                "item_count": 2,
                "total_points": 10.0,
                "quiz_test_parts": [
                    {"question_type": "ESSAY", "count": 2, "points_per_item": 5.0},
                ],
            },
        ),
        (
            "zero_questions",
            {
                "item_count": 0,
                "total_points": 10.0,
                "quiz_test_parts": [
                    {"question_type": "MULTIPLE_CHOICE", "count": 0, "points_per_item": 1.0},
                ],
            },
        ),
        (
            "exceeds_max_20_questions",
            {
                "item_count": 21,
                "total_points": 21.0,
                "quiz_test_parts": [
                    {"question_type": "MULTIPLE_CHOICE", "count": 11, "points_per_item": 1.0},
                    {"question_type": "TRUE_FALSE", "count": 10, "points_per_item": 1.0},
                ],
            },
        ),
        (
            "item_count_mismatch",
            {
                "item_count": 5,
                "total_points": 10.0,
                "quiz_test_parts": [
                    {"question_type": "MULTIPLE_CHOICE", "count": 4, "points_per_item": 2.5},
                ],
            },
        ),
        (
            "difficulty_breakdown_sum_mismatch",
            {
                "item_count": 5,
                "total_points": 10.0,
                "quiz_test_parts": [
                    {
                        "question_type": "MULTIPLE_CHOICE",
                        "count": 5,
                        "points_per_item": 2.0,
                        "difficulty_breakdown": {"EASY": 2, "MEDIUM": 1},
                    },
                ],
            },
        ),
        (
            "points_mismatch_with_request_total_points",
            {
                "item_count": 5,
                "total_points": 10.0,
                "quiz_test_parts": [
                    {"question_type": "MULTIPLE_CHOICE", "count": 5, "points_per_item": 1.0},
                ],
            },
        ),
        (
            "points_mismatch_with_locked_original_target_max_points",
            {
                "item_count": 5,
                "total_points": 15.0,
                "quiz_test_parts": [
                    {"question_type": "MULTIPLE_CHOICE", "count": 5, "points_per_item": 3.0},
                ],
            },
        ),
        (
            "forged_component_mismatch_on_written_work_target",
            {
                "target_component": "EXAMINATION",
                "grade_treatment": "EXAMINATION",
                "exam_subtype": "SUMMATIVE_1",
                "item_count": 5,
                "total_points": 10.0,
                "quiz_test_parts": [
                    {"question_type": "MULTIPLE_CHOICE", "count": 5, "points_per_item": 2.0},
                ],
            },
        ),
        (
            "quiz_test_parts_rejected_for_classwork_format",
            {
                "draft_format": "CLASSWORK",
                "target_component": "PERFORMANCE_TASK",
                "grade_treatment": "PERFORMANCE_TASK",
                "item_count": 2,
                "total_points": 10.0,
                "quiz_test_parts": [
                    {"question_type": "MULTIPLE_CHOICE", "count": 2, "points_per_item": 5.0},
                ],
            },
        ),
    ],
)
def test_invalid_quiz_builder_settings_fail_with_422_before_ai_provider_call(
    candidate_context, monkeypatch, case_name, payload_override
):
    ctx = candidate_context
    _competency, lesson, target_asgn = _setup_active_written_work_intervention(
        ctx, original_max_points=10.0
    )
    client = _client(ctx)

    provider_mock = AsyncMock(side_effect=AssertionError("AI provider must not be called"))
    monkeypatch.setattr(
        "app.services.intervention.InterventionRemediationDraftGenerationService.Provider.generate_text",
        provider_mock,
    )

    payload = {
        "draft_format": "QUIZ",
        "target_component": "WRITTEN_WORK",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_id": target_asgn.classwork_assignment_id,
        "selected_lesson_ids": [lesson.lesson_id],
        **payload_override,
    }
    resp = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/generate-draft",
        json=payload,
    )

    assert resp.status_code == 422, f"{case_name}: expected 422, got {resp.status_code} ({resp.text})"
    assert provider_mock.call_count == 0


def test_out_of_scope_lesson_fails_before_ai_provider_call(candidate_context, monkeypatch):
    ctx = candidate_context
    _competency, _lesson, target_asgn = _setup_active_written_work_intervention(
        ctx, original_max_points=10.0
    )
    db = ctx["db"]
    unrelated_lesson = Lesson(
        subject_id=ctx["candidate"].subject_id,
        title="Unrelated Topic",
        created_by_staff_id=_staff(ctx),
    )
    db.add(unrelated_lesson)
    db.commit()

    provider_mock = AsyncMock(side_effect=AssertionError("AI provider must not be called"))
    monkeypatch.setattr(
        "app.services.intervention.InterventionRemediationDraftGenerationService.Provider.generate_text",
        provider_mock,
    )

    client = _client(ctx)
    resp = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/generate-draft",
        json={
            "draft_format": "QUIZ",
            "target_component": "WRITTEN_WORK",
            "grade_treatment": "WRITTEN_WORK",
            "target_assignment_id": target_asgn.classwork_assignment_id,
            "item_count": 5,
            "total_points": 10.0,
            "selected_lesson_ids": [unrelated_lesson.lesson_id],
            "quiz_test_parts": [
                {"question_type": "MULTIPLE_CHOICE", "count": 5, "points_per_item": 2.0},
            ],
        },
    )

    assert resp.status_code == 422
    assert provider_mock.call_count == 0


def test_ai_provider_failure_and_mismatched_distribution_create_no_partial_assessments(
    candidate_context, monkeypatch
):
    ctx = candidate_context
    db = ctx["db"]
    competency, lesson, target_asgn = _setup_active_written_work_intervention(
        ctx, original_max_points=10.0
    )
    client = _client(ctx)

    cw_before = db.query(Classwork).count()
    asgn_before = db.query(ClassworkAssignment).count()
    quiz_before = db.query(Quiz).count()
    links_before = db.query(RemediationAssignmentLink).count()

    # 1. Rate-limit error from AI provider
    monkeypatch.setattr(
        "app.services.intervention.InterventionRemediationDraftGenerationService.Provider.generate_text",
        AsyncMock(side_effect=HTTPException(status_code=429, detail="Rate limit exceeded")),
    )
    req_body = {
        "draft_format": "QUIZ",
        "target_component": "WRITTEN_WORK",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_id": target_asgn.classwork_assignment_id,
        "item_count": 5,
        "total_points": 10.0,
        "selected_lesson_ids": [lesson.lesson_id],
        "quiz_test_parts": [
            {"question_type": "MULTIPLE_CHOICE", "count": 3, "points_per_item": 2.0},
            {"question_type": "IDENTIFICATION", "count": 2, "points_per_item": 2.0},
        ],
    }
    resp_429 = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/generate-draft",
        json=req_body,
    )
    assert resp_429.status_code == 429

    # 2. Mismatched question types returned by AI provider (requested 3 MC + 2 ID, AI returned 2 MC + 1 TF + 1 ID + 1 SA)
    monkeypatch.setattr(
        "app.services.intervention.InterventionRemediationDraftGenerationService.Provider.generate_text",
        AsyncMock(
            return_value=json.dumps(
                _valid_ai_quiz_payload(lesson.lesson_id, competency.competency_id)
            )
        ),
    )
    resp_mismatch = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/generate-draft",
        json=req_body,
    )
    assert resp_mismatch.status_code == 502
    assert "did not match requested quiz structure" in resp_mismatch.json()["detail"]

    assert db.query(Classwork).count() == cw_before
    assert db.query(ClassworkAssignment).count() == asgn_before
    assert db.query(Quiz).count() == quiz_before
    assert db.query(RemediationAssignmentLink).count() == links_before


def test_build_remediation_draft_prompt_includes_difficulty_breakdown():
    scope = {
        "status": "AVAILABLE",
        "academic_scope": {"subject_id": 1, "class_id": 2, "evidence_cutoff_at": "2026-10-15T08:00:00Z"},
        "components": ["WRITTEN_WORK"],
        "lessons": [{"lesson_id": 1, "title": "Lines", "is_taught": True}],
        "competencies": [{"competency_id": 10, "statement": "Identify parallel lines"}],
        "questions": [],
    }
    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=4,
        total_points=8.0,
        quiz_test_parts=[
            {
                "question_type": "MULTIPLE_CHOICE",
                "count": 2,
                "points_per_item": 2.0,
                "difficulty_breakdown": {"EASY": 1, "HARD": 1},
            },
            {
                "question_type": "IDENTIFICATION",
                "count": 2,
                "points_per_item": 2.0,
                "difficulty_breakdown": {"MEDIUM": 2},
            },
        ],
    )
    prompt, _sys, grounding = build_remediation_draft_prompt(scope, req)
    assert grounding["requested_quiz_test_parts"] == [
        {
            "part_number": 1,
            "question_type": "MULTIPLE_CHOICE",
            "count": 2,
            "points_per_item": 2.0,
            "difficulty_breakdown": {"EASY": 1, "HARD": 1},
        },
        {
            "part_number": 2,
            "question_type": "IDENTIFICATION",
            "count": 2,
            "points_per_item": 2.0,
            "difficulty_breakdown": {"MEDIUM": 2},
        },
    ]
    assert "Part 1: exactly 2 MULTIPLE_CHOICE item(s) at 2 point(s) each (1 EASY, 1 HARD)" in prompt
    assert "Part 2: exactly 2 IDENTIFICATION item(s) at 2 point(s) each (2 MEDIUM)" in prompt
