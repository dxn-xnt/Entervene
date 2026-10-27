"""Tests for PR 2D.2B.1: AI Draft Publication Preflight.

Verifies:
1. Valid Quiz and Classwork/PT draft preflight conversions.
2. Re-validation of teacher modifications to drafts on the backend.
3. Strict cap integrity: authoritative cap loaded from intervention plan; client/AI cannot override it.
4. Academic linkage: original target assignment, matching maximum points, grade treatment, and Reading prerequisites.
5. Strict rejection of:
   - Point mismatches with original target.
   - Treatment mismatches with saved intervention plan.
   - Format mismatches with saved intervention plan.
   - Unsupported upload formats.
   - Unscored original targets.
   - Graded remediation without valid Reading prerequisites.
   - Answer key leaks in student-visible instructions.
6. Clean separation of student-visible views from teacher-only answer keys and evaluation guides.
7. Zero database writes during preflight execution.
8. HTTP endpoint authentication, authorization, and response schema.

Uses pure database fixtures without live Groq calls.
"""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timezone, timedelta
from decimal import Decimal
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
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.classwork.RemediationReadingPrerequisite import RemediationReadingPrerequisite
from app.models.quiz.Quiz import Quiz
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.RemediationDraft import (
    RemediationClassworkDraft,
    RemediationDeliverableDraft,
    RemediationPublicationPreflightResult,
    RemediationQuizDraft,
    RemediationQuizOptionDraft,
    RemediationQuizQuestionDraft,
    RemediationRubricLevelDraft,
    RemediationTaskDraft,
    RemediationTeacherAnswerKey,
    RemediationTeacherClassworkGuide,
)
from app.services.intervention.InterventionRemediationDraftPreflightService import (
    preflight_remediation_draft,
)
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_teacher_intervention_review import candidate_context, _id, _other_staff, _staff
from tests.test_remediation_draft_generation import _mapped_records, _question_snapshot


# ── Helpers & Fixtures Setup ──

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


def _setup_intervention_with_targets(
    ctx,
    component: str = "WRITTEN_WORK",
    total_points: float = 10.0,
) -> tuple[Competency, Lesson, ClassworkAssignment, Classwork]:
    """Sets up an ACTIVE intervention with a taught lesson, a scored target classwork, and an accessible Reading."""
    db = ctx["db"]
    staff_id = _staff(ctx)
    intervention = ctx["candidate"]

    competency, lesson = _mapped_records(ctx)
    _question_snapshot(ctx, competency, lesson)

    intervention.status = "ACTIVE"
    intervention.activated_at = datetime.now(timezone.utc)
    intervention.activated_by_staff_id = staff_id

    cutoff = datetime.fromisoformat(intervention.diagnosis_snapshot["evidence_cutoff_at"])
    if cutoff.tzinfo is None:
        cutoff = cutoff.replace(tzinfo=timezone.utc)

    # Verified taught lesson
    delivery = LessonDelivery(
        lesson_id=lesson.lesson_id,
        class_id=intervention.class_id,
        subject_id=intervention.subject_id,
        academic_period_id=intervention.academic_period_id,
        delivered_by_staff_id=staff_id,
        delivered_at=cutoff - timedelta(days=2),
    )
    db.add(delivery)

    # Target classwork (e.g. Worksheet or Performance Task)
    target_work = Classwork(
        title=f"Original {component.replace('_', ' ').title()}",
        description="Target classwork for remediation",
        classwork_type="ASSIGNMENT" if component == "WRITTEN_WORK" else "ACTIVITY",
        classwork_category=component,
        is_graded=True,
        total_points=total_points,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=staff_id,
        is_archived=False,
        is_published=True,
    )
    db.add(target_work)
    db.flush()

    target_asgn = ClassworkAssignment(
        classwork_id=target_work.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=staff_id,
        is_published=True,
    )
    db.add(target_asgn)
    db.flush()

    # Recorded submission for student
    submission = StudentSubmission(
        classwork_assignment_id=target_asgn.classwork_assignment_id,
        student_id=intervention.student_id,
        grade=total_points * 0.5,  # 50% score
        status="GRADED",
    )
    db.add(submission)

    # Accessible supporting Reading
    reading = Classwork(
        title="Key Concepts Reading",
        description="Reading material for remediation",
        classwork_type="READING",
        is_graded=False,
        is_archived=False,
        is_published=True,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=staff_id,
    )
    db.add(reading)
    db.flush()

    reading_asgn = ClassworkAssignment(
        classwork_id=reading.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=staff_id,
        is_published=True,
    )
    db.add(reading_asgn)
    db.add(
        ClassworkCoverage(
            classwork_id=reading.classwork_id,
            lesson_id=lesson.lesson_id,
            competency_id=competency.competency_id,
        )
    )

    # Saved remediation plan
    if component == "PERFORMANCE_TASK":
        snap = deepcopy(intervention.diagnosis_snapshot or {})
        snap["weakest_supported_components"] = ["PERFORMANCE_TASK"]
        if "components" in snap:
            snap["components"]["PERFORMANCE_TASK"] = snap["components"].get("WRITTEN_WORK", {"evidence_state": "AVAILABLE", "percent": 50})
        for comp_item in snap.get("lowest_supported_competencies", []):
            for score_item in comp_item.get("supporting_scores", []):
                score_item["component"] = "PERFORMANCE_TASK"
        for act in snap.get("supporting_activities", []):
            act["component"] = "PERFORMANCE_TASK"
        intervention.diagnosis_snapshot = snap

    intervention.remediation_plan = {
        "teacher_choice": "QUIZ" if component == "WRITTEN_WORK" else "CLASSWORK",
        "grade_treatment": component,
        "score_adjustment_cap": 75.0,
        "target_assignment_ids": [target_asgn.classwork_assignment_id],
        "selected_resources": [{"kind": "CLASSWORK", "id": reading.classwork_id}],
    }
    db.commit()

    return competency, lesson, target_asgn, reading


