"""Tests for PR 2C.2: Grounded AI Remediation Draft Generation.

Verifies:
1. Grounded Quiz/Summative generation with mocked AI provider.
2. Grounded Classwork/PT generation with mocked AI provider.
3. Pre-generation validation: rejection of untaught lessons, component mismatches, format incompatibilities, insufficient evidence.
4. Provider error handling: rate limit (429) propagation, timeout (504), unavailable (503), generic failure (502).
5. Malformed response handling: recovery from markdown fences and minor defects; rejection of corrupt output.
6. Post-generation boundary validation: rejection of AI-hallucinated untaught lessons, foreign competencies, answer key leaks.
7. Database-level teacher review flow (no auto-publish, permissions check, status check).

Uses synthetic fixtures; no live Groq or Gemini requests.
"""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.models.academic.Lesson import Lesson
from app.models.academic.LessonDelivery import LessonDelivery
from app.models.academic.Competency import Competency
from app.models.intervention.Intervention import Intervention
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.RemediationDraft import (
    RemediationClassworkDraft,
    RemediationDraftGenerationRequest,
    RemediationQuizDraft,
)
from app.services.intervention.InterventionRemediationDraftGenerationService import (
    build_remediation_draft_prompt,
    clean_and_parse_provider_json,
    generate_remediation_draft,
    generate_remediation_draft_from_scope,
)
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_teacher_intervention_review import candidate_context


# ── Synthetic Scope Fixtures ──

def sample_scope():
    return {
        "scope_version": "REMEDIATION_GENERATION_EVIDENCE_V1",
        "status": "AVAILABLE",
        "academic_scope": {
            "student_id": "11111111-1111-1111-1111-111111111111",
            "class_id": 10,
            "subject_id": 20,
            "academic_period_id": 1,
            "academic_year_id": 1,
            "evidence_cutoff_at": "2026-10-15T08:00:00Z",
        },
        "evidence_level": "QUESTION_SCORE",
        "components": ["WRITTEN_WORK", "PERFORMANCE_TASK"],
        "questions": [
            {
                "quiz_question_id": 101,
                "classwork_id": 50,
                "lesson_id": 1,
                "competency_id": 10,
                "score": 0.0,
                "possible_score": 5.0,
            }
        ],
        "lessons": [
            {
                "lesson_id": 1,
                "title": "Algebraic Expressions",
                "is_taught": True,
                "taught_evidence": "TEACHER_VERIFIED_DELIVERY",
            },
            {
                "lesson_id": 2,
                "title": "Quadratic Functions",
                "is_taught": False,
                "taught_evidence": "NOT_RECORDED_AS_TAUGHT",
            },
        ],
        "competencies": [
            {
                "competency_id": 10,
                "code": "MATH-01",
                "statement": "Simplifies algebraic expressions",
            }
        ],
    }


def sample_quiz_response_dict():
    return {
        "draft_format": "QUIZ",
        "target_component": "WRITTEN_WORK",
        "grade_treatment": "WRITTEN_WORK",
        "exam_subtype": None,
        "title": "Remedial Quiz: Simplifying Expressions",
        "instructions": "Carefully solve each question.",
        "total_points": 10.0,
        "duration_minutes": 20,
        "questions": [
            {
                "question_text": "What is the simplified form of 2x + 3x?",
                "question_type": "MULTIPLE_CHOICE",
                "points": 5.0,
                "display_order": 1,
                "difficulty_level": "EASY",
                "targeted_competency_id": 10,
                "targeted_lesson_id": 1,
                "targeted_quiz_question_id": 101,
                "options": [
                    {"option_text": "5x", "option_order": 1},
                    {"option_text": "6x", "option_order": 2},
                    {"option_text": "5x^2", "option_order": 3},
                    {"option_text": "6x^2", "option_order": 4},
                ],
                "teacher_answer_key": {
                    "correct_answer": "5x",
                    "explanation": "Combining like terms gives 2x + 3x = 5x.",
                    "scoring_guide": "Full points for selecting 5x.",
                },
            },
            {
                "question_text": "Is 4(x + 2) equivalent to 4x + 8?",
                "question_type": "TRUE_FALSE",
                "points": 5.0,
                "display_order": 2,
                "difficulty_level": "EASY",
                "targeted_competency_id": 10,
                "targeted_lesson_id": 1,
                "targeted_quiz_question_id": None,
                "options": [
                    {"option_text": "True", "option_order": 1},
                    {"option_text": "False", "option_order": 2},
                ],
                "teacher_answer_key": {
                    "correct_answer": "True",
                    "explanation": "Distributing 4 gives 4*x + 4*2 = 4x + 8.",
                    "scoring_guide": "Full points for True.",
                },
            },
        ],
    }


