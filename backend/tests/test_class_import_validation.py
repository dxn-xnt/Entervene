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
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.ClassManagement import (
    CLASS_IMPORT_HEADERS,
    ClassManagementError,
    build_student_class_assignment,
    class_management_error_handler,
)


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    Role.__table__,
    UserAccount.__table__,
    UserRoles.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    Class.__table__,
    StudentClass.__table__,
]
HEADER = ",".join(CLASS_IMPORT_HEADERS)


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


def add_year(db, label: str, active: bool) -> AcademicYear:
    year = AcademicYear(
        year_label=label,
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=active,
    )
    db.add(year)
    db.flush()
    return year


def add_level(db, name: str, grade: int) -> AcademicLevel:
    level = AcademicLevel(level_name=name, grade_level=grade)
    db.add(level)
    db.flush()
    return level


def add_staff(db, staff_id: str, eligible: bool = True, middle_name=None) -> AcademicStaff:
    teacher_role = db.query(Role).filter(Role.role_name == "Teacher").first()
    if not teacher_role:
        teacher_role = Role(role_id=1, role_name="Teacher")
        db.add(teacher_role)
        db.flush()
    account = UserAccount(
        user_id=uuid.uuid4(),
        email=f"{staff_id}@example.test",
        password_hash="hash",
        account_status="active" if eligible else "inactive",
    )
    db.add(account)
    db.flush()
    db.add(UserRoles(user_id=account.user_id, role_id=teacher_role.role_id))
    staff = AcademicStaff(
        staff_id=staff_id,
        first_name="John" if staff_id == "T-1" else "Jane",
        middle_name=middle_name,
        last_name="Doe" if staff_id == "T-1" else "Smith",
        user_id=account.user_id,
    )
    db.add(staff)
    db.flush()
    return staff


def add_student(
    db,
    level: AcademicLevel,
    lrn: str,
    first_name: str,
    last_name: str,
    gender: str | None,
    middle_name=None,
) -> Student:
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn=lrn,
        first_name=first_name,
        middle_name=middle_name,
        last_name=last_name,
        gender=gender,
        academic_level_id=level.academic_level_id,
    )
    db.add(student)
    db.flush()
    return student


@pytest.fixture
def import_data(db):
    year = add_year(db, "2025-2026", True)
    level = add_level(db, "Grade 7", 7)
    other_level = add_level(db, "Grade 8", 8)
    adviser = add_staff(db, "T-1", middle_name=None)
    students = [
        add_student(db, level, "100000000001", "Zed", "Zulu", "Male", None),
        add_student(db, level, "100000000002", "Amy", "Able", "Female", "Marie"),
        add_student(db, level, "100000000003", "Uma", "Unknown", None, None),
    ]
    db.commit()
    return year, level, other_level, adviser, students


def csv_row(
    section="Sapphire",
    adviser_id="T-1",
    adviser_first="John",
    adviser_middle="NULL",
    adviser_last="Doe",
    lrn="100000000001",
    student_first="Zed",
    student_middle="NULL",
    student_last="Zulu",
    gender="Male",
):
    return ",".join(
        [
            section,
            adviser_id,
            adviser_first,
            adviser_middle,
            adviser_last,
            lrn,
            student_first,
            student_middle,
            student_last,
            gender,
        ]
    )


def upload(client, level_id: int, content: str | bytes, filename="classes.csv"):
    raw = content.encode("utf-8") if isinstance(content, str) else content
    return client.post(
        "/api/v1/classes/validate-import",
        data={"academic_level_id": str(level_id)},
        files={"file": (filename, raw, "text/csv")},
    )


def error_codes(response):
    return {error["code"] for error in response.json()["errors"]}