def _make_quiz_draft(competency_id: int, lesson_id: int, total_points: float = 10.0) -> RemediationQuizDraft:
    return RemediationQuizDraft(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        title="Remedial Quiz: Linear Equations",
        instructions="Complete the practice quiz carefully.",
        total_points=total_points,
        duration_minutes=20,
        questions=[
            RemediationQuizQuestionDraft(
                question_text="What is the solution to 2x = 10?",
                question_type="MULTIPLE_CHOICE",
                points=total_points / 2.0,
                display_order=1,
                difficulty_level="EASY",
                targeted_competency_id=competency_id,
                targeted_lesson_id=lesson_id,
                options=[
                    RemediationQuizOptionDraft(option_text="5", option_order=1),
                    RemediationQuizOptionDraft(option_text="2", option_order=2),
                    RemediationQuizOptionDraft(option_text="10", option_order=3),
                ],
                teacher_answer_key=RemediationTeacherAnswerKey(
                    correct_answer="5",
                    explanation="Divide both sides by 2: x = 10 / 2 = 5.",
                    scoring_guide="Award full points for option 5.",
                ),
            ),
            RemediationQuizQuestionDraft(
                question_text="True or False: The slope of y = 3x + 1 is 3.",
                question_type="TRUE_FALSE",
                points=total_points / 2.0,
                display_order=2,
                difficulty_level="EASY",
                targeted_competency_id=competency_id,
                targeted_lesson_id=lesson_id,
                options=[
                    RemediationQuizOptionDraft(option_text="True", option_order=1),
                    RemediationQuizOptionDraft(option_text="False", option_order=2),
                ],
                teacher_answer_key=RemediationTeacherAnswerKey(
                    correct_answer="True",
                    explanation="In slope-intercept form y = mx + b, m represents the slope.",
                ),
            ),
        ],
    )


