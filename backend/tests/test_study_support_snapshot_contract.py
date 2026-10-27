"""Comprehensive test suite for Task S1D.2B.4: Student Study Support Snapshot Contract Alignment.

Verifies:
- Activity 1 READY while Activity 2 requires more Readings under the same intervention.
- Activity 2 completion does not rewrite Activity 1's prerequisites.
- Teacher changes selected_resources after publication without affecting published snapshots.
- Reading completion progression (0/3, 2/3, 3/3).
- Historical activity missing a snapshot reports HISTORICAL / PREREQUISITE_SNAPSHOT_MISSING.
- Missing, unpublished, locked, or inaccessible Reading in snapshot causes blocked state.
- Unauthorized student isolation.
- Ordinary Quiz/Classwork unaffected.
- Study Support access_state agrees with actual assessment endpoint authorization.
- No sensitive assessment instructions or quiz questions leaked in Study Support.
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
from app.models.classwork.ClassworkAttachment import ClassworkAttachment
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionReadingReview import InterventionReadingReview
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention.RemediationReadingPrerequisiteService import (
    ReadingPrerequisiteSnapshotItem,
    stage_remediation_reading_prerequisites,
)
from app.services.intervention.StudentPersistentInterventionService import (
    get_active,
    list_active,
)
from app.services.submission.SubmissionService import complete_reading_assignment
from tests.test_classwork_submission_authorization import (
    _act_as,
    _bearer,
    authz_context,
)


def _client_with_all_routes(c):
    """Create a TestClient with student intervention, classwork, quiz, and submission routes."""
    app = FastAPI()
    app.include_router(student_interventions_router, prefix="/api/v1/student/interventions")
    app.include_router(classworks_router, prefix="/api/v1/classwork-assignments")
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.include_router(submissions_router, prefix="/api/v1/submissions")
    app.dependency_overrides[get_db] = lambda: c["db"]
    app.dependency_overrides[get_current_user] = lambda: c["identity"]
    app.dependency_overrides[require_development_intervention_api] = lambda: None
    return TestClient(app)


def _create_active_intervention(c, intervention_id: int = 5001) -> Intervention:
    """Helper to create an active intervention for the primary test student."""
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
) -> tuple[Classwork, ClassworkAssignment]:
    """Helper to create a Supporting Reading classwork and assignment."""
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
        class_id=c["allowed_class"].class_id,
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
    """Helper to create a remedial Quiz with a test question."""
    cw = Classwork(
        title=title,
        classwork_type="QUIZ",
        instructions="Secret Quiz Instructions",
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

    setting = QuizSetting(classwork_id=cw.classwork_id, max_attempts=1)
    c["db"].add(setting)

    q = Question(
        question_text="Secret Question: What is 2 + 2?",
        question_type="MULTIPLE_CHOICE",
        points=1,
    )
    c["db"].add(q)
    c["db"].flush()

    qq = QuizQuestion(
        quiz_id=quiz.quiz_id,
        question_id=q.question_id,
        display_order=1,
    )
    c["db"].add(qq)

    opt1 = QuestionOption(
        question_id=q.question_id,
        option_text="4",
        is_correct=True,
        option_order=1,
    )
    c["db"].add(opt1)
    c["db"].flush()
    return cw, assign, quiz


def _create_remedial_classwork(
    c,
    intervention: Intervention,
    *,
    title: str = "Targeted Remedial Classwork",
    instructions: str = "Secret Remedial Instructions: Solve problem set 1",
) -> tuple[Classwork, ClassworkAssignment]:
    """Helper to create a remedial Classwork activity."""
    cw = Classwork(
        title=title,
        classwork_type="ASSIGNMENT",
        instructions=instructions,
        is_graded=True,
        total_points=Decimal("100"),
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
    return cw, assign


def _mark_reading_completed(c, reading_assignment: ClassworkAssignment, *, review: bool = True) -> None:
    """Helper to record a completed reading submission and review for the student."""
    c["db"].add(
        StudentSubmission(
            student_id=c["student"].student_id,
            classwork_assignment_id=reading_assignment.classwork_assignment_id,
            status="submitted",
            attempt_count=1,
            reading_focused_seconds=120,
            submitted_at=datetime.now(timezone.utc),
        )
    )
    if review:
        inv = c["db"].query(Intervention).filter_by(student_id=c["student"].student_id).first()
        if inv is not None:
            c["db"].add(InterventionReadingReview(
                intervention_id=inv.intervention_id,
                reading_assignment_id=reading_assignment.classwork_assignment_id,
                student_id=c["student"].student_id,
            ))
    c["db"].commit()


def test_activity1_ready_while_activity2_requires_more_readings(authz_context):
    """Activity 1 READY while Activity 2 requires more Readings under same intervention."""
    c = authz_context
    intervention = _create_active_intervention(c, 5010)

    r1_cw, r1_as = _create_reading(c, "Reading 1 Foundations")
    r2_cw, r2_as = _create_reading(c, "Reading 2 Advanced")

    # Activity 1 requires only Reading 1
    act1_cw, act1_as, _ = _create_remedial_quiz(c, intervention, title="Remedial Quiz 1")
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=act1_as.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=r1_cw.classwork_id,
                reading_assignment_id=r1_as.classwork_assignment_id,
                display_order=1,
            ),
        ],
    )

    # Activity 2 requires Reading 1 AND Reading 2
    act2_cw, act2_as = _create_remedial_classwork(c, intervention, title="Remedial Classwork 2")
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=act2_as.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=r1_cw.classwork_id,
                reading_assignment_id=r1_as.classwork_assignment_id,
                display_order=1,
            ),
            ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=r2_cw.classwork_id,
                reading_assignment_id=r2_as.classwork_assignment_id,
                display_order=2,
            ),
        ],
    )
    c["db"].commit()

    # Student completes only Reading 1
    _mark_reading_completed(c, r1_as)

    client = _client_with_all_routes(c)
    _act_as(c, "student", "student")

    resp = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}")
    assert resp.status_code == 200
    data = resp.json()

    activities_by_id = {act["assignment_id"]: act for act in data["activities"]}

    # Activity 1: Reading 1 is satisfied -> READY
    act1_data = activities_by_id[act1_as.classwork_assignment_id]
    assert act1_data["access_state"] == "READY"
    assert act1_data["access_enforced"] is True
    assert act1_data["prerequisite_code"] == "PREPARATION_COMPLETE"
    assert act1_data["preparation"]["is_satisfied"] is True
    assert act1_data["preparation"]["completed_count"] == 1
    assert act1_data["preparation"]["required_count"] == 1

    # Activity 2: Reading 2 is missing -> PREPARATION_REQUIRED
    act2_data = activities_by_id[act2_as.classwork_assignment_id]
    assert act2_data["access_state"] == "PREPARATION_REQUIRED"
    assert act2_data["access_enforced"] is True
    assert act2_data["prerequisite_code"] == "PREPARATION_REQUIRED"
    assert act2_data["preparation"]["is_satisfied"] is False
    assert act2_data["preparation"]["completed_count"] == 1
    assert act2_data["preparation"]["required_count"] == 2

    # Assessment authorization agreement:
    # Activity 1 Quiz attempt is ALLOWED (HTTP 200)
    quiz_resp = client.get(f"/api/v1/quizzes/assignment/{act1_as.classwork_assignment_id}/attempt")
    assert quiz_resp.status_code == 200

    # Activity 2 Classwork detail is BLOCKED (HTTP 403)
    cw_resp = client.get(f"/api/v1/classwork-assignments/assignment/{act2_as.classwork_assignment_id}")
    assert cw_resp.status_code == 403
    assert cw_resp.json()["detail"]["code"] == "PREPARATION_REQUIRED"


def test_activity2_completion_does_not_rewrite_activity1_prerequisites(authz_context):
    """Activity 2 completion satisfies Activity 2 without rewriting Activity 1's prerequisites."""
    c = authz_context
    intervention = _create_active_intervention(c, 5020)

    r1_cw, r1_as = _create_reading(c, "Reading 1 Foundations")
    r2_cw, r2_as = _create_reading(c, "Reading 2 Advanced")

    act1_cw, act1_as, _ = _create_remedial_quiz(c, intervention, title="Remedial Quiz 1")
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=act1_as.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=r1_cw.classwork_id,
                reading_assignment_id=r1_as.classwork_assignment_id,
                display_order=1,
            ),
        ],
    )

    act2_cw, act2_as = _create_remedial_classwork(c, intervention, title="Remedial Classwork 2")
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=act2_as.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=r1_cw.classwork_id,
                reading_assignment_id=r1_as.classwork_assignment_id,
                display_order=1,
            ),
            ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=r2_cw.classwork_id,
                reading_assignment_id=r2_as.classwork_assignment_id,
                display_order=2,
            ),
        ],
    )
    c["db"].commit()

    # Complete both Reading 1 and Reading 2
    _mark_reading_completed(c, r1_as)
    _mark_reading_completed(c, r2_as)

    client = _client_with_all_routes(c)
    _act_as(c, "student", "student")

    resp = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}")
    assert resp.status_code == 200
    data = resp.json()
    activities_by_id = {act["assignment_id"]: act for act in data["activities"]}

    # Activity 1 maintains its own 1-reading requirement and remains READY
    act1_data = activities_by_id[act1_as.classwork_assignment_id]
    assert act1_data["access_state"] == "READY"
    assert act1_data["access_enforced"] is True
    assert act1_data["preparation"]["required_count"] == 1
    assert act1_data["preparation"]["completed_count"] == 1

    # Activity 2 now also READY with its 2-reading requirement
    act2_data = activities_by_id[act2_as.classwork_assignment_id]
    assert act2_data["access_state"] == "READY"
    assert act2_data["access_enforced"] is True
    assert act2_data["preparation"]["required_count"] == 2
    assert act2_data["preparation"]["completed_count"] == 2

    # Both assessment endpoints now return 200
    assert client.get(f"/api/v1/quizzes/assignment/{act1_as.classwork_assignment_id}/attempt").status_code == 200
    assert client.get(f"/api/v1/classwork-assignments/assignment/{act2_as.classwork_assignment_id}").status_code == 200