def test_valid_csv_groups_sorts_summarizes_handles_bom_blank_rows_and_writes_nothing(
    client, db, import_data
):
    _, level, _, _, students = import_data
    add_staff(db, "T-2", middle_name="Anne")
    db.commit()
    before = (db.query(Class).count(), db.query(StudentClass).count())
    content = "\ufeff" + HEADER + "\n" + "\n".join(
        [
            csv_row(section=" sapphire "),
            csv_row(
                section="SAPPHIRE",
                lrn="100000000002",
                student_first="Amy",
                student_middle="Marie",
                student_last="Able",
                gender="female",
            ),
            ",,,,,,,,,",
            csv_row(
                section="Emerald",
                adviser_id="T-2",
                adviser_first="Jane",
                adviser_middle="Anne",
                adviser_last="Smith",
                lrn="100000000003",
                student_first="Uma",
                student_last="Unknown",
                gender="",
            ),
        ]
    )

    response = upload(client, level.academic_level_id, content)

    assert response.status_code == 200
    body = response.json()
    assert [section["section_name"] for section in body["sections"]] == ["Emerald", "sapphire"]
    assert [student["student_lrn"] for student in body["sections"][1]["students"]] == [
        students[0].student_lrn,
        students[1].student_lrn,
    ]
    assert body["summary"] == {"section_count": 2, "student_count": 3}
    assert (db.query(Class).count(), db.query(StudentClass).count()) == before


def test_duplicate_imported_adviser_assignment_is_rejected(client, db, import_data):
    _, level, _, _, _ = import_data
    add_student(db, level, "100000000004", "Bea", "Cruz", "Female")
    db.commit()

    response = upload(
        client,
        level.academic_level_id,
        HEADER + "\n" + csv_row(section="Aristotle") + "\n" + csv_row(
            section="Galileo",
            lrn="100000000004",
            student_first="Bea",
            student_last="Cruz",
            gender="Female",
        ),
    )

    assert response.status_code == 422
    assert "duplicate_adviser_assignment" in error_codes(response)


def test_adviser_already_assigned_in_active_year_is_rejected(client, db, import_data):
    year, level, _, adviser, _ = import_data
    db.add(Class(
        section_name="Existing",
        adviser_staff_id=adviser.staff_id,
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    ))
    db.commit()

    response = upload(client, level.academic_level_id, HEADER + "\n" + csv_row())

    assert response.status_code == 422
    assert "adviser_already_assigned" in error_codes(response)


@pytest.mark.parametrize(
    ("filename", "content", "expected_code"),
    [
        ("classes.txt", HEADER + "\n" + csv_row(), "invalid_file_type"),
        ("classes.csv", "", "file_empty"),
        ("classes.csv", "section_name,student_lrn\nSapphire,100000000001", "invalid_headers"),
        ("classes.csv", HEADER + ",extra\n" + csv_row() + ",x", "invalid_headers"),
        ("classes.csv", ",".join(reversed(CLASS_IMPORT_HEADERS)) + "\n" + csv_row(), "invalid_headers"),
        ("classes.csv", b"\xff\xfe", "invalid_encoding"),
        ("classes.csv", HEADER + '\n"unterminated', "csv_parse_error"),
    ],
)
def test_file_validation_errors(client, import_data, filename, content, expected_code):
    _, level, _, _, _ = import_data

    response = upload(client, level.academic_level_id, content, filename)

    assert response.status_code == 422
    assert expected_code in error_codes(response)


def test_duplicate_rows_and_duplicate_student_lrns_are_rejected(client, import_data):
    _, level, _, _, _ = import_data
    row = csv_row()

    response = upload(client, level.academic_level_id, HEADER + "\n" + row + "\n" + row)

    assert response.status_code == 422
    assert {"duplicate_row", "duplicate_student_lrn"}.issubset(error_codes(response))


def test_active_year_and_academic_level_errors(client, db, import_data):
    year, level, _, _, _ = import_data
    content = HEADER + "\n" + csv_row()

    missing_level = upload(client, 999, content)
    assert missing_level.status_code == 404

    year.is_active = False
    db.commit()
    no_active = upload(client, level.academic_level_id, content)
    assert no_active.status_code == 409
    assert no_active.json()["code"] == "active_academic_year_missing"

    year.is_active = True
    add_year(db, "2026-2027", True)
    db.commit()
    multiple = upload(client, level.academic_level_id, content)
    assert multiple.status_code == 409
    assert multiple.json()["code"] == "active_academic_year_multiple"