def sample_classwork_response_dict():
    return {
        "draft_format": "CLASSWORK",
        "target_component": "PERFORMANCE_TASK",
        "grade_treatment": "PERFORMANCE_TASK",
        "title": "Performance Task: Expression Modeling",
        "description": "Model algebraic situations using concrete diagrams.",
        "student_instructions": "Follow each task step and submit your work.",
        "total_points": 20.0,
        "activity_mode": "ONLINE",
        "tasks": [
            {
                "task_number": 1,
                "title": "Diagram Construction",
                "instructions": "Draw an area model representing the distributive property for 3(x + 4).",
                "targeted_competency_id": 10,
                "targeted_lesson_id": 1,
            }
        ],
        "deliverables": [
            {
                "deliverable_name": "Area Model Worksheet",
                "deliverable_type": "DOCUMENT",
                "description": "Scanned or digital PDF of the model.",
            }
        ],
        "supported_upload_formats": [".pdf", ".docx"],
        "rubric_levels": [
            {
                "level_name": "Exemplary",
                "description": "Accurately models the expression with labeled dimensions and terms.",
                "points": 20.0,
                "display_order": 0,
            },
            {
                "level_name": "Proficient",
                "description": "Models the expression with minor arithmetic labeling errors.",
                "points": 15.0,
                "display_order": 1,
            },
            {
                "level_name": "Developing",
                "description": "Attempts model but has conceptual misunderstandings of distribution.",
                "points": 10.0,
                "display_order": 2,
            },
        ],
        "teacher_guide": {
            "exemplar_or_expected_response": "A 3 by (x + 4) rectangle split into 3x and 12 with total area 3x + 12.",
            "evaluation_notes": "Check for correct sub-areas 3x and 12.",
            "common_misconceptions": ["Multiplying only the x term and leaving 4 unmultiplied."],
        },
    }


# ── Step 1 & 2 Tests: Prompt Construction & Pre-validation ──

def test_prompt_builder_grounding_filters_untaught_lessons():
    scope = sample_scope()
    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
    )
    user_prompt, system_prompt, grounding = build_remediation_draft_prompt(scope, req)

    # Check grounding data passed to prompt
    taught_lesson_ids = [l["lesson_id"] for l in grounding["eligible_taught_lessons"]]
    assert taught_lesson_ids == [1]
    assert 2 not in taught_lesson_ids  # Lesson 2 is untaught, must be excluded!

    assert "Algebraic Expressions" in user_prompt
    assert "Quadratic Functions" not in user_prompt


def test_pre_validation_rejects_untaught_lesson_selection():
    scope = sample_scope()
    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
        selected_lesson_ids=[2],  # Lesson 2 is untaught
    )
    with pytest.raises(HTTPException) as exc:
        build_remediation_draft_prompt(scope, req)
    assert exc.value.status_code == 422
    assert "has not been verified as taught" in exc.value.detail


def test_pre_validation_rejects_foreign_lesson_selection():
    scope = sample_scope()
    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
        selected_lesson_ids=[999],
    )
    with pytest.raises(HTTPException) as exc:
        build_remediation_draft_prompt(scope, req)
    assert exc.value.status_code == 422
    assert "outside the verified evidence scope" in exc.value.detail


def test_pre_validation_rejects_foreign_competency_selection():
    scope = sample_scope()
    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
        selected_competency_ids=[888],
    )
    with pytest.raises(HTTPException) as exc:
        build_remediation_draft_prompt(scope, req)
    assert exc.value.status_code == 422
    assert "outside the verified evidence scope" in exc.value.detail


def test_pre_validation_rejects_scope_with_zero_taught_lessons():
    scope = sample_scope()
    for l in scope["lessons"]:
        l["is_taught"] = False
        l["taught_evidence"] = "NOT_RECORDED_AS_TAUGHT"

    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
    )
    with pytest.raises(HTTPException) as exc:
        build_remediation_draft_prompt(scope, req)
    assert exc.value.status_code == 422
    assert "No verified taught lessons available" in exc.value.detail