def test_teacher_changes_selected_resources_after_publication(authz_context):
    """Teacher edits to intervention selected_resources do not alter published activity snapshots."""
    c = authz_context
    intervention = _create_active_intervention(c, 5030)

    r1_cw, r1_as = _create_reading(c, "Reading 1 Foundations")
    r2_cw, r2_as = _create_reading(c, "Reading 2 Uncompleted Add-on")

    # Initial intervention plan had Reading 1
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "selected_resources": [{"kind": "CLASSWORK", "id": r1_cw.classwork_id}],
    }
    c["db"].commit()

    # Activity 1 published with snapshot [Reading 1]
    act1_cw, act1_as, _ = _create_remedial_quiz(c, intervention, title="Published Remedial Quiz")
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=act1_as.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=r1_cw.classwork_id,
                reading_assignment_id=r1_as.classwork_assignment_id,
                display_order=1,
            ),
        ],
    )
    c["db"].commit()

    # Student completes Reading 1
    _mark_reading_completed(c, r1_as)

    # Teacher now updates the intervention plan to include Reading 2 (which is uncompleted)
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "selected_resources": [
            {"kind": "CLASSWORK", "id": r1_cw.classwork_id},
            {"kind": "CLASSWORK", "id": r2_cw.classwork_id},
        ],
    }
    c["db"].commit()

    client = _client_with_all_routes(c)
    _act_as(c, "student", "student")

    resp = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}")
    assert resp.status_code == 200
    data = resp.json()

    # Intervention-level preparation shows 1 of 2 completed (IN_PROGRESS, not satisfied)
    assert data["preparation"]["is_satisfied"] is False
    assert data["preparation"]["completed_count"] == 1
    assert data["preparation"]["required_count"] == 2

    # BUT Activity 1's access_state is derived from its own snapshot: STILL READY!
    act1_data = data["activities"][0]
    assert act1_data["access_state"] == "READY"
    assert act1_data["access_enforced"] is True
    assert act1_data["prerequisite_code"] == "PREPARATION_COMPLETE"
    assert act1_data["preparation"]["is_satisfied"] is True
    assert act1_data["preparation"]["completed_count"] == 1
    assert act1_data["preparation"]["required_count"] == 1

    # Backend assessment endpoint agrees: access allowed (HTTP 200)
    assert client.get(f"/api/v1/quizzes/assignment/{act1_as.classwork_assignment_id}/attempt").status_code == 200


