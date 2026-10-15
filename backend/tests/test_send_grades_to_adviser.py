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
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.auth.UserAccount import UserAccount
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.intervention.Intervention import Intervention
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.student_record.StudentRecordService import teacher_student_gradebook


# Independent expectations from docs/GRADE_TRANSMUTATION_CONTRACT_4G.md.
# The fixture has no grading template, so the existing fallback is 30/50/20.
# Initial grade 90 is in 88.88-90.05 -> 91; do not call the production lookup
# to derive the expected value for either the response or the stored audit.
EXPECTED_COMPLETE_INITIAL_GRADE = float(
    Decimal("90") * Decimal("0.30")
    + Decimal("90") * Decimal("0.50")
    + Decimal("90") * Decimal("0.20")
)
EXPECTED_COMPLETE_TERM_GRADE = 91.0


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
        account_status="active",
    )
    sub_user = UserAccount(
        user_id=user_id_sub,
        email="carlos@school.edu",
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

    ca_ww = ClassworkAssignment(
        classwork_id=cw_ww.classwork_id,
        class_id=class_.class_id,
        academic_period_id=period.academic_period_id,
        assigned_by_staff_id=teacher.staff_id,
    )
    ca_pt = ClassworkAssignment(
        classwork_id=cw_pt.classwork_id,
        class_id=class_.class_id,
        academic_period_id=period.academic_period_id,
        assigned_by_staff_id=teacher.staff_id,
    )
    ca_qa = ClassworkAssignment(
        classwork_id=cw_qa.classwork_id,
        class_id=class_.class_id,
        academic_period_id=period.academic_period_id,
        assigned_by_staff_id=teacher.staff_id,
    )
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
        "expected_transmuted_grade": EXPECTED_COMPLETE_TERM_GRADE,
        "remarks": "Finalized Q1 grade for Juan",
    }
    resp = client.post(url, json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["student_id"] == str(ctx["student1"].student_id)
    assert data["is_finalized"] is True
    assert data["initial_grade"] == EXPECTED_COMPLETE_INITIAL_GRADE
    assert data["transmuted_grade"] == EXPECTED_COMPLETE_TERM_GRADE
    assert data["final_period_grade"] == EXPECTED_COMPLETE_TERM_GRADE
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
    assert float(pg.initial_grade) == EXPECTED_COMPLETE_INITIAL_GRADE
    assert float(pg.final_period_grade) == EXPECTED_COMPLETE_TERM_GRADE
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
    assert float(logs[0].initial_grade) == EXPECTED_COMPLETE_INITIAL_GRADE
    assert float(logs[0].final_period_grade) == EXPECTED_COMPLETE_TERM_GRADE
    assert logs[0].submitted_by_staff_id == ctx["teacher"].staff_id


def test_resend_after_score_edit_idempotent(adviser_send_context):
    ctx = adviser_send_context
    client = _make_client(ctx["db"], ctx["user"])
    db = ctx["db"]

    url = f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}/subjects/{ctx['subject'].subject_id}/students/{ctx['student1'].student_id}/send-to-adviser"

    # Initial send
    resp1 = client.post(url, json={"academic_period_id": ctx["period"].academic_period_id})
    assert resp1.status_code == 200
    assert resp1.json()["initial_grade"] == EXPECTED_COMPLETE_INITIAL_GRADE
    assert resp1.json()["transmuted_grade"] == EXPECTED_COMPLETE_TERM_GRADE

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
    edited_initial_grade = float(
        Decimal("100") * Decimal("0.30")
        + Decimal("90") * Decimal("0.50")
        + Decimal("90") * Decimal("0.20")
    )
    assert data2["initial_grade"] == edited_initial_grade
    # Task 4G interval 92.42-93.59 -> 94, independently of the implementation.
    assert data2["transmuted_grade"] == 94.0
    assert data2["final_period_grade"] == 94.0

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

    # Student 1 has Initial Grade 90 -> Term Grade 91, but the UI passes 85.
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
    assert float(log.final_period_grade) == EXPECTED_COMPLETE_TERM_GRADE


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