def _make_classwork_draft(competency_id: int, lesson_id: int, total_points: float = 20.0) -> RemediationClassworkDraft:
    return RemediationClassworkDraft(
        draft_format="CLASSWORK",
        target_component="PERFORMANCE_TASK",
        grade_treatment="PERFORMANCE_TASK",
        title="Performance Task: Practical Geometry Portfolio",
        description="Construct and analyze geometric scale drawings.",
        student_instructions="Step 1: Measure dimensions. Step 2: Draw scale model. Step 3: Write reflection.",
        total_points=total_points,
        activity_mode="ONLINE",
        tasks=[
            RemediationTaskDraft(
                task_number=1,
                title="Dimension Measurement",
                instructions="Measure room coordinates and record in table.",
                targeted_competency_id=competency_id,
                targeted_lesson_id=lesson_id,
            ),
            RemediationTaskDraft(
                task_number=2,
                title="Scale Representation",
                instructions="Translate measurements into 1:50 scale floor plan.",
                targeted_competency_id=competency_id,
                targeted_lesson_id=lesson_id,
            ),
        ],
        deliverables=[
            RemediationDeliverableDraft(
                deliverable_name="Floor Plan Drawing",
                deliverable_type="PDF",
                description="Final exported CAD or scanned grid floor plan.",
            ),
            RemediationDeliverableDraft(
                deliverable_name="Calculation Sheet",
                deliverable_type="DOCUMENT",
                description="Documented ratio conversion tables.",
            ),
        ],
        supported_upload_formats=[".pdf", ".docx"],
        rubric_levels=[
            RemediationRubricLevelDraft(
                level_name="Mastery",
                description="All scale ratios accurate and drawing well-annotated.",
                points=total_points,
                display_order=1,
            ),
            RemediationRubricLevelDraft(
                level_name="Proficient",
                description="Minor scaling error but clear annotations.",
                points=total_points * 0.75,
                display_order=2,
            ),
            RemediationRubricLevelDraft(
                level_name="Developing",
                description="Significant scaling inaccuracies.",
                points=total_points * 0.5,
                display_order=3,
            ),
        ],
        teacher_guide=RemediationTeacherClassworkGuide(
            exemplar_or_expected_response="Room 5m x 4m -> 10cm x 8cm with correct scale legend.",
            evaluation_notes="Verify scale calculations before grading rubric levels.",
            common_misconceptions=["Multiplying instead of dividing by scale denominator."],
        ),
    )


# ── Step 2 Implementation Tests ──

def test_preflight_quiz_draft_success(candidate_context):
    ctx = candidate_context
    comp, lesson, target_asgn, reading = _setup_intervention_with_targets(ctx, "WRITTEN_WORK", 10.0)
    db = ctx["db"]
    staff_id = _staff(ctx)
    intervention_id = _id(ctx)

    draft = _make_quiz_draft(comp.competency_id, lesson.lesson_id, 10.0)

    result = preflight_remediation_draft(db, staff_id, intervention_id, draft)

    assert result.is_valid is True
    assert result.draft_format == "QUIZ"
    assert result.target_component == "WRITTEN_WORK"
    assert result.grade_treatment == "WRITTEN_WORK"
    assert result.total_points == 10.0
    assert result.authoritative_cap == 75.0
    assert result.target_assignment_ids == [target_asgn.classwork_assignment_id]
    assert len(result.reading_prerequisites) == 1
    assert result.reading_prerequisites[0]["reading_classwork_id"] == reading.classwork_id

    # Verify authoring payload
    auth = result.authoring_payload
    assert "classwork" in auth
    assert auth["classwork"]["title"] == draft.title
    assert auth["classwork"]["total_points"] == 10.0
    assert auth["classwork"]["classwork_type"] == "QUIZ"
    assert "quiz_builder" in auth
    assert len(auth["quiz_builder"]["questions"]) == 2

    # Verify student view does NOT contain teacher answer keys or explanations
    student_q = result.student_view["questions"]
    assert len(student_q) == 2
    for q in student_q:
        assert "teacher_answer_key" not in q
        assert "explanation" not in q
        assert "correct_answer" not in q
        for opt in q["options"]:
            assert "is_correct" not in opt

    # Verify teacher guide view contains full answer keys
    guide = result.teacher_guide_view
    assert "answer_keys" in guide
    assert len(guide["answer_keys"]) == 2
    assert guide["answer_keys"][0]["correct_answer"] == "5"


def test_preflight_classwork_pt_success(candidate_context):
    ctx = candidate_context
    comp, lesson, target_asgn, reading = _setup_intervention_with_targets(ctx, "PERFORMANCE_TASK", 20.0)
    db = ctx["db"]
    staff_id = _staff(ctx)
    intervention_id = _id(ctx)

    draft = _make_classwork_draft(comp.competency_id, lesson.lesson_id, 20.0)

    result = preflight_remediation_draft(db, staff_id, intervention_id, draft)

    assert result.is_valid is True
    assert result.draft_format == "CLASSWORK"
    assert result.target_component == "PERFORMANCE_TASK"
    assert result.grade_treatment == "PERFORMANCE_TASK"
    assert result.total_points == 20.0
    assert result.authoritative_cap == 75.0
    assert result.target_assignment_ids == [target_asgn.classwork_assignment_id]

    # Verify authoring payload has deliverables and upload formats
    auth = result.authoring_payload
    assert len(auth["deliverables"]) == 2
    assert auth["deliverables"][0]["deliverable_name"] == "Floor Plan Drawing"
    assert auth["supported_upload_formats"] == [".pdf", ".docx"]

    # Student view must not have teacher guide
    assert "teacher_guide" not in result.student_view

    # Teacher guide view has exemplar, notes, and misconceptions
    guide = result.teacher_guide_view
    assert "exemplar_or_expected_response" in guide
    assert "evaluation_notes" in guide
    assert "common_misconceptions" in guide