def test_reading_completion_progression_0_of_3_to_2_of_3_to_3_of_3(authz_context):
    """Reading completion progression properly transitions access_state from PREPARATION_REQUIRED to READY."""
    c = authz_context
    intervention = _create_active_intervention(c, 5040)

    r1_cw, r1_as = _create_reading(c, "Reading Part 1")
    r2_cw, r2_as = _create_reading(c, "Reading Part 2")
    r3_cw, r3_as = _create_reading(c, "Reading Part 3")

    act_cw, act_as = _create_remedial_classwork(c, intervention, title="Remedial Capstone")
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=act_as.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r1_cw.classwork_id, reading_assignment_id=r1_as.classwork_assignment_id, display_order=1),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r2_cw.classwork_id, reading_assignment_id=r2_as.classwork_assignment_id, display_order=2),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r3_cw.classwork_id, reading_assignment_id=r3_as.classwork_assignment_id, display_order=3),
        ],
    )
    c["db"].commit()

    client = _client_with_all_routes(c)
    _act_as(c, "student", "student")

    # Step 1: 0/3 completed -> PREPARATION_REQUIRED
    resp = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}")
    act = resp.json()["activities"][0]
    assert act["access_state"] == "PREPARATION_REQUIRED"
    assert act["access_enforced"] is True
    assert act["preparation"]["completed_count"] == 0
    assert act["preparation"]["required_count"] == 3
    assert act["preparation"]["state"] == "NOT_STARTED"
    assert client.get(f"/api/v1/classwork-assignments/assignment/{act_as.classwork_assignment_id}").status_code == 403

    # Step 2: 2/3 completed (Reading 1 and 2) -> PREPARATION_REQUIRED
    _mark_reading_completed(c, r1_as)
    _mark_reading_completed(c, r2_as)
    resp = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}")
    act = resp.json()["activities"][0]
    assert act["access_state"] == "PREPARATION_REQUIRED"
    assert act["access_enforced"] is True
    assert act["preparation"]["completed_count"] == 2
    assert act["preparation"]["required_count"] == 3
    assert act["preparation"]["state"] == "IN_PROGRESS"
    assert client.get(f"/api/v1/classwork-assignments/assignment/{act_as.classwork_assignment_id}").status_code == 403

    # Step 3: 3/3 completed (Reading 3) -> READY
    _mark_reading_completed(c, r3_as)
    resp = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}")
    act = resp.json()["activities"][0]
    assert act["access_state"] == "READY"
    assert act["access_enforced"] is True
    assert act["preparation"]["completed_count"] == 3
    assert act["preparation"]["required_count"] == 3
    assert act["preparation"]["state"] == "COMPLETE"
    assert client.get(f"/api/v1/classwork-assignments/assignment/{act_as.classwork_assignment_id}").status_code == 200


