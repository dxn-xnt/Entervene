import uuid
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.SubjectOfferings import router as subject_offerings_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Subject import Subject
from app.models.academic.SubjectOffering import SubjectOffering


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    AcademicPeriod.__table__,
    Subject.__table__,
    SubjectOffering.__table__,
]

HEADER = "academic_year,grade_level,pathway,term,subject_code"


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine, tables=TABLES)
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
    test_app.include_router(subject_offerings_router, prefix="/api/v1/subject-offerings")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "admin",
    }
    with TestClient(test_app) as test_client:
        yield test_client
    test_app.dependency_overrides.clear()


@pytest.fixture
def offering_data(db):
    year = AcademicYear(year_label="2026-2027", start_date=date(2026, 6, 1), end_date=date(2027, 3, 31), is_active=True)
    other_year = AcademicYear(year_label="2027-2028", start_date=date(2027, 6, 1), end_date=date(2028, 3, 31), is_active=False)
    grade_7 = AcademicLevel(level_name="Grade 7", grade_level=7)
    grade_11 = AcademicLevel(level_name="Grade 11", grade_level=11)
    grade_12 = AcademicLevel(level_name="Grade 12", grade_level=12)
    db.add_all([year, other_year, grade_7, grade_11, grade_12])
    db.flush()
    term_1 = AcademicPeriod(
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        start_date=date(2026, 6, 1),
        end_date=date(2026, 8, 31),
        academic_year_id=year.academic_year_id,
    )
    term_2 = AcademicPeriod(
        period_name="Term 2",
        period_type="TERM",
        period_sequence=2,
        total_periods_in_year=3,
        start_date=date(2026, 9, 1),
        end_date=date(2026, 11, 30),
        academic_year_id=year.academic_year_id,
    )
    other_term = AcademicPeriod(
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        start_date=date(2027, 6, 1),
        end_date=date(2027, 8, 31),
        academic_year_id=other_year.academic_year_id,
    )
    db.add_all([term_1, term_2, other_term])
    db.flush()
    math_7 = Subject(subject_name="Mathematics 7", subject_codename="MATH7", status="active", academic_level_id=grade_7.academic_level_id)
    biology = Subject(subject_name="General Biology 1", subject_codename="GENBIO1", status="active", academic_level_id=grade_11.academic_level_id)
    precal = Subject(subject_name="Pre-Calculus", subject_codename="PRECAL", status="active", academic_level_id=grade_11.academic_level_id)
    archived = Subject(subject_name="Old STEM Subject", subject_codename="OLDSTEM", status="archived", academic_level_id=grade_11.academic_level_id)
    db.add_all([math_7, biology, precal, archived])
    db.commit()
    return {
        "year": year,
        "other_year": other_year,
        "grade_7": grade_7,
        "grade_11": grade_11,
        "grade_12": grade_12,
        "term_1": term_1,
        "term_2": term_2,
        "other_term": other_term,
        "math_7": math_7,
        "biology": biology,
        "precal": precal,
        "archived": archived,
    }


def upload(client, content: str | bytes, filename: str = "offerings.csv"):
    raw = content.encode("utf-8") if isinstance(content, str) else content
    return client.post(
        "/api/v1/subject-offerings/import",
        files={"file": (filename, raw, "text/csv")},
    )


def test_subject_offering_import_template_downloads_csv(client):
    response = client.get("/api/v1/subject-offerings/import-template")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert response.text.splitlines()[0] == HEADER
    assert "Grade 7,general" in response.text
    assert "Grade 11,stem_engineering" in response.text
    assert "subject_offering_import_template.csv" in response.headers["content-disposition"]


def test_subject_offering_import_creates_valid_rows(client, db, offering_data):
    content = "\n".join([
        HEADER,
        "2026-2027,Grade 7,general,Term 1,MATH7",
        "2026-2027,11,both,1,PRECAL",
    ])

    response = upload(client, content)

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "total_rows": 2,
        "created_count": 2,
        "skipped_count": 0,
        "error_count": 0,
        "errors": [],
    }
    assert db.query(SubjectOffering).count() == 2


def test_subject_offering_import_reports_row_errors_and_keeps_valid_rows(client, db, offering_data):
    content = "\n".join([
        HEADER,
        "2026-2027,Grade 7,general,Term 1,MATH7",
        "2026-2027,Grade 7,general,Term 1,MATH7",
        "2026-2027,Grade 7,both,Term 1,MATH7",
        "2026-2027,11,stem_medical,Term 9,PRECAL",
        "2026-2027,11,invalid,Term 1,PRECAL",
        "2026-2027,11,both,Term 1,OLDSTEM",
    ])

    response = upload(client, content)

    assert response.status_code == 200
    body = response.json()
    assert body["total_rows"] == 6
    assert body["created_count"] == 1
    assert body["skipped_count"] == 5
    assert body["error_count"] == 5
    assert db.query(SubjectOffering).count() == 1
    assert {error["row"] for error in body["errors"]} == {3, 4, 5, 6, 7}


def test_subject_offering_import_enforces_grade_pathway_rules(client, db, offering_data):
    content = "\n".join([
        HEADER,
        "2026-2027,Grade 7,stem_medical,Term 1,MATH7",
        "2026-2027,Grade 11,general,Term 1,GENBIO1",
    ])

    response = upload(client, content)

    assert response.status_code == 200
    body = response.json()
    assert body["created_count"] == 0
    assert body["error_count"] == 2
    assert db.query(SubjectOffering).count() == 0
    messages = [error["message"] for error in body["errors"]]
    assert any("Grade 7 to Grade 10" in message for message in messages)
    assert any("Grade 11 and Grade 12" in message for message in messages)


def test_subject_offering_import_rejects_existing_both_conflict(client, db, offering_data):
    db.add(SubjectOffering(
        subject_id=offering_data["biology"].subject_id,
        academic_year_id=offering_data["year"].academic_year_id,
        academic_level_id=offering_data["grade_11"].academic_level_id,
        academic_period_id=offering_data["term_1"].academic_period_id,
        pathway="both",
        status="active",
    ))
    db.commit()
    content = "\n".join([
        HEADER,
        "2026-2027,11,stem_engineering,Term 1,GENBIO1",
    ])

    response = upload(client, content)

    assert response.status_code == 200
    assert response.json()["created_count"] == 0
    assert "shared offering" in response.json()["errors"][0]["message"]


def test_subject_offering_import_rejects_bad_headers_and_file_type(client, offering_data):
    bad_headers = upload(client, "academic_year,subject_code\n2026-2027,GENBIO1")
    assert bad_headers.status_code == 200
    assert bad_headers.json()["errors"][0]["message"].startswith("CSV headers")

    bad_file = upload(client, HEADER + "\n2026-2027,11,both,Term 1,GENBIO1", filename="offerings.txt")
    assert bad_file.status_code == 200
    assert bad_file.json()["errors"][0]["message"] == "Upload a .csv file."


def test_subject_offering_import_requires_admin(client, offering_data):
    client.app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "teacher",
    }

    response = upload(client, HEADER + "\n2026-2027,11,both,Term 1,GENBIO1")

    assert response.status_code == 403
