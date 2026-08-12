import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Subjects import router as subjects_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Subject import Subject
from app.models.academic.SubjectGroup import SubjectGroup


TABLES = [
    AcademicLevel.__table__,
    SubjectGroup.__table__,
    Subject.__table__,
]

HEADER = "subject_code,subject_name,grade_level,subject_group,hours,default_grading_template,description"


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine, tables=TABLES)
    session = sessionmaker(bind=engine)()

    # Seed required default groups
    core = SubjectGroup(name="Core", passing_threshold=85.0, display_order=1)
    spec = SubjectGroup(name="Specialized", passing_threshold=83.0, display_order=2)
    other = SubjectGroup(name="Other", passing_threshold=83.0, display_order=3)
    session.add_all([core, spec, other])
    session.commit()

    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
        engine.dispose()


@pytest.fixture
def client(db):
    test_app = FastAPI()
    test_app.include_router(subjects_router, prefix="/api/v1/subjects")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "admin",
    }
    with TestClient(test_app) as test_client:
        yield test_client
    test_app.dependency_overrides.clear()


@pytest.fixture
def levels(db):
    grade_11 = AcademicLevel(level_name="Grade 11", grade_level=11)
    grade_12 = AcademicLevel(level_name="Grade 12", grade_level=12)
    db.add_all([grade_11, grade_12])
    db.commit()
    return grade_11, grade_12


def upload(client, content: str | bytes, filename: str = "subjects.csv"):
    raw = content.encode("utf-8") if isinstance(content, str) else content
    return client.post(
        "/api/v1/subjects/import",
        files={"file": (filename, raw, "text/csv")},
    )


def test_subject_import_template_downloads_csv(client):
    response = client.get("/api/v1/subjects/import-template")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    lines = response.text.splitlines()
    assert lines[0] == HEADER
    assert "GENBIO1" in lines[1]
    assert "MATH7" in lines[2]
    assert "subject_catalog_import_template.csv" in response.headers["content-disposition"]


def test_subject_import_creates_valid_rows(client, db, levels):
    content = "\n".join([
        HEADER,
        "GENBIO1,General Biology 1,11,Specialized,80,Default SHS,STEM subject",
        "PRECAL,Pre-Calculus,11,Core,80,Default SHS,Math subject",
    ])

    response = upload(client, content)

    assert response.status_code == 200
    body = response.json()
    assert body["total_rows"] == 2
    assert body["created_count"] == 2
    assert body["skipped_count"] == 0
    assert body["error_count"] == 0
    assert body["errors"] == []
    assert [subject.subject_codename for subject in db.query(Subject).order_by(Subject.subject_codename).all()] == ["GENBIO1", "PRECAL"]


def test_subject_import_handles_blank_non_numeric_and_negative_hours_with_warnings(client, db, levels):
    content = "\n".join([
        HEADER,
        "BLANKHRS,Blank Hours Subject,11,Specialized,,Default SHS,Blank hours",
        "BADHRS,Non Numeric Hours,11,Specialized,eighty,Default SHS,Non numeric hours",
        "NEGCHRS,Negative Hours,11,Specialized,-5,Default SHS,Negative hours",
    ])

    response = upload(client, content)

    assert response.status_code == 200
    body = response.json()
    assert body["total_rows"] == 3
    assert body["created_count"] == 3
    assert body["error_count"] == 0
    assert len(body["warnings"]) == 3
    blank_sub = db.query(Subject).filter(Subject.subject_codename == "BLANKHRS").one()
    bad_sub = db.query(Subject).filter(Subject.subject_codename == "BADHRS").one()
    neg_sub = db.query(Subject).filter(Subject.subject_codename == "NEGCHRS").one()
    assert blank_sub.hours is None
    assert bad_sub.hours is None
    assert neg_sub.hours is None
    assert any("hours column is empty" in w for w in body["warnings"])
    assert any("invalid hours value 'eighty'" in w for w in body["warnings"])
    assert any("negative hours '-5'" in w for w in body["warnings"])


def test_subject_import_returns_row_errors_and_warns_on_unknown_group(client, db, levels):
    grade_11, _ = levels
    other_group = db.query(SubjectGroup).filter(SubjectGroup.name == "Other").one()
    db.add(Subject(subject_name="Existing Biology", subject_codename="GENBIO1", subject_group_id=other_group.subject_group_id, academic_level_id=grade_11.academic_level_id))
    db.commit()
    content = "\n".join([
        HEADER,
        "GENBIO1,General Biology 1,11,Specialized,80,Default SHS,Duplicate",
        "BADHOURS,Bad Hours,11,Specialized,eighty,Default SHS,Invalid hours",
        "GENCHEM1,General Chemistry 1,11,Specialized,80,Default SHS,Valid",
        ",Missing Code,11,Specialized,80,Default SHS,Missing",
        "UNKNOWNGRP,Unknown Group Subject,11,UnknownGroup,80,Default SHS,Assigned to Other with warning",
        "BADGRADE,Bad Grade,99,Specialized,80,Default SHS,Invalid grade",
    ])

    response = upload(client, content)

    assert response.status_code == 200
    body = response.json()
    assert body["total_rows"] == 6
    # GENBIO1 (duplicate), missing code, and bad grade fail -> 3 errors
    # BADHOURS (created with hours=None + warning), GENCHEM1 (valid), UNKNOWNGRP (created with Other + warning) -> 3 created
    assert body["created_count"] == 3
    assert body["skipped_count"] == 3
    assert body["error_count"] == 3
    assert db.query(Subject).filter(Subject.subject_codename == "GENCHEM1").count() == 1
    assert db.query(Subject).filter(Subject.subject_codename == "UNKNOWNGRP").count() == 1
    assert db.query(Subject).filter(Subject.subject_codename == "BADHOURS").count() == 1
    # Check warnings emitted
    assert any("UnknownGroup" in w for w in body.get("warnings", []))
    assert any("eighty" in w for w in body.get("warnings", []))


def test_subject_import_rejects_bad_headers_and_file_type(client, levels):
    bad_headers = upload(client, "subject_code,subject_name\nGENBIO1,Bio")
    assert bad_headers.status_code == 200
    assert bad_headers.json()["errors"][0]["message"].startswith("CSV headers")

    bad_file = upload(client, HEADER + "\nGENBIO1,Bio,11,Specialized,80,,", filename="subjects.txt")
    assert bad_file.status_code == 200
    assert bad_file.json()["errors"][0]["message"] == "Upload a .csv file."


def test_subject_import_requires_admin(client, levels):
    client.app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "teacher",
    }

    response = upload(client, HEADER + "\nGENBIO1,Bio,11,Specialized,80,,")

    assert response.status_code == 403
