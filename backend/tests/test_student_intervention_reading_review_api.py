"""Test suite for Step 2 & 3: Student Intervention Reading Review API.

Verifies:
1. Ownership: Only the owning enrolled student can mark a Reading as reviewed.
2. Snapshot membership: Only Readings in an immutable prerequisite snapshot of a
   published remediation activity under the active intervention can be reviewed.
3. Inaccessible/Unrelated Readings return 404 or 403.
4. Active status: Inactive (candidate or resolved) interventions return 400.
5. Idempotency: Repeated review requests return 200 with the identical review record
   and do not create duplicate database rows.
6. Persisted response data: The student Reading response schemas
   (StudentRequiredReading in required_readings and activities[].readings)
   expose review_status and reviewed_at matching persisted review acknowledgments.
7. Separation: Ordinary Reading completion (StudentSubmission) remains completely
   independent and uncorrupted.
8. Scoping: A review in Intervention A does not mark the Reading reviewed in Intervention B.
9. Contract: StudentReadingReviewResponse includes review_id, intervention_id,
   reading_assignment_id, assignment_id, student_id, review_status, reviewed_at, acknowledged_at.
"""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Classworks import router as classworks_router
from app.api.v1.routes.StudentPersistentInterventions import router as student_interventions_router
from app.api.v1.routes.Submissions import router as submissions_router
from app.api.v1.routes.TeacherInterventions import require_development_intervention_api
from app.db.Session import get_db
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionReadingReview import InterventionReadingReview
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention.RemediationReadingPrerequisiteService import (
    ReadingPrerequisiteSnapshotItem,
    stage_remediation_reading_prerequisites,
)
from app.services.submission.SubmissionService import complete_reading_assignment
from tests.test_classwork_submission_authorization import (
    _act_as,
    _bearer,
    authz_context,
)


def _client_for_student(c):
    app = FastAPI()
    app.include_router(student_interventions_router, prefix="/api/v1/student/interventions")
    app.include_router(classworks_router, prefix="/api/v1/classwork-assignments")
    app.include_router(submissions_router, prefix="/api/v1/submissions")
    app.dependency_overrides[get_db] = lambda: c["db"]
    app.dependency_overrides[get_current_user] = lambda: c["identity"]
    app.dependency_overrides[require_development_intervention_api] = lambda: None
    return TestClient(app)


def _create_active_intervention(
    c,
    intervention_id: int = 7001,
    subject_id: int | None = None,
    source_prediction_id: int | None = None,
) -> Intervention:
    sid = subject_id or c["subject"].subject_id
    pid = source_prediction_id or intervention_id
    intervention = Intervention(
        intervention_id=intervention_id,
        student_id=c["student"].student_id,
        class_id=c["allowed_class"].class_id,
        subject_id=sid,
        academic_period_id=c["period"].academic_period_id,
        source_prediction_id=pid,
        status="ACTIVE",
        diagnosis_snapshot={},
        remediation_plan={"teacher_choice": "QUIZ", "selected_resources": []},
        activated_at=datetime.now(timezone.utc),
        activated_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(intervention)
    c["db"].commit()
    return intervention


def _setup_intervention_with_reading(c, intervention_id: int = 7001, subject=None):
    db = c["db"]
    subj = subject or c["subject"]
    intervention = _create_active_intervention(c, intervention_id=intervention_id, subject_id=subj.subject_id)

    # Supporting Reading
    reading_cw = Classwork(
        title="Chapter 1 Guide",
        classwork_type="READING",
        is_graded=False,
        subject_id=subj.subject_id,
        created_by_staff_id=c["owner"].staff_id,
        is_published=True,
    )
    db.add(reading_cw)
    db.flush()

    reading_assign = ClassworkAssignment(
        classwork_id=reading_cw.classwork_id,
        class_id=c["allowed_class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=c["owner"].staff_id,
        is_published=True,
    )
    db.add(reading_assign)
    db.flush()

    # Remediation Activity
    remediation_cw = Classwork(
        title="Remedial Quiz 1",
        classwork_type="QUIZ",
        is_graded=True,
        total_points=Decimal("20.00"),
        subject_id=subj.subject_id,
        created_by_staff_id=c["owner"].staff_id,
        is_published=True,
    )
    db.add(remediation_cw)
    db.flush()

    remediation_assign = ClassworkAssignment(
        classwork_id=remediation_cw.classwork_id,
        class_id=c["allowed_class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=c["owner"].staff_id,
        is_published=True,
        recipient_student_id=c["student"].student_id,
        source_intervention_id=intervention.intervention_id,
        remediation_request_id=uuid4(),
    )
    db.add(remediation_assign)
    db.flush()

    # Stage immutable prerequisite snapshot
    stage_remediation_reading_prerequisites(
        db,
        remediation_assignment_id=remediation_assign.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=reading_cw.classwork_id,
                reading_assignment_id=reading_assign.classwork_assignment_id,
                display_order=1,
            ),
        ],
    )

    # Link in plan for top-level required_readings
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "selected_resources": [
            {"kind": "CLASSWORK", "id": reading_cw.classwork_id},
        ],
    }
    db.commit()

    return intervention, reading_assign, remediation_assign


