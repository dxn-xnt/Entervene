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
from app.api.v1.routes.Classes import router as classes_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.classes.ClassService import (
    archive_class_record,
    build_student_class_assignment,
    update_class_record,
)
from app.services.classes.ClassShared import ClassManagementError, class_management_error_handler
from app.schemas.Class import ClassUpdateRequest, UpdateClassStudentListRequest
from app.services.classes.ClassStudentService import update_class_student_assignments


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    Role.__table__,
    UserAccount.__table__,
    UserRoles.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    Subject.__table__,
    AcademicPeriod.__table__,
    Class.__table__,
    StudentClass.__table__,
    SubjectLoad.__table__,
]


@pytest.fixture
def db():
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
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
        engine.dispose()


@pytest.fixture
def client(db):
    test_app = FastAPI()
    test_app.add_exception_handler(ClassManagementError, class_management_error_handler)
    test_app.include_router(classes_router, prefix="/api/v1/classes")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "admin",
    }
    with TestClient(test_app) as test_client:
        yield test_client
    test_app.dependency_overrides.clear()


def add_year(db, label: str) -> AcademicYear:
    year = AcademicYear(
        year_label=label,
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    db.add(year)
    db.flush()
    return year


def add_level(db, name: str, grade: int) -> AcademicLevel:
    level = AcademicLevel(level_name=name, grade_level=grade)
    db.add(level)
    db.flush()
    return level


def add_staff(db, staff_id: str) -> AcademicStaff:
    role = db.query(Role).filter(Role.role_name == "Teacher").first()
    if role is None:
        role = Role(role_id=1, role_name="Teacher")
        db.add(role)
        db.flush()
    account = UserAccount(
        user_id=uuid.uuid4(),
        email=f"{staff_id}@example.test",
        password_hash="super-secret-hash",
        account_status="active",
    )
    db.add(account)
    db.flush()
    db.add(UserRoles(user_id=account.user_id, role_id=role.role_id))
    staff = AcademicStaff(
        staff_id=staff_id,
        first_name="Ada",
        middle_name="Byron",
        last_name="Lovelace",
        suffix=None,
        user_id=account.user_id,
    )
    db.add(staff)
    db.flush()
    return staff


def add_student(db, level: AcademicLevel, lrn: str) -> Student:
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn=lrn,
        first_name="Student",
        last_name=lrn,
        academic_level_id=level.academic_level_id,
    )
    db.add(student)
    db.flush()
    return student