def test_pre_validation_rejects_insufficient_evidence():
    scope = sample_scope()
    scope["status"] = "INSUFFICIENT_EVIDENCE"
    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
    )
    with pytest.raises(HTTPException) as exc:
        build_remediation_draft_prompt(scope, req)
    assert exc.value.status_code == 422
    assert "Insufficient verified evidence" in exc.value.detail


def test_pre_validation_rejects_unweakened_component():
    scope = sample_scope()
    # scope only has WRITTEN_WORK and PERFORMANCE_TASK; EXAMINATION is not weak
    with pytest.raises(ValidationError):
        # Request validator enforces EXAMINATION requires exam_subtype if graded
        RemediationDraftGenerationRequest(
            draft_format="QUIZ",
            target_component="EXAMINATION",
            grade_treatment="EXAMINATION",
            exam_subtype=None,
        )

    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="EXAMINATION",
        grade_treatment="EXAMINATION",
        exam_subtype="SUMMATIVE_1",
        item_count=2,
        total_points=10.0,
    )
    with pytest.raises(HTTPException) as exc:
        build_remediation_draft_prompt(scope, req)
    assert exc.value.status_code == 422
    assert "does not match the student's verified weakest components" in exc.value.detail


def test_request_schema_rejects_incompatible_combinations():
    # PERFORMANCE_TASK in QUIZ format
    with pytest.raises(ValidationError) as exc:
        RemediationDraftGenerationRequest(
            draft_format="QUIZ",
            target_component="PERFORMANCE_TASK",
            grade_treatment="PERFORMANCE_TASK",
        )
    assert "PERFORMANCE_TASK remediation must use CLASSWORK format" in str(exc.value)

    # EXAMINATION in CLASSWORK format
    with pytest.raises(ValidationError) as exc:
        RemediationDraftGenerationRequest(
            draft_format="CLASSWORK",
            target_component="EXAMINATION",
            grade_treatment="EXAMINATION",
            exam_subtype="SUMMATIVE_1",
        )
    assert "EXAMINATION remediation must use QUIZ format" in str(exc.value)

    # Treatment mismatch
    with pytest.raises(ValidationError) as exc:
        RemediationDraftGenerationRequest(
            draft_format="QUIZ",
            target_component="WRITTEN_WORK",
            grade_treatment="PERFORMANCE_TASK",
        )
    assert "grade_treatment 'PERFORMANCE_TASK' must match target_component 'WRITTEN_WORK'" in str(exc.value)


# ── Step 3 Tests: AI Provider Mocking, Execution & Validation ──

@pytest.mark.anyio
async def test_generate_quiz_draft_success(monkeypatch):
    scope = sample_scope()
    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
    )

    mock_response = json.dumps(sample_quiz_response_dict())
    mock_generate = AsyncMock(return_value=mock_response)
    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_generate)

    draft = await generate_remediation_draft_from_scope(scope, req, staff_id="teacher-uuid")

    assert isinstance(draft, RemediationQuizDraft)
    assert draft.draft_format == "QUIZ"
    assert draft.total_points == 10.0
    assert len(draft.questions) == 2
    assert draft.questions[0].teacher_answer_key.correct_answer == "5x"
    assert draft.questions[0].targeted_lesson_id == 1
    assert draft.questions[0].targeted_competency_id == 10

    # Ensure provider was called once with max_tokens <= 4000
    mock_generate.assert_called_once()
    _, kwargs = mock_generate.call_args
    assert kwargs.get("max_tokens") == 3000
    assert kwargs.get("json_output") is True


@pytest.mark.anyio
async def test_generate_classwork_draft_success(monkeypatch):
    scope = sample_scope()
    req = RemediationDraftGenerationRequest(
        draft_format="CLASSWORK",
        target_component="PERFORMANCE_TASK",
        grade_treatment="PERFORMANCE_TASK",
        item_count=1,
        total_points=20.0,
    )

    mock_response = json.dumps(sample_classwork_response_dict())
    mock_generate = AsyncMock(return_value=mock_response)
    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_generate)

    draft = await generate_remediation_draft_from_scope(scope, req, staff_id="teacher-uuid")

    assert isinstance(draft, RemediationClassworkDraft)
    assert draft.draft_format == "CLASSWORK"
    assert draft.total_points == 20.0
    assert len(draft.tasks) == 1
    assert draft.tasks[0].targeted_lesson_id == 1
    assert draft.tasks[0].targeted_competency_id == 10
    assert draft.rubric_levels[0].points == 20.0
    assert draft.teacher_guide.exemplar_or_expected_response is not None