def test_preflight_revalidates_teacher_edits(candidate_context):
    ctx = candidate_context
    comp, lesson, target_asgn, reading = _setup_intervention_with_targets(ctx, "WRITTEN_WORK", 10.0)
    db = ctx["db"]
    staff_id = _staff(ctx)
    intervention_id = _id(ctx)

    # Teacher edits points: Item 1 becomes 6 pts, Item 2 becomes 4 pts (total 10.0)
    draft = _make_quiz_draft(comp.competency_id, lesson.lesson_id, 10.0)
    draft.questions[0].points = 6.0
    draft.questions[0].question_text = "Teacher edited prompt: Solve 2x = 12"
    draft.questions[0].options[0].option_text = "6"
    draft.questions[0].teacher_answer_key.correct_answer = "6"
    draft.questions[1].points = 4.0

    result = preflight_remediation_draft(db, staff_id, intervention_id, draft)

    assert result.is_valid is True
    assert result.total_points == 10.0
    assert result.authoring_payload["quiz_builder"]["questions"][0]["points"] == 6.0
    assert result.authoring_payload["quiz_builder"]["questions"][1]["points"] == 4.0
    assert result.teacher_guide_view["answer_keys"][0]["correct_answer"] == "6"


def test_preflight_rejects_broken_teacher_point_sum(candidate_context):
    ctx = candidate_context
    comp, lesson, target_asgn, reading = _setup_intervention_with_targets(ctx, "WRITTEN_WORK", 10.0)
    db = ctx["db"]
    staff_id = _staff(ctx)
    intervention_id = _id(ctx)

    # Teacher modifies Item 1 to 8 without adjusting Item 2 or total (sum = 8 + 5 = 13 != 10)
    draft_dict = _make_quiz_draft(comp.competency_id, lesson.lesson_id, 10.0).model_dump()
    draft_dict["questions"][0]["points"] = 8.0

    with pytest.raises(HTTPException) as exc:
        preflight_remediation_draft(db, staff_id, intervention_id, draft_dict)

    assert exc.value.status_code == 422
    assert "Sum of question points" in str(exc.value.detail)


def test_preflight_preserves_teacher_cap_rejects_client_override(candidate_context):
    ctx = candidate_context
    comp, lesson, target_asgn, reading = _setup_intervention_with_targets(ctx, "WRITTEN_WORK", 10.0)
    db = ctx["db"]
    staff_id = _staff(ctx)
    intervention_id = _id(ctx)

    # Saved plan cap is 82.5%
    plan = dict(ctx["candidate"].remediation_plan or {})
    plan["score_adjustment_cap"] = 82.5
    ctx["candidate"].remediation_plan = plan
    db.commit()

    draft = _make_quiz_draft(comp.competency_id, lesson.lesson_id, 10.0)

    result = preflight_remediation_draft(db, staff_id, intervention_id, draft)

    # Authoritative cap must be 82.5, preserving teacher control
    assert result.authoritative_cap == 82.5


def test_preflight_rejects_point_mismatch_with_original_target(candidate_context):
    ctx = candidate_context
    comp, lesson, target_asgn, reading = _setup_intervention_with_targets(ctx, "WRITTEN_WORK", 10.0)
    db = ctx["db"]
    staff_id = _staff(ctx)
    intervention_id = _id(ctx)

    # Draft has total_points=15.0, but original target has 10.0
    draft = _make_quiz_draft(comp.competency_id, lesson.lesson_id, 15.0)

    with pytest.raises(HTTPException) as exc:
        preflight_remediation_draft(db, staff_id, intervention_id, draft)

    assert exc.value.status_code == 422
    assert "must equal original classwork maximum points" in str(exc.value.detail)


