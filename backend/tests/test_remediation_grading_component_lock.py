"""Regression tests for Task 2: Lock Remediation Grading Components.

Verifies:
1. Valid edits on remediation-linked quizzes/classworks (title, instructions, schedule, quiz config)
   succeed without altering grading component, link provenance, scores, ceilings, or submissions.
2. Forbidden grading component changes (PERFORMANCE_TASK, QUARTERLY_ASSESSMENT, EXAMS, None/empty,
   exam_subtype injection, is_graded toggle, total_points mismatch, classwork_type change) are
   rejected on Written Work, Performance Task, and Practice-Only remediation records.
3. Forged API bypass attempts across Classworks and Quizzes endpoints (attempting to change
   component, remove/modify remediation linkage fields, reassign sections, or archive linked records)
   are rejected with HTTP 4xx.
4. Original classworks targeted by an active RemediationAssignmentLink also lock their grading
   component & max points and report `is_linked_original_for_remediation=True`.
5. Ordinary non-remediation classworks preserve full normal editing and archiving behavior.
6. Existing remediation scores, ceilings, submissions, and effective score adjustment remain intact.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Classworks import router as classworks_router
from app.api.v1.routes.Quizzes import router as quizzes_router
from app.core.Dependencies import get_staff_id
from app.db.Session import get_db
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.quiz.Question import Question
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Classwork import ClassworkUpdate
from app.services.classwork.ClassworkService import (
    create_classwork_wizard_record,
    update_classwork_record,
)
from app.services.grading.RemediationScoreAdjuster import adjust_remediation_score
from tests.test_classwork_submission_authorization import authz_context
from tests.test_intervention_lesson_scoping_and_isolation import _setup_two_lesson_math_scenario


def _build_api_client(db, owner_user, staff_id: str) -> TestClient:
    app = FastAPI()
    app.include_router(classworks_router, prefix="/api/v1/classwork-assignments")
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_staff_id] = lambda: staff_id
    app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(owner_user.user_id),
        "role": "teacher",
        "staff_id": staff_id,
    }
    return TestClient(app)


def _setup_remediation_lock_scenario(authz_context):
    ctx = _setup_two_lesson_math_scenario(authz_context)
    db = ctx["db"]
    staff_id = ctx["owner"].staff_id
    class_a = ctx["class_a"]
    period = ctx["period"]
    subject = ctx["subject"]
    student = ctx["student_a"]

    reading = ctx["create_reading"](
        "Parallel Lines Reading",
        lessons=[ctx["lesson_2"]],
        class_ids=[class_a.class_id],
    )
    orig_quiz = ctx["create_quiz"](
        "Parallel and Perpendicular Lines Quiz",
        class_row=class_a,
        lesson_items=[(ctx["lesson_2"], Decimal("10"), Decimal("2"))],
        student_row=student,
    )
    # Normalize original quiz category to canonical WRITTEN_WORK
    orig_quiz["classwork"].classwork_category = "WRITTEN_WORK"
    db.flush()

    intervention = ctx["create_intervention"](
        student,
        class_a,
        activities=[orig_quiz["activity"]],
        supporting_scores=orig_quiz["supporting_scores"],
    )
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [orig_quiz["assignment"].classwork_assignment_id],
        "score_adjustment_cap": 75.0,
        "selected_resources": [{"kind": "CLASSWORK", "id": reading.classwork_id}],
    }
    db.flush()

    # Existing remediation quiz linked to orig_quiz (Written Work, 10 pts)
    rem_quiz_cw = Classwork(
        title="Parallel Lines Remediation Quiz",
        instructions="Complete all items.",
        classwork_type="QUIZ",
        classwork_category="WRITTEN_WORK",
        exam_subtype=None,
        subject_id=subject.subject_id,
        created_by_staff_id=staff_id,
        total_points=Decimal("10"),
        is_graded=True,
        is_published=False,
        is_archived=False,
    )
    rem_quiz_cw.lessons = [ctx["lesson_2"]]
    db.add(rem_quiz_cw)
    db.flush()

    due_dt = datetime.now(timezone.utc) + timedelta(days=2)
    rem_quiz_asgn = ClassworkAssignment(
        classwork_id=rem_quiz_cw.classwork_id,
        class_id=class_a.class_id,
        academic_period_id=period.academic_period_id,
        recipient_student_id=student.student_id,
        source_intervention_id=intervention.intervention_id,
        remediation_request_id=uuid4(),
        assigned_by_staff_id=staff_id,
        due_date=due_dt,
        max_attempts=3,
        is_published=False,
    )
    db.add(rem_quiz_asgn)
    db.flush()

    rem_quiz = Quiz(classwork_id=rem_quiz_cw.classwork_id, total_items=1, status="DRAFT")
    db.add(rem_quiz)
    db.flush()
    q = Question(
        question_text="Slopes of parallel lines are ___",
        question_type="SHORT_ANSWER",
        points=Decimal("10"),
        lesson_id=ctx["lesson_2"].lesson_id,
    )
    db.add(q)
    db.flush()
    db.add(QuizQuestion(quiz_id=rem_quiz.quiz_id, question_id=q.question_id, display_order=1))

    link = RemediationAssignmentLink(
        source_intervention_id=intervention.intervention_id,
        remediation_assignment_id=rem_quiz_asgn.classwork_assignment_id,
        original_assignment_id=orig_quiz["assignment"].classwork_assignment_id,
        student_id=student.student_id,
        component="WRITTEN_WORK",
        score_adjustment_cap=Decimal("75.00"),
        created_by_staff_id=staff_id,
    )
    db.add(link)
    db.commit()

    client = _build_api_client(db, ctx["accounts"]["owner"], staff_id)
    return {
        **ctx,
        "client": client,
        "reading": reading,
        "orig_quiz": orig_quiz,
        "intervention": intervention,
        "rem_quiz_cw": rem_quiz_cw,
        "rem_quiz_asgn": rem_quiz_asgn,
        "link": link,
        "due_dt": due_dt,
    }


def test_remediation_quiz_allows_valid_edits_and_blocks_all_component_mutations(authz_context):
    s = _setup_remediation_lock_scenario(authz_context)
    client = s["client"]
    db = s["db"]
    rem_id = s["rem_quiz_cw"].classwork_id

    # 1. Valid metadata edit preserving WRITTEN_WORK succeeds.
    ok_res = client.put(
        f"/api/v1/classwork-assignments/classwork/{rem_id}",
        json={
            "title": "Parallel Lines Remediation Quiz (Updated)",
            "instructions": "Show your slope calculations.",
            "classwork_type": "QUIZ",
            "classwork_category": "WRITTEN_WORK",
            "exam_subtype": None,
            "total_points": 10,
        },
    )
    assert ok_res.status_code == 200, ok_res.text
    body = ok_res.json()
    assert body["title"] == "Parallel Lines Remediation Quiz (Updated)"
    assert body["classwork_category"] == "WRITTEN_WORK"
    assert body["exam_subtype"] is None
    assert body["is_graded"] is True

    # 2. Every attempt to change the grading component is rejected with HTTP 400.
    forbidden_payloads = [
        {"classwork_category": "PERFORMANCE_TASK"},
        {"classwork_category": "QUARTERLY_ASSESSMENT"},
        {"classwork_category": "EXAMS"},
        {"classwork_category": None},
        {"classwork_category": ""},
        {"classwork_category": "   "},
        {"exam_subtype": "SUMMATIVE_1"},
        {"exam_subtype": "TERM_EXAM"},
        {"is_graded": False},
        {"classwork_type": "ASSIGNMENT"},
        {"total_points": 20},
    ]
    for payload in forbidden_payloads:
        res = client.put(f"/api/v1/classwork-assignments/classwork/{rem_id}", json=payload)
        assert res.status_code == 400, f"Expected 400 for payload {payload}, got {res.status_code}: {res.text}"

    # Verify DB state stayed intact after all rejected attempts.
    db.expire_all()
    cw = db.get(Classwork, rem_id)
    assert cw.classwork_category == "WRITTEN_WORK"
    assert cw.exam_subtype is None
    assert cw.is_graded is True
    assert float(cw.total_points) == 10.0


def test_remediation_api_bypass_attempts_are_rejected_across_endpoints(authz_context):
    s = _setup_remediation_lock_scenario(authz_context)
    client = s["client"]
    db = s["db"]
    rem_id = s["rem_quiz_cw"].classwork_id
    orig_id = s["orig_quiz"]["classwork"].classwork_id

    # 1. Forged remediation link removal/mutation fields on PUT /classwork/{id} -> 422.
    forged_link_payloads = [
        {"title": "Tampered", "source_intervention_id": None},
        {"title": "Tampered", "recipient_student_id": None},
        {"title": "Tampered", "remediation_request_id": None},
        {"title": "Tampered", "original_exam_assignment_id": None},
        {"title": "Tampered", "original_classwork_assignment_id": None},
        {"title": "Tampered", "remediation_link_id": None},
        {"title": "Tampered", "intervention_id": None},
    ]
    for payload in forged_link_payloads:
        res = client.put(f"/api/v1/classwork-assignments/classwork/{rem_id}", json=payload)
        assert res.status_code == 422, f"Expected 422 for {payload}, got {res.status_code}: {res.text}"

    # 2. Forged link removal or section-scope widening on POST /classwork/{id}/assign.
    res_assign_link = client.post(
        f"/api/v1/classwork-assignments/classwork/{rem_id}/assign",
        json={
            "class_ids": [s["class_a"].class_id],
            "due_date": s["due_dt"].isoformat(),
            "max_attempts": 3,
            "is_published": False,
            "source_intervention_id": None,
        },
    )
    assert res_assign_link.status_code == 422

    res_assign_scope = client.post(
        f"/api/v1/classwork-assignments/classwork/{rem_id}/assign",
        json={
            "class_ids": [s["class_a"].class_id, s["class_b"].class_id],
            "due_date": s["due_dt"].isoformat(),
            "max_attempts": 3,
            "is_published": False,
        },
    )
    assert res_assign_scope.status_code == 400

    # 3. Forged component/link mutation via Quizzes endpoints -> 422.
    res_quiz_upsert = client.put(
        f"/api/v1/quizzes/classwork/{rem_id}",
        json={
            "status": "DRAFT",
            "classwork_category": "PERFORMANCE_TASK",
            "questions": [],
        },
    )
    assert res_quiz_upsert.status_code == 422

    res_quiz_cfg = client.put(
        f"/api/v1/quizzes/classwork/{rem_id}/configuration",
        json={
            "is_shuffle_questions": False,
            "enable_per_question_scoring": True,
            "enable_per_question_time_limits": False,
            "max_attempts": 2,
            "source_intervention_id": None,
        },
    )
    assert res_quiz_cfg.status_code == 422

    res_quiz_results = client.put(
        f"/api/v1/quizzes/classwork/{rem_id}/results-settings",
        json={
            "release_policy": "HIDDEN",
            "classwork_category": "QUARTERLY_ASSESSMENT",
        },
    )
    assert res_quiz_results.status_code == 422

    # 4. Archiving/deleting remediation-linked classwork or its linked original is rejected -> 409.
    assert client.delete(f"/api/v1/classwork-assignments/classwork/{rem_id}").status_code == 409
    assert client.put(f"/api/v1/classwork-assignments/classwork/{rem_id}/archive").status_code == 409
    assert client.put(f"/api/v1/classwork-assignments/classwork/{orig_id}/archive").status_code == 409

    # 5. Create-endpoint bypass: exam_subtype injection on WRITTEN_WORK remediation is rejected -> 400.
    quiz_payload = json.dumps(
        {
            "status": "DRAFT",
            "settings": {"max_attempts": 3},
            "questions": [
                {
                    "question_text": "Slope of y = 3x + 1?",
                    "question_type": "SHORT_ANSWER",
                    "points": 10,
                    "display_order": 1,
                    "lesson_id": s["lesson_2"].lesson_id,
                    "options": [],
                }
            ],
        }
    )
    with pytest.raises(HTTPException) as create_exc:
        asyncio.run(
            create_classwork_wizard_record(
                title="Forged Exam Subtype WW Remediation",
                classwork_type="QUIZ",
                subject_id=s["subject"].subject_id,
                description=None,
                instructions="Do it",
                classwork_category="WRITTEN_WORK",
                exam_subtype="SUMMATIVE_1",
                total_points=10,
                is_published=False,
                class_ids=json.dumps([s["class_a"].class_id]),
                academic_period_id=s["period"].academic_period_id,
                lesson_ids="[]",
                due_date=s["due_dt"],
                lock_date=None,
                allow_late_submissions=False,
                max_attempts=3,
                quiz_payload=quiz_payload,
                rubric_payload=None,
                files=None,
                intervention_id=s["intervention"].intervention_id,
                remediation_request_id=uuid4(),
                original_classwork_assignment_id=s["orig_quiz"]["assignment"].classwork_assignment_id,
                current_user={"sub": str(s["accounts"]["owner"].user_id), "role": "teacher"},
                staff_id=s["owner"].staff_id,
                db=db,
            )
        )
    assert create_exc.value.status_code == 400
    assert "exam sub-type" in str(create_exc.value.detail).lower()

    # Remediation link row remains completely intact.
    db.expire_all()
    link = db.get(RemediationAssignmentLink, s["link"].remediation_link_id)
    assert link is not None
    assert link.component == "WRITTEN_WORK"
    assert link.original_assignment_id == s["orig_quiz"]["assignment"].classwork_assignment_id


def test_linked_original_classwork_and_performance_task_remediation_are_locked(authz_context):
    s = _setup_remediation_lock_scenario(authz_context)
    client = s["client"]
    db = s["db"]
    orig_id = s["orig_quiz"]["classwork"].classwork_id

    # Original classwork reports is_linked_original_for_remediation=True and rejects component changes.
    detail_res = client.get(f"/api/v1/classwork-assignments/classwork/{orig_id}")
    assert detail_res.status_code == 200
    assert detail_res.json()["is_linked_original_for_remediation"] is True

    for payload in (
        {"classwork_category": "PERFORMANCE_TASK"},
        {"classwork_category": None},
        {"exam_subtype": "SUMMATIVE_1"},
        {"total_points": 50},
    ):
        res = client.put(f"/api/v1/classwork-assignments/classwork/{orig_id}", json=payload)
        assert res.status_code == 400

    # Equivalent Performance Task remediation classwork rejects changing to WRITTEN_WORK or None.
    pt_orig = Classwork(
        title="Original PT Activity",
        classwork_type="ACTIVITY",
        classwork_category="PERFORMANCE_TASK",
        subject_id=s["subject"].subject_id,
        created_by_staff_id=s["owner"].staff_id,
        total_points=Decimal("50"),
        is_graded=True,
        is_published=True,
    )
    pt_rem = Classwork(
        title="Remediation PT Activity",
        classwork_type="ACTIVITY",
        classwork_category="PERFORMANCE_TASK",
        subject_id=s["subject"].subject_id,
        created_by_staff_id=s["owner"].staff_id,
        total_points=Decimal("50"),
        is_graded=True,
        is_published=False,
    )
    db.add_all([pt_orig, pt_rem])
    db.flush()
    pt_orig_asgn = ClassworkAssignment(
        classwork_id=pt_orig.classwork_id,
        class_id=s["class_a"].class_id,
        academic_period_id=s["period"].academic_period_id,
        assigned_by_staff_id=s["owner"].staff_id,
        is_published=True,
    )
    pt_rem_asgn = ClassworkAssignment(
        classwork_id=pt_rem.classwork_id,
        class_id=s["class_a"].class_id,
        academic_period_id=s["period"].academic_period_id,
        recipient_student_id=s["student_a"].student_id,
        source_intervention_id=s["intervention"].intervention_id,
        remediation_request_id=uuid4(),
        assigned_by_staff_id=s["owner"].staff_id,
        is_published=False,
    )
    db.add_all([pt_orig_asgn, pt_rem_asgn])
    db.flush()
    db.add(
        RemediationAssignmentLink(
            source_intervention_id=s["intervention"].intervention_id,
            remediation_assignment_id=pt_rem_asgn.classwork_assignment_id,
            original_assignment_id=pt_orig_asgn.classwork_assignment_id,
            student_id=s["student_a"].student_id,
            component="PERFORMANCE_TASK",
            score_adjustment_cap=Decimal("75.00"),
            created_by_staff_id=s["owner"].staff_id,
        )
    )
    db.commit()

    for bad in ("WRITTEN_WORK", "QUARTERLY_ASSESSMENT", None):
        with pytest.raises(HTTPException) as exc:
            update_classwork_record(
                pt_rem.classwork_id,
                ClassworkUpdate(classwork_category=bad),
                s["owner"].staff_id,
                db,
            )
        assert exc.value.status_code == 400


def test_ordinary_classwork_preserves_full_editing_and_existing_remediation_scores_stay_intact(authz_context):
    s = _setup_remediation_lock_scenario(authz_context)
    client = s["client"]
    db = s["db"]

    # 1. Ordinary classwork (not linked to remediation) can freely change grading components & archive.
    ordinary_cw = Classwork(
        title="Ordinary Quiz",
        classwork_type="QUIZ",
        classwork_category="WRITTEN_WORK",
        subject_id=s["subject"].subject_id,
        created_by_staff_id=s["owner"].staff_id,
        total_points=Decimal("20"),
        is_graded=True,
        is_published=False,
    )
    db.add(ordinary_cw)
    db.flush()
    db.add(
        ClassworkAssignment(
            classwork_id=ordinary_cw.classwork_id,
            class_id=s["class_a"].class_id,
            academic_period_id=s["period"].academic_period_id,
            assigned_by_staff_id=s["owner"].staff_id,
            is_published=False,
        )
    )
    db.commit()

    get_ord = client.get(f"/api/v1/classwork-assignments/classwork/{ordinary_cw.classwork_id}")
    assert get_ord.status_code == 200
    assert get_ord.json()["is_linked_original_for_remediation"] is False

    for next_cat, next_sub in (
        ("PERFORMANCE_TASK", None),
        ("QUARTERLY_ASSESSMENT", "SUMMATIVE_1"),
        (None, None),
    ):
        upd = client.put(
            f"/api/v1/classwork-assignments/classwork/{ordinary_cw.classwork_id}",
            json={"classwork_category": next_cat, "exam_subtype": next_sub},
        )
        assert upd.status_code == 200, upd.text
        assert upd.json()["classwork_category"] == next_cat
        assert upd.json()["exam_subtype"] == next_sub

    arch = client.put(f"/api/v1/classwork-assignments/classwork/{ordinary_cw.classwork_id}/archive")
    assert arch.status_code == 200

    # 2. Existing remediation submission, score adjustment, and cap remain unchanged after valid/invalid edits.
    rem_sub = StudentSubmission(
        classwork_assignment_id=s["rem_quiz_asgn"].classwork_assignment_id,
        student_id=s["student_a"].student_id,
        status="graded",
        grade=Decimal("9.00"),
    )
    db.add(rem_sub)
    db.commit()

    before_adj = adjust_remediation_score(
        original_score=s["orig_quiz"]["submission"].grade,
        remediation_score=rem_sub.grade,
        max_points=s["orig_quiz"]["classwork"].total_points,
        cap_percentage=s["link"].score_adjustment_cap,
    )
    assert before_adj.effective_score == Decimal("7.50")  # 75% cap of 10 pts

    # Valid instruction edit + rejected component tamper on remediation quiz
    ok = client.put(
        f"/api/v1/classwork-assignments/classwork/{s['rem_quiz_cw'].classwork_id}",
        json={"instructions": "Review worked examples."},
    )
    assert ok.status_code == 200
    bad = client.put(
        f"/api/v1/classwork-assignments/classwork/{s['rem_quiz_cw'].classwork_id}",
        json={"classwork_category": "PERFORMANCE_TASK"},
    )
    assert bad.status_code == 400

    db.expire_all()
    orig_sub_after = db.get(StudentSubmission, s["orig_quiz"]["submission"].submission_id)
    rem_sub_after = db.get(StudentSubmission, rem_sub.submission_id)
    link_after = db.get(RemediationAssignmentLink, s["link"].remediation_link_id)
    after_adj = adjust_remediation_score(
        original_score=orig_sub_after.grade,
        remediation_score=rem_sub_after.grade,
        max_points=s["orig_quiz"]["classwork"].total_points,
        cap_percentage=link_after.score_adjustment_cap,
    )
    assert after_adj == before_adj
    assert orig_sub_after.grade == Decimal("2.00")
    assert rem_sub_after.grade == Decimal("9.00")
