"""Comprehensive test suite for Task S1E.2A: Activity-Specific Supporting Reading API Contract.

Verifies:
1. Single activity with three snapshotted Readings returns the exact three Readings in the correct order.
2. 0/3 completed -> all three reported correctly; activity blocked.
3. 2/3 completed -> correct individual completion states; activity blocked.
4. 3/3 completed -> activity READY.
5. Multiple activities under one intervention have independent Reading lists.
6. Changing the teacher's current selected_resources does not alter previously published activity Reading lists.
7. Invalid or inaccessible Reading cannot leak private information.
8. Missing historical snapshot does not create fake Reading records or unlock the activity.
9. Unauthorized student cannot access another student's activity details.
10. Activity-specific Reading data agrees with the existing prerequisite guard.
11. No duplicate Reading assignments or incorrect ordering.
12. Resolved intervention history remains compatible.
"""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Classworks import router as classworks_router
from app.api.v1.routes.Quizzes import router as quizzes_router
from app.api.v1.routes.StudentPersistentInterventions import router as student_interventions_router
from app.api.v1.routes.Submissions import router as submissions_router
from app.api.v1.routes.TeacherInterventions import require_development_intervention_api
from app.db.Session import get_db
from app.models.academic.StudentCLass import StudentClass
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionReadingReview import InterventionReadingReview
from app.models.quiz.Question import Question
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention.RemediationPrerequisiteService import (
    evaluate_remediation_prerequisite,
)
from app.services.intervention.RemediationReadingPrerequisiteService import (
    ReadingPrerequisiteSnapshotItem,
    stage_remediation_reading_prerequisites,
)
from app.services.intervention.StudentPersistentInterventionService import (
    get_active,
    get_resolved,
    list_active,
)
from tests.test_classwork_submission_authorization import (
    _act_as,
    _bearer,
    authz_context,
)


def _client_for_student(c):
    app = FastAPI()
    app.include_router(student_interventions_router, prefix="/api/v1/student/interventions")
    app.include_router(classworks_router, prefix="/api/v1/classwork-assignments")
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.include_router(submissions_router, prefix="/api/v1/submissions")
    app.dependency_overrides[get_db] = lambda: c["db"]
    app.dependency_overrides[get_current_user] = lambda: c["identity"]
    app.dependency_overrides[require_development_intervention_api] = lambda: None
    return TestClient(app)