# ── Provider Error & Resiliency Tests ──

@pytest.mark.anyio
async def test_provider_rate_limit_429_propagated(monkeypatch):
    scope = sample_scope()
    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
    )

    rate_limit_exc = HTTPException(
        status_code=429,
        detail="AI provider rate limit reached. Continue with manual authoring or try again later.",
        headers={"Retry-After": "45"},
    )
    mock_generate = AsyncMock(side_effect=rate_limit_exc)
    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_generate)

    with pytest.raises(HTTPException) as exc:
        await generate_remediation_draft_from_scope(scope, req, staff_id="teacher-uuid")

    assert exc.value.status_code == 429
    assert exc.value.headers.get("Retry-After") == "45"
    assert "rate limit reached" in exc.value.detail


@pytest.mark.anyio
async def test_provider_timeout_504_propagated(monkeypatch):
    scope = sample_scope()
    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
    )

    mock_generate = AsyncMock(side_effect=HTTPException(504, "AI generation timed out."))
    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_generate)

    with pytest.raises(HTTPException) as exc:
        await generate_remediation_draft_from_scope(scope, req, staff_id="teacher-uuid")

    assert exc.value.status_code == 504
    assert "timed out" in exc.value.detail


@pytest.mark.anyio
async def test_provider_service_unavailable_503_propagated(monkeypatch):
    scope = sample_scope()
    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
    )

    mock_generate = AsyncMock(side_effect=HTTPException(503, "AI provider is unavailable."))
    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_generate)

    with pytest.raises(HTTPException) as exc:
        await generate_remediation_draft_from_scope(scope, req, staff_id="teacher-uuid")

    assert exc.value.status_code == 503
    assert "unavailable" in exc.value.detail


@pytest.mark.anyio
async def test_provider_markdown_fence_recovered(monkeypatch):
    scope = sample_scope()
    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
    )

    fenced_raw = f"```json\n{json.dumps(sample_quiz_response_dict())}\n```"
    mock_generate = AsyncMock(return_value=fenced_raw)
    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_generate)

    draft = await generate_remediation_draft_from_scope(scope, req, staff_id="teacher-uuid")
    assert isinstance(draft, RemediationQuizDraft)
    assert len(draft.questions) == 2


@pytest.mark.anyio
async def test_provider_trailing_comma_recovered(monkeypatch):
    scope = sample_scope()
    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
    )

    raw_with_trailing = json.dumps(sample_quiz_response_dict()).replace('}', ', }', 1)
    mock_generate = AsyncMock(return_value=raw_with_trailing)
    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_generate)

    draft = await generate_remediation_draft_from_scope(scope, req, staff_id="teacher-uuid")
    assert isinstance(draft, RemediationQuizDraft)


@pytest.mark.anyio
async def test_provider_malformed_json_raises_502(monkeypatch):
    scope = sample_scope()
    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
    )

    mock_generate = AsyncMock(return_value="I cannot create a quiz for this student.")
    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_generate)

    with pytest.raises(HTTPException) as exc:
        await generate_remediation_draft_from_scope(scope, req, staff_id="teacher-uuid")

    assert exc.value.status_code == 502
    assert "malformed remediation draft JSON" in exc.value.detail


# ── Post-generation Boundary Validation & Grounding Failures ──

@pytest.mark.anyio
async def test_ai_hallucinated_untaught_lesson_raises_502(monkeypatch):
    scope = sample_scope()
    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
    )

    bad_dict = sample_quiz_response_dict()
    # Force AI to have picked untaught lesson 2
    bad_dict["questions"][0]["targeted_lesson_id"] = 2

    mock_generate = AsyncMock(return_value=json.dumps(bad_dict))
    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_generate)

    with pytest.raises(HTTPException) as exc:
        await generate_remediation_draft_from_scope(scope, req, staff_id="teacher-uuid")

    assert exc.value.status_code == 502
    assert "failed boundary validation" in exc.value.detail
    assert "has not been verified as taught" in exc.value.detail


