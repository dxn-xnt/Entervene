import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.StudentRecords import router as student_records_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.GradeSubmissionLog import GradeSubmissionLog
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission


@pytest.fixture
def adviser_send_context():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    lrn_check = next(
        (c for c in Student.__table__.constraints if isinstance(c, CheckConstraint) and c.name == "lrn_check"),
        None,
    )
    if lrn_check and lrn_check in Student.__table__.constraints:
        Student.__table__.constraints.remove(lrn_check)
    try:
        Base.metadata.create_all(bind=engine)
    finally:
        if lrn_check and lrn_check not in Student.__table__.constraints:
            Student.__table__.append_constraint(lrn_check)
    db = sessionmaker(bind=engine)()

    year = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    db.add(year)
    db.flush()

    period = AcademicPeriod(
        period_name="1st Quarter",
        period_type="QUARTER",
        period_sequence=1,
        total_periods_in_year=4,
        period_progress_ratio=Decimal("0.2500"),
        start_date=date.today() - timedelta(days=60),
        end_date=date.today(),
        is_active=True,
        academic_year_id=year.academic_year_id,
    )
    db.add(period)

    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add(level)
    db.flush()

    user_id_teacher = uuid.uuid4()
    user_id_sub = uuid.uuid4()

    teacher = AcademicStaff(
        staff_id="TCH-001",
        user_id=user_id_teacher,
        first_name="Maria",
        last_name="Santos",
        email="maria@school.edu",
    )
    sub_teacher = AcademicStaff(
        staff_id="TCH-SUB",
        user_id=user_id_sub,
        first_name="Carlos",
        last_name="Dela Cruz",
        email="carlos@school.edu",
    )
    adviser = AcademicStaff(
        staff_id="TCH-ADV",
        first_name="Elena",
        last_name="Reyes",
        email="elena@school.edu",
    )
    db.add_all([teacher, sub_teacher, adviser])
    db.flush()

    user = UserAccount(
        user_id=user_id_teacher,
        email="maria@school.edu",
        ref_type="staff",
        ref_id=teacher.staff_id,
        account_status="active",
    )
    sub_user = UserAccount(
        user_id=user_id_sub,
        email="carlos@school.edu",
        ref_type="staff",
        ref_id=sub_teacher.staff_id,
        account_status="active",
    )
    db.add_all([user, sub_user])

    subject = Subject(
        subject_name="Science 7",
        subject_codename="SCI7",
        academic_level_id=level.academic_level_id,
    )
    db.add(subject)
    db.flush()

    class_ = Class(
        section_name="Diamond",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
        academic_period_id=period.academic_period_id,
        adviser_staff_id=adviser.staff_id,
        class_status="active",
    )
    db.add(class_)
    db.flush()

    load = SubjectLoad(
        staff_id=teacher.staff_id,
        subject_id=subject.subject_id,
        class_id=class_.class_id,
        academic_period_id=period.academic_period_id,
        status="active",
    )
    db.add(load)
    db.flush()

    student1 = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000001",
        first_name="Juan",
        last_name="Luna",
        gender="Male",
    )
    student2 = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000002",
        first_name="Maria",
        last_name="Clara",
        gender="Female",
    )
    db.add_all([student1, student2])
    db.flush()

    sc1 = StudentClass(
        student_id=student1.student_id,
        class_id=class_.class_id,
        academic_year_id=year.academic_year_id,
        enrollment_status="enrolled",
    )
    sc2 = StudentClass(
        student_id=student2.student_id,
        class_id=class_.class_id,
        academic_year_id=year.academic_year_id,
        enrollment_status="enrolled",
    )
    db.add_all([sc1, sc2])
    db.flush()

    # Create WW, PT, QA classworks
    cw_ww = Classwork(
        title="Quiz 1",
        subject_id=subject.subject_id,
        classwork_category="WRITTEN_WORK",
        classwork_type="QUIZ",
        total_points=Decimal("100"),
        created_by_staff_id=teacher.staff_id,
        is_graded=True,
        is_archived=False,
    )
    cw_pt = Classwork(
        title="Lab Activity",
        subject_id=subject.subject_id,
        classwork_category="PERFORMANCE_TASK",
        classwork_type="ACTIVITY",
        total_points=Decimal("100"),
        created_by_staff_id=teacher.staff_id,
        is_graded=True,
        is_archived=False,
    )
    cw_qa = Classwork(
        title="Quarterly Exam",
        subject_id=subject.subject_id,
        classwork_category="QUARTERLY_ASSESSMENT",
        classwork_type="EXAM",
        total_points=Decimal("100"),
        created_by_staff_id=teacher.staff_id,
        is_graded=True,
        is_archived=False,
    )
    db.add_all([cw_ww, cw_pt, cw_qa])
    db.flush()

    ca_ww = ClassworkAssignment(classwork_id=cw_ww.classwork_id, class_id=class_.class_id, assigned_by_staff_id=teacher.staff_id)
    ca_pt = ClassworkAssignment(classwork_id=cw_pt.classwork_id, class_id=class_.class_id, assigned_by_staff_id=teacher.staff_id)
    ca_qa = ClassworkAssignment(classwork_id=cw_qa.classwork_id, class_id=class_.class_id, assigned_by_staff_id=teacher.staff_id)
    db.add_all([ca_ww, ca_pt, ca_qa])
    db.flush()

    # Submissions for Student 1 (all 90)
    sub1_ww = StudentSubmission(
        student_id=student1.student_id,
        classwork_assignment_id=ca_ww.classwork_assignment_id,
        grade=Decimal("90"),
        status="graded",
    )
    sub1_pt = StudentSubmission(
        student_id=student1.student_id,
        classwork_assignment_id=ca_pt.classwork_assignment_id,
        grade=Decimal("90"),
        status="graded",
    )
    sub1_qa = StudentSubmission(
        student_id=student1.student_id,
        classwork_assignment_id=ca_qa.classwork_assignment_id,
        grade=Decimal("90"),
        status="graded",
    )

    # Submissions for Student 2 (only WW scored, PT & QA missing -> incomplete)
    sub2_ww = StudentSubmission(
        student_id=student2.student_id,
        classwork_assignment_id=ca_ww.classwork_assignment_id,
        grade=Decimal("80"),
        status="graded",
    )
    db.add_all([sub1_ww, sub1_pt, sub1_qa, sub2_ww])
    db.commit()

    return {
        "db": db,
        "teacher": teacher,
        "sub_teacher": sub_teacher,
        "user": user,
        "sub_user": sub_user,
        "class": class_,
        "subject": subject,
        "period": period,
        "student1": student1,
        "student2": student2,
        "load": load,
        "ca_ww": ca_ww,
        "ca_pt": ca_pt,
        "ca_qa": ca_qa,
    }