def _create_active_intervention(c, intervention_id: int = 6001) -> Intervention:
    intervention = Intervention(
        intervention_id=intervention_id,
        student_id=c["student"].student_id,
        class_id=c["allowed_class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        source_prediction_id=1,
        status="ACTIVE",
        diagnosis_snapshot={},
        remediation_plan={"teacher_choice": "QUIZ", "selected_resources": []},
        activated_at=datetime.now(timezone.utc),
        activated_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(intervention)
    c["db"].flush()
    return intervention


def _create_reading(
    c,
    title: str,
    *,
    is_published: bool = True,
    is_archived: bool = False,
    is_locked: bool = False,
    class_id: int | None = None,
) -> tuple[Classwork, ClassworkAssignment]:
    cw = Classwork(
        title=title,
        classwork_type="READING",
        is_graded=False,
        total_points=None,
        is_published=is_published,
        is_archived=is_archived,
        subject_id=c["subject"].subject_id,
        created_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(cw)
    c["db"].flush()

    assign = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=class_id or c["allowed_class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=c["owner"].staff_id,
        is_published=is_published,
        is_locked=is_locked,
    )
    c["db"].add(assign)
    c["db"].flush()
    return cw, assign


def _create_remedial_quiz(
    c,
    intervention: Intervention,
    *,
    title: str = "Targeted Remedial Quiz",
) -> tuple[Classwork, ClassworkAssignment, Quiz]:
    cw = Classwork(
        title=title,
        classwork_type="QUIZ",
        instructions="Secret quiz instructions",
        is_graded=True,
        total_points=Decimal("10"),
        is_published=True,
        is_archived=False,
        subject_id=c["subject"].subject_id,
        created_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(cw)
    c["db"].flush()

    assign = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=c["allowed_class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=c["owner"].staff_id,
        is_published=True,
        recipient_student_id=c["student"].student_id,
        source_intervention_id=intervention.intervention_id,
        remediation_request_id=uuid4(),
    )
    c["db"].add(assign)
    c["db"].flush()

    quiz = Quiz(
        classwork_id=cw.classwork_id,
        total_items=1,
        status="PUBLISHED",
    )
    c["db"].add(quiz)
    c["db"].flush()

    q = Question(
        question_text="Sample Remedial Question?",
        question_type="MULTIPLE_CHOICE",
        points=Decimal("10"),
    )
    c["db"].add(q)
    c["db"].flush()

    qq = QuizQuestion(
        quiz_id=quiz.quiz_id,
        question_id=q.question_id,
        display_order=1,
    )
    c["db"].add(qq)
    c["db"].flush()
    return cw, assign, quiz


def _complete_reading(c, reading_assignment: ClassworkAssignment, *, focused_seconds: int = 120, review: bool = True):
    sub = StudentSubmission(
        classwork_assignment_id=reading_assignment.classwork_assignment_id,
        student_id=c["student"].student_id,
        status="SUBMITTED",
        reading_focused_seconds=focused_seconds,
        submitted_at=datetime.now(timezone.utc),
    )
    c["db"].add(sub)
    if review:
        inv = c["db"].query(Intervention).filter_by(student_id=c["student"].student_id).first()
        if inv is not None:
            c["db"].add(InterventionReadingReview(
                intervention_id=inv.intervention_id,
                reading_assignment_id=reading_assignment.classwork_assignment_id,
                student_id=c["student"].student_id,
            ))
    c["db"].flush()
    return sub


def test_three_readings_progression_and_order(authz_context):
    """Verifies items 1, 2, 3, 4:
    - 3 snapshotted readings returned in exact order.
    - 0/3 completed -> NOT_STARTED, activity blocked.
    - 2/3 completed -> individual states reported, activity blocked.
    - 3/3 completed -> all COMPLETED, activity READY.
    """
    c = authz_context
    _act_as(c, "student", "student")
    client = _client_for_student(c)

    intervention = _create_active_intervention(c, 6010)
    cw1, asg1 = _create_reading(c, "Alpha Reading")
    cw2, asg2 = _create_reading(c, "Beta Reading")
    cw3, asg3 = _create_reading(c, "Gamma Reading")

    q_cw, q_asg, quiz = _create_remedial_quiz(c, intervention, title="3-Step Quiz")
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=q_asg.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(cw1.classwork_id, asg1.classwork_assignment_id, 1),
            ReadingPrerequisiteSnapshotItem(cw2.classwork_id, asg2.classwork_assignment_id, 2),
            ReadingPrerequisiteSnapshotItem(cw3.classwork_id, asg3.classwork_assignment_id, 3),
        ],
    )
    c["db"].commit()

    # Step A: 0/3 completed
    resp = client.get("/api/v1/student/interventions", headers=_bearer(c, "student", "student"))
    assert resp.status_code == 200
    data = resp.json()["items"][0]
    act = data["activities"][0]
    assert act["access_state"] == "PREPARATION_REQUIRED"
    assert act["access_enforced"] is True
    assert act["prerequisite_code"] == "PREPARATION_REQUIRED"
    assert act["preparation"]["completed_count"] == 0
    assert act["preparation"]["required_count"] == 3
    assert len(act["readings"]) == 3
    assert [r["order"] for r in act["readings"]] == [1, 2, 3]
    assert [r["title"] for r in act["readings"]] == ["Alpha Reading", "Beta Reading", "Gamma Reading"]
    assert all(r["completion_status"] == "NOT_STARTED" for r in act["readings"])

    # Step B: 2/3 completed
    _complete_reading(c, asg1, focused_seconds=95)
    _complete_reading(c, asg2, focused_seconds=140)
    c["db"].commit()

    resp = client.get("/api/v1/student/interventions", headers=_bearer(c, "student", "student"))
    assert resp.status_code == 200
    act = resp.json()["items"][0]["activities"][0]
    assert act["access_state"] == "PREPARATION_REQUIRED"
    assert act["access_enforced"] is True
    assert act["preparation"]["completed_count"] == 2
    assert act["preparation"]["required_count"] == 3
    assert act["readings"][0]["completion_status"] == "COMPLETED"
    assert act["readings"][0]["focused_seconds"] == 95
    assert act["readings"][0]["completed_at"] is not None
    assert act["readings"][1]["completion_status"] == "COMPLETED"
    assert act["readings"][1]["focused_seconds"] == 140
    assert act["readings"][2]["completion_status"] == "NOT_STARTED"

    # Step C: 3/3 completed -> READY
    _complete_reading(c, asg3, focused_seconds=180)
    c["db"].commit()

    resp = client.get("/api/v1/student/interventions", headers=_bearer(c, "student", "student"))
    assert resp.status_code == 200
    act = resp.json()["items"][0]["activities"][0]
    assert act["access_state"] == "READY"
    assert act["access_enforced"] is True
    assert act["prerequisite_code"] == "PREPARATION_COMPLETE"
    assert act["preparation"]["is_satisfied"] is True
    assert act["preparation"]["completed_count"] == 3
    assert all(r["completion_status"] == "COMPLETED" for r in act["readings"])


def test_multiple_activities_have_independent_reading_lists(authz_context):
    """Verifies item 5:
    Activity 1 and Activity 2 under the same intervention have completely independent reading requirements.
    """
    c = authz_context
    _act_as(c, "student", "student")
    client = _client_for_student(c)

    intervention = _create_active_intervention(c, 6020)
    cwA, asgA = _create_reading(c, "Reading A for Quiz 1")
    cwB, asgB = _create_reading(c, "Reading B for Quiz 2")
    cwC, asgC = _create_reading(c, "Reading C for Quiz 2")

    q1_cw, q1_asg, _ = _create_remedial_quiz(c, intervention, title="Remedial Quiz 1")
    q2_cw, q2_asg, _ = _create_remedial_quiz(c, intervention, title="Remedial Quiz 2")

    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=q1_asg.classwork_assignment_id,
        items=[ReadingPrerequisiteSnapshotItem(cwA.classwork_id, asgA.classwork_assignment_id, 1)],
    )
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=q2_asg.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(cwB.classwork_id, asgB.classwork_assignment_id, 1),
            ReadingPrerequisiteSnapshotItem(cwC.classwork_id, asgC.classwork_assignment_id, 2),
        ],
    )
    c["db"].commit()

    # Complete Reading A only
    _complete_reading(c, asgA)
    c["db"].commit()

    resp = client.get("/api/v1/student/interventions", headers=_bearer(c, "student", "student"))
    assert resp.status_code == 200
    activities = resp.json()["items"][0]["activities"]
    act1 = next(a for a in activities if a["assignment_id"] == q1_asg.classwork_assignment_id)
    act2 = next(a for a in activities if a["assignment_id"] == q2_asg.classwork_assignment_id)

    # Act 1 is READY with 1 reading (Reading A completed)
    assert act1["access_state"] == "READY"
    assert len(act1["readings"]) == 1
    assert act1["readings"][0]["title"] == "Reading A for Quiz 1"
    assert act1["readings"][0]["completion_status"] == "COMPLETED"

    # Act 2 is PREPARATION_REQUIRED with 2 readings (Reading B and C not started)
    assert act2["access_state"] == "PREPARATION_REQUIRED"
    assert len(act2["readings"]) == 2
    assert [r["title"] for r in act2["readings"]] == ["Reading B for Quiz 2", "Reading C for Quiz 2"]
    assert all(r["completion_status"] == "NOT_STARTED" for r in act2["readings"])