@pytest.mark.anyio
async def test_ai_hallucinated_unknown_competency_raises_502(monkeypatch):
    scope = sample_scope()
    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
    )

    bad_dict = sample_quiz_response_dict()
    bad_dict["questions"][0]["targeted_competency_id"] = 9999

    mock_generate = AsyncMock(return_value=json.dumps(bad_dict))
    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_generate)

    with pytest.raises(HTTPException) as exc:
        await generate_remediation_draft_from_scope(scope, req, staff_id="teacher-uuid")

    assert exc.value.status_code == 502
    assert "failed boundary validation" in exc.value.detail
    assert "Competency ID 9999 is outside" in exc.value.detail


@pytest.mark.anyio
async def test_ai_sum_of_points_mismatch_raises_502(monkeypatch):
    scope = sample_scope()
    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
    )

    bad_dict = sample_quiz_response_dict()
    # Sum of points is 5 + 2 = 7 != 10.0
    bad_dict["questions"][1]["points"] = 2.0

    mock_generate = AsyncMock(return_value=json.dumps(bad_dict))
    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_generate)

    with pytest.raises(HTTPException) as exc:
        await generate_remediation_draft_from_scope(scope, req, staff_id="teacher-uuid")

    assert exc.value.status_code == 502
    assert "failed schema validation" in exc.value.detail


@pytest.mark.anyio
async def test_ai_answer_key_leak_in_student_instructions_raises_502(monkeypatch):
    scope = sample_scope()
    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
    )

    bad_dict = sample_quiz_response_dict()
    bad_dict["instructions"] = "Note: The correct answer to question 1 is 5x."

    mock_generate = AsyncMock(return_value=json.dumps(bad_dict))
    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_generate)

    with pytest.raises(HTTPException) as exc:
        await generate_remediation_draft_from_scope(scope, req, staff_id="teacher-uuid")

    assert exc.value.status_code == 502
    assert "failed boundary validation" in exc.value.detail
    assert "leaked teacher answer key" in exc.value.detail


# ── Database & Intervention Flow Tests ──

def _mapped_records(ctx):
    competency = Competency(
        competency_code="MATH-GEN-1",
        statement="Interpret verified ratios",
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
    )
    ctx["db"].add(competency)
    ctx["db"].flush()
    lesson = Lesson(
        title="Verified ratios lesson",
        subject_id=ctx["subject"].subject_id,
        competency_id=competency.competency_id,
        is_published=True,
    )
    ctx["db"].add(lesson)
    ctx["db"].commit()
    return competency, lesson


def _question_snapshot(ctx, competency, lesson):
    from app.models.quiz.Quiz import Quiz
    from app.models.quiz.Question import Question
    from app.models.quiz.QuizQuestion import QuizQuestion
    from app.models.quiz.QuizAnswer import QuizAnswer
    from decimal import Decimal

    snapshot = deepcopy(ctx["candidate"].diagnosis_snapshot)
    activity = snapshot["supporting_activities"][0]
    quiz = Quiz(classwork_id=activity["classwork_id"], total_items=2, status="PUBLISHED")
    ctx["db"].add(quiz)
    ctx["db"].flush()
    question_rows = []
    submission = ctx["db"].get(StudentSubmission, activity["submission_id"])
    for order, awarded in enumerate((2, 0), start=1):
        question = Question(
            question_text=f"Verified ratio item {order}",
            question_type="SHORT_ANSWER",
            points=Decimal("5"),
            lesson_id=lesson.lesson_id,
        )
        ctx["db"].add(question)
        ctx["db"].flush()
        link = QuizQuestion(
            quiz_id=quiz.quiz_id,
            question_id=question.question_id,
            display_order=order,
        )
        ctx["db"].add(link)
        ctx["db"].flush()
        ctx["db"].add(
            QuizAnswer(
                submission_id=submission.submission_id,
                quiz_question_id=link.quiz_question_id,
                points_awarded=Decimal(str(awarded)),
            )
        )
        question_rows.append(link)
    ctx["db"].commit()

    snapshot["lowest_supported_competencies"] = [
        {
            "competency_id": competency.competency_id,
            "competency_statement": competency.statement,
            "percent": 20.0,
            "supporting_scores": [
                {
                    "classwork_id": activity["classwork_id"],
                    "classwork_assignment_id": activity["classwork_assignment_id"],
                    "submission_id": activity["submission_id"],
                    "quiz_question_id": question_rows[1].quiz_question_id,
                    "lesson_id": lesson.lesson_id,
                    "lesson_title": lesson.title,
                    "competency_id": competency.competency_id,
                    "score": 0.0,
                    "possible_score": 5.0,
                    "percent": 0.0,
                    "source_type": "QUIZ_QUESTION",
                    "component": "WRITTEN_WORK",
                },
            ],
        }
    ]
    ctx["candidate"].diagnosis_snapshot = snapshot
    ctx["db"].commit()
    return question_rows