def _make_client(db, user):
    app = FastAPI()
    app.include_router(student_records_router, prefix="/api/v1/student-records")
    identity = {"sub": user.user_id, "role": "teacher"}
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: identity
    return TestClient(app)


def test_send_single_student_grade_and_audit_log(adviser_send_context):
    ctx = adviser_send_context
    client = _make_client(ctx["db"], ctx["user"])

    url = f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}/subjects/{ctx['subject'].subject_id}/students/{ctx['student1'].student_id}/send-to-adviser"
    payload = {
        "academic_period_id": ctx["period"].academic_period_id,
        "expected_transmuted_grade": 95.0,
        "remarks": "Finalized Q1 grade for Juan",
    }
    resp = client.post(url, json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["student_id"] == str(ctx["student1"].student_id)
    assert data["is_finalized"] is True
    assert data["transmuted_grade"] == 95.0
    assert data["final_period_grade"] == 95.0
    assert data["status"] == "newly_sent"
    assert data["finalized_by_name"] == "Maria Santos"

    # Verify StudentPeriodGrade row
    db = ctx["db"]
    pg = (
        db.query(StudentPeriodGrade)
        .filter(
            StudentPeriodGrade.student_id == ctx["student1"].student_id,
            StudentPeriodGrade.class_id == ctx["class"].class_id,
            StudentPeriodGrade.subject_id == ctx["subject"].subject_id,
            StudentPeriodGrade.academic_period_id == ctx["period"].academic_period_id,
        )
        .first()
    )
    assert pg is not None
    assert pg.is_finalized is True
    assert float(pg.final_period_grade) == 95.0
    assert pg.finalized_by_staff_id == ctx["teacher"].staff_id
    assert pg.entered_by_staff_id == ctx["teacher"].staff_id

    # Verify GradeSubmissionLog
    logs = (
        db.query(GradeSubmissionLog)
        .filter(GradeSubmissionLog.student_id == ctx["student1"].student_id)
        .all()
    )
    assert len(logs) == 1
    assert logs[0].submission_type == "single"
    assert float(logs[0].final_period_grade) == 95.0
    assert logs[0].submitted_by_staff_id == ctx["teacher"].staff_id


def test_resend_after_score_edit_idempotent(adviser_send_context):
    ctx = adviser_send_context
    client = _make_client(ctx["db"], ctx["user"])
    db = ctx["db"]

    url = f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}/subjects/{ctx['subject'].subject_id}/students/{ctx['student1'].student_id}/send-to-adviser"

    # Initial send
    resp1 = client.post(url, json={"academic_period_id": ctx["period"].academic_period_id})
    assert resp1.status_code == 200

    # Modify a classwork score for student 1 from 90 to 100
    sub = (
        db.query(StudentSubmission)
        .filter(
            StudentSubmission.student_id == ctx["student1"].student_id,
            StudentSubmission.classwork_assignment_id == ctx["ca_ww"].classwork_assignment_id,
        )
        .first()
    )
    sub.grade = Decimal("100")
    db.commit()

    # Resend
    resp2 = client.post(url, json={"academic_period_id": ctx["period"].academic_period_id})
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["status"] == "updated"

    # Verify StudentPeriodGrade is updated, NOT duplicated
    pg_count = (
        db.query(StudentPeriodGrade)
        .filter(
            StudentPeriodGrade.student_id == ctx["student1"].student_id,
            StudentPeriodGrade.class_id == ctx["class"].class_id,
            StudentPeriodGrade.subject_id == ctx["subject"].subject_id,
            StudentPeriodGrade.academic_period_id == ctx["period"].academic_period_id,
        )
        .count()
    )
    assert pg_count == 1

    # Verify GradeSubmissionLog has 2 append-only rows
    logs = (
        db.query(GradeSubmissionLog)
        .filter(GradeSubmissionLog.student_id == ctx["student1"].student_id)
        .order_by(GradeSubmissionLog.id.asc())
        .all()
    )
    assert len(logs) == 2