def test_changing_plan_does_not_alter_published_snapshots(authz_context):
    """Verifies item 6:
    Mutating intervention.remediation_plan['selected_resources'] does NOT alter published activity reading lists.
    """
    c = authz_context
    _act_as(c, "student", "student")
    client = _client_for_student(c)

    intervention = _create_active_intervention(c, 6030)
    cw1, asg1 = _create_reading(c, "Original Reading 1")
    cw2, asg2 = _create_reading(c, "Original Reading 2")

    q_cw, q_asg, _ = _create_remedial_quiz(c, intervention, title="Immutable Snapshot Quiz")
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=q_asg.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(cw1.classwork_id, asg1.classwork_assignment_id, 1),
            ReadingPrerequisiteSnapshotItem(cw2.classwork_id, asg2.classwork_assignment_id, 2),
        ],
    )
    c["db"].commit()

    # Now teacher changes selected_resources on intervention to completely different IDs
    cw_new, asg_new = _create_reading(c, "Brand New Teacher Plan Reading")
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "selected_resources": [{"id": cw_new.classwork_id, "kind": "CLASSWORK"}],
    }
    c["db"].add(intervention)
    c["db"].commit()

    resp = client.get("/api/v1/student/interventions", headers=_bearer(c, "student", "student"))
    assert resp.status_code == 200
    data = resp.json()["items"][0]

    # Top-level required_readings reflects the new plan (backward-compatible)
    assert len(data["required_readings"]) == 1
    assert data["required_readings"][0]["title"] == "Brand New Teacher Plan Reading"

    # But the published activity's readings strictly preserve the immutable snapshot!
    act = data["activities"][0]
    assert len(act["readings"]) == 2
    assert [r["title"] for r in act["readings"]] == ["Original Reading 1", "Original Reading 2"]