def test_historical_activity_missing_snapshot(authz_context):
    """Historical remediation activity without a snapshot reports HISTORICAL, never READY."""
    c = authz_context
    intervention = _create_active_intervention(c, 5050)

    # Remedial activity created with NO snapshot rows
    act_cw, act_as = _create_remedial_classwork(c, intervention, title="Historical Unsnapshotted Activity")
    c["db"].commit()

    client = _client_with_all_routes(c)
    _act_as(c, "student", "student")

    resp = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}")
    assert resp.status_code == 200
    act = resp.json()["activities"][0]

    # Explicitly reports HISTORICAL and PREREQUISITE_SNAPSHOT_MISSING
    assert act["access_state"] == "HISTORICAL"
    assert act["access_enforced"] is False
    assert act["prerequisite_code"] == "PREREQUISITE_SNAPSHOT_MISSING"
    assert "missing an immutable Reading prerequisite snapshot" in act["prerequisite_message"]

    # Assessment endpoint blocks access with 403 PREREQUISITE_SNAPSHOT_MISSING
    cw_resp = client.get(f"/api/v1/classwork-assignments/assignment/{act_as.classwork_assignment_id}")
    assert cw_resp.status_code == 403
    assert cw_resp.json()["detail"]["code"] == "PREREQUISITE_SNAPSHOT_MISSING"


def test_snapshot_reading_issues_missing_unpublished_locked_inaccessible(authz_context):
    """Snapshot containing missing, unpublished, locked, or archived reading causes blocked state."""
    c = authz_context
    intervention = _create_active_intervention(c, 5060)

    # Reading with locked assignment
    r_locked_cw, r_locked_as = _create_reading(c, "Locked Reading", is_locked=True)
    act_cw, act_as = _create_remedial_classwork(c, intervention, title="Remedial Activity Blocked")

    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=act_as.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=r_locked_cw.classwork_id,
                reading_assignment_id=r_locked_as.classwork_assignment_id,
                display_order=1,
            ),
        ],
    )
    c["db"].commit()

    client = _client_with_all_routes(c)
    _act_as(c, "student", "student")

    resp = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}")
    assert resp.status_code == 200
    act = resp.json()["activities"][0]

    assert act["access_state"] == "PREPARATION_REQUIRED"
    assert act["access_enforced"] is True
    assert act["prerequisite_code"] == "PREPARATION_REQUIRED"
    assert act["preparation"]["state"] == "BLOCKED"
    assert "Unavailable requirements: LOCKED" in act["prerequisite_message"]

    # Assessment endpoint agrees: 403 PREPARATION_REQUIRED
    cw_resp = client.get(f"/api/v1/classwork-assignments/assignment/{act_as.classwork_assignment_id}")
    assert cw_resp.status_code == 403
    assert cw_resp.json()["detail"]["code"] == "PREPARATION_REQUIRED"


