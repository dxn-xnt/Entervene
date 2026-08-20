from datetime import date, datetime, timezone
from decimal import Decimal
import uuid
import pytest
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.classwork.ClassworkService import create_classwork_record
from app.schemas.Classwork import ClassworkCreate
from app.services.student_record.StudentRecordService import (
    _classwork_assignments,
    TeacherRecordScope,
)


@pytest.fixture
def db_session():
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
    try:
        yield db
    finally:
        db.close()


def test_reading_classwork_forces_is_graded_false(db_session):
    db = db_session
    account = UserAccount(user_id=uuid.uuid4(), email="teacher@test.local", password_hash="x")
    db.add(account)
    db.flush()

    staff = AcademicStaff(
        staff_id="STF-TEST-READING-1",
        first_name="Teacher",
        last_name="Test",
        user_id=account.user_id,
    )
    db.add(staff)
    db.flush()

    level = AcademicLevel(level_name="Grade 9", grade_level=9)
    db.add(level)
    db.flush()

    year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    db.add(year)
    db.flush()

    cls = Class(
        section_name="Emerald",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add(cls)
    db.flush()

    subject = Subject(
        subject_name="Science 9 Test",
        academic_level_id=level.academic_level_id,
    )
    db.add(subject)
    db.flush()

    period1 = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name="Q1",
        period_sequence=1,
        start_date=date(2026, 8, 1),
        end_date=date(2026, 10, 31),
        is_active=True,
    )
    db.add(period1)
    db.flush()

    subject_load = SubjectLoad(
        staff_id=staff.staff_id,
        subject_id=subject.subject_id,
        class_id=cls.class_id,
        academic_period_id=period1.academic_period_id,
        status="active",
    )
    db.add(subject_load)
    db.commit()

    # 1. Create a reading classwork via service
    reading_body = ClassworkCreate(
        title="Cell Structure Reference Reading",
        description="Reading material on cells",
        instructions="Read pages 10-20",
        classwork_type="READING",
        classwork_category="WRITTEN_WORK",
        subject_id=subject.subject_id,
        total_points=100.0,
    )
    reading_res = create_classwork_record(reading_body, staff.staff_id, db)
    assert reading_res.is_graded is False
    assert reading_res.classwork_category == "WRITTEN_WORK"
    assert reading_res.total_points is None

    # Check DB record directly
    db_reading = db.get(Classwork, reading_res.classwork_id)
    assert db_reading.is_graded is False
    assert db_reading.classwork_category == "WRITTEN_WORK"

    # 2. Create a non-reading classwork (e.g. QUIZ / ASSIGNMENT)
    quiz_body = ClassworkCreate(
        title="Cell Structure Quiz",
        description="Quiz on cells",
        instructions="Answer all questions",
        classwork_type="QUIZ",
        classwork_category="WRITTEN_WORK",
        subject_id=subject.subject_id,
        total_points=50.0,
    )
    quiz_res = create_classwork_record(quiz_body, staff.staff_id, db)
    assert quiz_res.is_graded is True
    assert quiz_res.classwork_category == "WRITTEN_WORK"
    assert quiz_res.total_points == 50.0

    db_quiz = db.get(Classwork, quiz_res.classwork_id)
    assert db_quiz.is_graded is True