def test_student_can_review_reading_and_contract_is_verified(authz_context):
    c = authz_context
    intervention, reading_assign, _ = _setup_intervention_with_reading(c, 7101)

    _act_as(c, "student", "student")
    client = _client_for_student(c)

    # Verify initial read state: review_status is NOT_REVIEWED, reviewed_at is None
    detail_res = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}")
    assert detail_res.status_code == 200
    detail = detail_res.json()
    assert detail["required_readings"][0]["review_status"] == "NOT_REVIEWED"
    assert detail["required_readings"][0]["reviewed_at"] is None
    assert detail["activities"][0]["readings"][0]["review_status"] == "NOT_REVIEWED"
    assert detail["activities"][0]["readings"][0]["reviewed_at"] is None

    # Review the reading via POST endpoint
    rev_url = f"/api/v1/student/interventions/{intervention.intervention_id}/readings/{reading_assign.classwork_assignment_id}/review"
    res = client.post(rev_url)
    assert res.status_code == 200
    data = res.json()

    # Verify contract fields
    assert data["intervention_id"] == intervention.intervention_id
    assert data["reading_assignment_id"] == reading_assign.classwork_assignment_id
    assert data["assignment_id"] == reading_assign.classwork_assignment_id
    assert data["student_id"] == str(c["student"].student_id)
    assert data["review_status"] == "REVIEWED"
    assert data["reviewed_at"] is not None
    assert data["acknowledged_at"] == data["reviewed_at"]
    assert "review_id" in data

    # Verify detail response reflects reviewed state
    detail_after = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}").json()
    req_reading = detail_after["required_readings"][0]
    act_reading = detail_after["activities"][0]["readings"][0]
    assert req_reading["review_status"] == "REVIEWED"
    assert req_reading["reviewed_at"] == data["reviewed_at"]
    assert act_reading["review_status"] == "REVIEWED"
    assert act_reading["reviewed_at"] == data["reviewed_at"]


def test_repeated_review_requests_are_idempotent(authz_context):
    c = authz_context
    intervention, reading_assign, _ = _setup_intervention_with_reading(c, 7102)

    _act_as(c, "student", "student")
    client = _client_for_student(c)

    rev_url = f"/api/v1/student/interventions/{intervention.intervention_id}/readings/{reading_assign.classwork_assignment_id}/review"

    # First request
    res1 = client.post(rev_url)
    assert res1.status_code == 200
    data1 = res1.json()

    # Second request (retry)
    res2 = client.post(rev_url)
    assert res2.status_code == 200
    data2 = res2.json()

    # Third request via alias route /acknowledge
    ack_url = f"/api/v1/student/interventions/{intervention.intervention_id}/readings/{reading_assign.classwork_assignment_id}/acknowledge"
    res3 = client.post(ack_url)
    assert res3.status_code == 200
    data3 = res3.json()

    # All three must match exactly
    assert data1["review_id"] == data2["review_id"] == data3["review_id"]
    assert data1["reviewed_at"] == data2["reviewed_at"] == data3["reviewed_at"]
    assert data1["review_status"] == data2["review_status"] == data3["review_status"] == "REVIEWED"

    # Exact DB count is still 1
    assert c["db"].query(InterventionReadingReview).filter_by(
        intervention_id=intervention.intervention_id,
        reading_assignment_id=reading_assign.classwork_assignment_id,
    ).count() == 1


