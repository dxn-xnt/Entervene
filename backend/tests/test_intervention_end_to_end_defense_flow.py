"""End-to-end isolated defense-readiness flow test for Task 4.

Verifies the complete teacher + student intervention workflow on isolated test data:
1. Student risk / active intervention workspace -> correct single-lesson recommendations.
2. Zero cross-student private resources exposed in recommendations or student views.
3. Grading component lock enforced on creation and edits (Written Work stays Written Work).
4. AI Quiz Builder test-part generation validates counts, types, and locked total points
   before calling the AI provider (zero credits wasted on invalid configs).
5. Teacher review before publishing (unpublished draft editable; hidden from students until published).
6. Student-specific assignment (visible to target student only; blocked for other students).
7. Maximum 3 attempts enforced for graded remediation quizzes.
8. Reading prerequisite access & review flow before remediation quiz completion.
9. Original score-adjustment ceiling (75%) enforced on remediation grading without altering
   grading formulas or original scores.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Classworks import router as classworks_router
from app.api.v1.routes.Quizzes import router as quizzes_router
from app.api.v1.routes.StudentPersistentInterventions import (
    router as student_interventions_router,
)
from app.api.v1.routes.TeacherInterventions import router as teacher_interventions_router
from app.core.Dependencies import get_staff_id, get_student_record
from app.db.Session import get_db
from app.models.academic.LessonDelivery import LessonDelivery
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.classwork.ClassworkService import create_classwork_wizard_record
from app.services.grading.RemediationScoreAdjuster import adjust_remediation_score
from tests.test_classwork_submission_authorization import authz_context
from tests.test_intervention_lesson_scoping_and_isolation import (
    _setup_two_lesson_math_scenario,
)


def _teacher_client(db, user_id, staff_id: str) -> TestClient:
    app = FastAPI()
    app.include_router(teacher_interventions_router, prefix="/api/v1/teacher/interventions")
    app.include_router(classworks_router, prefix="/api/v1/classworks")
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_staff_id] = lambda: staff_id
    app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(user_id),
        "role": "teacher",
        "staff_id": staff_id,
    }
    return TestClient(app)


def _student_client(db, student_row) -> TestClient:
    app = FastAPI()
    app.include_router(student_interventions_router, prefix="/api/v1/student/interventions")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_student_record] = lambda: student_row
    return TestClient(app)


def test_complete_teacher_to_student_remediation_defense_flow(authz_context, monkeypatch):
    ctx = _setup_two_lesson_math_scenario(authz_context)
    db = ctx["db"]
    staff_id = ctx["owner"].staff_id
    class_a = ctx["class_a"]
    period = ctx["period"]
    subject = ctx["subject"]
    target_student = ctx["student_a"]
    other_student = ctx["student_b"]
    lesson_1 = ctx["lesson_1"]
    lesson_2 = ctx["lesson_2"]
    lesson_2.created_by_staff_id = staff_id
    competency_id = lesson_2.competency_id

    # Shared legitimate reading on Lesson 2 + unrelated reading on Lesson 1
    shared_reading_l2 = ctx["create_reading"](
        "Parallel and Perpendicular Lines Study Guide",
        lessons=[lesson_2],
        class_ids=[class_a.class_id],
    )
    unrelated_reading_l1 = ctx["create_reading"](
        "Slope Intercept Form Basics",
        lessons=[lesson_1],
        class_ids=[class_a.class_id],
    )

    # Original scored Written Work quiz for target_student (2/10 on Lesson 2 ONLY)
    orig_quiz = ctx["create_quiz"](
        "Parallel and Perpendicular Lines Quiz",
        class_row=class_a,
        lesson_items=[(lesson_2, Decimal("10"), Decimal("2"))],
        student_row=target_student,
    )
    orig_quiz["classwork"].classwork_category = "WRITTEN_WORK"
    db.flush()

    # Other student's separate active intervention & PRIVATE reading on Lesson 2
    other_quiz = ctx["create_quiz"](
        "Other Student Quiz",
        class_row=class_a,
        lesson_items=[(lesson_2, Decimal("10"), Decimal("3"))],
        student_row=other_student,
    )
    other_quiz["classwork"].classwork_category = "WRITTEN_WORK"
    other_intervention = ctx["create_intervention"](
        other_student,
        class_a,
        activities=[other_quiz["activity"]],
        supporting_scores=other_quiz["supporting_scores"],
    )
    other_private_reading = Classwork(
        title="Private Reading for Other Student Only",
        classwork_type="READING",
        classwork_category=None,
        subject_id=subject.subject_id,
        created_by_staff_id=staff_id,
        total_points=None,
        is_graded=False,
        is_published=True,
        is_archived=False,
        intervention_resource_origin_id=other_intervention.intervention_id,
        intervention_resource_recipient_scope="THIS_STUDENT",
    )
    other_private_reading.lessons = [lesson_2]
    db.add(other_private_reading)
    db.flush()
    db.add(
        ClassworkAssignment(
            classwork_id=other_private_reading.classwork_id,
            class_id=class_a.class_id,
            academic_period_id=period.academic_period_id,
            assigned_by_staff_id=staff_id,
            recipient_student_id=other_student.student_id,
            source_intervention_id=other_intervention.intervention_id,
            remediation_request_id=uuid4(),
            is_published=True,
        )
    )
    db.flush()

    # Target student's active intervention
    intervention = ctx["create_intervention"](
        target_student,
        class_a,
        activities=[orig_quiz["activity"]],
        supporting_scores=orig_quiz["supporting_scores"],
    )
    db.commit()

    teacher_client = _teacher_client(db, authz_context["accounts"]["owner"].user_id, staff_id)
    target_student_client = _student_client(db, target_student)
    other_student_client = _student_client(db, other_student)

    # ── 1 & 2. Workspace lesson scoping & zero cross-student private resources ──
    ws_resp = teacher_client.get(
        f"/api/v1/teacher/interventions/{intervention.intervention_id}/remediation",
        params={"target_assignment_id": orig_quiz["assignment"].classwork_assignment_id},
    )
    assert ws_resp.status_code == 200, ws_resp.text
    ws = ws_resp.json()

    assert ws["focus"]["lesson_ids"] == [lesson_2.lesson_id]
    assert [l["lesson_id"] for l in ws["generation_eligibility"]["eligible_taught_lessons"]] == [
        lesson_2.lesson_id
    ]
    resource_ids = {r["id"] for r in ws["resources"]}
    recommended_ids = {r["id"] for r in ws["resources"] if r["recommended"]}
    assert shared_reading_l2.classwork_id in recommended_ids
    assert unrelated_reading_l1.classwork_id not in recommended_ids
    assert other_private_reading.classwork_id not in resource_ids

    # ── 3. Save remediation plan (QUIZ, WRITTEN_WORK, 75% ceiling, shared reading) ──
    plan_resp = teacher_client.put(
        f"/api/v1/teacher/interventions/{intervention.intervention_id}/remediation",
        json={
            "teacher_choice": "QUIZ",
            "grade_treatment": "WRITTEN_WORK",
            "target_assignment_ids": [orig_quiz["assignment"].classwork_assignment_id],
            "score_adjustment_cap": 75.0,
            "selected_resources": [
                {"kind": "CLASSWORK", "id": shared_reading_l2.classwork_id}
            ],
        },
    )
    assert plan_resp.status_code == 200, plan_resp.text

    # ── 4. AI Quiz Builder generation validates inputs before provider call ──
    provider_spy = AsyncMock(side_effect=AssertionError("Provider should not be called"))
    monkeypatch.setattr(
        "app.services.intervention.InterventionRemediationDraftGenerationService.Provider.generate_text",
        provider_spy,
    )
    bad_resp = teacher_client.post(
        f"/api/v1/teacher/interventions/{intervention.intervention_id}/remediation/generate-draft",
        json={
            "draft_format": "QUIZ",
            "target_component": "WRITTEN_WORK",
            "grade_treatment": "WRITTEN_WORK",
            "target_assignment_id": orig_quiz["assignment"].classwork_assignment_id,
            "item_count": 2,
            "total_points": 10.0,
            "selected_lesson_ids": [lesson_2.lesson_id],
            "quiz_test_parts": [
                {"question_type": "ESSAY", "count": 2, "points_per_item": 5.0}
            ],
        },
    )
    assert bad_resp.status_code == 422
    assert provider_spy.call_count == 0

    ai_draft_payload = {
        "draft_format": "QUIZ",
        "target_component": "WRITTEN_WORK",
        "grade_treatment": "WRITTEN_WORK",
        "exam_subtype": None,
        "title": "Remediation Quiz: Parallel & Perpendicular Lines",
        "instructions": "Review the linked study guide, then answer all questions.",
        "total_points": 10.0,
        "duration_minutes": 20,
        "questions": [
            {
                "question_text": "What is the slope of a line parallel to y = 4x - 1?",
                "question_type": "MULTIPLE_CHOICE",
                "points": 5.0,
                "display_order": 1,
                "difficulty_level": "EASY",
                "targeted_competency_id": competency_id,
                "targeted_lesson_id": lesson_2.lesson_id,
                "options": [
                    {"option_text": "4", "option_order": 1},
                    {"option_text": "-4", "option_order": 2},
                    {"option_text": "1/4", "option_order": 3},
                    {"option_text": "-1/4", "option_order": 4},
                ],
                "teacher_answer_key": {
                    "correct_answer": "4",
                    "explanation": "Parallel lines have equal slopes.",
                },
            },
            {
                "question_text": "Perpendicular lines have slopes whose product is -1.",
                "question_type": "TRUE_FALSE",
                "points": 5.0,
                "display_order": 2,
                "difficulty_level": "MEDIUM",
                "targeted_competency_id": competency_id,
                "targeted_lesson_id": lesson_2.lesson_id,
                "options": [
                    {"option_text": "True", "option_order": 1},
                    {"option_text": "False", "option_order": 2},
                ],
                "teacher_answer_key": {
                    "correct_answer": "True",
                    "explanation": "Negative reciprocal slopes multiply to -1.",
                },
            },
        ],
    }
    monkeypatch.setattr(
        "app.services.intervention.InterventionRemediationDraftGenerationService.Provider.generate_text",
        AsyncMock(return_value=json.dumps(ai_draft_payload)),
    )

    gen_resp = teacher_client.post(
        f"/api/v1/teacher/interventions/{intervention.intervention_id}/remediation/generate-draft",
        json={
            "draft_format": "QUIZ",
            "target_component": "WRITTEN_WORK",
            "grade_treatment": "WRITTEN_WORK",
            "target_assignment_id": orig_quiz["assignment"].classwork_assignment_id,
            "item_count": 2,
            "total_points": 10.0,
            "selected_lesson_ids": [lesson_2.lesson_id],
            "selected_reading_ids": [shared_reading_l2.classwork_id],
            "quiz_test_parts": [
                {
                    "question_type": "MULTIPLE_CHOICE",
                    "count": 1,
                    "points_per_item": 5.0,
                    "difficulty_breakdown": {"EASY": 1},
                },
                {
                    "question_type": "TRUE_FALSE",
                    "count": 1,
                    "points_per_item": 5.0,
                    "difficulty_breakdown": {"MEDIUM": 1},
                },
            ],
        },
    )
    assert gen_resp.status_code == 200, gen_resp.text
    generated = gen_resp.json()
    assert len(generated["questions"]) == 2
    assert all(q["targeted_lesson_id"] == lesson_2.lesson_id for q in generated["questions"])

    # ── 5. Teacher review before publishing, component lock & max 3 attempts ──
    quiz_builder_payload = json.dumps(
        {
            "status": "DRAFT",
            "duration_minutes": 20,
            "settings": {
                "max_attempts": 3,
                "shuffle_questions": False,
                "shuffle_options": False,
                "show_correct_answers": True,
            },
            "questions": [
                {
                    "question_text": q["question_text"],
                    "question_type": (
                        "MULTIPLE_CHOICE"
                        if q["question_type"] == "TRUE_FALSE"
                        else q["question_type"]
                    ),
                    "points": q["points"],
                    "display_order": q["display_order"],
                    "difficulty_level": q["difficulty_level"],
                    "lesson_id": q["targeted_lesson_id"],
                    "options": [
                        {
                            "option_text": opt["option_text"],
                            "is_correct": (
                                opt["option_text"].casefold()
                                == q["teacher_answer_key"]["correct_answer"].casefold()
                            ),
                            "option_order": opt["option_order"],
                        }
                        for opt in q["options"]
                    ],
                }
                for q in generated["questions"]
            ],
        }
    )
    due_dt = datetime.now(timezone.utc) + timedelta(days=5)
    teacher_user_dict = {"sub": str(authz_context["accounts"]["owner"].user_id), "role": "teacher"}

    # 5a. Forged grading component (PERFORMANCE_TASK) is rejected on Quiz Builder create
    with pytest.raises(HTTPException) as forged_exc:
        asyncio.run(
            create_classwork_wizard_record(
                title=generated["title"],
                classwork_type="QUIZ",
                subject_id=subject.subject_id,
                description=None,
                instructions=generated["instructions"],
                classwork_category="PERFORMANCE_TASK",
                exam_subtype=None,
                total_points=10,
                is_published=False,
                class_ids=json.dumps([class_a.class_id]),
                academic_period_id=period.academic_period_id,
                lesson_ids=json.dumps([lesson_2.lesson_id]),
                due_date=due_dt,
                lock_date=None,
                allow_late_submissions=False,
                max_attempts=3,
                quiz_payload=quiz_builder_payload,
                rubric_payload=None,
                files=None,
                intervention_id=intervention.intervention_id,
                remediation_request_id=uuid4(),
                original_classwork_assignment_id=orig_quiz["assignment"].classwork_assignment_id,
                current_user=teacher_user_dict,
                staff_id=staff_id,
                db=db,
            )
        )
    assert forged_exc.value.status_code in (400, 422)

    # 5b. Excessive attempts (>3) rejected for graded remediation
    too_many_attempts_payload = json.dumps(
        {
            **json.loads(quiz_builder_payload),
            "settings": {
                **json.loads(quiz_builder_payload)["settings"],
                "max_attempts": 4,
            },
        }
    )
    with pytest.raises(HTTPException) as attempts_exc:
        asyncio.run(
            create_classwork_wizard_record(
                title=generated["title"],
                classwork_type="QUIZ",
                subject_id=subject.subject_id,
                description=None,
                instructions=generated["instructions"],
                classwork_category="WRITTEN_WORK",
                exam_subtype=None,
                total_points=10,
                is_published=False,
                class_ids=json.dumps([class_a.class_id]),
                academic_period_id=period.academic_period_id,
                lesson_ids=json.dumps([lesson_2.lesson_id]),
                due_date=due_dt,
                lock_date=None,
                allow_late_submissions=False,
                max_attempts=4,
                quiz_payload=too_many_attempts_payload,
                rubric_payload=None,
                files=None,
                intervention_id=intervention.intervention_id,
                remediation_request_id=uuid4(),
                original_classwork_assignment_id=orig_quiz["assignment"].classwork_assignment_id,
                current_user=teacher_user_dict,
                staff_id=staff_id,
                db=db,
            )
        )
    assert attempts_exc.value.status_code in (400, 422)

    # 5c. Save unpublished draft via Quiz Builder for teacher review (max_attempts=3, WRITTEN_WORK)
    created_cw = asyncio.run(
        create_classwork_wizard_record(
            title=generated["title"],
            classwork_type="QUIZ",
            subject_id=subject.subject_id,
            description=None,
            instructions=generated["instructions"],
            classwork_category="WRITTEN_WORK",
            exam_subtype=None,
            total_points=10,
            is_published=False,
            class_ids=json.dumps([class_a.class_id]),
            academic_period_id=period.academic_period_id,
            lesson_ids=json.dumps([lesson_2.lesson_id]),
            due_date=due_dt,
            lock_date=None,
            allow_late_submissions=False,
            max_attempts=3,
            quiz_payload=quiz_builder_payload,
            rubric_payload=None,
            files=None,
            intervention_id=intervention.intervention_id,
            remediation_request_id=uuid4(),
            original_classwork_assignment_id=orig_quiz["assignment"].classwork_assignment_id,
            current_user=teacher_user_dict,
            staff_id=staff_id,
            db=db,
        )
    )
    rem_cw_id = created_cw.classwork_id
    rem_asgn_id = created_cw.assignments[0].classwork_assignment_id
    assert created_cw.is_published is False
    assert created_cw.classwork_category == "WRITTEN_WORK"
    assert created_cw.assignments[0].source_intervention_id == intervention.intervention_id
    assert created_cw.assignments[0].max_attempts == 3

    # Unpublished draft must NOT appear in student's active intervention activities yet
    pre_publish_view = target_student_client.get("/api/v1/student/interventions")
    assert pre_publish_view.status_code == 200
    pre_titles = [
        a["title"]
        for item in pre_publish_view.json()["items"]
        for a in item["activities"]
    ]
    assert generated["title"] not in pre_titles

    # Teacher edit: forged component change rejected; valid title edit + publish succeeds
    forged_edit = teacher_client.put(
        f"/api/v1/classworks/classwork/{rem_cw_id}",
        json={"classwork_category": "QUARTERLY_ASSESSMENT"},
    )
    assert forged_edit.status_code in (400, 422)

    publish_resp = teacher_client.put(
        f"/api/v1/classworks/classwork/{rem_cw_id}",
        json={
            "title": "Reviewed Parallel & Perpendicular Remediation Quiz",
            "is_published": True,
        },
    )
    assert publish_resp.status_code == 200, publish_resp.text
    assert publish_resp.json()["is_published"] is True
    assert publish_resp.json()["classwork_category"] == "WRITTEN_WORK"

    assign_publish_resp = teacher_client.post(
        f"/api/v1/classworks/classwork/{rem_cw_id}/assign",
        json={
            "class_ids": [class_a.class_id],
            "due_date": due_dt.isoformat(),
            "max_attempts": 3,
            "is_published": True,
        },
    )
    assert assign_publish_resp.status_code == 200, assign_publish_resp.text

    # ── 6, 7, 8. Student-specific visibility & reading prerequisite enforcement ──
    target_view = target_student_client.get("/api/v1/student/interventions")
    assert target_view.status_code == 200, target_view.text
    target_items = target_view.json()["items"]
    assert len(target_items) == 1
    target_item = target_items[0]
    assert target_item["intervention_id"] == intervention.intervention_id
    assigned_titles = [a["title"] for a in target_item["activities"]]
    assert "Reviewed Parallel & Perpendicular Remediation Quiz" in assigned_titles
    reading_titles = [r["title"] for r in target_item["required_readings"]]
    assert "Parallel and Perpendicular Lines Study Guide" in reading_titles
    assert "Private Reading for Other Student Only" not in reading_titles

    # Other student does NOT see target_student's remediation quiz
    other_view = other_student_client.get("/api/v1/student/interventions")
    assert other_view.status_code == 200
    for item in other_view.json()["items"]:
        other_titles = [a["title"] for a in item["activities"]]
        assert "Reviewed Parallel & Perpendicular Remediation Quiz" not in other_titles

    # Before reviewing the prerequisite reading, reading is unreviewed and remediation is gated
    rem_assignment = db.get(ClassworkAssignment, rem_asgn_id)
    assert rem_assignment is not None
    assert rem_assignment.recipient_student_id == target_student.student_id
    target_activity_before = next(
        a for a in target_item["activities"] if a["assignment_id"] == rem_asgn_id
    )
    assert target_activity_before["access_state"] == "PREPARATION_REQUIRED"
    assert target_activity_before["max_attempts"] == 3

    # Target student marks the supporting reading as reviewed
    reading_asgn = (
        db.query(ClassworkAssignment)
        .filter_by(classwork_id=shared_reading_l2.classwork_id, class_id=class_a.class_id)
        .one()
    )
    review_resp = target_student_client.post(
        f"/api/v1/student/interventions/{intervention.intervention_id}/readings/{reading_asgn.classwork_assignment_id}/review"
    )
    assert review_resp.status_code == 200, review_resp.text

    # After reviewing the reading, prerequisite check passes on Student Interventions API!
    target_view_after = target_student_client.get("/api/v1/student/interventions")
    assert target_view_after.status_code == 200
    target_activity_after = next(
        a
        for a in target_view_after.json()["items"][0]["activities"]
        if a["assignment_id"] == rem_asgn_id
    )
    assert target_activity_after["access_state"] == "READY"
    assert target_activity_after["preparation"]["is_satisfied"] is True

    # ── 9. Score-adjustment ceiling (75%) preserved on completion ──
    link = (
        db.query(RemediationAssignmentLink)
        .filter_by(remediation_assignment_id=rem_asgn_id)
        .one()
    )
    assert float(link.score_adjustment_cap) == 75.0

    rem_sub = StudentSubmission(
        classwork_assignment_id=rem_asgn_id,
        student_id=target_student.student_id,
        status="graded",
        grade=Decimal("10.00"),
        attempt_count=1,
        submitted_at=datetime.now(timezone.utc),
        graded_at=datetime.now(timezone.utc),
    )
    db.add(rem_sub)
    db.flush()

    adjusted = adjust_remediation_score(
        original_score=Decimal("2.00"),
        remediation_score=Decimal("10.00"),
        max_points=Decimal("10.00"),
        cap_percentage=link.score_adjustment_cap,
    )
    assert adjusted.effective_score == Decimal("7.50")
    assert adjusted.original_score == Decimal("2.00")
    assert adjusted.was_adjusted is True
    assert adjusted.was_capped is True