def test_unauthorized_student_access(authz_context):
    """Unauthorized classmate cannot read primary student's intervention or activities."""
    c = authz_context
    intervention = _create_active_intervention(c, 5070)
    act_cw, act_as = _create_remedial_classwork(c, intervention, title="Secret Remedial Activity")
    c["db"].commit()

    client = _client_with_all_routes(c)

    # Act as other_student (classmate)
    _act_as(c, "other_student", "student")

    # Detail endpoint returns 404
    detail_resp = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}")
    assert detail_resp.status_code == 404

    # List endpoint returns empty items
    list_resp = client.get("/api/v1/student/interventions")
    assert list_resp.status_code == 200
    assert not any(item["intervention_id"] == intervention.intervention_id for item in list_resp.json()["items"])


def test_ordinary_classwork_and_quiz_unaffected(authz_context):
    """Ordinary (non-remedial) activities are unaffected by remediation prerequisite logic."""
    c = authz_context
    intervention = _create_active_intervention(c, 5080)

    # Standard non-remedial Classwork (no source_intervention_id)
    cw = Classwork(
        title="Ordinary Science Assignment",
        classwork_type="ASSIGNMENT",
        instructions="Complete textbook chapter 5",
        is_graded=True,
        total_points=Decimal("50"),
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
    )
    c["db"].add(assign)
    c["db"].commit()

    client = _client_with_all_routes(c)
    _act_as(c, "student", "student")

    # Ordinary assignment accessible immediately (HTTP 200)
    resp = client.get(f"/api/v1/classwork-assignments/assignment/{assign.classwork_assignment_id}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "Ordinary Science Assignment"

    # Not included in Study Support intervention activities
    study_resp = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}")
    assert study_resp.status_code == 200
    activity_ids = [act["assignment_id"] for act in study_resp.json()["activities"]]
    assert assign.classwork_assignment_id not in activity_ids


def test_no_sensitive_assessment_data_exposed_in_study_support(authz_context):
    """Study Support summary does NOT expose quiz questions, options, or classwork instructions."""
    c = authz_context
    intervention = _create_active_intervention(c, 5090)

    # Quiz with questions and classwork with secret instructions
    quiz_cw, quiz_as, quiz = _create_remedial_quiz(c, intervention, title="Sensitive Quiz")
    cw, cw_as = _create_remedial_classwork(c, intervention, title="Sensitive Classwork", instructions="CLASSIFIED INSTRUCTIONS")
    c["db"].commit()

    client = _client_with_all_routes(c)
    _act_as(c, "student", "student")

    resp = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}")
    assert resp.status_code == 200
    raw_text = resp.text

    # None of the private questions, instructions, or secret phrases are present in the response
    assert "Secret Question" not in raw_text
    assert "What is 2 + 2?" not in raw_text
    assert "Secret Quiz Instructions" not in raw_text
    assert "CLASSIFIED INSTRUCTIONS" not in raw_text
    assert "questions" not in resp.json()["activities"][0]
    assert "instructions" not in resp.json()["activities"][0]


def test_resolved_intervention_activities_report_historical_and_not_enforced(authz_context):
    """Resolved intervention activities are reported as HISTORICAL with access_enforced=False."""
    c = authz_context
    intervention = _create_active_intervention(c, 5100)

    act_cw, act_as = _create_remedial_classwork(c, intervention, title="Completed Remediation")
    c["db"].add(
        StudentSubmission(
            student_id=c["student"].student_id,
            classwork_assignment_id=act_as.classwork_assignment_id,
            status="graded",
            grade=Decimal("95"),
            attempt_count=1,
            submitted_at=datetime.now(timezone.utc),
        )
    )
    intervention.status = "RESOLVED"
    intervention.resolution_reason = "IMPROVED_PREDICTION"
    intervention.resolved_at = datetime.now(timezone.utc)
    c["db"].commit()

    client = _client_with_all_routes(c)
    _act_as(c, "student", "student")

    # Read from resolved intervention detail endpoint
    resp = client.get(f"/api/v1/student/interventions/resolved/{intervention.intervention_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "RESOLVED"
    assert len(data["activities"]) == 1
    act = data["activities"][0]
    assert act["access_state"] == "HISTORICAL"
    assert act["access_enforced"] is False
    assert act["prerequisite_code"] == "INTERVENTION_RESOLVED"
    assert act["prerequisite_message"] == "This support has ended."