def test_unauthorized_student_cannot_review_another_students_reading(authz_context):
    c = authz_context
    intervention, reading_assign, _ = _setup_intervention_with_reading(c, 7103)

    # Act as another student (other_student)
    _act_as(c, "other_student", "student")
    client = _client_for_student(c)

    rev_url = f"/api/v1/student/interventions/{intervention.intervention_id}/readings/{reading_assign.classwork_assignment_id}/review"
    res = client.post(rev_url)
    assert res.status_code == 404
    assert res.json()["detail"] == "Intervention not found"

    # No review record created
    assert c["db"].query(InterventionReadingReview).count() == 0


def test_non_student_role_forbidden(authz_context):
    c = authz_context
    intervention, reading_assign, _ = _setup_intervention_with_reading(c, 7104)

    # Act as teacher
    _act_as(c, "owner", "teacher")
    client = _client_for_student(c)

    rev_url = f"/api/v1/student/interventions/{intervention.intervention_id}/readings/{reading_assign.classwork_assignment_id}/review"
    res = client.post(rev_url)
    assert res.status_code == 403


def test_reading_not_in_published_snapshot_returns_404(authz_context):
    c = authz_context
    db = c["db"]
    intervention, _, _ = _setup_intervention_with_reading(c, 7105)

    # Create an unrelated reading in the class
    unrelated_cw = Classwork(
        title="Unrelated Class Reading",
        classwork_type="READING",
        is_graded=False,
        subject_id=c["subject"].subject_id,
        created_by_staff_id=c["owner"].staff_id,
        is_published=True,
    )
    db.add(unrelated_cw)
    db.flush()

    unrelated_assign = ClassworkAssignment(
        classwork_id=unrelated_cw.classwork_id,
        class_id=c["allowed_class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=c["owner"].staff_id,
        is_published=True,
    )
    db.add(unrelated_assign)
    db.commit()

    _act_as(c, "student", "student")
    client = _client_for_student(c)

    rev_url = f"/api/v1/student/interventions/{intervention.intervention_id}/readings/{unrelated_assign.classwork_assignment_id}/review"
    res = client.post(rev_url)
    assert res.status_code == 404
    assert "Reading is not required by a published remediation activity" in res.json()["detail"]
    assert db.query(InterventionReadingReview).count() == 0


def test_unpublished_remediation_activity_returns_404(authz_context):
    c = authz_context
    db = c["db"]
    intervention, reading_assign, remediation_assign = _setup_intervention_with_reading(c, 7106)

    # Unpublish the remediation activity
    remediation_assign.is_published = False
    db.commit()

    _act_as(c, "student", "student")
    client = _client_for_student(c)

    rev_url = f"/api/v1/student/interventions/{intervention.intervention_id}/readings/{reading_assign.classwork_assignment_id}/review"
    res = client.post(rev_url)
    assert res.status_code == 404
    assert db.query(InterventionReadingReview).count() == 0


def test_inactive_intervention_rejected_with_400(authz_context):
    c = authz_context
    db = c["db"]
    intervention, reading_assign, _ = _setup_intervention_with_reading(c, 7107)

    # Resolve the intervention
    intervention.status = "RESOLVED"
    intervention.resolved_at = datetime.now(timezone.utc)
    intervention.resolution_reason = "IMPROVED_PREDICTION"
    db.commit()

    _act_as(c, "student", "student")
    client = _client_for_student(c)

    rev_url = f"/api/v1/student/interventions/{intervention.intervention_id}/readings/{reading_assign.classwork_assignment_id}/review"
    res = client.post(rev_url)
    assert res.status_code == 400
    assert "Reading reviews require an active intervention" in res.json()["detail"]
    assert db.query(InterventionReadingReview).count() == 0


def test_ordinary_reading_completion_preserved_separately(authz_context):
    c = authz_context
    db = c["db"]
    intervention, reading_assign, _ = _setup_intervention_with_reading(c, 7108)

    _act_as(c, "student", "student")
    client = _client_for_student(c)

    # 1. Review reading without ordinary completion:
    # completion_status is NOT_STARTED, review_status is REVIEWED
    rev_url = f"/api/v1/student/interventions/{intervention.intervention_id}/readings/{reading_assign.classwork_assignment_id}/review"
    res = client.post(rev_url)
    assert res.status_code == 200

    detail = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}").json()
    req_reading = detail["required_readings"][0]
    assert req_reading["completion_status"] == "NOT_STARTED"
    assert req_reading["review_status"] == "REVIEWED"
    assert req_reading["completed_at"] is None
    assert req_reading["reviewed_at"] is not None

    # Verify no StudentSubmission was created
    assert db.query(StudentSubmission).filter_by(
        student_id=c["student"].student_id,
        classwork_assignment_id=reading_assign.classwork_assignment_id,
    ).count() == 0

    # 2. Now perform ordinary Reading completion (e.g. via complete-reading endpoint)
    comp_res = client.post(f"/api/v1/submissions/assignment/{reading_assign.classwork_assignment_id}/complete-reading")
    assert comp_res.status_code == 200

    # Detail now has BOTH completion_status COMPLETED and review_status REVIEWED
    detail2 = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}").json()
    req_reading2 = detail2["required_readings"][0]
    assert req_reading2["completion_status"] == "COMPLETED"
    assert req_reading2["review_status"] == "REVIEWED"
    assert req_reading2["completed_at"] is not None
    assert req_reading2["reviewed_at"] == req_reading["reviewed_at"]

    # StudentSubmission exists with status submitted
    sub = db.query(StudentSubmission).filter_by(
        student_id=c["student"].student_id,
        classwork_assignment_id=reading_assign.classwork_assignment_id,
    ).one()
    assert sub.status == "submitted"