@pytest.mark.anyio
async def test_db_generate_remediation_draft_active_flow(candidate_context, monkeypatch):
    ctx = candidate_context
    db = ctx["db"]
    staff_id = ctx["staff"].staff_id
    intervention = ctx["candidate"]
    intervention_id = intervention.intervention_id

    competency, lesson = _mapped_records(ctx)
    question_rows = _question_snapshot(ctx, competency, lesson)

    # Mark intervention as ACTIVE
    intervention.status = "ACTIVE"
    intervention.activated_at = datetime.now(timezone.utc)
    intervention.activated_by_staff_id = staff_id
    db.commit()

    cutoff = datetime.fromisoformat(intervention.diagnosis_snapshot["evidence_cutoff_at"])
    if cutoff.tzinfo is None:
        cutoff = cutoff.replace(tzinfo=timezone.utc)

    # Record delivery for lesson before cutoff so it qualifies as taught
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

    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=1,
        total_points=5.0,
    )

    resp = {
        "draft_format": "QUIZ",
        "target_component": "WRITTEN_WORK",
        "grade_treatment": "WRITTEN_WORK",
        "exam_subtype": None,
        "title": "Remediation Quiz: Ratios",
        "instructions": "Carefully solve the problem.",
        "total_points": 5.0,
        "duration_minutes": 15,
        "questions": [
            {
                "question_text": "What is the simplified ratio of 4:8?",
                "question_type": "SHORT_ANSWER",
                "points": 5.0,
                "display_order": 1,
                "difficulty_level": "EASY",
                "targeted_competency_id": competency.competency_id,
                "targeted_lesson_id": lesson.lesson_id,
                "targeted_quiz_question_id": question_rows[1].quiz_question_id,
                "options": [],
                "teacher_answer_key": {
                    "correct_answer": "1:2",
                    "explanation": "Divide both by 4.",
                    "scoring_guide": "Full points for 1:2.",
                },
            }
        ],
    }

    mock_generate = AsyncMock(return_value=json.dumps(resp))
    monkeypatch.setattr("app.services.ai.Provider.generate_text", mock_generate)

    draft = await generate_remediation_draft(db, staff_id, intervention_id, req)
    assert draft is not None
    assert draft.target_component == "WRITTEN_WORK"
    assert draft.total_points == 5.0

    # Verify no persistent Classwork or Quiz was created in the database
    from app.models.classwork.Classwork import Classwork
    count_classworks = db.query(Classwork).filter_by(title="Remediation Quiz: Ratios").count()
    assert count_classworks == 0


@pytest.mark.anyio
async def test_db_generate_remediation_draft_requires_active_status(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    staff_id = ctx["staff"].staff_id
    intervention = ctx["candidate"]
    assert intervention.status == "CANDIDATE"

    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
    )

    with pytest.raises(HTTPException) as exc:
        await generate_remediation_draft(db, staff_id, intervention.intervention_id, req)

    assert exc.value.status_code == 409
    assert "must be ACTIVE" in exc.value.detail


@pytest.mark.anyio
async def test_db_generate_remediation_draft_checks_teacher_permissions(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    staff_id = ctx["staff"].staff_id
    intervention = ctx["candidate"]
    intervention.status = "ACTIVE"
    intervention.activated_by_staff_id = staff_id
    intervention.activated_at = datetime.now(timezone.utc)
    db.commit()

    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
    )

    with pytest.raises(HTTPException) as exc:
        await generate_remediation_draft(db, "unauthorized-staff-uuid", intervention.intervention_id, req)

    assert exc.value.status_code == 403
    assert "teaching permissions" in exc.value.detail


@pytest.mark.anyio
async def test_db_generate_remediation_draft_nonexistent_intervention(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    staff_id = ctx["staff"].staff_id

    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        item_count=2,
        total_points=10.0,
    )

    with pytest.raises(HTTPException) as exc:
        await generate_remediation_draft(db, staff_id, 999999, req)

    assert exc.value.status_code == 404
    assert "Intervention not found" in exc.value.detail