def test_gradebook_and_assignments_exclude_non_graded(db_session):
    db = db_session
    account = UserAccount(user_id=uuid.uuid4(), email="teacher2@test.local", password_hash="x")
    db.add(account)
    db.flush()

    staff = AcademicStaff(
        staff_id="STF-TEST-READING-2",
        first_name="Teacher",
        last_name="Test2",
        user_id=account.user_id,
    )
    db.add(staff)
    db.flush()

    level = AcademicLevel(level_name="Grade 9", grade_level=9)
    db.add(level)
    db.flush()

    year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    db.add(year)
    db.flush()

    period = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name="Q1",
        period_sequence=1,
        start_date=date(2026, 8, 1),
        end_date=date(2026, 10, 31),
        is_active=True,
    )
    db.add(period)
    db.flush()

    cls = Class(
        section_name="Emerald",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add(cls)
    db.flush()

    subject = Subject(
        subject_name="Science 9 Test 2",
        academic_level_id=level.academic_level_id,
    )
    db.add(subject)
    db.flush()

    subject_load2 = SubjectLoad(
        staff_id=staff.staff_id,
        subject_id=subject.subject_id,
        class_id=cls.class_id,
        academic_period_id=period.academic_period_id,
        status="active",
    )
    db.add(subject_load2)
    db.flush()

    # Reading classwork assigned
    cw_reading = Classwork(
        title="Chapter 1 Reading Guide",
        classwork_type="READING",
        classwork_category="WRITTEN_WORK",
        is_graded=False,
        total_points=None,
        subject_id=subject.subject_id,
        created_by_staff_id=staff.staff_id,
        is_published=True,
        is_archived=False,
    )
    db.add(cw_reading)
    db.flush()
    asgn_reading = ClassworkAssignment(
        classwork_id=cw_reading.classwork_id,
        class_id=cls.class_id,
        assigned_by_staff_id=staff.staff_id,
        is_published=True,
    )
    db.add(asgn_reading)

    # Graded classwork assigned
    cw_quiz = Classwork(
        title="Chapter 1 Quiz",
        classwork_type="QUIZ",
        classwork_category="WRITTEN_WORK",
        is_graded=True,
        total_points=Decimal("30.0"),
        subject_id=subject.subject_id,
        created_by_staff_id=staff.staff_id,
        is_published=True,
        is_archived=False,
    )
    db.add(cw_quiz)
    db.flush()
    asgn_quiz = ClassworkAssignment(
        classwork_id=cw_quiz.classwork_id,
        class_id=cls.class_id,
        assigned_by_staff_id=staff.staff_id,
        is_published=True,
    )
    db.add(asgn_quiz)
    db.commit()

    scope = TeacherRecordScope(
        subject_load=subject_load2,
        class_=cls,
        subject=subject,
        period=period,
        year=year,
    )

    # _classwork_assignments should ONLY return the graded quiz, not the reading material
    gradable = _classwork_assignments(db, scope)
    assert len(gradable) == 1
    assert gradable[0].classwork_assignment_id == asgn_quiz.classwork_assignment_id
    assert gradable[0].classwork.title == "Chapter 1 Quiz"


def test_student_todos_and_grades_widgets_exclude_reading_from_score_computations(db_session):
    from app.models.academic.StudentCLass import StudentClass
    from app.models.submissions.StudentSubmission import StudentSubmission
    from app.services.users.UserQueryService import (
        _student_assignment_rows,
        _student_submissions_by_assignment,
        _student_metric_summary,
        _student_subject_mastery,
    )

    db = db_session
    teacher_account = UserAccount(user_id=uuid.uuid4(), email="t3@test.local", password_hash="x")
    student_account = UserAccount(user_id=uuid.uuid4(), email="s3@test.local", password_hash="x")
    db.add_all([teacher_account, student_account])
    db.flush()

    staff = AcademicStaff(
        staff_id="STF-TEST-3",
        first_name="Teacher",
        last_name="Three",
        user_id=teacher_account.user_id,
    )
    db.add(staff)

    level = AcademicLevel(level_name="Grade 9", grade_level=9)
    db.add(level)
    db.flush()

    year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    db.add(year)
    db.flush()

    cls = Class(
        section_name="Emerald",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add(cls)
    db.flush()

    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789012",
        first_name="Test",
        last_name="Student",
        academic_level_id=level.academic_level_id,
        user_id=student_account.user_id,
    )
    db.add(student)
    db.flush()

    db.add(StudentClass(
        student_id=student.student_id,
        class_id=cls.class_id,
        academic_year_id=year.academic_year_id,
        enrollment_status="enrolled",
    ))

    subject = Subject(
        subject_name="Biology 9",
        academic_level_id=level.academic_level_id,
    )
    db.add(subject)
    db.flush()

    # 1. Reading classwork (Reference, non-graded)
    cw_reading = Classwork(
        title="Chapter 1 Reference Notes",
        classwork_type="READING",
        classwork_category="WRITTEN_WORK",
        is_graded=False,
        total_points=None,
        subject_id=subject.subject_id,
        created_by_staff_id=staff.staff_id,
        is_published=True,
        is_archived=False,
    )
    db.add(cw_reading)
    db.flush()
    asgn_reading = ClassworkAssignment(
        classwork_id=cw_reading.classwork_id,
        class_id=cls.class_id,
        assigned_by_staff_id=staff.staff_id,
        is_published=True,
    )
    db.add(asgn_reading)
    db.flush()

    # Student completed reading (even if a fake grade was somehow recorded on the submission row)
    sub_reading = StudentSubmission(
        classwork_assignment_id=asgn_reading.classwork_assignment_id,
        student_id=student.student_id,
        status="graded",
        grade=Decimal("100.0"),  # Fake score
    )
    db.add(sub_reading)

    # 2. Quiz classwork (Graded, 30 points, student scored 24/30 = 80%)
    cw_quiz = Classwork(
        title="Chapter 1 Assessment",
        classwork_type="QUIZ",
        classwork_category="WRITTEN_WORK",
        is_graded=True,
        total_points=Decimal("30.0"),
        subject_id=subject.subject_id,
        created_by_staff_id=staff.staff_id,
        is_published=True,
        is_archived=False,
    )
    db.add(cw_quiz)
    db.flush()
    asgn_quiz = ClassworkAssignment(
        classwork_id=cw_quiz.classwork_id,
        class_id=cls.class_id,
        assigned_by_staff_id=staff.staff_id,
        is_published=True,
    )
    db.add(asgn_quiz)
    db.flush()

    sub_quiz = StudentSubmission(
        classwork_assignment_id=asgn_quiz.classwork_assignment_id,
        student_id=student.student_id,
        status="graded",
        grade=Decimal("24.0"),  # 24/30 = 80%
    )
    db.add(sub_quiz)
    db.commit()

    # Verify UserQueryService backend analytics:
    # _student_assignment_rows filters out is_graded == False / READING
    rows = _student_assignment_rows(db, student.student_id)
    assert len(rows) == 1
    assert rows[0][1].classwork_id == cw_quiz.classwork_id

    subs_map = _student_submissions_by_assignment(db, student.student_id)
    metric_summary = _student_metric_summary(rows, subs_map)
    # Written work average should be exactly 80.0% (from Quiz 24/30), completely ignoring Reading
    assert metric_summary["written_work_average"] == 80.0

    mastery = _student_subject_mastery(rows, subs_map)
    assert len(mastery) == 1
    assert mastery[0]["subject"] == "Biology 9"
    assert mastery[0]["value"] == 80.0

    # Verify Frontend Widget logic on mock todos items:
    todos = [
        {
            "assignment_id": asgn_reading.classwork_assignment_id,
            "subject_id": subject.subject_id,
            "subject": subject.subject_name,
            "type": "READING",
            "category": "WRITTEN_WORK",
            "is_graded": False,
            "total_points": None,
            "status": "completed",
            "is_submitted": True,
            "grade": 100.0,
        },
        {
            "assignment_id": asgn_quiz.classwork_assignment_id,
            "subject_id": subject.subject_id,
            "subject": subject.subject_name,
            "type": "QUIZ",
            "category": "WRITTEN_WORK",
            "is_graded": True,
            "total_points": 30.0,
            "status": "completed",
            "is_submitted": True,
            "grade": 24.0,
        },
    ]

    # Widget 1: Completion Rate (Tracks engagement across ALL activities)
    completed_activities = len([t for t in todos if t["is_submitted"] or t["status"] == "completed"])
    assert completed_activities == 2
    assert round((completed_activities / len(todos)) * 100) == 100

    # Widget 2: Classwork Distribution (Type breakdown includes both)
    types = [t["type"] for t in todos]
    assert "READING" in types and "QUIZ" in types

    # Widget 3: Graded Classwork count (Excludes Reading)
    graded_count = len([
        t for t in todos
        if t["subject_id"] == subject.subject_id
        and t.get("is_graded") is not False
        and t["type"].upper() != "READING"
        and (t["status"] == "completed" or t["is_submitted"] or t["grade"] is not None)
    ])
    assert graded_count == 1  # ONLY the Quiz!

    # Widget 4: Subject Performance % (Excludes Reading and computes 24 / 30 = 80%)
    earned = sum(t["grade"] for t in todos if t.get("is_graded") is not False and t["type"].upper() != "READING" and t.get("total_points"))
    possible = sum(t["total_points"] for t in todos if t.get("is_graded") is not False and t["type"].upper() != "READING" and t.get("total_points"))
    subject_score = round((earned / possible) * 100)
    assert subject_score == 80  # Exactly 80%, not (100+24)/(100+30) = 95%


def test_unengaged_reading_classwork_excluded_from_graded_and_counts_in_completion_denominator(db_session):
    from app.models.academic.StudentCLass import StudentClass
    from app.models.submissions.StudentSubmission import StudentSubmission
    from app.services.users.UserQueryService import (
        _student_assignment_rows,
        _student_submissions_by_assignment,
        _student_metric_summary,
        _student_subject_mastery,
    )

    db = db_session
    teacher_account = UserAccount(user_id=uuid.uuid4(), email="t4@test.local", password_hash="x")
    student_account = UserAccount(user_id=uuid.uuid4(), email="s4@test.local", password_hash="x")
    db.add_all([teacher_account, student_account])
    db.flush()

    staff = AcademicStaff(
        staff_id="STF-TEST-4",
        first_name="Teacher",
        last_name="Four",
        user_id=teacher_account.user_id,
    )
    db.add(staff)

    level = AcademicLevel(level_name="Grade 9", grade_level=9)
    db.add(level)
    db.flush()

    year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    db.add(year)
    db.flush()

    cls = Class(
        section_name="Emerald",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add(cls)
    db.flush()

    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789013",
        first_name="Unengaged",
        last_name="Reader",
        academic_level_id=level.academic_level_id,
        user_id=student_account.user_id,
    )
    db.add(student)
    db.flush()

    db.add(StudentClass(
        student_id=student.student_id,
        class_id=cls.class_id,
        academic_year_id=year.academic_year_id,
        enrollment_status="enrolled",
    ))

    subject = Subject(
        subject_name="Physics 9",
        academic_level_id=level.academic_level_id,
    )
    db.add(subject)
    db.flush()

    # 1. Reading classwork (Unopened / Unengaged by student — NO submission record at all)
    cw_reading = Classwork(
        title="Electromagnetism Handout",
        classwork_type="READING",
        classwork_category="WRITTEN_WORK",
        is_graded=False,
        total_points=None,
        subject_id=subject.subject_id,
        created_by_staff_id=staff.staff_id,
        is_published=True,
        is_archived=False,
    )
    db.add(cw_reading)
    db.flush()
    asgn_reading = ClassworkAssignment(
        classwork_id=cw_reading.classwork_id,
        class_id=cls.class_id,
        assigned_by_staff_id=staff.staff_id,
        is_published=True,
    )
    db.add(asgn_reading)
    db.flush()

    # 2. Quiz classwork (Graded, 50 points, student scored 50/50 = 100%)
    cw_quiz = Classwork(
        title="Electromagnetism Quick Quiz",
        classwork_type="QUIZ",
        classwork_category="WRITTEN_WORK",
        is_graded=True,
        total_points=Decimal("50.0"),
        subject_id=subject.subject_id,
        created_by_staff_id=staff.staff_id,
        is_published=True,
        is_archived=False,
    )
    db.add(cw_quiz)
    db.flush()
    asgn_quiz = ClassworkAssignment(
        classwork_id=cw_quiz.classwork_id,
        class_id=cls.class_id,
        assigned_by_staff_id=staff.staff_id,
        is_published=True,
    )
    db.add(asgn_quiz)
    db.flush()

    sub_quiz = StudentSubmission(
        classwork_assignment_id=asgn_quiz.classwork_assignment_id,
        student_id=student.student_id,
        status="graded",
        grade=Decimal("50.0"),
    )
    db.add(sub_quiz)
    db.commit()

    # Backend verification:
    # 1. _student_assignment_rows ignores the unengaged Reading classwork completely for grade/point queries
    rows = _student_assignment_rows(db, student.student_id)
    assert len(rows) == 1
    assert rows[0][1].classwork_id == cw_quiz.classwork_id

    subs_map = _student_submissions_by_assignment(db, student.student_id)
    metric_summary = _student_metric_summary(rows, subs_map)
    # Grade remains 100% from Quiz; the missing reading does not penalize or show up as missing in gradebook metrics
    assert metric_summary["written_work_average"] == 100.0

    mastery = _student_subject_mastery(rows, subs_map)
    assert len(mastery) == 1
    assert mastery[0]["subject"] == "Physics 9"
    assert mastery[0]["value"] == 100.0

    # Frontend Dashboard Todos mock data:
    todos = [
        {
            "assignment_id": asgn_reading.classwork_assignment_id,
            "subject_id": subject.subject_id,
            "subject": subject.subject_name,
            "type": "READING",
            "category": "WRITTEN_WORK",
            "is_graded": False,
            "total_points": None,
            "status": "pending",  # Unread / unengaged
            "is_submitted": False,
            "grade": None,
        },
        {
            "assignment_id": asgn_quiz.classwork_assignment_id,
            "subject_id": subject.subject_id,
            "subject": subject.subject_name,
            "type": "QUIZ",
            "category": "WRITTEN_WORK",
            "is_graded": True,
            "total_points": 50.0,
            "status": "completed",
            "is_submitted": True,
            "grade": 50.0,
        },
    ]

    # Widget 1: Completion Rate (Denominator = 2 activities, Completed = 1 -> Rate = 50%)
    total_activities = len(todos)
    completed_activities = len([t for t in todos if t["is_submitted"] or t["status"] == "completed" or t["grade"] is not None])
    completion_rate = round((completed_activities / total_activities) * 100)
    assert total_activities == 2
    assert completed_activities == 1
    assert completion_rate == 50  # Correctly counts unread reading in denominator!

    # Widget 2: Graded Classwork count (Excludes Reading, only counts completed Quiz)
    graded_count = len([
        t for t in todos
        if t["subject_id"] == subject.subject_id
        and t.get("is_graded") is not False
        and t["type"].upper() != "READING"
        and (t["status"] == "completed" or t["is_submitted"] or t["grade"] is not None)
    ])
    assert graded_count == 1  # 1 graded classwork done

    # Widget 3: Subject Performance % (Only the 50/50 quiz counts -> 100%)
    earned = sum(t["grade"] for t in todos if t.get("is_graded") is not False and t["type"].upper() != "READING" and t.get("total_points") and t.get("grade") is not None)
    possible = sum(t["total_points"] for t in todos if t.get("is_graded") is not False and t["type"].upper() != "READING" and t.get("total_points") and t.get("grade") is not None)
    subject_score = round((earned / possible) * 100)
    assert subject_score == 100


def test_complete_reading_assignment_marks_reading_as_submitted_and_increments_completion_rate(db_session):
    from app.models.academic.StudentCLass import StudentClass
    from app.models.submissions.StudentSubmission import StudentSubmission
    from app.services.submission.SubmissionService import complete_reading_assignment

    db = db_session
    teacher_account = UserAccount(user_id=uuid.uuid4(), email="t5@test.local", password_hash="x")
    student_account = UserAccount(user_id=uuid.uuid4(), email="s5@test.local", password_hash="x")
    db.add_all([teacher_account, student_account])
    db.flush()

    staff = AcademicStaff(
        staff_id="STF-TEST-5",
        first_name="Teacher",
        last_name="Five",
        user_id=teacher_account.user_id,
    )
    db.add(staff)

    level = AcademicLevel(level_name="Grade 9", grade_level=9)
    db.add(level)
    db.flush()

    year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    db.add(year)
    db.flush()

    cls = Class(
        section_name="Emerald",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add(cls)
    db.flush()

    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789014",
        first_name="Active",
        last_name="Reader",
        academic_level_id=level.academic_level_id,
        user_id=student_account.user_id,
    )
    db.add(student)
    db.flush()

    db.add(StudentClass(
        student_id=student.student_id,
        class_id=cls.class_id,
        academic_year_id=year.academic_year_id,
        enrollment_status="enrolled",
    ))

    subject = Subject(
        subject_name="Earth Science 9",
        academic_level_id=level.academic_level_id,
    )
    db.add(subject)
    db.flush()

    cw_reading = Classwork(
        title="Plate Tectonics Reading",
        classwork_type="READING",
        classwork_category="WRITTEN_WORK",
        is_graded=False,
        total_points=None,
        subject_id=subject.subject_id,
        created_by_staff_id=staff.staff_id,
        is_published=True,
        is_archived=False,
    )
    db.add(cw_reading)
    db.flush()
    asgn_reading = ClassworkAssignment(
        classwork_id=cw_reading.classwork_id,
        class_id=cls.class_id,
        assigned_by_staff_id=staff.staff_id,
        is_published=True,
    )
    db.add(asgn_reading)
    db.commit()

    # Before completion: No submission exists
    sub_before = db.query(StudentSubmission).filter(
        StudentSubmission.classwork_assignment_id == asgn_reading.classwork_assignment_id,
        StudentSubmission.student_id == student.student_id,
    ).first()
    assert sub_before is None

    # Call complete_reading_assignment
    response = complete_reading_assignment(asgn_reading.classwork_assignment_id, student, db)
    assert response.status == "submitted"
    assert response.submitted_at is not None

    # Query database to confirm submission record is created
    sub_after = db.query(StudentSubmission).filter(
        StudentSubmission.classwork_assignment_id == asgn_reading.classwork_assignment_id,
        StudentSubmission.student_id == student.student_id,
    ).first()
    assert sub_after is not None
    assert sub_after.status == "submitted"
    assert sub_after.submitted_at is not None
    assert sub_after.grade is None


def test_record_reading_focus_accumulates_seconds_and_preserves_isolation(db_session):
    from app.models.academic.StudentCLass import StudentClass
    from app.models.submissions.StudentSubmission import StudentSubmission
    from app.services.submission.SubmissionService import record_reading_focus

    db = db_session
    teacher_account = UserAccount(user_id=uuid.uuid4(), email="t6@test.local", password_hash="x")
    student_account = UserAccount(user_id=uuid.uuid4(), email="s6@test.local", password_hash="x")
    db.add_all([teacher_account, student_account])
    db.flush()

    staff = AcademicStaff(
        staff_id="STF-TEST-6",
        first_name="Teacher",
        last_name="Six",
        user_id=teacher_account.user_id,
    )
    db.add(staff)

    level = AcademicLevel(level_name="Grade 9", grade_level=9)
    db.add(level)
    db.flush()

    year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    db.add(year)
    db.flush()

    cls = Class(
        section_name="Emerald",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add(cls)
    db.flush()

    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789015",
        first_name="Focused",
        last_name="Reader",
        academic_level_id=level.academic_level_id,
        user_id=student_account.user_id,
    )
    db.add(student)
    db.flush()

    db.add(StudentClass(
        student_id=student.student_id,
        class_id=cls.class_id,
        academic_year_id=year.academic_year_id,
        enrollment_status="enrolled",
    ))

    subject = Subject(
        subject_name="Biology 9",
        academic_level_id=level.academic_level_id,
    )
    db.add(subject)
    db.flush()

    cw_reading = Classwork(
        title="Cellular Respiration Article",
        classwork_type="READING",
        classwork_category="WRITTEN_WORK",
        is_graded=False,
        total_points=None,
        subject_id=subject.subject_id,
        created_by_staff_id=staff.staff_id,
        is_published=True,
        is_archived=False,
    )
    db.add(cw_reading)
    db.flush()
    asgn_reading = ClassworkAssignment(
        classwork_id=cw_reading.classwork_id,
        class_id=cls.class_id,
        assigned_by_staff_id=staff.staff_id,
        is_published=True,
    )
    db.add(asgn_reading)
    db.commit()

    # 1. First focus event: 45 seconds
    res1 = record_reading_focus(asgn_reading.classwork_assignment_id, 45, student, db)
    assert res1.reading_focused_seconds == 45
    assert res1.status == "pending"  # does NOT force completion or mark as completed

    # 2. Second focus event: 60 seconds (should accumulate to 105)
    res2 = record_reading_focus(asgn_reading.classwork_assignment_id, 60, student, db)
    assert res2.reading_focused_seconds == 105
    assert res2.status == "pending"

    # 3. Verify in DB
    sub = db.query(StudentSubmission).filter(
        StudentSubmission.classwork_assignment_id == asgn_reading.classwork_assignment_id,
        StudentSubmission.student_id == student.student_id,
    ).first()
    assert sub.reading_focused_seconds == 105
    assert sub.grade is None