def test_intervention_specific_isolation_multiple_interventions(authz_context):
    c = authz_context
    db = c["db"]
    # Setup first intervention with reading under primary subject
    inv1, reading_assign, _ = _setup_intervention_with_reading(c, 7109)

    # Create second subject to satisfy unique constraint for second intervention
    subject2 = Subject(
        subject_name="Physics 101",
        subject_codename=f"PHYS-{uuid4().hex[:6]}",
        academic_level_id=c["subject"].academic_level_id,
        grading_template_id=c["subject"].grading_template_id,
    )
    db.add(subject2)
    db.flush()

    inv2, reading_assign2, _ = _setup_intervention_with_reading(c, 7110, subject=subject2)

    _act_as(c, "student", "student")
    client = _client_for_student(c)

    # Acknowledge review ONLY for inv1
    rev_url = f"/api/v1/student/interventions/{inv1.intervention_id}/readings/{reading_assign.classwork_assignment_id}/review"
    res = client.post(rev_url)
    assert res.status_code == 200

    # inv1 reading shows REVIEWED
    detail1 = client.get(f"/api/v1/student/interventions/{inv1.intervention_id}").json()
    assert detail1["required_readings"][0]["review_status"] == "REVIEWED"
    assert detail1["activities"][0]["readings"][0]["review_status"] == "REVIEWED"

    # inv2 reading MUST still show NOT_REVIEWED
    detail2 = client.get(f"/api/v1/student/interventions/{inv2.intervention_id}").json()
    assert detail2["required_readings"][0]["review_status"] == "NOT_REVIEWED"
    assert detail2["required_readings"][0]["reviewed_at"] is None
    assert detail2["activities"][0]["readings"][0]["review_status"] == "NOT_REVIEWED"
    assert detail2["activities"][0]["readings"][0]["reviewed_at"] is None


def test_list_reviews_and_body_post_endpoint(authz_context):
    c = authz_context
    intervention, reading_assign, _ = _setup_intervention_with_reading(c, 7111)

    _act_as(c, "student", "student")
    client = _client_for_student(c)

    # Initially empty review list
    list_res0 = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}/reviews")
    assert list_res0.status_code == 200
    assert list_res0.json() == []

    # Review via POST /reviews with JSON body
    body_res = client.post(
        f"/api/v1/student/interventions/{intervention.intervention_id}/reviews",
        json={"reading_assignment_id": reading_assign.classwork_assignment_id},
    )
    assert body_res.status_code == 200
    assert body_res.json()["review_status"] == "REVIEWED"

    # List now contains 1 review
    list_res1 = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}/reviews")
    assert list_res1.status_code == 200
    items = list_res1.json()
    assert len(items) == 1
    assert items[0]["reading_assignment_id"] == reading_assign.classwork_assignment_id
    assert items[0]["review_status"] == "REVIEWED"