def test_completeness_warning_allows_send_with_incomplete_components(adviser_send_context):
    ctx = adviser_send_context
    client = _make_client(ctx["db"], ctx["user"])

    # Student 2 is missing PT & QA - should succeed (200 OK) with warnings populated
    url = f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}/subjects/{ctx['subject'].subject_id}/students/{ctx['student2'].student_id}/send-to-adviser"
    resp = client.post(url, json={"academic_period_id": ctx["period"].academic_period_id})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["student_id"] == str(ctx["student2"].student_id)
    assert data["is_finalized"] is True
    assert "performance_task" in data["incomplete_components"]
    assert "quarterly_assessment" in data["incomplete_components"]
    assert "written_work" not in data["incomplete_components"]
    assert data["transmuted_grade"] is not None


def test_bulk_send_with_incomplete_components_sets_warning_count(adviser_send_context):
    ctx = adviser_send_context
    client = _make_client(ctx["db"], ctx["user"])

    # Student 1 has full components, Student 2 is missing PT & QA
    bulk_url = f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}/subjects/{ctx['subject'].subject_id}/periods/{ctx['period'].academic_period_id}/send-to-adviser"
    resp = client.post(bulk_url, json={})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total_students"] == 2
    assert data["newly_sent_count"] == 2
    assert data["incomplete_warning_count"] == 1
    assert data["incomplete_skipped_count"] == 0


def test_recompute_vs_display_conflict_check(adviser_send_context):
    ctx = adviser_send_context
    client = _make_client(ctx["db"], ctx["user"])

    # Student 1 computed grade is 93, but frontend passes expected 85
    url = f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}/subjects/{ctx['subject'].subject_id}/students/{ctx['student1'].student_id}/send-to-adviser"
    resp = client.post(
        url,
        json={
            "academic_period_id": ctx["period"].academic_period_id,
            "expected_transmuted_grade": 85.0,
        },
    )
    assert resp.status_code == 409
    assert "conflict" in resp.json()["detail"].lower()


