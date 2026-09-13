import uuid
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
import app.api.v1.routes.Lessons as lesson_routes
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Lessons import router as lessons_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    Subject.__table__,
    AcademicPeriod.__table__,
    Class.__table__,
    StudentClass.__table__,
    SubjectLoad.__table__,
    Competency.__table__,
    Lesson.__table__,
    LessonAssignment.__table__,
    Classwork.__table__,
    ClassworkLesson.__table__,
    TeacherSubstitution.__table__,
]


@pytest.fixture
def lesson_context(tmp_path):
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
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add_all([year, level])
    db.flush()
    period = AcademicPeriod(
        period_name="1st Quarter",
        period_type="QUARTER",
        start_date=date(2025, 6, 1),
        end_date=date(2025, 8, 31),
        academic_year_id=year.academic_year_id,
        is_active=True,
    )
    subject = Subject(subject_name="English", academic_level_id=level.academic_level_id)
    db.add_all([period, subject])
    db.flush()

    accounts = {
        name: UserAccount(
            user_id=uuid.uuid4(),
            email=f"{name}@example.test",
            password_hash="x",
            account_status="active",
        )
        for name in ("owner", "other_teacher", "student", "other_student")
    }
    db.add_all(accounts.values())
    db.flush()
    owner = AcademicStaff(
        staff_id="T-1",
        first_name="Owner",
        last_name="Teacher",
        user_id=accounts["owner"].user_id,
    )
    other_teacher = AcademicStaff(
        staff_id="T-2",
        first_name="Other",
        last_name="Teacher",
        user_id=accounts["other_teacher"].user_id,
    )
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789012",
        first_name="Allowed",
        last_name="Student",
        academic_level_id=level.academic_level_id,
        user_id=accounts["student"].user_id,
    )
    other_student = Student(
        student_id=uuid.uuid4(),
        student_lrn="210987654321",
        first_name="Other",
        last_name="Student",
        academic_level_id=level.academic_level_id,
        user_id=accounts["other_student"].user_id,
    )
    class_ = Class(
        section_name="Ruby",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    other_class = Class(
        section_name="Gold",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add_all([owner, other_teacher, student, other_student, class_, other_class])
    db.flush()
    db.add_all([
        StudentClass(
            student_id=student.student_id,
            class_id=class_.class_id,
            academic_year_id=year.academic_year_id,
            enrollment_status="enrolled",
        ),
        StudentClass(
            student_id=other_student.student_id,
            class_id=other_class.class_id,
            academic_year_id=year.academic_year_id,
            enrollment_status="enrolled",
        ),
        SubjectLoad(
            staff_id=owner.staff_id,
            subject_id=subject.subject_id,
            class_id=class_.class_id,
            academic_period_id=period.academic_period_id,
            status="active",
        ),
    ])
    lesson = Lesson(
        title="Protected Lesson",
        subject_id=subject.subject_id,
        created_by_staff_id=owner.staff_id,
        is_published=True,
        is_draft=False,
    )
    db.add(lesson)
    db.flush()
    assignment = LessonAssignment(
        lesson_id=lesson.lesson_id,
        class_id=class_.class_id,
        assigned_by_staff_id=owner.staff_id,
        is_published=True,
    )
    db.add(assignment)
    db.commit()

    identity = {"sub": accounts["owner"].user_id, "role": "teacher"}
    test_app = FastAPI()
    test_app.include_router(lessons_router, prefix="/api/v1/lessons")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: identity
    with TestClient(test_app, raise_server_exceptions=False) as client:
        yield {
            "client": client,
            "db": db,
            "identity": identity,
            "accounts": accounts,
            "owner": owner,
            "other_teacher": other_teacher,
            "student": student,
            "subject": subject,
            "period": period,
            "class": class_,
            "other_class": other_class,
            "lesson": lesson,
        }
    db.close()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def _act_as(context, account_name: str, role: str) -> None:
    context["identity"].update(
        sub=context["accounts"][account_name].user_id,
        role=role,
    )


def test_lesson_detail_follows_access_matrix(lesson_context):
    c = lesson_context
    detail_url = f"/api/v1/lessons/{c['lesson'].lesson_id}"

    assert c["client"].get(detail_url).status_code == 200
    _act_as(c, "other_teacher", "teacher")
    assert c["client"].get(detail_url).status_code == 403
    _act_as(c, "student", "student")
    assert c["client"].get(detail_url).status_code == 200
    _act_as(c, "other_student", "student")
    assert c["client"].get(detail_url).status_code == 403


def test_student_cannot_access_unpublished_lesson(lesson_context):
    c = lesson_context
    c["lesson"].is_published = False
    c["db"].commit()
    _act_as(c, "student", "student")

    response = c["client"].get(f"/api/v1/lessons/{c['lesson'].lesson_id}")

    assert response.status_code == 403


def test_lesson_delete_archives_and_preserves_linked_classwork(lesson_context):
    c = lesson_context
    classwork = Classwork(
        title="Linked Work",
        classwork_type="ASSIGNMENT",
        subject_id=c["subject"].subject_id,
        created_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(classwork)
    c["db"].flush()
    c["db"].add(ClassworkLesson(classwork_id=classwork.classwork_id, lesson_id=c["lesson"].lesson_id))
    c["db"].commit()

    response = c["client"].delete(f"/api/v1/lessons/{c['lesson'].lesson_id}")

    assert response.status_code == 200
    c["db"].refresh(c["lesson"])
    assert c["lesson"].is_archived is True
    assert c["db"].query(Classwork).filter_by(classwork_id=classwork.classwork_id).count() == 1
    assert c["db"].query(ClassworkLesson).filter_by(
        classwork_id=classwork.classwork_id,
        lesson_id=c["lesson"].lesson_id,
    ).count() == 1


def test_lesson_assignment_validates_teacher_class_targets_before_writing(lesson_context):
    c = lesson_context
    before = c["db"].query(LessonAssignment).count()

    response = c["client"].post(
        f"/api/v1/lessons/{c['lesson'].lesson_id}/assign",
        json={"class_ids": [c["class"].class_id, c["other_class"].class_id]},
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Not assigned to this class/subject"
    assert c["db"].query(LessonAssignment).count() == before


def test_lesson_detail_blocks_same_subject_different_class_teacher(lesson_context):
    """A teacher teaching the same subject on another class cannot access this lesson if it is not assigned to their class."""
    c = lesson_context
    # Give other_teacher an active load on other_class for the same subject
    other_load = SubjectLoad(
        staff_id=c["other_teacher"].staff_id,
        subject_id=c["subject"].subject_id,
        class_id=c["other_class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        status="active",
        is_active_version=True,
    )
    c["db"].add(other_load)
    c["db"].commit()

    detail_url = f"/api/v1/lessons/{c['lesson'].lesson_id}"

    # Owner accesses successfully
    _act_as(c, "owner", "teacher")
    assert c["client"].get(detail_url).status_code == 200

    # other_teacher teaches the same subject, but lesson is assigned to class_, not other_class
    _act_as(c, "other_teacher", "teacher")
    assert c["client"].get(detail_url).status_code == 403


def test_lesson_detail_allows_substitute_for_assigned_class(lesson_context):
    """An active substitute teacher covering the class where the lesson is assigned can view the lesson."""
    c = lesson_context
    sub_user = UserAccount(
        user_id=uuid.uuid4(),
        email="substitute@example.test",
        password_hash="x",
        account_status="active",
    )
    sub_staff = AcademicStaff(
        staff_id="SUB_STAFF_1",
        user_id=sub_user.user_id,
        first_name="Sub",
        last_name="Teacher",
    )
    # Find owner's load for class_
    owner_load = c["db"].query(SubjectLoad).filter(
        SubjectLoad.staff_id == c["owner"].staff_id,
        SubjectLoad.class_id == c["class"].class_id,
        SubjectLoad.subject_id == c["subject"].subject_id,
    ).first()

    sub_record = TeacherSubstitution(
        subject_load_id=owner_load.subject_load_id,
        original_staff_id=c["owner"].staff_id,
        substitute_staff_id=sub_staff.staff_id,
        start_date=date(2025, 6, 1),
        end_date=None,
        status="active",
    )
    c["db"].add_all([sub_user, sub_staff, sub_record])
    c["db"].commit()

    # Act as substitute
    c["identity"].update(sub=sub_user.user_id, role="teacher")
    detail_url = f"/api/v1/lessons/{c['lesson'].lesson_id}"
    resp = c["client"].get(detail_url)
    assert resp.status_code == 200
    assert resp.json()["lesson_id"] == c["lesson"].lesson_id


def test_teacher_lessons_for_class_subject_excludes_unassigned_lessons_from_other_teachers(lesson_context):
    """Unassigned/draft lessons created by Teacher A must NOT leak into Teacher B's class subject list."""
    c = lesson_context
    # Ensure other_teacher has active load on other_class
    other_load = c["db"].query(SubjectLoad).filter(
        SubjectLoad.staff_id == c["other_teacher"].staff_id,
        SubjectLoad.class_id == c["other_class"].class_id,
    ).first()
    if not other_load:
        other_load = SubjectLoad(
            staff_id=c["other_teacher"].staff_id,
            subject_id=c["subject"].subject_id,
            class_id=c["other_class"].class_id,
            academic_period_id=c["period"].academic_period_id,
            status="active",
            is_active_version=True,
        )
        c["db"].add(other_load)

    # Owner creates an UNASSIGNED lesson for the subject
    unassigned_lesson = Lesson(
        title="Owner's Private Draft Lesson",
        subject_id=c["subject"].subject_id,
        created_by_staff_id=c["owner"].staff_id,
        is_published=False,
        is_draft=True,
    )
    c["db"].add(unassigned_lesson)
    c["db"].commit()

    # Teacher B views lessons for other_class & subject
    _act_as(c, "other_teacher", "teacher")
    resp_other = c["client"].get(f"/api/v1/lessons/my-class/{c['other_class'].class_id}/subject/{c['subject'].subject_id}")
    assert resp_other.status_code == 200
    returned_ids_other = [l["lesson_id"] for l in resp_other.json()]
    # Teacher B must NOT see Owner's unassigned lesson
    assert unassigned_lesson.lesson_id not in returned_ids_other

    # Owner views lessons for class_ & subject
    _act_as(c, "owner", "teacher")
    resp_owner = c["client"].get(f"/api/v1/lessons/my-class/{c['class'].class_id}/subject/{c['subject'].subject_id}")
    assert resp_owner.status_code == 200
    returned_ids_owner = [l["lesson_id"] for l in resp_owner.json()]
    # Owner DOES see their own unassigned lesson
    assert unassigned_lesson.lesson_id in returned_ids_owner