def test_class_detail_returns_real_basic_information_counts_and_safe_fields(client, db):
    year = add_year(db, "2025-2026")
    level = add_level(db, "Grade 7", 7)
    adviser = add_staff(db, "T-1")
    class_ = Class(
        section_name="Galileo",
        class_status="active",
        adviser_staff_id=adviser.staff_id,
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add(class_)
    db.flush()
    students = [
        add_student(db, level, "100000000001"),
        add_student(db, level, "100000000002"),
    ]
    subject = Subject(subject_name="Science", academic_level_id=level.academic_level_id)
    period = AcademicPeriod(
        period_name="Q1",
        period_type="QUARTER",
        start_date=date(2025, 6, 1),
        end_date=date(2025, 8, 31),
        academic_year_id=year.academic_year_id,
    )
    db.add_all([subject, period])
    db.flush()
    db.add(build_student_class_assignment(students[0].student_id, class_))
    db.add(build_student_class_assignment(students[1].student_id, class_))
    db.add(
        SubjectLoad(
            staff_id=adviser.staff_id,
            subject_id=subject.subject_id,
            class_id=class_.class_id,
            academic_period_id=period.academic_period_id,
        )
    )
    db.commit()

    response = client.get(f"/api/v1/classes/{class_.class_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["class_id"] == class_.class_id
    assert body["section_name"] == "Galileo"
    assert body["class_status"] == "active"
    assert body["created_at"] is not None
    assert body["academic_year"] == {
        "academic_year_id": year.academic_year_id,
        "year_label": "2025-2026",
    }
    assert body["academic_level"] == {
        "academic_level_id": level.academic_level_id,
        "level_name": "Grade 7",
        "grade_level": 7,
    }
    assert body["adviser"] == {
        "staff_id": adviser.staff_id,
        "first_name": "Ada",
        "middle_name": "Byron",
        "last_name": "Lovelace",
        "suffix": None,
    }
    assert body["statistics"] == {
        "student_count": 2,
        "subject_count": 1,
        "schedule_count": 0,
    }
    assert "password_hash" not in response.text
    assert "super-secret-hash" not in response.text


def test_class_detail_returns_null_adviser_and_zero_deferred_counts(client, db):
    year = add_year(db, "2025-2026")
    level = add_level(db, "Grade 8", 8)
    class_ = Class(
        section_name="No Adviser",
        class_status="active",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add(class_)
    db.commit()

    response = client.get(f"/api/v1/classes/{class_.class_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["adviser"] is None
    assert body["statistics"] == {
        "student_count": 0,
        "subject_count": 0,
        "schedule_count": 0,
    }


def test_class_detail_unknown_class_returns_404(client):
    response = client.get("/api/v1/classes/999")

    assert response.status_code == 404
    assert response.json()["detail"] == "Class not found."


def test_class_detail_requires_admin_and_authentication(client):
    client.app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "teacher",
    }
    assert client.get("/api/v1/classes/1").status_code == 403

    del client.app.dependency_overrides[get_current_user]
    assert client.get("/api/v1/classes/1").status_code == 401


def test_archive_class_preserves_related_records_and_remains_readable(client, db):
    year = add_year(db, "2025-2026")
    level = add_level(db, "Grade 7", 7)
    adviser = add_staff(db, "T-1")
    class_ = Class(
        section_name="Galileo",
        class_status="active",
        adviser_staff_id=adviser.staff_id,
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    other_class = Class(
        section_name="Newton",
        class_status="active",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add_all([class_, other_class])
    db.flush()
    student = add_student(db, level, "100000000001")
    subject = Subject(subject_name="Science", academic_level_id=level.academic_level_id)
    period = AcademicPeriod(
        period_name="Q1",
        period_type="QUARTER",
        start_date=date(2025, 6, 1),
        end_date=date(2025, 8, 31),
        academic_year_id=year.academic_year_id,
    )
    db.add_all([subject, period])
    db.flush()
    db.add(build_student_class_assignment(student.student_id, class_))
    db.add(SubjectLoad(
        staff_id=adviser.staff_id,
        subject_id=subject.subject_id,
        class_id=class_.class_id,
        academic_period_id=period.academic_period_id,
    ))
    db.commit()

    response = client.patch(f"/api/v1/classes/{class_.class_id}/archive")

    assert response.status_code == 200
    assert response.json() == {
        "class_id": class_.class_id,
        "section_name": "Galileo",
        "class_status": "archived",
        "message": "Class archived successfully.",
    }
    assert db.query(Class).filter(Class.class_id == class_.class_id).one().class_status == "archived"
    assert db.query(StudentClass).count() == 1
    assert db.query(Student).count() == 1
    assert db.query(SubjectLoad).count() == 1
    assert db.query(Class).filter(Class.class_id == class_.class_id).one().adviser_staff_id == adviser.staff_id
    assert "password_hash" not in response.text
    detail = client.get(f"/api/v1/classes/{class_.class_id}")
    assert detail.status_code == 200
    assert detail.json()["class_status"] == "archived"
    active_classes = client.get("/api/v1/classes").json()["classes"]
    assert [item["section_name"] for item in active_classes] == ["Newton"]
    transfer_options = client.get(f"/api/v1/classes/{other_class.class_id}/transfer-options")
    assert transfer_options.status_code == 200
    assert transfer_options.json()["available_sections"] == []


def test_archive_class_handles_missing_already_archived_and_access_safely(client, db):
    year = add_year(db, "2025-2026")
    level = add_level(db, "Grade 7", 7)
    class_ = Class(
        section_name="Galileo",
        class_status="archived",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add(class_)
    db.commit()

    missing = client.patch("/api/v1/classes/999/archive")
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Class not found."

    repeated = client.patch(f"/api/v1/classes/{class_.class_id}/archive")
    assert repeated.status_code == 409
    assert repeated.json()["detail"] == "Class is already archived."

    client.app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "teacher",
    }
    assert client.patch(f"/api/v1/classes/{class_.class_id}/archive").status_code == 403

    del client.app.dependency_overrides[get_current_user]
    assert client.patch(f"/api/v1/classes/{class_.class_id}/archive").status_code == 401


def test_archive_class_record_rolls_back_when_commit_fails(db, monkeypatch):
    year = add_year(db, "2025-2026")
    level = add_level(db, "Grade 7", 7)
    class_ = Class(
        section_name="Galileo",
        class_status="active",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add(class_)
    db.commit()

    def fail_commit():
        raise RuntimeError("simulated commit failure")

    monkeypatch.setattr(db, "commit", fail_commit)

    with pytest.raises(Exception) as exc_info:
        archive_class_record(db=db, class_id=class_.class_id)

    assert exc_info.value.status_code == 500
    assert exc_info.value.detail == "Unable to archive class."
    assert db.query(Class).filter(Class.class_id == class_.class_id).one().class_status == "active"


def test_update_class_changes_section_and_preserves_students_and_adviser(client, db):
    year = add_year(db, "2025-2026")
    level = add_level(db, "Grade 7", 7)
    adviser = add_staff(db, "T-1")
    class_ = Class(
        section_name="Galileo",
        class_status="active",
        adviser_staff_id=adviser.staff_id,
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add(class_)
    db.flush()
    student = add_student(db, level, "100000000001")
    db.add(build_student_class_assignment(student.student_id, class_))
    db.commit()

    response = client.patch(f"/api/v1/classes/{class_.class_id}", json={"section_name": "Newton"})

    assert response.status_code == 200
    body = response.json()
    assert body["section_name"] == "Newton"
    assert body["adviser"]["staff_id"] == adviser.staff_id
    assert body["statistics"]["student_count"] == 1
    assert db.query(StudentClass).count() == 1
    assert "password_hash" not in response.text
    assert "super-secret-hash" not in response.text


def test_update_class_assigns_and_removes_adviser(client, db):
    year = add_year(db, "2025-2026")
    level = add_level(db, "Grade 7", 7)
    first_adviser = add_staff(db, "T-1")
    second_adviser = add_staff(db, "T-2")
    class_ = Class(
        section_name="Galileo",
        class_status="active",
        adviser_staff_id=first_adviser.staff_id,
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add(class_)
    db.commit()

    assigned = client.patch(
        f"/api/v1/classes/{class_.class_id}",
        json={"adviser_staff_id": second_adviser.staff_id},
    )
    assert assigned.status_code == 200
    assert assigned.json()["adviser"]["staff_id"] == second_adviser.staff_id

    removed = client.patch(f"/api/v1/classes/{class_.class_id}", json={"adviser_staff_id": None})
    assert removed.status_code == 200
    assert removed.json()["adviser"] is None


def test_update_class_rejects_invalid_requests_safely(client, db):
    year = add_year(db, "2025-2026")
    level = add_level(db, "Grade 7", 7)
    class_ = Class(
        section_name="Galileo",
        class_status="active",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    duplicate = Class(
        section_name="Newton",
        class_status="active",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add_all([class_, duplicate])
    db.commit()

    assert client.patch("/api/v1/classes/999", json={"section_name": "X"}).status_code == 404

    empty = client.patch(f"/api/v1/classes/{class_.class_id}", json={})
    assert empty.status_code == 400
    assert empty.json()["detail"] == "Provide at least one editable field."

    blank = client.patch(f"/api/v1/classes/{class_.class_id}", json={"section_name": " "})
    assert blank.status_code == 400
    assert blank.json()["detail"] == "Section name is required."

    conflict = client.patch(f"/api/v1/classes/{class_.class_id}", json={"section_name": " newton "})
    assert conflict.status_code == 409
    assert "same section" in conflict.json()["detail"]

    invalid_adviser = client.patch(f"/api/v1/classes/{class_.class_id}", json={"adviser_staff_id": "NOPE"})
    assert invalid_adviser.status_code == 400
    assert invalid_adviser.json()["detail"] == "Adviser not found."


def test_update_class_rejects_adviser_assigned_to_another_class(client, db):
    year = add_year(db, "2025-2026")
    level = add_level(db, "Grade 7", 7)
    adviser = add_staff(db, "T-1")
    class_ = Class(
        section_name="Galileo",
        class_status="active",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    other_class = Class(
        section_name="Newton",
        class_status="active",
        adviser_staff_id=adviser.staff_id,
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add_all([class_, other_class])
    db.commit()

    response = client.patch(f"/api/v1/classes/{class_.class_id}", json={"adviser_staff_id": adviser.staff_id})

    assert response.status_code == 409
    assert "already assigned" in response.json()["detail"]


def test_update_class_requires_admin_and_authentication(client):
    client.app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "teacher",
    }
    assert client.patch("/api/v1/classes/1", json={"section_name": "Newton"}).status_code == 403

    del client.app.dependency_overrides[get_current_user]
    assert client.patch("/api/v1/classes/1", json={"section_name": "Newton"}).status_code == 401


def test_update_class_record_rolls_back_when_commit_fails(db, monkeypatch):
    year = add_year(db, "2025-2026")
    level = add_level(db, "Grade 7", 7)
    class_ = Class(
        section_name="Galileo",
        class_status="active",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add(class_)
    db.commit()

    def fail_commit():
        raise RuntimeError("simulated commit failure")

    monkeypatch.setattr(db, "commit", fail_commit)

    with pytest.raises(RuntimeError, match="simulated commit failure"):
        update_class_record(
            db=db,
            class_id=class_.class_id,
            payload=ClassUpdateRequest(section_name="Newton"),
        )

    assert db.query(Class).filter(Class.class_id == class_.class_id).one().section_name == "Galileo"


def test_archived_class_rejects_basic_and_student_list_edits(client, db):
    year = add_year(db, "2025-2026")
    level = add_level(db, "Grade 7", 7)
    class_ = Class(
        section_name="Galileo",
        class_status="archived",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add(class_)
    db.flush()
    student = add_student(db, level, "100000000001")
    db.add(build_student_class_assignment(student.student_id, class_))
    db.commit()

    basic_edit = client.patch(
        f"/api/v1/classes/{class_.class_id}",
        json={"section_name": "Newton"},
    )
    student_edit = client.patch(
        f"/api/v1/classes/{class_.class_id}/students",
        json={"removals": [{"student_id": str(student.student_id)}], "transfers": []},
    )

    expected_detail = "Archived classes cannot be modified. Restore the class before editing."
    assert basic_edit.status_code == 409
    assert basic_edit.json()["detail"] == expected_detail
    assert student_edit.status_code == 409
    assert student_edit.json()["detail"] == expected_detail
    assert db.query(Class).filter(Class.class_id == class_.class_id).one().section_name == "Galileo"
    assert db.query(StudentClass).filter(StudentClass.class_id == class_.class_id).count() == 1
    assert db.query(Student).count() == 1


def test_class_students_returns_assigned_students_sorted_counts_search_and_safe_fields(client, db):
    year = add_year(db, "2025-2026")
    level = add_level(db, "Grade 7", 7)
    class_ = Class(section_name="Aristotle", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    other_class = Class(section_name="Newton", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    db.add_all([class_, other_class])
    db.flush()
    bea = add_student(db, level, "100000000001")
    bea.first_name = "Bea"
    bea.middle_name = "Marie"
    bea.last_name = "Santos"
    bea.gender = "Female"
    angela = add_student(db, level, "100000000002")
    angela.first_name = "Angela"
    angela.last_name = "Cruz"
    angela.gender = "Female"
    no_gender = add_student(db, level, "100000000003")
    no_gender.first_name = "Carlos"
    no_gender.last_name = "Reyes"
    no_gender.gender = None
    other_student = add_student(db, level, "100000000004")
    db.add_all([
        build_student_class_assignment(bea.student_id, class_),
        build_student_class_assignment(angela.student_id, class_),
        build_student_class_assignment(no_gender.student_id, class_),
        build_student_class_assignment(other_student.student_id, other_class),
    ])
    db.commit()

    response = client.get(f"/api/v1/classes/{class_.class_id}/students")

    assert response.status_code == 200
    body = response.json()
    assert [student["full_name"] for student in body["students"]] == ["Cruz, Angela", "Reyes, Carlos", "Santos, Bea M."]
    assert body["summary"]["total_students"] == 3
    assert body["summary"]["gender_counts"] == {"female": 2, "male": 0, "other": 0, "unspecified": 1}
    assert body["students"][0]["avatar_initial"] == "A"
    assert "password_hash" not in response.text

    filtered = client.get(f"/api/v1/classes/{class_.class_id}/students?search=bea").json()
    assert [student["full_name"] for student in filtered["students"]] == ["Santos, Bea M."]


def test_class_students_paginates_and_filtered_summary_matches_filtered_results(client, db):
    year = add_year(db, "2025-2026")
    level = add_level(db, "Grade 7", 7)
    class_ = Class(section_name="Aristotle", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    db.add(class_)
    db.flush()
    students = [
        add_student(db, level, "100000000001"),
        add_student(db, level, "100000000002"),
        add_student(db, level, "100000000003"),
    ]
    students[0].first_name, students[0].last_name, students[0].gender = "Amy", "Able", "Female"
    students[1].first_name, students[1].last_name, students[1].gender = "Ben", "Baker", "Male"
    students[2].first_name, students[2].last_name, students[2].gender = "Cara", "Cruz", "Female"
    db.add_all([build_student_class_assignment(student.student_id, class_) for student in students])
    db.commit()

    page_two = client.get(f"/api/v1/classes/{class_.class_id}/students?page=2&page_size=1")
    filtered = client.get(f"/api/v1/classes/{class_.class_id}/students?search=cara&page_size=1")

    assert page_two.status_code == 200
    assert [student["full_name"] for student in page_two.json()["students"]] == ["Baker, Ben"]
    assert page_two.json()["pagination"] == {
        "page": 2,
        "page_size": 1,
        "total_items": 3,
        "total_pages": 3,
    }
    assert filtered.status_code == 200
    assert filtered.json()["summary"] == {
        "total_students": 1,
        "gender_counts": {"female": 1, "male": 0, "other": 0, "unspecified": 0},
    }


def test_class_students_requires_admin_and_authentication(client):
    client.app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "teacher",
    }
    assert client.get("/api/v1/classes/1/students").status_code == 403

    del client.app.dependency_overrides[get_current_user]
    assert client.get("/api/v1/classes/1/students").status_code == 401


def test_transfer_options_returns_valid_same_level_active_sections(client, db):
    year = add_year(db, "2025-2026")
    level = add_level(db, "Grade 7", 7)
    other_level = add_level(db, "Grade 8", 8)
    current = Class(section_name="Aristotle", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    zeta = Class(section_name="Zeta", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    alpha = Class(section_name="Alpha", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    archived = Class(section_name="Archived", class_status="archived", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    other_grade = Class(section_name="Grade Eight", academic_year_id=year.academic_year_id, academic_level_id=other_level.academic_level_id)
    db.add_all([current, zeta, alpha, archived, other_grade])
    db.commit()

    response = client.get(f"/api/v1/classes/{current.class_id}/transfer-options")

    assert response.status_code == 200
    assert [section["section_name"] for section in response.json()["available_sections"]] == ["Alpha", "Zeta"]


def test_transfer_options_excludes_same_level_class_from_other_academic_year(client, db):
    year = add_year(db, "2025-2026")
    other_year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=False,
    )
    level = add_level(db, "Grade 7", 7)
    db.add(other_year)
    db.flush()
    current = Class(section_name="Aristotle", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    same_year = Class(section_name="Newton", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    other_year_class = Class(section_name="Future", academic_year_id=other_year.academic_year_id, academic_level_id=level.academic_level_id)
    db.add_all([current, same_year, other_year_class])
    db.commit()

    response = client.get(f"/api/v1/classes/{current.class_id}/transfer-options")

    assert response.status_code == 200
    assert response.json()["available_sections"] == [
        {"class_id": same_year.class_id, "section_name": "Newton"}
    ]


def test_update_class_students_removes_and_transfers_assignments_without_deleting_students(client, db):
    year = add_year(db, "2025-2026")
    level = add_level(db, "Grade 7", 7)
    source = Class(section_name="Aristotle", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    target = Class(section_name="Newton", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    db.add_all([source, target])
    db.flush()
    remove_student = add_student(db, level, "100000000001")
    transfer_student = add_student(db, level, "100000000002")
    db.add(build_student_class_assignment(remove_student.student_id, source))
    db.add(build_student_class_assignment(transfer_student.student_id, source))
    db.commit()

    response = client.patch(
        f"/api/v1/classes/{source.class_id}/students",
        json={
            "removals": [{"student_id": str(remove_student.student_id)}],
            "transfers": [{"student_id": str(transfer_student.student_id), "target_class_id": target.class_id}],
        },
    )

    assert response.status_code == 200
    assert db.query(Student).count() == 2
    assert db.query(StudentClass).filter(StudentClass.student_id == remove_student.student_id).count() == 0
    transferred = db.query(StudentClass).filter(StudentClass.student_id == transfer_student.student_id).one()
    assert transferred.class_id == target.class_id
    assert response.json()["summary"]["total_students"] == 0


def test_update_class_students_rejects_invalid_transfer_and_rolls_back(client, db):
    year = add_year(db, "2025-2026")
    level = add_level(db, "Grade 7", 7)
    other_level = add_level(db, "Grade 8", 8)
    source = Class(section_name="Aristotle", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    bad_target = Class(section_name="Other Grade", academic_year_id=year.academic_year_id, academic_level_id=other_level.academic_level_id)
    db.add_all([source, bad_target])
    db.flush()
    first = add_student(db, level, "100000000001")
    second = add_student(db, level, "100000000002")
    db.add(build_student_class_assignment(first.student_id, source))
    db.add(build_student_class_assignment(second.student_id, source))
    db.commit()

    response = client.patch(
        f"/api/v1/classes/{source.class_id}/students",
        json={
            "removals": [{"student_id": str(first.student_id)}],
            "transfers": [{"student_id": str(second.student_id), "target_class_id": bad_target.class_id}],
        },
    )

    assert response.status_code == 400
    assert "same academic level" in response.json()["detail"]
    assert db.query(StudentClass).filter(StudentClass.class_id == source.class_id).count() == 2


def test_update_class_students_rejects_cross_academic_year_transfer(client, db):
    year = add_year(db, "2025-2026")
    other_year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=False,
    )
    level = add_level(db, "Grade 7", 7)
    db.add(other_year)
    db.flush()
    source = Class(section_name="Aristotle", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    target = Class(section_name="Newton", academic_year_id=other_year.academic_year_id, academic_level_id=level.academic_level_id)
    db.add_all([source, target])
    db.flush()
    student = add_student(db, level, "100000000001")
    db.add(build_student_class_assignment(student.student_id, source))
    db.commit()

    response = client.patch(
        f"/api/v1/classes/{source.class_id}/students",
        json={
            "removals": [],
            "transfers": [{"student_id": str(student.student_id), "target_class_id": target.class_id}],
        },
    )

    assert response.status_code == 400
    assert "same academic year" in response.json()["detail"]
    assignment = db.query(StudentClass).filter(StudentClass.student_id == student.student_id).one()
    assert assignment.class_id == source.class_id


def test_update_class_student_assignments_rolls_back_when_commit_fails(db, monkeypatch):
    year = add_year(db, "2025-2026")
    level = add_level(db, "Grade 7", 7)
    source = Class(section_name="Aristotle", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    target = Class(section_name="Newton", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    db.add_all([source, target])
    db.flush()
    student = add_student(db, level, "100000000001")
    db.add(build_student_class_assignment(student.student_id, source))
    db.commit()
    payload = UpdateClassStudentListRequest(
        transfers=[{"student_id": student.student_id, "target_class_id": target.class_id}]
    )

    def fail_commit():
        raise RuntimeError("simulated commit failure")

    monkeypatch.setattr(db, "commit", fail_commit)

    with pytest.raises(RuntimeError, match="simulated commit failure"):
        update_class_student_assignments(db=db, class_id=source.class_id, payload=payload)

    assignment = db.query(StudentClass).filter(StudentClass.student_id == student.student_id).one()
    assert assignment.class_id == source.class_id
