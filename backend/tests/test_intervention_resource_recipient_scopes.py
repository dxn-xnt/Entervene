"""Comprehensive tests for Intervention support resource recipient scopes.

Verifies:
1. Default `THIS_STUDENT` scope when creating a Reading from Student A's intervention.
2. Explicit `ENTIRE_CLASS` scope sharing only with eligible classmates.
3. Explicit `ALL_SUBJECT_STUDENTS` scope sharing across multiple authorized sections of
   the same teacher, subject, and academic period while excluding other teachers,
   unrelated subjects, and other terms.
4. Client-spoofed `class_ids` are ignored; backend enforces teacher authorization.
5. Duplicate `ClassworkAssignment` and `ClassworkAssignmentRecipient` rows are prevented.
6. Attaching existing resources preserves ownership, publication state, and existing
   classwide visibility (never narrows classwide resources or auto-publishes drafts).
7. Reusing a student-restricted Reading for a second student in the same class grants
   both students access without exposing it to a third classmate or duplicating Classwork.
8. Shared resources never create Intervention records for other students.
9. Student access across subject classworks, student To-Do classworks, direct
   assignment/classwork access, and Study Support respects recipient permissions.
10. Accurate, deduplicated enrolled student counts in `recipient_scopes`.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Classworks import router as classworks_router
from app.api.v1.routes.Students import router as students_router
from app.api.v1.routes.TeacherInterventions import (
    require_development_intervention_api,
    router as teacher_interventions_router,
)
from app.db.Session import get_db
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkAssignmentRecipient import ClassworkAssignmentRecipient
from app.models.intervention.Intervention import Intervention
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.submission.SubmissionService import (
    assignment_tracking,
    classwork_tracking,
)
from app.services.intervention.InterventionRemediationService import (
    PlanUpdate,
    get_workspace,
    save_plan,
)
from app.services.intervention.StudentPersistentInterventionService import (
    resolve_required_readings,
)
from tests.test_classwork_submission_authorization import (
    _act_as,
    _bearer,
    authz_context,
)


def _add_student(db, *, class_id: int, academic_year_id: int, suffix: str, status: str = "enrolled"):
    user = UserAccount(
        user_id=uuid4(),
        email=f"student_{suffix}@example.com",
        password_hash="x",
    )
    db.add(user)
    db.flush()
    student = Student(
        student_id=uuid4(),
        user_id=user.user_id,
        student_lrn=f"LRN{uuid4().hex[:9]}",
        first_name="Student",
        last_name=suffix.title(),
    )
    db.add(student)
    db.flush()
    db.add(
        StudentClass(
            student_id=student.student_id,
            class_id=class_id,
            academic_year_id=academic_year_id,
            enrollment_status=status,
        )
    )
    db.flush()
    return student, user


def _setup_multi_section_context(authz_context):
    c = authz_context
    db = c["db"]
    c["period"].is_active = True
    year_id = c["period"].academic_year_id
    owner = c["owner"]
    other_teacher = db.get(AcademicStaff, "T-OTHER")
    owner_user = c["accounts"]["owner"]
    other_teacher_user = c["accounts"]["other_teacher"]
    student_user = c["accounts"]["student"]
    subject = c["subject"]
    class_a = c["allowed_class"]
    student_a = c["student"]

    # Classmate B (enrolled in Class A) + Classmate C (enrolled in Class A) + Dropped student in Class A
    student_b, user_b = _add_student(db, class_id=class_a.class_id, academic_year_id=year_id, suffix="b")
    student_c, user_c = _add_student(db, class_id=class_a.class_id, academic_year_id=year_id, suffix="c")
    student_dropped, user_dropped = _add_student(
        db,
        class_id=class_a.class_id,
        academic_year_id=year_id,
        suffix="dropped",
        status="dropped",
    )

    level_id = class_a.academic_level_id
    # Section 2 handled by SAME teacher for SAME subject & period
    class_b = Class(
        section_name="Einstein",
        academic_year_id=year_id,
        academic_level_id=level_id,
        class_status="active",
    )
    db.add(class_b)
    db.flush()
    db.add(
        SubjectLoad(
            staff_id=owner.staff_id,
            subject_id=subject.subject_id,
            class_id=class_b.class_id,
            academic_period_id=c["period"].academic_period_id,
            status="active",
            is_active_version=True,
        )
    )
    student_sec2, user_sec2 = _add_student(
        db, class_id=class_b.class_id, academic_year_id=year_id, suffix="sec2"
    )

    # Section 3 handled by OTHER teacher for SAME subject & period
    class_other_teacher = Class(
        section_name="Newton",
        academic_year_id=year_id,
        academic_level_id=level_id,
        class_status="active",
    )
    db.add(class_other_teacher)
    db.flush()
    db.add(
        SubjectLoad(
            staff_id=other_teacher.staff_id,
            subject_id=subject.subject_id,
            class_id=class_other_teacher.class_id,
            academic_period_id=c["period"].academic_period_id,
            status="active",
            is_active_version=True,
        )
    )
    student_other_teacher, user_other_teacher = _add_student(
        db, class_id=class_other_teacher.class_id, academic_year_id=year_id, suffix="other_teacher"
    )

    # Section 4 handled by SAME teacher for DIFFERENT subject in SAME period
    other_subject = Subject(subject_name="Science 9", subject_codename="SCI9")
    db.add(other_subject)
    db.flush()
    class_other_subject = Class(
        section_name="Galileo",
        academic_year_id=year_id,
        academic_level_id=level_id,
        class_status="active",
    )
    db.add(class_other_subject)
    db.flush()
    db.add(
        SubjectLoad(
            staff_id=owner.staff_id,
            subject_id=other_subject.subject_id,
            class_id=class_other_subject.class_id,
            academic_period_id=c["period"].academic_period_id,
            status="active",
            is_active_version=True,
        )
    )
    student_other_subject, user_other_subject = _add_student(
        db, class_id=class_other_subject.class_id, academic_year_id=year_id, suffix="other_subject"
    )

    # Section 5 handled by SAME teacher for SAME subject in DIFFERENT period
    from datetime import date as date_type

    other_period = AcademicPeriod(
        academic_year_id=year_id,
        period_name="Quarter 2",
        period_sequence=2,
        start_date=date_type(2026, 9, 1),
        end_date=date_type(2026, 11, 30),
        is_active=False,
    )
    db.add(other_period)
    db.flush()
    class_other_term = Class(
        section_name="Kepler",
        academic_year_id=year_id,
        academic_level_id=level_id,
        class_status="active",
    )
    db.add(class_other_term)
    db.flush()
    db.add(
        SubjectLoad(
            staff_id=owner.staff_id,
            subject_id=subject.subject_id,
            class_id=class_other_term.class_id,
            academic_period_id=other_period.academic_period_id,
            status="active",
            is_active_version=True,
        )
    )
    student_other_term, user_other_term = _add_student(
        db, class_id=class_other_term.class_id, academic_year_id=year_id, suffix="other_term"
    )

    # Prediction + Active Intervention for Student A
    model_version = AIModelVersion(
        model_name="corrected_dev_test",
        algorithm="RandomForest",
        model_type="REGRESSOR",
        model_purpose=ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value,
        lifecycle_status="DEVELOPMENT",
        is_active=True,
    )
    db.add(model_version)
    db.flush()

    pred_a = DevelopmentCurrentTermPrediction(
        student_id=student_a.student_id,
        class_id=class_a.class_id,
        subject_id=subject.subject_id,
        source_period_id=c["period"].academic_period_id,
        target_period_id=c["period"].academic_period_id,
        model_version_id=model_version.model_version_id,
        revision=1,
        predicted_period_grade=Decimal("78.50"),
        intervention_level="MODERATE_RISK",
        intervention_basis="BELOW_PASSING_THRESHOLD",
        evidence_snapshot={
            "readiness": {"status": "READY"},
            "projected_final_term_grade_raw": 78.5,
        },
    )
    pred_b = DevelopmentCurrentTermPrediction(
        student_id=student_b.student_id,
        class_id=class_a.class_id,
        subject_id=subject.subject_id,
        source_period_id=c["period"].academic_period_id,
        target_period_id=c["period"].academic_period_id,
        model_version_id=model_version.model_version_id,
        revision=1,
        predicted_period_grade=Decimal("79.00"),
        intervention_level="MODERATE_RISK",
        intervention_basis="BELOW_PASSING_THRESHOLD",
        evidence_snapshot={
            "readiness": {"status": "READY"},
            "projected_final_term_grade_raw": 79.0,
        },
    )
    db.add_all([pred_a, pred_b])
    db.flush()

    intervention_a = Intervention(
        student_id=student_a.student_id,
        class_id=class_a.class_id,
        subject_id=subject.subject_id,
        academic_period_id=c["period"].academic_period_id,
        source_prediction_id=pred_a.prediction_id,
        status="ACTIVE",
        diagnosis_snapshot={"weakest_supported_components": ["WRITTEN_WORK"]},
        remediation_plan={"teacher_choice": None, "selected_resources": []},
        activated_at=datetime.now(timezone.utc),
        activated_by_staff_id=owner.staff_id,
    )
    intervention_b = Intervention(
        student_id=student_b.student_id,
        class_id=class_a.class_id,
        subject_id=subject.subject_id,
        academic_period_id=c["period"].academic_period_id,
        source_prediction_id=pred_b.prediction_id,
        status="ACTIVE",
        diagnosis_snapshot={"weakest_supported_components": ["WRITTEN_WORK"]},
        remediation_plan={"teacher_choice": None, "selected_resources": []},
        activated_at=datetime.now(timezone.utc),
        activated_by_staff_id=owner.staff_id,
    )
    db.add_all([intervention_a, intervention_b])
    db.commit()

    app = FastAPI()
    app.include_router(classworks_router, prefix="/api/v1/classwork-assignments")
    app.include_router(students_router, prefix="/api/v1/students")
    app.include_router(teacher_interventions_router, prefix="/api/v1/teacher/interventions")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: c["identity"]
    app.dependency_overrides[require_development_intervention_api] = lambda: None
    client = TestClient(app)

    return {
        **c,
        "client": client,
        "owner_user": owner_user,
        "other_teacher": other_teacher,
        "other_teacher_user": other_teacher_user,
        "student_user": student_user,
        "class_a": class_a,
        "class_b": class_b,
        "class_other_teacher": class_other_teacher,
        "class_other_subject": class_other_subject,
        "class_other_term": class_other_term,
        "other_subject": other_subject,
        "other_period": other_period,
        "student_a": student_a,
        "student_b": student_b,
        "user_b": user_b,
        "student_c": student_c,
        "user_c": user_c,
        "student_dropped": student_dropped,
        "user_dropped": user_dropped,
        "student_sec2": student_sec2,
        "user_sec2": user_sec2,
        "student_other_teacher": student_other_teacher,
        "user_other_teacher": user_other_teacher,
        "student_other_subject": student_other_subject,
        "user_other_subject": user_other_subject,
        "student_other_term": student_other_term,
        "user_other_term": user_other_term,
        "intervention_a": intervention_a,
        "intervention_b": intervention_b,
    }


def _headers_for(ctx, user_id, role: str) -> dict:
    from app.core.Security import create_access_token

    ctx["identity"].update(sub=user_id, role=role)
    token = create_access_token(str(user_id), role)
    return {"Authorization": f"Bearer {token}"}


def test_workspace_reports_accurate_enrolled_recipient_counts(authz_context):
    ctx = _setup_multi_section_context(authz_context)
    ws = get_workspace(ctx["db"], ctx["owner"].staff_id, ctx["intervention_a"].intervention_id)
    scopes = ws["recipient_scopes"]

    assert scopes["default_scope"] == "THIS_STUDENT"
    assert scopes["this_student"]["student_count"] == 1
    assert scopes["this_student"]["student_id"] == str(ctx["student_a"].student_id)
    # Class A has 3 enrolled students (A, B, C) and 1 dropped student (excluded).
    assert scopes["entire_class"]["student_count"] == 3
    assert scopes["entire_class"]["class_id"] == ctx["class_a"].class_id
    # Authorized sections for owner + subject + period are Class A (3) + Class B (1) = 4 enrolled students.
    # Excludes other_teacher (Newton), other_subject (Galileo), and other_term (Kepler).
    assert scopes["all_subject_students"]["student_count"] == 4
    assert scopes["all_subject_students"]["section_count"] == 2
    assert set(scopes["all_subject_students"]["class_ids"]) == {
        ctx["class_a"].class_id,
        ctx["class_b"].class_id,
    }


def test_create_reading_from_intervention_defaults_to_this_student_only(authz_context):
    ctx = _setup_multi_section_context(authz_context)
    db = ctx["db"]
    client = ctx["client"]
    interventions_before = db.query(Intervention).count()

    # Omit recipient_scope (and even send spoofed extra class_ids) -> must default to THIS_STUDENT only!
    resp = client.post(
        "/api/v1/classwork-assignments/with-assignments",
        headers=_headers_for(ctx, ctx["owner_user"].user_id, "teacher"),
        data={
            "title": "Targeted Fraction Review",
            "classwork_type": "READING",
            "subject_id": str(ctx["subject"].subject_id),
            "is_published": "true",
            "class_ids": json.dumps([ctx["class_a"].class_id, ctx["class_b"].class_id]),
            "academic_period_id": str(ctx["period"].academic_period_id),
            "intervention_id": str(ctx["intervention_a"].intervention_id),
        },
    )
    assert resp.status_code == 200, resp.text
    created = resp.json()
    cw_id = created["classwork_id"]
    assert created["intervention_resource_origin_id"] == ctx["intervention_a"].intervention_id
    assert len(created["assignments"]) == 1
    assignment_id = created["assignments"][0]["classwork_assignment_id"]
    assert created["assignments"][0]["class_id"] == ctx["class_a"].class_id
    assert created["assignments"][0]["recipient_student_ids"] == [str(ctx["student_a"].student_id)]
    assert created["assignments"][0]["source_intervention_id"] is None
    initial_tracking = classwork_tracking(cw_id, ctx["owner"].staff_id, db)
    assert initial_tracking["total_students"] == 1
    assert initial_tracking["submitted_count"] == 0
    assert initial_tracking["missing_count"] == 1
    assert [row["student_id"] for row in initial_tracking["missing"]] == [
        str(ctx["student_a"].student_id)
    ]
    initial_assignment_tracking = assignment_tracking(
        assignment_id, ctx["owner"].staff_id, db
    )
    assert initial_assignment_tracking["total_students"] == 1
    assert initial_assignment_tracking["missing_count"] == 1

    # No new interventions created
    assert db.query(Intervention).count() == interventions_before

    # Student A CAN see and access the reading across all student endpoints
    headers_a = _headers_for(ctx, ctx["student_user"].user_id, "student")
    subj_a = client.get(
        f"/api/v1/classwork-assignments/class/{ctx['class_a'].class_id}/subject/{ctx['subject'].subject_id}",
        headers=headers_a,
    )
    assert subj_a.status_code == 200
    assert any(item["classwork_id"] == cw_id for item in subj_a.json())

    todo_a = client.get("/api/v1/students/me/todos", headers=headers_a)
    assert todo_a.status_code == 200
    assert any(item["classwork_id"] == cw_id for item in todo_a.json()["all"])

    detail_a = client.get(f"/api/v1/classwork-assignments/assignment/{assignment_id}", headers=headers_a)
    assert detail_a.status_code == 200

    # Classmate B in the SAME section CANNOT see or access the reading
    headers_b = _headers_for(ctx, ctx["user_b"].user_id, "student")
    subj_b = client.get(
        f"/api/v1/classwork-assignments/class/{ctx['class_a'].class_id}/subject/{ctx['subject'].subject_id}",
        headers=headers_b,
    )
    assert subj_b.status_code == 200
    assert all(item["classwork_id"] != cw_id for item in subj_b.json())

    todo_b = client.get("/api/v1/students/me/todos", headers=headers_b)
    assert todo_b.status_code == 200
    assert all(item["classwork_id"] != cw_id for item in todo_b.json()["all"])

    detail_b = client.get(f"/api/v1/classwork-assignments/assignment/{assignment_id}", headers=headers_b)
    assert detail_b.status_code == 403

    cw_b = client.get(f"/api/v1/classwork-assignments/classwork/{cw_id}", headers=headers_b)
    assert cw_b.status_code == 403

    # Attaching to Student A's intervention makes it appear in Student A's required readings
    # without locking teacher_choice or appearing in assigned_remediation
    saved_ws = save_plan(
        db,
        ctx["owner"].staff_id,
        ctx["intervention_a"].intervention_id,
        PlanUpdate(
            selected_resources=[{"kind": "CLASSWORK", "id": cw_id}],
            resource_recipient_scope="THIS_STUDENT",
        ),
    )
    assert saved_ws["progress"]["assigned_remediation"] == []
    readings, issues, _prep = resolve_required_readings(
        db, ctx["intervention_a"], ctx["student_a"].student_id
    )
    assert not issues
    assert [r.classwork_id for r in readings] == [cw_id]


def test_create_reading_entire_class_shares_only_with_eligible_classmates_without_interventions(authz_context):
    ctx = _setup_multi_section_context(authz_context)
    db = ctx["db"]
    client = ctx["client"]
    interventions_before = db.query(Intervention).count()

    resp = client.post(
        "/api/v1/classwork-assignments/with-assignments",
        headers=_headers_for(ctx, ctx["owner_user"].user_id, "teacher"),
        data={
            "title": "Classwide Algebra Guide",
            "classwork_type": "READING",
            "subject_id": str(ctx["subject"].subject_id),
            "is_published": "true",
            "class_ids": json.dumps([ctx["class_a"].class_id]),
            "academic_period_id": str(ctx["period"].academic_period_id),
            "intervention_id": str(ctx["intervention_a"].intervention_id),
            "recipient_scope": "ENTIRE_CLASS",
        },
    )
    assert resp.status_code == 200, resp.text
    created = resp.json()
    cw_id = created["classwork_id"]
    assignment_id = created["assignments"][0]["classwork_assignment_id"]
    assert len(created["assignments"]) == 1
    assert created["assignments"][0]["class_id"] == ctx["class_a"].class_id
    assert created["assignments"][0]["recipient_student_ids"] == []
    assert db.query(ClassworkAssignmentRecipient).filter_by(classwork_assignment_id=assignment_id).count() == 0

    # Student A & Classmate B (same class) CAN access; Section 2 student & dropped student CANNOT
    for user in (ctx["student_user"], ctx["user_b"], ctx["user_c"]):
        res = client.get(
            f"/api/v1/classwork-assignments/assignment/{assignment_id}",
            headers=_headers_for(ctx, user.user_id, "student"),
        )
        assert res.status_code == 200

    for user in (ctx["user_sec2"], ctx["user_dropped"], ctx["user_other_teacher"]):
        res = client.get(
            f"/api/v1/classwork-assignments/assignment/{assignment_id}",
            headers=_headers_for(ctx, user.user_id, "student"),
        )
        assert res.status_code == 403

    # Sharing resource never creates new interventions for classmates
    assert db.query(Intervention).count() == interventions_before
    assert db.query(Intervention).filter_by(student_id=ctx["student_c"].student_id).count() == 0


def test_create_reading_all_subject_students_includes_only_authorized_sections(authz_context):
    ctx = _setup_multi_section_context(authz_context)
    db = ctx["db"]
    client = ctx["client"]
    interventions_before = db.query(Intervention).count()

    resp = client.post(
        "/api/v1/classwork-assignments/with-assignments",
        headers=_headers_for(ctx, ctx["owner_user"].user_id, "teacher"),
        data={
            "title": "Subject-Wide Quadratic Notes",
            "classwork_type": "READING",
            "subject_id": str(ctx["subject"].subject_id),
            "is_published": "true",
            # Client only sends class_a, server resolves ALL authorized sections for teacher+subject+period
            "class_ids": json.dumps([ctx["class_a"].class_id]),
            "academic_period_id": str(ctx["period"].academic_period_id),
            "intervention_id": str(ctx["intervention_a"].intervention_id),
            "recipient_scope": "ALL_SUBJECT_STUDENTS",
        },
    )
    assert resp.status_code == 200, resp.text
    created = resp.json()
    cw_id = created["classwork_id"]
    assigned_class_ids = {a["class_id"] for a in created["assignments"]}
    assert assigned_class_ids == {ctx["class_a"].class_id, ctx["class_b"].class_id}
    assert ctx["class_other_teacher"].class_id not in assigned_class_ids
    assert ctx["class_other_subject"].class_id not in assigned_class_ids
    assert ctx["class_other_term"].class_id not in assigned_class_ids

    # Students in both authorized sections can access
    for user in (ctx["student_user"], ctx["user_b"], ctx["user_sec2"]):
        res = client.get(
            f"/api/v1/classwork-assignments/classwork/{cw_id}",
            headers=_headers_for(ctx, user.user_id, "student"),
        )
        assert res.status_code == 200

    # Students from other teachers, other subjects, or other terms are excluded
    for user in (ctx["user_other_teacher"], ctx["user_other_subject"], ctx["user_other_term"]):
        res = client.get(
            f"/api/v1/classwork-assignments/classwork/{cw_id}",
            headers=_headers_for(ctx, user.user_id, "student"),
        )
        assert res.status_code == 403

    # No interventions created for other students
    assert db.query(Intervention).count() == interventions_before


def test_existing_resource_attachment_preserves_visibility_prevents_duplicates_and_supports_multi_student_reuse(authz_context):
    ctx = _setup_multi_section_context(authz_context)
    db = ctx["db"]
    client = ctx["client"]

    # 1) Existing classwide published reading in Class A: attaching with THIS_STUDENT must NOT narrow it!
    existing_classwide = Classwork(
        title="Existing Classwide Handout",
        classwork_type="READING",
        is_graded=False,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=ctx["owner"].staff_id,
        is_published=True,
    )
    db.add(existing_classwide)
    db.flush()
    classwide_asgn = ClassworkAssignment(
        classwork_id=existing_classwide.classwork_id,
        class_id=ctx["class_a"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=ctx["owner"].staff_id,
        is_published=True,
    )
    db.add(classwide_asgn)

    # 2) Existing unpublished draft reading: attaching must preserve is_published=False!
    existing_draft = Classwork(
        title="Unpublished Draft Reading",
        classwork_type="READING",
        is_graded=False,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=ctx["owner"].staff_id,
        is_published=False,
    )
    db.add(existing_draft)

    # 3) Existing reading assigned only to Section 2: attaching to Student A with THIS_STUDENT
    #    must keep Section 2 untouched and restrict Class A to Student A only!
    section2_reading = Classwork(
        title="Section 2 Reading",
        classwork_type="READING",
        is_graded=False,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=ctx["owner"].staff_id,
        is_published=True,
    )
    db.add(section2_reading)
    db.flush()
    db.add(
        ClassworkAssignment(
            classwork_id=section2_reading.classwork_id,
            class_id=ctx["class_b"].class_id,
            academic_period_id=ctx["period"].academic_period_id,
            assigned_by_staff_id=ctx["owner"].staff_id,
            is_published=True,
        )
    )
    db.commit()

    # Attach all 3 to Student A with default THIS_STUDENT scope
    save_plan(
        db,
        ctx["owner"].staff_id,
        ctx["intervention_a"].intervention_id,
        PlanUpdate(
            selected_resources=[
                {"kind": "CLASSWORK", "id": existing_classwide.classwork_id},
                {"kind": "CLASSWORK", "id": existing_draft.classwork_id},
                {"kind": "CLASSWORK", "id": section2_reading.classwork_id},
            ],
            resource_recipient_scope="THIS_STUDENT",
        ),
    )

    # Classwide reading MUST still have 0 restriction rows (Classmate C still sees it)
    assert db.query(ClassworkAssignmentRecipient).filter_by(
        classwork_assignment_id=classwide_asgn.classwork_assignment_id
    ).count() == 0
    assert client.get(
        f"/api/v1/classwork-assignments/classwork/{existing_classwide.classwork_id}",
        headers=_headers_for(ctx, ctx["user_c"].user_id, "student"),
    ).status_code == 200

    # Draft reading MUST remain unpublished (ownership and publication state unchanged)
    db.refresh(existing_draft)
    assert existing_draft.is_published is False
    assert existing_draft.created_by_staff_id == ctx["owner"].staff_id
    draft_asgn = db.query(ClassworkAssignment).filter_by(
        classwork_id=existing_draft.classwork_id, class_id=ctx["class_a"].class_id
    ).one()
    assert draft_asgn.is_published is False

    # Section 2 reading: Student A and Section 2 student CAN access; Classmate B & C CANNOT!
    assert client.get(
        f"/api/v1/classwork-assignments/classwork/{section2_reading.classwork_id}",
        headers=_headers_for(ctx, ctx["student_user"].user_id, "student"),
    ).status_code == 200
    assert client.get(
        f"/api/v1/classwork-assignments/classwork/{section2_reading.classwork_id}",
        headers=_headers_for(ctx, ctx["user_sec2"].user_id, "student"),
    ).status_code == 200
    assert client.get(
        f"/api/v1/classwork-assignments/classwork/{section2_reading.classwork_id}",
        headers=_headers_for(ctx, ctx["user_b"].user_id, "student"),
    ).status_code == 403

    # Now attach SAME section2_reading to Student B's intervention (same Class A) with THIS_STUDENT:
    # Must NOT duplicate Classwork or ClassworkAssignment; Student A + B get access, Classmate C stays blocked!
    save_plan(
        db,
        ctx["owner"].staff_id,
        ctx["intervention_b"].intervention_id,
        PlanUpdate(
            selected_resources=[{"kind": "CLASSWORK", "id": section2_reading.classwork_id}],
            resource_recipient_scope="THIS_STUDENT",
        ),
    )
    # Repeat save to verify deduplication / idempotency
    save_plan(
        db,
        ctx["owner"].staff_id,
        ctx["intervention_b"].intervention_id,
        PlanUpdate(
            selected_resources=[{"kind": "CLASSWORK", "id": section2_reading.classwork_id}],
            resource_recipient_scope="THIS_STUDENT",
        ),
    )
    class_a_asgns = db.query(ClassworkAssignment).filter_by(
        classwork_id=section2_reading.classwork_id, class_id=ctx["class_a"].class_id
    ).all()
    assert len(class_a_asgns) == 1
    recipients = db.query(ClassworkAssignmentRecipient).filter_by(
        classwork_assignment_id=class_a_asgns[0].classwork_assignment_id
    ).all()
    assert {r.student_id for r in recipients} == {
        ctx["student_a"].student_id,
        ctx["student_b"].student_id,
    }
    assert client.get(
        f"/api/v1/classwork-assignments/classwork/{section2_reading.classwork_id}",
        headers=_headers_for(ctx, ctx["user_b"].user_id, "student"),
    ).status_code == 200
    assert client.get(
        f"/api/v1/classwork-assignments/classwork/{section2_reading.classwork_id}",
        headers=_headers_for(ctx, ctx["user_c"].user_id, "student"),
    ).status_code == 403

    # Explicitly promote section2_reading to ENTIRE_CLASS -> clears restriction rows, Classmate C now has access, no duplicates
    save_plan(
        db,
        ctx["owner"].staff_id,
        ctx["intervention_a"].intervention_id,
        PlanUpdate(
            selected_resources=[{"kind": "CLASSWORK", "id": section2_reading.classwork_id}],
            resource_recipient_scope="ENTIRE_CLASS",
        ),
    )
    assert db.query(ClassworkAssignment).filter_by(
        classwork_id=section2_reading.classwork_id, class_id=ctx["class_a"].class_id
    ).count() == 1
    assert db.query(ClassworkAssignmentRecipient).filter_by(
        classwork_assignment_id=class_a_asgns[0].classwork_assignment_id
    ).count() == 0
    assert client.get(
        f"/api/v1/classwork-assignments/classwork/{section2_reading.classwork_id}",
        headers=_headers_for(ctx, ctx["user_c"].user_id, "student"),
    ).status_code == 200


def test_unauthorized_teacher_and_invalid_scope_are_rejected(authz_context):
    ctx = _setup_multi_section_context(authz_context)
    client = ctx["client"]

    # Unauthorized teacher cannot create a reading attached to another teacher's intervention
    resp_unauth = client.post(
        "/api/v1/classwork-assignments/with-assignments",
        headers=_headers_for(ctx, ctx["other_teacher_user"].user_id, "teacher"),
        data={
            "title": "Unauthorized Reading",
            "classwork_type": "READING",
            "subject_id": str(ctx["subject"].subject_id),
            "is_published": "true",
            "class_ids": json.dumps([ctx["class_a"].class_id]),
            "academic_period_id": str(ctx["period"].academic_period_id),
            "intervention_id": str(ctx["intervention_a"].intervention_id),
            "recipient_scope": "THIS_STUDENT",
        },
    )
    assert resp_unauth.status_code == 403

    # Invalid recipient_scope value is rejected with 400
    resp_bad_scope = client.post(
        "/api/v1/classwork-assignments/with-assignments",
        headers=_headers_for(ctx, ctx["owner_user"].user_id, "teacher"),
        data={
            "title": "Bad Scope Reading",
            "classwork_type": "READING",
            "subject_id": str(ctx["subject"].subject_id),
            "is_published": "true",
            "class_ids": json.dumps([ctx["class_a"].class_id]),
            "academic_period_id": str(ctx["period"].academic_period_id),
            "intervention_id": str(ctx["intervention_a"].intervention_id),
            "recipient_scope": "EVERYONE_IN_SCHOOL",
        },
    )
    assert resp_bad_scope.status_code == 400


def test_editing_intervention_created_reading_replaces_scope_and_preserves_origin_student(authz_context):
    ctx = _setup_multi_section_context(authz_context)
    client = ctx["client"]
    teacher_headers = _headers_for(ctx, ctx["owner_user"].user_id, "teacher")

    created_response = client.post(
        "/api/v1/classwork-assignments/with-assignments",
        headers=teacher_headers,
        data={
            "title": "Editable Study Support Reading",
            "classwork_type": "READING",
            "subject_id": str(ctx["subject"].subject_id),
            "is_published": "true",
            "class_ids": json.dumps([ctx["class_a"].class_id]),
            "academic_period_id": str(ctx["period"].academic_period_id),
            "intervention_id": str(ctx["intervention_a"].intervention_id),
            "recipient_scope": "THIS_STUDENT",
        },
    )
    assert created_response.status_code == 200, created_response.text
    classwork_id = created_response.json()["classwork_id"]
    assert ctx["db"].get(Classwork, classwork_id).intervention_resource_recipient_scope == "THIS_STUDENT"

    entire_class = client.put(
        f"/api/v1/classwork-assignments/classwork/{classwork_id}",
        headers=teacher_headers,
        json={"recipient_scope": "ENTIRE_CLASS"},
    )
    assert entire_class.status_code == 200, entire_class.text
    ctx["db"].expire_all()
    assert ctx["db"].get(Classwork, classwork_id).intervention_resource_recipient_scope == "ENTIRE_CLASS"
    assert len(entire_class.json()["assignments"]) == 1
    assert entire_class.json()["assignments"][0]["recipient_student_ids"] == []
    entire_assignment_id = entire_class.json()["assignments"][0][
        "classwork_assignment_id"
    ]
    opened_at = datetime.now(timezone.utc)
    ctx["db"].add(
        StudentSubmission(
            student_id=ctx["student_c"].student_id,
            classwork_assignment_id=entire_assignment_id,
            status="submitted",
            submitted_at=opened_at,
            attempt_count=1,
        )
    )
    ctx["db"].commit()
    entire_tracking = classwork_tracking(
        classwork_id, ctx["owner"].staff_id, ctx["db"]
    )
    assert entire_tracking["total_students"] == 3
    assert entire_tracking["submitted_count"] == 1
    assert entire_tracking["missing_count"] == 2
    assert entire_tracking["submitted"][0]["student_id"] == str(
        ctx["student_c"].student_id
    )
    assert entire_tracking["submitted"][0]["submitted_at"] == opened_at.replace(
        tzinfo=None
    ).isoformat()
    assert client.get(
        f"/api/v1/classwork-assignments/classwork/{classwork_id}",
        headers=_headers_for(ctx, ctx["user_c"].user_id, "student"),
    ).status_code == 200

    all_subject = client.put(
        f"/api/v1/classwork-assignments/classwork/{classwork_id}",
        headers=_headers_for(ctx, ctx["owner_user"].user_id, "teacher"),
        json={"recipient_scope": "ALL_SUBJECT_STUDENTS"},
    )
    assert all_subject.status_code == 200, all_subject.text
    ctx["db"].expire_all()
    assert ctx["db"].get(Classwork, classwork_id).intervention_resource_recipient_scope == "ALL_SUBJECT_STUDENTS"
    assert {row["class_id"] for row in all_subject.json()["assignments"]} == {
        ctx["class_a"].class_id,
        ctx["class_b"].class_id,
    }
    subject_tracking = classwork_tracking(
        classwork_id, ctx["owner"].staff_id, ctx["db"]
    )
    assert subject_tracking["total_students"] == 4
    assert subject_tracking["submitted_count"] == 1
    assert subject_tracking["missing_count"] == 3
    assert client.get(
        f"/api/v1/classwork-assignments/classwork/{classwork_id}",
        headers=_headers_for(ctx, ctx["user_sec2"].user_id, "student"),
    ).status_code == 200

    this_student = client.put(
        f"/api/v1/classwork-assignments/classwork/{classwork_id}",
        headers=_headers_for(ctx, ctx["owner_user"].user_id, "teacher"),
        json={"recipient_scope": "THIS_STUDENT"},
    )
    assert this_student.status_code == 200, this_student.text
    ctx["db"].expire_all()
    assert ctx["db"].get(Classwork, classwork_id).intervention_resource_recipient_scope == "THIS_STUDENT"
    assignments = this_student.json()["assignments"]
    assert len(assignments) == 1
    assert assignments[0]["class_id"] == ctx["class_a"].class_id
    assert assignments[0]["recipient_student_ids"] == [
        str(ctx["student_a"].student_id)
    ]
    reduced_tracking = classwork_tracking(
        classwork_id, ctx["owner"].staff_id, ctx["db"]
    )
    assert reduced_tracking["total_students"] == 1
    assert reduced_tracking["submitted_count"] == 0
    assert reduced_tracking["missing_count"] == 1
    assert reduced_tracking["missing"][0]["student_id"] == str(
        ctx["student_a"].student_id
    )
    assert (
        ctx["db"]
        .query(StudentSubmission)
        .filter_by(
            classwork_assignment_id=entire_assignment_id,
            student_id=ctx["student_c"].student_id,
        )
        .count()
        == 1
    )
    assert client.get(
        f"/api/v1/classwork-assignments/classwork/{classwork_id}",
        headers=_headers_for(ctx, ctx["student_user"].user_id, "student"),
    ).status_code == 200
    assert client.get(
        f"/api/v1/classwork-assignments/classwork/{classwork_id}",
        headers=_headers_for(ctx, ctx["user_b"].user_id, "student"),
    ).status_code == 403
    assert client.get(
        f"/api/v1/classwork-assignments/classwork/{classwork_id}",
        headers=_headers_for(ctx, ctx["user_sec2"].user_id, "student"),
    ).status_code == 403

    ctx["intervention_a"].status = "RESOLVED"
    ctx["intervention_a"].resolution_reason = "GOAL_MET"
    ctx["intervention_a"].resolved_at = datetime.now(timezone.utc)
    ctx["db"].commit()
    recipient_context = client.get(
        f"/api/v1/classwork-assignments/classwork/{classwork_id}/intervention-resource-recipient-context",
        headers=_headers_for(ctx, ctx["owner_user"].user_id, "teacher"),
    )
    assert recipient_context.status_code == 200, recipient_context.text
    assert recipient_context.json()["current_scope"] == "THIS_STUDENT"
    assert recipient_context.json()["recipient_scopes"]["entire_class"]["student_count"] == 3
    resolved_scope_update = client.put(
        f"/api/v1/classwork-assignments/classwork/{classwork_id}",
        headers=_headers_for(ctx, ctx["owner_user"].user_id, "teacher"),
        json={"recipient_scope": "ENTIRE_CLASS"},
    )
    assert resolved_scope_update.status_code == 200, resolved_scope_update.text

    ordinary = Classwork(
        title="Ordinary Reading",
        classwork_type="READING",
        is_graded=False,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=ctx["owner"].staff_id,
        is_published=True,
    )
    ctx["db"].add(ordinary)
    ctx["db"].flush()
    ctx["db"].add(
        ClassworkAssignment(
            classwork_id=ordinary.classwork_id,
            class_id=ctx["class_a"].class_id,
            academic_period_id=ctx["period"].academic_period_id,
            assigned_by_staff_id=ctx["owner"].staff_id,
            is_published=True,
        )
    )
    ctx["db"].commit()
    ordinary_tracking = classwork_tracking(
        ordinary.classwork_id, ctx["owner"].staff_id, ctx["db"]
    )
    assert ordinary_tracking["total_students"] == 3
    assert ordinary_tracking["submitted_count"] == 0
    assert ordinary_tracking["missing_count"] == 3
    ordinary_update = client.put(
        f"/api/v1/classwork-assignments/classwork/{ordinary.classwork_id}",
        headers=_headers_for(ctx, ctx["owner_user"].user_id, "teacher"),
        json={"recipient_scope": "ENTIRE_CLASS"},
    )
    assert ordinary_update.status_code == 400
    ordinary_context = client.get(
        f"/api/v1/classwork-assignments/classwork/{ordinary.classwork_id}/intervention-resource-recipient-context",
        headers=_headers_for(ctx, ctx["owner_user"].user_id, "teacher"),
    )
    assert ordinary_context.status_code == 404