def test_bulk_send_partitions_newly_sent_vs_unchanged(adviser_send_context):
    ctx = adviser_send_context
    client = _make_client(ctx["db"], ctx["user"])
    db = ctx["db"]

    # Also give student 2 full scores so they are eligible
    sub2_pt = StudentSubmission(
        student_id=ctx["student2"].student_id,
        classwork_assignment_id=ctx["ca_pt"].classwork_assignment_id,
        grade=Decimal("85"),
        status="graded",
    )
    sub2_qa = StudentSubmission(
        student_id=ctx["student2"].student_id,
        classwork_assignment_id=ctx["ca_qa"].classwork_assignment_id,
        grade=Decimal("85"),
        status="graded",
    )
    db.add_all([sub2_pt, sub2_qa])
    db.commit()

    bulk_url = f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}/subjects/{ctx['subject'].subject_id}/periods/{ctx['period'].academic_period_id}/send-to-adviser"

    # First bulk send
    resp1 = client.post(bulk_url, json={})
    assert resp1.status_code == 200, resp1.text
    data1 = resp1.json()
    assert data1["total_students"] == 2
    assert data1["newly_sent_count"] == 2
    assert data1["unchanged_skipped_count"] == 0

    # Second bulk send without edits
    resp2 = client.post(bulk_url, json={})
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["total_students"] == 2
    assert data2["newly_sent_count"] == 0
    assert data2["unchanged_skipped_count"] == 2


def test_substitute_teacher_audit_trail(adviser_send_context):
    ctx = adviser_send_context
    db = ctx["db"]

    # Create active substitution
    sub = TeacherSubstitution(
        subject_load_id=ctx["load"].subject_load_id,
        original_staff_id=ctx["teacher"].staff_id,
        substitute_staff_id=ctx["sub_teacher"].staff_id,
        start_date=date.today() - timedelta(days=1),
        end_date=date.today() + timedelta(days=5),
        status="active",
    )
    db.add(sub)
    db.commit()

    # Make request as substitute teacher
    sub_client = _make_client(db, ctx["sub_user"])
    url = f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}/subjects/{ctx['subject'].subject_id}/students/{ctx['student1'].student_id}/send-to-adviser"

    resp = sub_client.post(url, json={"academic_period_id": ctx["period"].academic_period_id})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["finalized_by_staff_id"] == ctx["sub_teacher"].staff_id
    assert data["finalized_by_name"] == "Carlos Dela Cruz"

    # Verify StudentPeriodGrade has entered_by = original teacher, finalized_by = substitute
    pg = (
        db.query(StudentPeriodGrade)
        .filter(
            StudentPeriodGrade.student_id == ctx["student1"].student_id,
            StudentPeriodGrade.class_id == ctx["class"].class_id,
        )
        .first()
    )
    assert pg.finalized_by_staff_id == ctx["sub_teacher"].staff_id
    assert pg.entered_by_staff_id == ctx["teacher"].staff_id


def test_grade_submission_log_set_null_on_period_grade_deletion(adviser_send_context):
    ctx = adviser_send_context
    client = _make_client(ctx["db"], ctx["user"])
    db = ctx["db"]

    url = f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}/subjects/{ctx['subject'].subject_id}/students/{ctx['student1'].student_id}/send-to-adviser"
    resp = client.post(url, json={"academic_period_id": ctx["period"].academic_period_id})
    assert resp.status_code == 200

    pg = (
        db.query(StudentPeriodGrade)
        .filter(StudentPeriodGrade.student_id == ctx["student1"].student_id)
        .first()
    )
    pg_id = pg.period_grade_id

    # Delete StudentPeriodGrade
    db.delete(pg)
    db.commit()

    # Log should still survive with student_period_grade_id set to None/null
    log = (
        db.query(GradeSubmissionLog)
        .filter(GradeSubmissionLog.student_id == ctx["student1"].student_id)
        .first()
    )
    assert log is not None
    assert log.student_period_grade_id is None
    assert float(log.final_period_grade) == 95.0


def test_send_single_student_rejected_outside_timing_window(adviser_send_context):
    ctx = adviser_send_context
    client = _make_client(ctx["db"], ctx["user"])
    db = ctx["db"]

    # Set period end_date 30 days in the future (submission window is 7 days before end_date)
    period = ctx["period"]
    period.end_date = date.today() + timedelta(days=30)
    db.commit()

    allowed_date = (period.end_date - timedelta(days=7)).isoformat()

    url = f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}/subjects/{ctx['subject'].subject_id}/students/{ctx['student1'].student_id}/send-to-adviser"
    resp = client.post(url, json={"academic_period_id": period.academic_period_id})
    assert resp.status_code == 400
    assert resp.json()["detail"] == f"Grades can be sent to the adviser starting {allowed_date}."