@pytest.fixture
def grade_send_comparison_context(adviser_send_context):
    """Exercise real grade paths with explicit weights, not fallback policy."""
    ctx = adviser_send_context
    template = GradingTemplate(
        template_name="Scope comparison 20-50-30",
        subject_id=ctx["subject"].subject_id,
        academic_level_id=ctx["subject"].academic_level_id,
        status="active",
        components=[
            GradingTemplateComponent(component_name=name, weight=Decimal(weight), display_order=index)
            for index, (name, weight) in enumerate(
                (("Written Works", "20"), ("Performance Tasks", "50"), ("Exams", "30")),
                start=1,
            )
        ],
    )
    ctx["db"].add(template)
    ctx["db"].flush()
    ctx["subject"].default_grading_template = str(template.grading_template_id)
    ctx["db"].commit()
    return ctx


def _comparison_targeted_intervention(ctx, recipient):
    """Persist valid provenance without calling predictions or AI services."""
    db = ctx["db"]
    model = AIModelVersion(
        model_name="isolated-grade-scope-fixture",
        model_type="REGRESSOR",
        model_purpose="CURRENT_TERM_FINAL_GRADE_PROJECTION",
        algorithm="fixture-only",
        is_active=False,
    )
    db.add(model)
    db.flush()
    prediction = DevelopmentCurrentTermPrediction(
        student_id=recipient.student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        source_period_id=ctx["period"].academic_period_id,
        target_period_id=ctx["period"].academic_period_id,
        model_version_id=model.model_version_id,
        revision=1,
        predicted_period_grade=Decimal("80"),
        intervention_level="NEEDS_MONITORING",
        intervention_basis="fixture-only",
        evidence_snapshot={},
    )
    db.add(prediction)
    db.flush()
    intervention = Intervention(
        student_id=recipient.student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        source_prediction_id=prediction.prediction_id,
        status="CANDIDATE",
        diagnosis_snapshot={},
    )
    db.add(intervention)
    db.flush()
    return intervention.intervention_id


def _add_grade_scope_comparison_work(
    ctx, category, recipient_key, score, *, remedial=False, forged_score=False, exam_subtype="TERM_EXAM",
):
    db = ctx["db"]
    recipient = ctx[recipient_key] if recipient_key else None
    classwork = Classwork(
        title="Scope comparison work",
        subject_id=ctx["subject"].subject_id,
        classwork_category=category,
        classwork_type="QUIZ" if category == "QUARTERLY_ASSESSMENT" else "ACTIVITY",
        exam_subtype=exam_subtype if category == "QUARTERLY_ASSESSMENT" else None,
        total_points=Decimal("100"),
        created_by_staff_id=ctx["teacher"].staff_id,
        is_graded=True,
        is_archived=False,
    )
    db.add(classwork)
    db.flush()
    assignment = ClassworkAssignment(
        classwork_id=classwork.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=ctx["teacher"].staff_id,
        is_published=True,
        recipient_student_id=recipient.student_id if recipient else None,
        source_intervention_id=_comparison_targeted_intervention(ctx, recipient) if recipient else None,
        remediation_request_id=uuid.uuid4() if recipient else None,
        original_exam_assignment_id=ctx["ca_qa"].classwork_assignment_id if remedial else None,
    )
    db.add(assignment)
    db.flush()
    # Class-wide extra work is scored for the classmate, not student1.
    scored_student = recipient or ctx["student2"]
    db.add(StudentSubmission(
        student_id=scored_student.student_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
        grade=Decimal(score),
        status="graded",
    ))
    if forged_score:
        assert recipient_key == "student2"
        db.add(StudentSubmission(
            student_id=ctx["student1"].student_id,
            classwork_assignment_id=assignment.classwork_assignment_id,
            grade=Decimal("100"),
            status="graded",
        ))
    db.commit()


