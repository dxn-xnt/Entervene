import uuid
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Classworks import router as classworks_router
from app.api.v1.routes.Submissions import router as submissions_router
from app.core.Security import create_access_token
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkAttachment import ClassworkAttachment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.submissions.SubmissionAttachment import SubmissionAttachment


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
    Classwork.__table__,
    ClassworkAttachment.__table__,
    ClassworkAssignment.__table__,
    StudentSubmission.__table__,
    SubmissionAttachment.__table__,
]


@pytest.fixture
def authz_context(tmp_path):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    lrn_check = next(
        constraint
        for constraint in Student.__table__.constraints
        if isinstance(constraint, CheckConstraint) and constraint.name == "lrn_check"
    )
    Student.__table__.constraints.remove(lrn_check)
    Base.metadata.create_all(bind=engine, tables=TABLES)
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
        period_name="Q1",
        period_type="QUARTER",
        start_date=date(2025, 6, 1),
        end_date=date(2025, 8, 31),
        academic_year_id=year.academic_year_id,
    )
    subject = Subject(subject_name="Science", academic_level_id=level.academic_level_id)
    db.add_all([period, subject])
    db.flush()

    accounts = {}
    for name in ("owner", "other_teacher", "student", "other_student"):
        accounts[name] = UserAccount(
            user_id=uuid.uuid4(),
            email=f"{name}@example.test",
            password_hash="hash",
        )
    db.add_all(accounts.values())
    db.flush()
    owner = AcademicStaff(
        staff_id="T-OWNER",
        first_name="Owner",
        last_name="Teacher",
        user_id=accounts["owner"].user_id,
    )
    other_teacher = AcademicStaff(
        staff_id="T-OTHER",
        first_name="Other",
        last_name="Teacher",
        user_id=accounts["other_teacher"].user_id,
    )
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000001",
        first_name="Allowed",
        last_name="Student",
        academic_level_id=level.academic_level_id,
        user_id=accounts["student"].user_id,
    )
    other_student = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000002",
        first_name="Other",
        last_name="Student",
        academic_level_id=level.academic_level_id,
        user_id=accounts["other_student"].user_id,
    )
    allowed_class = Class(
        section_name="Allowed",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    other_class = Class(
        section_name="Other",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add_all([owner, other_teacher, student, other_student, allowed_class, other_class])
    db.flush()
    db.add_all(
        [
            StudentClass(
                student_id=student.student_id,
                class_id=allowed_class.class_id,
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
                class_id=allowed_class.class_id,
                academic_period_id=period.academic_period_id,
                status="active",
            ),
        ]
    )
    classwork = Classwork(
        title="Protected work",
        classwork_type="ASSIGNMENT",
        total_points=100,
        subject_id=subject.subject_id,
        created_by_staff_id=owner.staff_id,
        is_published=True,
    )
    db.add(classwork)
    db.flush()
    assignment = ClassworkAssignment(
        classwork_id=classwork.classwork_id,
        class_id=allowed_class.class_id,
        assigned_by_staff_id=owner.staff_id,
        is_published=True,
    )
    db.add(assignment)
    db.flush()
    submission = StudentSubmission(
        student_id=student.student_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
        status="submitted",
        attempt_count=1,
    )
    classwork_file = tmp_path / "classwork.txt"
    classwork_file.write_text("classwork", encoding="utf-8")
    submission_file = tmp_path / "submission.txt"
    submission_file.write_text("submission", encoding="utf-8")
    db.add(submission)
    db.flush()
    classwork_attachment = ClassworkAttachment(
        classwork_id=classwork.classwork_id,
        file_name="classwork.txt",
        file_path=str(classwork_file),
        file_type="text/plain",
        file_size=9,
    )
    submission_attachment = SubmissionAttachment(
        submission_id=submission.submission_id,
        file_name="submission.txt",
        file_path=str(submission_file),
        file_type="text/plain",
        file_size=10,
    )
    db.add_all([classwork_attachment, submission_attachment])
    db.commit()

    identity = {"sub": accounts["owner"].user_id, "role": "teacher"}
    test_app = FastAPI()
    test_app.include_router(classworks_router, prefix="/api/v1/classwork-assignments")
    test_app.include_router(submissions_router, prefix="/api/v1/submissions")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: identity
    with TestClient(test_app) as client:
        yield {
            "client": client,
            "db": db,
            "identity": identity,
            "accounts": accounts,
            "owner": owner,
            "student": student,
            "other_class": other_class,
            "classwork": classwork,
            "assignment": assignment,
            "submission": submission,
            "classwork_attachment": classwork_attachment,
            "submission_attachment": submission_attachment,
        }
    db.close()
    Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
    engine.dispose()


def _act_as(context, account_name: str, role: str) -> None:
    context["identity"].update(
        sub=context["accounts"][account_name].user_id,
        role=role,
    )


def _bearer(context, account_name: str, role: str) -> dict[str, str]:
    token = create_access_token(str(context["accounts"][account_name].user_id), role)
    return {"Authorization": f"Bearer {token}"}


def test_classwork_and_assignment_direct_access_follow_access_matrix(authz_context):
    c = authz_context
    classwork_url = f"/api/v1/classwork-assignments/classwork/{c['classwork'].classwork_id}"
    assignment_url = f"/api/v1/classwork-assignments/assignment/{c['assignment'].classwork_assignment_id}"

    assert c["client"].get(classwork_url).status_code == 200
    _act_as(c, "other_teacher", "teacher")
    assert c["client"].get(classwork_url).status_code == 403
    assert c["client"].get(assignment_url).status_code == 403
    _act_as(c, "student", "student")
    assert c["client"].get(classwork_url).status_code == 200
    assert c["client"].get(assignment_url).status_code == 200
    _act_as(c, "other_student", "student")
    assert c["client"].get(classwork_url).status_code == 403
    assert c["client"].get(assignment_url).status_code == 403
    c["identity"].update(sub=str(uuid.uuid4()), role="admin")
    assert c["client"].get(classwork_url).status_code == 200
    assert c["client"].get(assignment_url).status_code == 403


def test_assignment_rejects_class_without_active_teacher_subject_load(authz_context):
    c = authz_context
    before = c["db"].query(ClassworkAssignment).count()
    response = c["client"].post(
        f"/api/v1/classwork-assignments/classwork/{c['classwork'].classwork_id}/assign",
        json={"class_ids": [c["other_class"].class_id]},
    )

    assert response.status_code == 403
    assert c["db"].query(ClassworkAssignment).count() == before


def test_submission_detail_and_grading_require_owner(authz_context):
    c = authz_context
    base = f"/api/v1/submissions/{c['submission'].submission_id}"

    assert c["client"].get(f"{base}/detail").status_code == 200
    assert c["client"].put(f"{base}/grade", json={"grade": 90}).status_code == 200
    _act_as(c, "other_teacher", "teacher")
    assert c["client"].get(f"{base}/detail").status_code == 403
    assert c["client"].put(f"{base}/grade", json={"grade": 80}).status_code == 403
    _act_as(c, "student", "student")
    assert c["client"].get(base).status_code == 200
    _act_as(c, "other_student", "student")
    assert c["client"].get(base).status_code == 403
    c["identity"].update(sub=str(uuid.uuid4()), role="admin")
    assert c["client"].get(base).status_code == 403
    assert c["client"].get(f"{base}/detail").status_code == 403
    assert c["client"].put(f"{base}/grade", json={"grade": 80}).status_code == 403


def test_attachment_downloads_are_scoped_and_debug_route_is_removed(authz_context):
    c = authz_context
    cw_url = (
        f"/api/v1/classwork-assignments/classwork/{c['classwork'].classwork_id}"
        f"/attachments/{c['classwork_attachment'].classwork_attachment_id}/download"
    )
    sub_url = (
        f"/api/v1/submissions/{c['submission'].submission_id}"
        f"/attachments/{c['submission_attachment'].submission_attachment_id}/download"
    )

    assert c["client"].get(cw_url, headers=_bearer(c, "student", "student")).status_code == 200
    assert c["client"].get(cw_url, headers=_bearer(c, "other_student", "student")).status_code == 403
    assert c["client"].get(sub_url, headers=_bearer(c, "owner", "teacher")).status_code == 200
    assert c["client"].get(sub_url, headers=_bearer(c, "other_teacher", "teacher")).status_code == 403
    assert c["client"].get(sub_url, headers=_bearer(c, "student", "student")).status_code == 200
    assert c["client"].get(sub_url, headers=_bearer(c, "other_student", "student")).status_code == 403
    assert c["client"].get(
        f"/api/v1/submissions/classwork/{c['classwork'].classwork_id}/debug"
    ).status_code == 404