def test_existing_normalized_section_and_conflicting_adviser_are_rejected(client, db, import_data):
    year, level, _, _, _ = import_data
    db.add(Class(section_name=" Sapphire ", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id))
    add_staff(db, "T-2", middle_name="Anne")
    add_student(db, level, "100000000004", "Bea", "Cruz", "Female", "Marie")
    db.commit()

    existing = upload(client, level.academic_level_id, HEADER + "\n" + csv_row(section="sAPPHIRE"))
    assert "section_already_exists" in error_codes(existing)

    conflicting = upload(
        client,
        level.academic_level_id,
        HEADER + "\n" + csv_row(section="Emerald") + "\n" + csv_row(
            section=" emerald ",
            adviser_id="T-2",
            adviser_first="Jane",
            adviser_middle="Anne",
            adviser_last="Smith",
            lrn="100000000004",
            student_first="Bea",
            student_middle="Marie",
            student_last="Cruz",
            gender="Female",
        ),
    )
    assert "conflicting_section_adviser" in error_codes(conflicting)


@pytest.mark.parametrize(
    ("row", "expected_code"),
    [
        (csv_row(section=" "), "section_name_required"),
        (csv_row(adviser_id=""), "adviser_staff_id_required"),
        (csv_row(adviser_id="NOPE"), "adviser_not_found"),
        (csv_row(adviser_first="Wrong"), "adviser_name_mismatch"),
        (csv_row(lrn=""), "student_lrn_required"),
        (csv_row(lrn="123"), "student_lrn_invalid_format"),
        (csv_row(lrn="999999999999"), "student_not_found"),
        (csv_row(student_first="Wrong"), "student_name_mismatch"),
        (csv_row(gender="Female"), "student_gender_mismatch"),
    ],
)
def test_row_validation_errors(client, import_data, row, expected_code):
    _, level, _, _, _ = import_data

    response = upload(client, level.academic_level_id, HEADER + "\n" + row)

    assert response.status_code == 422
    assert expected_code in error_codes(response)


def test_ineligible_adviser_and_student_level_mismatch_are_rejected(client, db, import_data):
    _, level, other_level, _, _ = import_data
    add_staff(db, "T-2", eligible=False, middle_name="Anne")
    add_student(db, other_level, "200000000001", "Other", "Level", "Male")
    db.commit()

    response = upload(
        client,
        level.academic_level_id,
        HEADER + "\n" + csv_row(
            adviser_id="T-2",
            adviser_first="Jane",
            adviser_middle="Anne",
            adviser_last="Smith",
            lrn="200000000001",
            student_first="Other",
            student_last="Level",
        ),
    )

    assert {"adviser_not_eligible", "student_level_mismatch"}.issubset(error_codes(response))


def test_active_year_assignment_is_rejected_but_other_year_assignment_is_valid(client, db, import_data):
    active_year, level, _, _, students = import_data
    other_year = add_year(db, "2024-2025", False)
    active_class = Class(section_name="Active", academic_year_id=active_year.academic_year_id, academic_level_id=level.academic_level_id)
    old_class = Class(section_name="Old", academic_year_id=other_year.academic_year_id, academic_level_id=level.academic_level_id)
    db.add_all([active_class, old_class])
    db.flush()
    db.add(build_student_class_assignment(students[0].student_id, active_class))
    db.add(build_student_class_assignment(students[1].student_id, old_class))
    db.commit()

    active_response = upload(client, level.academic_level_id, HEADER + "\n" + csv_row())
    assert "student_already_assigned" in error_codes(active_response)

    other_year_response = upload(
        client,
        level.academic_level_id,
        HEADER + "\n" + csv_row(
            lrn="100000000002",
            student_first="Amy",
            student_middle="Marie",
            student_last="Able",
            gender="Female",
        ),
    )
    assert other_year_response.status_code == 200


def test_validate_import_requires_admin_and_authentication(client, import_data):
    _, level, _, _, _ = import_data
    content = HEADER + "\n" + csv_row()
    client.app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "teacher",
    }
    assert upload(client, level.academic_level_id, content).status_code == 403

    del client.app.dependency_overrides[get_current_user]
    assert upload(client, level.academic_level_id, content).status_code == 401