def test_inaccessible_reading_does_not_leak_info_and_blocks_activity(authz_context):
    """Verifies item 7:
    Inaccessible Reading (e.g. In another class or unpublished) does NOT leak its title in readings,
    and the activity remains BLOCKED.
    """
    c = authz_context
    _act_as(c, "student", "student")
    client = _client_for_student(c)

    intervention = _create_active_intervention(c, 6040)
    cw_pub, asg_pub = _create_reading(c, "Legitimate Reading")
    cw_secret, asg_secret = _create_reading(c, "SECRET Admin Only Material", is_published=False)

    q_cw, q_asg, _ = _create_remedial_quiz(c, intervention, title="Quiz with Secret Prereq")
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=q_asg.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(cw_pub.classwork_id, asg_pub.classwork_assignment_id, 1),
            ReadingPrerequisiteSnapshotItem(cw_secret.classwork_id, asg_secret.classwork_assignment_id, 2),
        ],
    )
    c["db"].commit()

    resp = client.get("/api/v1/student/interventions", headers=_bearer(c, "student", "student"))
    assert resp.status_code == 200
    act = resp.json()["items"][0]["activities"][0]

    # Must be BLOCKED
    assert act["access_state"] == "PREPARATION_REQUIRED"
    assert act["preparation"]["state"] == "BLOCKED"
    assert act["preparation"]["required_count"] == 2
    assert act["preparation"]["accessible_count"] == 1
    assert act["preparation"]["unavailable_count"] == 1

    # Secret title must NOT leak in readings
    assert len(act["readings"]) == 1
    assert act["readings"][0]["title"] == "Legitimate Reading"
    assert all("SECRET" not in r["title"] for r in act["readings"])