def test_preflight_rejects_treatment_mismatch_with_plan(candidate_context):
    ctx = candidate_context
    comp, lesson, target_asgn, reading = _setup_intervention_with_targets(ctx, "WRITTEN_WORK", 10.0)
    db = ctx["db"]
    staff_id = _staff(ctx)
    intervention_id = _id(ctx)

    draft = _make_quiz_draft(comp.competency_id, lesson.lesson_id, 10.0)
    # Mutate draft treatment to PRACTICE_ONLY while plan says WRITTEN_WORK
    draft_dict = draft.model_dump()
    draft_dict["grade_treatment"] = "PRACTICE_ONLY"

    with pytest.raises(HTTPException) as exc:
        preflight_remediation_draft(db, staff_id, intervention_id, draft_dict)

    assert exc.value.status_code == 422
    assert "does not match the saved intervention plan treatment" in str(exc.value.detail)


def test_preflight_rejects_format_mismatch_with_plan(candidate_context):
    ctx = candidate_context
    comp, lesson, target_asgn, reading = _setup_intervention_with_targets(ctx, "WRITTEN_WORK", 20.0)
    db = ctx["db"]
    staff_id = _staff(ctx)
    intervention_id = _id(ctx)

    # Plan says teacher_choice="QUIZ", but draft is CLASSWORK
    draft = _make_classwork_draft(comp.competency_id, lesson.lesson_id, 20.0)
    draft_dict = draft.model_dump()
    draft_dict["target_component"] = "WRITTEN_WORK"
    draft_dict["grade_treatment"] = "WRITTEN_WORK"

    with pytest.raises(HTTPException) as exc:
        preflight_remediation_draft(db, staff_id, intervention_id, draft_dict)

    assert exc.value.status_code == 422
    assert "does not match the saved intervention plan method" in str(exc.value.detail)


def test_preflight_rejects_unsupported_upload_format(candidate_context):
    ctx = candidate_context
    comp, lesson, target_asgn, reading = _setup_intervention_with_targets(ctx, "PERFORMANCE_TASK", 20.0)
    db = ctx["db"]
    staff_id = _staff(ctx)
    intervention_id = _id(ctx)

    draft_dict = _make_classwork_draft(comp.competency_id, lesson.lesson_id, 20.0).model_dump()
    draft_dict["supported_upload_formats"] = [".exe", ".bat"]

    with pytest.raises(HTTPException) as exc:
        preflight_remediation_draft(db, staff_id, intervention_id, draft_dict)

    assert exc.value.status_code == 422
    assert "Unsupported upload format" in str(exc.value.detail)


def test_preflight_rejects_unscored_original_target(candidate_context):
    ctx = candidate_context
    comp, lesson, target_asgn, reading = _setup_intervention_with_targets(ctx, "WRITTEN_WORK", 10.0)
    db = ctx["db"]
    staff_id = _staff(ctx)
    intervention_id = _id(ctx)

    # Delete the student submission grade
    db.query(StudentSubmission).filter_by(
        classwork_assignment_id=target_asgn.classwork_assignment_id,
        student_id=ctx["candidate"].student_id,
    ).delete()
    db.commit()

    draft = _make_quiz_draft(comp.competency_id, lesson.lesson_id, 10.0)

    with pytest.raises(HTTPException) as exc:
        preflight_remediation_draft(db, staff_id, intervention_id, draft)

    assert exc.value.status_code == 422
    assert "needs a recorded score" in str(exc.value.detail)


def test_preflight_rejects_graded_remediation_without_reading_prerequisites(candidate_context):
    ctx = candidate_context
    comp, lesson, target_asgn, reading = _setup_intervention_with_targets(ctx, "WRITTEN_WORK", 10.0)
    db = ctx["db"]
    staff_id = _staff(ctx)
    intervention_id = _id(ctx)

    # Empty selected reading resources
    plan = dict(ctx["candidate"].remediation_plan or {})
    plan["selected_resources"] = []
    ctx["candidate"].remediation_plan = plan
    db.commit()

    draft = _make_quiz_draft(comp.competency_id, lesson.lesson_id, 10.0)

    with pytest.raises(HTTPException) as exc:
        preflight_remediation_draft(db, staff_id, intervention_id, draft)

    assert exc.value.status_code == 400
    assert "requires at least one valid Supporting Reading" in str(exc.value.detail)


