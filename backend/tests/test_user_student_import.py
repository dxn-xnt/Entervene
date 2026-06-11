import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Users import router as users_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.auth.InvitationToken import InvitationToken
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student


TABLES = [
    AcademicLevel.__table__,
    Role.__table__,
    UserAccount.__table__,
    UserRoles.__table__,
    InvitationToken.__table__,
    AcademicStaff.__table__,
    Student.__table__,
]

HEADER = "first_name,last_name,middle_name,email,student_lrn,gender,contact_number,address,grade_level,suffix"


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
    session.add_all(
        [
            Role(role_id=1, role_name="Admin"),
            Role(role_id=2, role_name="Teacher"),
            Role(role_id=3, role_name="Student"),
            AcademicLevel(level_name="Grade 7", grade_level=7),
        ]
    )
    session.commit()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
        engine.dispose()


@pytest.fixture
def client(db, monkeypatch):
    test_app = FastAPI()
    test_app.include_router(users_router, prefix="/api/v1")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "admin",
    }
    monkeypatch.setattr("app.api.v1.routes.Users.send_invitation_email", lambda email, token: None)
    with TestClient(test_app) as test_client:
        yield test_client
    test_app.dependency_overrides.clear()


def row(
    first="Manuel",
    last="Garcia",
    middle="Santos",
    email="manuel.garcia@student.ph",
    lrn="'786966032787",
    gender="Male",
    contact="09195339866",
    address="12 Marcos Highway, Antipolo City",
    grade="7",
    suffix="",
):
    return f'{first},{last},{middle},{email},{lrn},{gender},{contact},"{address}",{grade},{suffix}'


def upload(client, content: str | bytes, filename="students.csv"):
    raw = content.encode("utf-8") if isinstance(content, str) else content
    return client.post(
        "/api/v1/admin/users/upload-csv?role=Student",
        files={"file": (filename, raw, "text/csv")},
    )


def detail(response):
    return response.json()["detail"]


def fields(response):
    return {error["field"] for error in detail(response)["errors"]}


def test_valid_csv_import_accepts_template_headers_and_apostrophe_lrn(client, db):
    content = HEADER + "\n" + row() + "\n" + row(
        first="Patricia",
        last="Santiago",
        middle="Guerrero",
        email="patricia.santiago@student.ph",
        lrn="'743341803726",
        gender="Female",
    )

    response = upload(client, content)

    assert response.status_code == 200
    body = response.json()
    assert body["created_count"] == 2
    assert body["failed_count"] == 0
    assert db.query(UserAccount).count() == 2
    assert db.query(Student).filter(Student.student_lrn == "786966032787").count() == 1
    assert db.query(Student).filter(Student.student_lrn == "743341803726").count() == 1
    assert db.query(InvitationToken).count() == 2


def test_csv_import_preserves_leading_zero_lrn(client, db):
    response = upload(client, HEADER + "\n" + row(lrn="'012345678901"))

    assert response.status_code == 200
    assert db.query(Student).filter(Student.student_lrn == "012345678901").count() == 1


def test_csv_import_normalizes_scientific_notation_lrn(client, db):
    response = upload(client, HEADER + "\n" + row(lrn="7.86966032787E+11"))

    assert response.status_code == 200
    assert db.query(Student).filter(Student.student_lrn == "786966032787").count() == 1


def test_csv_import_rejects_invalid_header(client, db):
    response = upload(client, "first_name,last_name,email\nAda,Lovelace,ada@example.com")

    assert response.status_code == 400
    assert "student_lrn" in response.json()["detail"]
    assert db.query(UserAccount).count() == 0


def test_csv_import_rejects_empty_and_header_only_files(client, db):
    empty = upload(client, "")
    header_only = upload(client, HEADER + "\n")

    assert empty.status_code == 400
    assert header_only.status_code == 422
    assert detail(header_only)["created_count"] == 0
    assert db.query(UserAccount).count() == 0


def test_csv_import_reports_invalid_email_duplicate_email_duplicate_lrn_and_invalid_grade(client, db):
    existing_account = UserAccount(user_id=uuid.uuid4(), email="existing@example.com", account_status="pending")
    db.add(existing_account)
    db.flush()
    db.add(Student(
        student_id=uuid.uuid4(),
        user_id=existing_account.user_id,
        student_lrn="999999999999",
        first_name="Existing",
        last_name="Student",
        email="existing@example.com",
        academic_level_id=1,
    ))
    db.commit()

    content = "\n".join(
        [
            HEADER,
            row(email="not-an-email", lrn="'111111111111"),
            row(first="Existing", email="existing@example.com", lrn="'222222222222"),
            row(first="DupEmail", email="manuel.garcia@student.ph", lrn="'333333333333"),
            row(first="DupEmailAgain", email="manuel.garcia@student.ph", lrn="'444444444444"),
            row(first="DupLrn", email="duplrn@example.com", lrn="'999999999999"),
            row(first="BadGrade", email="badgrade@example.com", lrn="'555555555555", grade="99"),
        ]
    )

    response = upload(client, content)

    assert response.status_code == 422
    assert {"email", "student_lrn", "grade_level"}.issubset(fields(response))
    assert detail(response)["created_count"] == 0
    assert db.query(UserAccount).count() == 1
    assert db.query(Student).count() == 1


def test_csv_import_rolls_back_whole_batch_when_one_row_is_invalid(client, db):
    content = "\n".join(
        [
            HEADER,
            row(email="valid@example.com", lrn="'111111111111"),
            row(email="bad@example.com", lrn="'123", grade="7"),
        ]
    )

    response = upload(client, content)

    assert response.status_code == 422
    assert detail(response)["created_count"] == 0
    assert db.query(UserAccount).count() == 0
    assert db.query(Student).count() == 0


def test_csv_import_rejects_unsupported_extension(client, db):
    response = upload(client, HEADER + "\n" + row(), filename="students.txt")

    assert response.status_code == 400
    assert "Upload a .csv" in response.json()["detail"]
    assert db.query(UserAccount).count() == 0


def test_csv_import_rolls_back_whole_batch_when_persistence_fails(client, db, monkeypatch):
    from app.services.users import UserImportService

    original_create = UserImportService.create_pending_account
    calls = 0

    def fail_second_account(db, email, role_name):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("simulated persistence failure")
        return original_create(db, email, role_name)

    monkeypatch.setattr(UserImportService, "create_pending_account", fail_second_account)
    content = HEADER + "\n" + row(email="first@example.com", lrn="'111111111111") + "\n" + row(
        first="Second",
        email="second@example.com",
        lrn="'222222222222",
    )

    with pytest.raises(RuntimeError, match="simulated persistence failure"):
        upload(client, content)

    assert db.query(UserAccount).count() == 0
    assert db.query(Student).count() == 0
    assert db.query(InvitationToken).count() == 0
