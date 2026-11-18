"""Regression and scoping test suite for Student Study Support API endpoints.

Verifies:
1. Endpoints /api/v1/student/interventions, /resolved, and /intervention-reviewers
   return HTTP 200 with empty lists for students with zero interventions (no 404/500).
2. Endpoints respect academic_period_id query parameter filtering.
3. Students can only see their own active and resolved interventions (strict cross-student isolation).
"""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.StudentInterventionReviewers import router as student_reviewers_router
from app.api.v1.routes.StudentPersistentInterventions import router as student_interventions_router
from app.db.Session import get_db
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.auth.UserAccount import UserAccount
from app.models.intervention.Intervention import Intervention
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from tests.test_classwork_submission_authorization import authz_context


def _make_client(db, user_account, role="student"):
    app = FastAPI()
    app.include_router(student_interventions_router, prefix="/api/v1/student/interventions")
    app.include_router(student_reviewers_router, prefix="/api/v1/student/intervention-reviewers")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: {
        "role": role,
        "sub": str(user_account.user_id),
        "user_id": str(user_account.user_id),
    }
    return TestClient(app)


def test_student_zero_interventions_returns_200_empty(authz_context):
    c = authz_context
    db = c["db"]
    client = _make_client(db, c["accounts"]["student"], role="student")

    # 1. Active interventions
    r_active = client.get("/api/v1/student/interventions")
    assert r_active.status_code == 200
    assert r_active.json() == {"items": []}

    # 2. Resolved interventions
    r_resolved = client.get("/api/v1/student/interventions/resolved")
    assert r_resolved.status_code == 200
    assert r_resolved.json() == {"items": []}

    # 3. Reviewers
    r_reviewers = client.get("/api/v1/student/intervention-reviewers")
    assert r_reviewers.status_code == 200
    assert r_reviewers.json() == {"items": [], "total": 0}


def test_student_interventions_respect_academic_period_scoping(authz_context):
    c = authz_context
    db = c["db"]
    student = c["student"]

    # Create second academic period (Q2)
    term2 = AcademicPeriod(
        academic_year_id=c["period"].academic_year_id,
        period_name="Q2",
        period_type="QUARTER",
        period_sequence=2,
        total_periods_in_year=4,
        start_date=c["period"].start_date,
        end_date=c["period"].end_date,
        is_active=True,
    )
    db.add(term2)
    db.flush()

    # Active intervention in Term 2
    inv_active = Intervention(
        intervention_id=8001,
        student_id=student.student_id,
        class_id=c["allowed_class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=term2.academic_period_id,
        source_prediction_id=8001,
        status="ACTIVE",
        diagnosis_snapshot={},
        remediation_plan={"selected_resources": []},
        activated_at=datetime.now(timezone.utc),
        activated_by_staff_id=c["owner"].staff_id,
    )
    # Resolved intervention in Term 1
    inv_resolved = Intervention(
        intervention_id=8002,
        student_id=student.student_id,
        class_id=c["allowed_class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        source_prediction_id=8002,
        status="RESOLVED",
        resolution_reason="IMPROVED_PREDICTION",
        resolved_at=datetime.now(timezone.utc),
        diagnosis_snapshot={},
        remediation_plan={"selected_resources": []},
    )
    db.add_all([inv_active, inv_resolved])
    db.commit()

    client = _make_client(db, c["accounts"]["student"], role="student")

    # When querying with term 2:
    r_t2 = client.get(f"/api/v1/student/interventions?academic_period_id={term2.academic_period_id}")
    assert r_t2.status_code == 200
    items_t2 = r_t2.json()["items"]
    assert len(items_t2) == 1
    assert items_t2[0]["intervention_id"] == inv_active.intervention_id
    assert items_t2[0]["academic_period_id"] == term2.academic_period_id

    # When querying with term 1: active is empty
    r_t1 = client.get(f"/api/v1/student/interventions?academic_period_id={c['period'].academic_period_id}")
    assert r_t1.status_code == 200
    assert len(r_t1.json()["items"]) == 0

    # Resolved in term 1:
    r_res_t1 = client.get(f"/api/v1/student/interventions/resolved?academic_period_id={c['period'].academic_period_id}")
    assert r_res_t1.status_code == 200
    res_items = r_res_t1.json()["items"]
    assert len(res_items) == 1
    assert res_items[0]["intervention_id"] == inv_resolved.intervention_id


def test_cross_student_isolation(authz_context):
    c = authz_context
    db = c["db"]

    # Create another student
    other_user = UserAccount(user_id=uuid4(), email="other.student@example.com")
    other_student = Student(
        student_id=uuid4(),
        user_id=other_user.user_id,
        student_lrn="111222333444",
        first_name="Other",
        last_name="Person",
    )
    db.add_all([other_user, other_student])
    db.flush()

    inv = Intervention(
        intervention_id=8003,
        student_id=other_student.student_id,
        class_id=c["allowed_class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        source_prediction_id=8003,
        status="ACTIVE",
        diagnosis_snapshot={},
        remediation_plan={"selected_resources": []},
        activated_at=datetime.now(timezone.utc),
        activated_by_staff_id=c["owner"].staff_id,
    )
    db.add(inv)
    db.commit()

    # Original student queries - must see 0 interventions
    client_orig = _make_client(db, c["accounts"]["student"], role="student")
    r = client_orig.get("/api/v1/student/interventions")
    assert r.status_code == 200
    assert len(r.json()["items"]) == 0

    # Other student queries - sees their own 1 intervention
    client_other = _make_client(db, other_user, role="student")
    r2 = client_other.get("/api/v1/student/interventions")
    assert r2.status_code == 200
    assert len(r2.json()["items"]) == 1
    assert r2.json()["items"][0]["intervention_id"] == inv.intervention_id