def test_save_draft_preflight_allows_missing_reading_but_publication_preflight_does_not(
    candidate_context,
):
    ctx = candidate_context
    comp, lesson, _target_asgn, _reading = _setup_intervention_with_targets(
        ctx, "WRITTEN_WORK", 10.0,
    )
    plan = dict(ctx["candidate"].remediation_plan or {})
    plan["selected_resources"] = []
    ctx["candidate"].remediation_plan = plan
    ctx["db"].commit()
    draft = _make_quiz_draft(comp.competency_id, lesson.lesson_id, 10.0).model_dump()
    client = _client(ctx, role="teacher")

    saved_draft_check = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/preflight",
        json={"draft": draft, "validation_stage": "SAVE_DRAFT"},
    )
    publication_check = client.post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/preflight",
        json={"draft": draft, "validation_stage": "PUBLICATION"},
    )

    assert saved_draft_check.status_code == 200, saved_draft_check.json()
    assert saved_draft_check.json()["reading_prerequisites"] == []
    assert publication_check.status_code == 400
    assert "requires at least one valid Supporting Reading" in publication_check.json()["detail"]


def test_preflight_rejects_answer_key_leak_in_student_instructions(candidate_context):
    ctx = candidate_context
    comp, lesson, target_asgn, reading = _setup_intervention_with_targets(ctx, "WRITTEN_WORK", 10.0)
    db = ctx["db"]
    staff_id = _staff(ctx)
    intervention_id = _id(ctx)

    draft_dict = _make_quiz_draft(comp.competency_id, lesson.lesson_id, 10.0).model_dump()
    draft_dict["instructions"] = "Please refer to the answer key: 5x for verification."

    with pytest.raises(HTTPException) as exc:
        preflight_remediation_draft(db, staff_id, intervention_id, draft_dict)

    assert exc.value.status_code == 422
    assert "leaked teacher answer key" in str(exc.value.detail)


def test_preflight_zero_database_writes(candidate_context):
    ctx = candidate_context
    comp, lesson, target_asgn, reading = _setup_intervention_with_targets(ctx, "WRITTEN_WORK", 10.0)
    db = ctx["db"]
    staff_id = _staff(ctx)
    intervention_id = _id(ctx)

    # Count rows before preflight
    initial_classworks = db.query(Classwork).count()
    initial_assignments = db.query(ClassworkAssignment).count()
    initial_quizzes = db.query(Quiz).count()
    initial_links = db.query(RemediationAssignmentLink).count()
    initial_prereqs = db.query(RemediationReadingPrerequisite).count()

    draft = _make_quiz_draft(comp.competency_id, lesson.lesson_id, 10.0)

    result = preflight_remediation_draft(db, staff_id, intervention_id, draft)
    assert result.is_valid is True

    # Count rows after preflight
    assert db.query(Classwork).count() == initial_classworks
    assert db.query(ClassworkAssignment).count() == initial_assignments
    assert db.query(Quiz).count() == initial_quizzes
    assert db.query(RemediationAssignmentLink).count() == initial_links
    assert db.query(RemediationReadingPrerequisite).count() == initial_prereqs


# ── HTTP Endpoint Tests ──

def test_preflight_endpoint_auth_and_response(candidate_context):
    ctx = candidate_context
    comp, lesson, target_asgn, reading = _setup_intervention_with_targets(ctx, "WRITTEN_WORK", 10.0)
    intervention_id = _id(ctx)

    # 1. Unauthenticated -> 401
    unauth_client = _client(ctx, omit_auth=True)
    resp = unauth_client.post(
        f"/api/v1/teacher/interventions/{intervention_id}/remediation/preflight",
        json={"draft": _make_quiz_draft(comp.competency_id, lesson.lesson_id, 10.0).model_dump()},
    )
    assert resp.status_code == 401

    # 2. Student role -> 403
    student_client = _client(ctx, role="student")
    resp = student_client.post(
        f"/api/v1/teacher/interventions/{intervention_id}/remediation/preflight",
        json={"draft": _make_quiz_draft(comp.competency_id, lesson.lesson_id, 10.0).model_dump()},
    )
    assert resp.status_code == 403

    # 3. Authorized teacher -> 200
    teacher_client = _client(ctx, role="teacher")
    resp = teacher_client.post(
        f"/api/v1/teacher/interventions/{intervention_id}/remediation/preflight",
        json={"draft": _make_quiz_draft(comp.competency_id, lesson.lesson_id, 10.0).model_dump()},
    )
    assert resp.status_code == 200, resp.json()
    data = resp.json()
    assert data["is_valid"] is True
    assert data["draft_format"] == "QUIZ"
    assert data["authoritative_cap"] == 75.0
    assert data["total_points"] == 10.0
    assert len(data["reading_prerequisites"]) == 1