def test_missing_historical_snapshot_does_not_fabricate_readings(authz_context):
    """Verifies item 8:
    A published historical remediation activity missing a snapshot returns HISTORICAL,
    readings = [], and PREREQUISITE_SNAPSHOT_MISSING without fake records.
    """
    c = authz_context
    _act_as(c, "student", "student")
    client = _client_for_student(c)

    intervention = _create_active_intervention(c, 6050)
    q_cw, q_asg, _ = _create_remedial_quiz(c, intervention, title="Historical Activity Without Snapshot")
    # No snapshot staged!
    c["db"].commit()

    resp = client.get("/api/v1/student/interventions", headers=_bearer(c, "student", "student"))
    assert resp.status_code == 200
    act = resp.json()["items"][0]["activities"][0]

    assert act["access_state"] == "HISTORICAL"
    assert act["access_enforced"] is False
    assert act["prerequisite_code"] == "PREREQUISITE_SNAPSHOT_MISSING"
    assert act["readings"] == []


def test_unauthorized_student_isolation(authz_context):
    """Verifies item 9:
    Student A cannot read Student B's intervention or activity details.
    """
    c = authz_context
    intervention = _create_active_intervention(c, 6060)
    cw, asg = _create_reading(c, "Student A Reading")
    q_cw, q_asg, _ = _create_remedial_quiz(c, intervention, title="Student A Quiz")
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=q_asg.classwork_assignment_id,
        items=[ReadingPrerequisiteSnapshotItem(cw.classwork_id, asg.classwork_assignment_id, 1)],
    )
    c["db"].commit()

    # Another student queries
    _act_as(c, "other_student", "student")
    client = _client_for_student(c)

    # List only returns Student B's own items (empty)
    resp = client.get("/api/v1/student/interventions", headers=_bearer(c, "other_student", "student"))
    assert resp.status_code == 200
    assert len(resp.json()["items"]) == 0

    # Direct ID read returns 404
    direct_resp = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}", headers=_bearer(c, "other_student", "student"))
    assert direct_resp.status_code == 404


def test_activity_readings_agree_with_prerequisite_guard(authz_context):
    """Verifies item 10:
    The returned readings and preparation exactly match evaluate_remediation_prerequisite().
    """
    c = authz_context
    intervention = _create_active_intervention(c, 6070)
    cw1, asg1 = _create_reading(c, "Matching Reading 1")
    cw2, asg2 = _create_reading(c, "Matching Reading 2")

    q_cw, q_asg, _ = _create_remedial_quiz(c, intervention, title="Agreement Quiz")
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=q_asg.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(cw1.classwork_id, asg1.classwork_assignment_id, 1),
            ReadingPrerequisiteSnapshotItem(cw2.classwork_id, asg2.classwork_assignment_id, 2),
        ],
    )
    _complete_reading(c, asg1, focused_seconds=60)
    c["db"].commit()

    # Evaluate using the service guard directly
    decision = evaluate_remediation_prerequisite(c["db"], q_asg, c["student"])
    assert len(decision.readings) == 2
    assert decision.readings[0].completion_status == "COMPLETED"
    assert decision.readings[1].completion_status == "NOT_STARTED"

    # Evaluate via Study Support API
    _act_as(c, "student", "student")
    client = _client_for_student(c)
    resp = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}", headers=_bearer(c, "student", "student"))
    assert resp.status_code == 200
    act = resp.json()["activities"][0]

    assert len(act["readings"]) == len(decision.readings)
    for api_r, dec_r in zip(act["readings"], decision.readings):
        assert api_r["assignment_id"] == dec_r.assignment_id
        assert api_r["classwork_id"] == dec_r.classwork_id
        assert api_r["title"] == dec_r.title
        assert api_r["order"] == dec_r.order
        assert api_r["completion_status"] == dec_r.completion_status
        assert api_r["focused_seconds"] == dec_r.focused_seconds