# The class record is the applicability oracle, not a duplicated recipient rule.
# Every scenario must agree through both real send endpoints, with and without
# the optional stale-display check. No incorrect pre-fix grade is an expectation.
@pytest.mark.parametrize("send_kind", ["single", "bulk"])
@pytest.mark.parametrize("include_expected_grade", [True, False], ids=["with-display-check", "without-display-check"])
@pytest.mark.parametrize("exam_subtype", ["SUMMATIVE_1", "SUMMATIVE_2", "TERM_EXAM", None])
@pytest.mark.parametrize(
    "category,recipient_key,score,remedial,remove_original,forged_score",
    [
        pytest.param(None, None, "100", False, False, False, id="classwide-baseline"),
        pytest.param("WRITTEN_WORK", "student2", "100", False, False, False, id="classmate-targeted-ww"),
        pytest.param("PERFORMANCE_TASK", "student2", "100", False, False, False, id="classmate-targeted-pt"),
        pytest.param("QUARTERLY_ASSESSMENT", "student2", "100", False, False, False, id="classmate-targeted-exam"),
        pytest.param("WRITTEN_WORK", "student1", "100", False, False, False, id="own-targeted-ww"),
        pytest.param("PERFORMANCE_TASK", "student1", "100", False, False, False, id="own-targeted-pt"),
        pytest.param("QUARTERLY_ASSESSMENT", "student1", "100", False, False, False, id="own-targeted-exam"),
        pytest.param("WRITTEN_WORK", None, "100", False, False, False, id="classwide-unscored-extra-ww"),
        pytest.param("QUARTERLY_ASSESSMENT", "student1", "100", True, False, False, id="own-higher-remedial-exam"),
        pytest.param("QUARTERLY_ASSESSMENT", "student1", "80", True, False, False, id="own-lower-remedial-exam"),
        pytest.param("QUARTERLY_ASSESSMENT", "student2", "100", True, False, False, id="classmate-remedial-exam"),
        pytest.param("QUARTERLY_ASSESSMENT", "student1", "100", True, True, False, id="own-remedial-with-unscored-original"),
        pytest.param("WRITTEN_WORK", "student2", "100", False, False, True, id="ineligible-scored-ww"),
        pytest.param("PERFORMANCE_TASK", "student2", "100", False, False, True, id="ineligible-scored-pt"),
        pytest.param("QUARTERLY_ASSESSMENT", "student2", "100", False, False, True, id="ineligible-scored-exam"),
        pytest.param("QUARTERLY_ASSESSMENT", "student2", "100", True, False, True, id="ineligible-scored-remedial"),
    ],
)
def test_send_and_gradebook_applicability_parity(
    grade_send_comparison_context, send_kind, include_expected_grade, exam_subtype, category, recipient_key, score,
    remedial, remove_original, forged_score,
):
    ctx = grade_send_comparison_context
    db = ctx["db"]
    student = ctx["student1"]
    ctx["ca_qa"].classwork.exam_subtype = exam_subtype
    db.commit()
    if remove_original:
        original_score = db.query(StudentSubmission).filter_by(
            student_id=student.student_id,
            classwork_assignment_id=ctx["ca_qa"].classwork_assignment_id,
        ).one()
        db.delete(original_score)
        db.commit()
    if category:
        _add_grade_scope_comparison_work(
            ctx, category, recipient_key, score, remedial=remedial,
            forged_score=forged_score, exam_subtype=exam_subtype,
        )

    gradebook = teacher_student_gradebook(
        db, ctx["teacher"].staff_id, ctx["class"].class_id,
        ctx["subject"].subject_id, ctx["period"].academic_period_id,
    )
    assert (
        gradebook.grading_weights.ww_percentage,
        gradebook.grading_weights.pt_percentage,
        gradebook.grading_weights.exams_percentage,
    ) == (20, 50, 30)
    displayed = next(row for row in gradebook.studentGrades if row.student_id == str(student.student_id))
    assert displayed.initial_grade is not None
    assert displayed.transmuted_grade is not None

    client = _make_client(db, ctx["user"])
    prefix = f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}/subjects/{ctx['subject'].subject_id}"
    url = (
        f"{prefix}/students/{student.student_id}/send-to-adviser" if send_kind == "single"
        else f"{prefix}/periods/{ctx['period'].academic_period_id}/send-to-adviser"
    )
    expected_payload = (
        {"expected_transmuted_grade": displayed.transmuted_grade} if send_kind == "single"
        else {"expected_student_grades": {str(student.student_id): displayed.transmuted_grade}}
    ) if include_expected_grade else {}
    response = client.post(url, json={"academic_period_id": ctx["period"].academic_period_id, **expected_payload})
    assert response.status_code == 200, response.text
    payload = response.json()
    entry = payload if send_kind == "single" else next(
        row for row in payload["entries"] if row["student_id"] == str(student.student_id)
    )
    assert entry["initial_grade"] == displayed.initial_grade
    assert entry["transmuted_grade"] == displayed.transmuted_grade
    assert entry["final_period_grade"] == displayed.transmuted_grade
    stored = db.query(StudentPeriodGrade).filter_by(student_id=student.student_id).one()
    audit = db.query(GradeSubmissionLog).filter_by(student_id=student.student_id).one()
    assert float(stored.final_period_grade) == displayed.transmuted_grade
    assert float(audit.final_period_grade) == displayed.transmuted_grade