def test_bulk_send_rejected_outside_timing_window(adviser_send_context):
    ctx = adviser_send_context
    client = _make_client(ctx["db"], ctx["user"])
    db = ctx["db"]

    # Set period end_date 20 days in the future
    period = ctx["period"]
    period.end_date = date.today() + timedelta(days=20)
    db.commit()

    allowed_date = (period.end_date - timedelta(days=7)).isoformat()

    bulk_url = f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}/subjects/{ctx['subject'].subject_id}/periods/{period.academic_period_id}/send-to-adviser"
    resp = client.post(bulk_url, json={})
    assert resp.status_code == 400
    assert resp.json()["detail"] == f"Grades can be sent to the adviser starting {allowed_date}."


def test_send_allowed_inside_timing_window_and_boundary(adviser_send_context):
    ctx = adviser_send_context
    client = _make_client(ctx["db"], ctx["user"])
    db = ctx["db"]

    # Exactly 7 days before end_date (boundary)
    period = ctx["period"]
    period.end_date = date.today() + timedelta(days=7)
    db.commit()

    url = f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}/subjects/{ctx['subject'].subject_id}/students/{ctx['student1'].student_id}/send-to-adviser"
    resp = client.post(url, json={"academic_period_id": period.academic_period_id})
    assert resp.status_code == 200, resp.text


def test_send_allowed_inside_window_after_end_date(adviser_send_context):
    ctx = adviser_send_context
    client = _make_client(ctx["db"], ctx["user"])
    db = ctx["db"]

    # Period ended 3 days ago (inside the +7 days window)
    period = ctx["period"]
    period.end_date = date.today() - timedelta(days=3)
    db.commit()

    url = f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}/subjects/{ctx['subject'].subject_id}/students/{ctx['student1'].student_id}/send-to-adviser"
    resp = client.post(url, json={"academic_period_id": period.academic_period_id})
    assert resp.status_code == 200, resp.text


def test_first_time_send_rejected_after_upper_cutoff(adviser_send_context):
    ctx = adviser_send_context
    client = _make_client(ctx["db"], ctx["user"])
    db = ctx["db"]

    # Period ended 15 days ago (window closed 8 days ago)
    period = ctx["period"]
    period.end_date = date.today() - timedelta(days=15)
    db.commit()

    allowed_end_date = (period.end_date + timedelta(days=7)).isoformat()

    url = f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}/subjects/{ctx['subject'].subject_id}/students/{ctx['student1'].student_id}/send-to-adviser"
    resp = client.post(url, json={"academic_period_id": period.academic_period_id})
    assert resp.status_code == 400
    assert resp.json()["detail"] == f"The submission window for this term closed on {allowed_end_date}. Contact an administrator if this grade needs correction."


def test_bulk_send_rejected_after_upper_cutoff(adviser_send_context):
    ctx = adviser_send_context
    client = _make_client(ctx["db"], ctx["user"])
    db = ctx["db"]

    # Period ended 10 days ago (window closed 3 days ago)
    period = ctx["period"]
    period.end_date = date.today() - timedelta(days=10)
    db.commit()

    allowed_end_date = (period.end_date + timedelta(days=7)).isoformat()

    bulk_url = f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}/subjects/{ctx['subject'].subject_id}/periods/{period.academic_period_id}/send-to-adviser"
    resp = client.post(bulk_url, json={})
    assert resp.status_code == 400
    assert resp.json()["detail"] == f"The submission window for this term closed on {allowed_end_date}. Contact an administrator if this grade needs correction."


def test_resend_of_finalized_grade_rejected_after_upper_cutoff(adviser_send_context):
    ctx = adviser_send_context
    client = _make_client(ctx["db"], ctx["user"])
    db = ctx["db"]

    # 1. Initial send while window is active (today is end_date)
    period = ctx["period"]
    period.end_date = date.today()
    db.commit()

    url = f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}/subjects/{ctx['subject'].subject_id}/students/{ctx['student1'].student_id}/send-to-adviser"
    resp1 = client.post(url, json={"academic_period_id": period.academic_period_id})
    assert resp1.status_code == 200, resp1.text

    # 2. Window closes (period ended 12 days ago)
    period.end_date = date.today() - timedelta(days=12)
    db.commit()

    allowed_end_date = (period.end_date + timedelta(days=7)).isoformat()

    # 3. Attempt resend with force_resend=True
    resp2 = client.post(
        url,
        json={
            "academic_period_id": period.academic_period_id,
            "force_resend": True,
            "remarks": "Late correction attempt",
        },
    )
    assert resp2.status_code == 400
    assert resp2.json()["detail"] == f"The submission window for this term closed on {allowed_end_date}. Contact an administrator if this grade needs correction."