def test_resolved_intervention_history_remains_compatible(authz_context):
    """Verifies item 12:
    Resolved interventions return readings = [] for all activities and access_state = HISTORICAL.
    """
    c = authz_context
    intervention = _create_active_intervention(c, 6080)
    q_cw, q_asg, _ = _create_remedial_quiz(c, intervention, title="Resolved Intervention Quiz")
    c["db"].commit()

    # Mark intervention RESOLVED
    intervention.status = "RESOLVED"
    intervention.resolved_at = datetime.now(timezone.utc)
    intervention.resolution_reason = "IMPROVED_PREDICTION"
    c["db"].add(intervention)
    c["db"].commit()

    _act_as(c, "student", "student")
    client = _client_for_student(c)

    resp = client.get("/api/v1/student/interventions/resolved", headers=_bearer(c, "student", "student"))
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) == 1
    act = items[0]["activities"][0]
    assert act["access_state"] == "HISTORICAL"
    assert act["access_enforced"] is False
    assert act["prerequisite_code"] == "INTERVENTION_RESOLVED"
    assert act["readings"] == []


def test_no_duplicate_reading_assignments_and_contiguous_ordering(authz_context):
    """Verifies item 11:
    Duplicate Reading assignments and non-contiguous/non-1-based ordering are rejected by the snapshot contract.
    """
    from fastapi import HTTPException
    c = authz_context
    intervention = _create_active_intervention(c, 6090)
    cw1, asg1 = _create_reading(c, "Reading 1")
    cw2, asg2 = _create_reading(c, "Reading 2")
    q_cw, q_asg, _ = _create_remedial_quiz(c, intervention, title="Validation Quiz")

    # Duplicate reading assignments rejected
    with pytest.raises(HTTPException) as exc_dup:
        stage_remediation_reading_prerequisites(
            c["db"],
            remediation_assignment_id=q_asg.classwork_assignment_id,
            items=[
                ReadingPrerequisiteSnapshotItem(cw1.classwork_id, asg1.classwork_assignment_id, 1),
                ReadingPrerequisiteSnapshotItem(cw1.classwork_id, asg1.classwork_assignment_id, 2),
            ],
        )
    assert exc_dup.value.status_code == 400
    assert "appear only once" in exc_dup.value.detail

    # Non-contiguous ordering rejected (starts at 2)
    with pytest.raises(HTTPException) as exc_order:
        stage_remediation_reading_prerequisites(
            c["db"],
            remediation_assignment_id=q_asg.classwork_assignment_id,
            items=[
                ReadingPrerequisiteSnapshotItem(cw1.classwork_id, asg1.classwork_assignment_id, 2),
                ReadingPrerequisiteSnapshotItem(cw2.classwork_id, asg2.classwork_assignment_id, 3),
            ],
        )
    assert exc_order.value.status_code == 400
    assert "start at 1" in exc_order.value.detail


def test_actual_serialized_response_demonstration(authz_context):
    """Generates and asserts actual serialized API responses for documentation/verification."""
    import json
    c = authz_context
    _act_as(c, "student", "student")
    client = _client_for_student(c)

    intervention = _create_active_intervention(c, 7001)
    cw1, asg1 = _create_reading(c, "Quadratic Equations Intro")
    cw2, asg2 = _create_reading(c, "Factoring Polynomials")
    q_cw, q_asg, _ = _create_remedial_quiz(c, intervention, title="Unit 2 Remedial Assessment")

    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=q_asg.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(cw1.classwork_id, asg1.classwork_assignment_id, 1),
            ReadingPrerequisiteSnapshotItem(cw2.classwork_id, asg2.classwork_assignment_id, 2),
        ],
    )
    c["db"].commit()

    # 1. Locked (0/2 completed)
    resp_locked = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}", headers=_bearer(c, "student", "student"))
    assert resp_locked.status_code == 200
    print("\n=== ACTUAL SERIALIZED RESPONSE (LOCKED) ===")
    print(json.dumps(resp_locked.json(), indent=2))

    # 2. Unlocked (2/2 completed)
    _complete_reading(c, asg1, focused_seconds=120)
    _complete_reading(c, asg2, focused_seconds=300)
    c["db"].commit()

    resp_unlocked = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}", headers=_bearer(c, "student", "student"))
    assert resp_unlocked.status_code == 200
    print("\n=== ACTUAL SERIALIZED RESPONSE (UNLOCKED) ===")
    print(json.dumps(resp_unlocked.json(), indent=2))


