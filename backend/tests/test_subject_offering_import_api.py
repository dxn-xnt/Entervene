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
from app.models.academic.AcademicPathway import AcademicPathway
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Subject import Subject
from app.models.academic.SubjectOffering import SubjectOffering
from app.models.academic.SubjectOfferingPathway import SubjectOfferingPathway


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    AcademicPeriod.__table__,
    Subject.__table__,
    SubjectOffering.__table__,
]

HEADER = "academic_year,grade_level,pathway,term,subject_code,minutes"
READ_ONLY_DETAIL = "Subject offerings for historical academic years or periods are read-only."


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
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
    historical_year = AcademicYear(year_label="2025-2026", start_date=date(2025, 6, 1), end_date=date(2026, 3, 31), is_active=False)
    grade_7 = AcademicLevel(level_name="Grade 7", grade_level=7)
    grade_11 = AcademicLevel(level_name="Grade 11", grade_level=11)
    grade_12 = AcademicLevel(level_name="Grade 12", grade_level=12)
    db.add_all([year, other_year, historical_year, grade_7, grade_11, grade_12])
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
    historical_term = AcademicPeriod(
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        start_date=date(2025, 6, 1),
        end_date=date(2025, 8, 31),
        academic_year_id=historical_year.academic_year_id,
    )
    db.add_all([term_1, term_2, other_term, historical_term])
    db.flush()
    math_7 = Subject(subject_name="Mathematics 7", subject_codename="MATH7", status="active", academic_level_id=grade_7.academic_level_id)
    biology = Subject(subject_name="General Biology 1", subject_codename="GENBIO1", status="active", academic_level_id=grade_11.academic_level_id)
    precal = Subject(subject_name="Pre-Calculus", subject_codename="PRECAL", status="active", academic_level_id=grade_11.academic_level_id)
    archived = Subject(subject_name="Old STEM Subject", subject_codename="OLDSTEM", status="archived", academic_level_id=grade_11.academic_level_id)
    med_pw = AcademicPathway(code="stem_medical", name="STEM Medical", is_enabled=True)
    eng_pw = AcademicPathway(code="stem_engineering", name="STEM Engineering", is_enabled=True)
    db.add_all([math_7, biology, precal, archived, med_pw, eng_pw])
    db.commit()
    return {
        "year": year,
        "other_year": other_year,
        "historical_year": historical_year,
        "grade_7": grade_7,
        "grade_11": grade_11,
        "grade_12": grade_12,
        "term_1": term_1,
        "term_2": term_2,
        "other_term": other_term,
        "historical_term": historical_term,
        "math_7": math_7,
        "biology": biology,
        "precal": precal,
        "archived": archived,
        "med_pw": med_pw,
        "eng_pw": eng_pw,
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
        "2026-2027,Grade 7,general,Term 1,MATH7,45",
        "2026-2027,11,both,1,PRECAL,96",
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
        "2026-2027,Grade 7,general,Term 1,MATH7,45",
        "2026-2027,Grade 7,general,Term 1,MATH7,45",
        "2026-2027,Grade 7,both,Term 1,MATH7,45",
        "2026-2027,11,stem_medical,Term 9,PRECAL,96",
        "2026-2027,11,invalid,Term 1,PRECAL,96",
        "2026-2027,11,both,Term 1,OLDSTEM,60",
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
        "2026-2027,Grade 7,stem_medical,Term 1,MATH7,45",
        "2026-2027,Grade 11,general,Term 1,GENBIO1,96",
    ])

    response = upload(client, content)

    assert response.status_code == 200
    body = response.json()
    assert body["created_count"] == 0
    assert body["error_count"] == 2
    assert db.query(SubjectOffering).count() == 0
    messages = [error["message"] for error in body["errors"]]
    assert any("Grade 7 offerings must use the general pathway" in message for message in messages)
    assert any("Grade 11 offerings require a specific pathway" in message for message in messages)


def test_subject_offering_import_respects_grade_12_pathway_scope_and_core_subjects(client, db, offering_data):
    from app.models.academic.AcademicLevelPathwayScope import AcademicLevelPathwayScope

    g12_phys = Subject(
        subject_name="General Physics 1",
        subject_codename="GENPHYS1",
        status="active",
        is_core=False,
        academic_level_id=offering_data["grade_12"].academic_level_id,
    )
    g11_core = Subject(
        subject_name="General Mathematics",
        subject_codename="GENMATH11",
        status="active",
        is_core=True,
        academic_level_id=offering_data["grade_11"].academic_level_id,
    )
    # 2026-2027 Grade 12 does NOT require pathways; 2027-2028 Grade 12 DOES require pathways.
    db.add_all([
        g12_phys,
        g11_core,
        AcademicLevelPathwayScope(
            academic_year_id=offering_data["year"].academic_year_id,
            academic_level_id=offering_data["grade_12"].academic_level_id,
            requires_pathway=False,
        ),
        AcademicLevelPathwayScope(
            academic_year_id=offering_data["other_year"].academic_year_id,
            academic_level_id=offering_data["grade_12"].academic_level_id,
            requires_pathway=True,
        ),
    ])
    db.commit()

    content = "\n".join([
        HEADER,
        # Valid: Grade 12 general when requires_pathway=False
        "2026-2027,Grade 12,general,Term 1,GENPHYS1,72",
        # Invalid: Grade 12 pathway-specific when requires_pathway=False
        "2026-2027,Grade 12,both,Term 2,GENPHYS1,72",
        # Valid: Grade 12 pathway-specific when requires_pathway=True in 2027-2028
        "2027-2028,Grade 12,both,Term 1,GENPHYS1,72",
        # Valid: Grade 11 core subject uses general
        "2026-2027,Grade 11,general,Term 1,GENMATH11,60",
        # Invalid: Grade 11 core subject cannot have pathway restrictions
        "2026-2027,Grade 11,both,Term 2,GENMATH11,60",
    ])

    response = upload(client, content)
    assert response.status_code == 200
    body = response.json()
    assert body["created_count"] == 3
    assert body["error_count"] == 2
    error_messages = [e["message"] for e in body["errors"]]
    assert any("Grade 12 offerings must use the general pathway" in m for m in error_messages)
    assert any("Core subjects are mandatory for all pathways" in m for m in error_messages)


def test_subject_offering_import_allows_prepared_future_academic_year(client, db, offering_data):
    content = "\n".join([
        HEADER,
        "2027-2028,11,both,Term 1,GENBIO1,96",
    ])

    response = upload(client, content)

    assert response.status_code == 200
    body = response.json()
    assert body["created_count"] == 1
    assert body["skipped_count"] == 0
    assert body["error_count"] == 0
    assert db.query(SubjectOffering).count() == 1


def test_subject_offering_import_rejects_historical_academic_year(client, db, offering_data):
    response = upload(client, "\n".join([
        HEADER,
        "2025-2026,11,both,Term 1,GENBIO1,96",
    ]))

    assert response.status_code == 200
    body = response.json()
    assert body["created_count"] == 0
    assert body["error_count"] == 1
    assert body["errors"][0]["message"] == READ_ONLY_DETAIL
    assert db.query(SubjectOffering).count() == 0


def test_subject_offering_import_rejects_existing_both_conflict(client, db, offering_data):
    offering = SubjectOffering(
        subject_id=offering_data["biology"].subject_id,
        academic_year_id=offering_data["year"].academic_year_id,
        academic_level_id=offering_data["grade_11"].academic_level_id,
        academic_period_id=offering_data["term_1"].academic_period_id,
        status="active",
    )
    db.add(offering)
    db.flush()
    db.add(SubjectOfferingPathway(subject_offering_id=offering.subject_offering_id, pathway_id=offering_data["med_pw"].id))
    db.add(SubjectOfferingPathway(subject_offering_id=offering.subject_offering_id, pathway_id=offering_data["eng_pw"].id))
    db.commit()
    content = "\n".join([
        HEADER,
        "2026-2027,11,stem_engineering,Term 1,GENBIO1,96",
    ])

    response = upload(client, content)

    assert response.status_code == 200
    assert response.json()["created_count"] == 0
    assert "shared offering" in response.json()["errors"][0]["message"]


def test_subject_offering_import_rejects_bad_headers_and_file_type(client, offering_data):
    bad_headers = upload(client, "academic_year,subject_code\n2026-2027,GENBIO1")
    assert bad_headers.status_code == 200
    assert bad_headers.json()["errors"][0]["message"].startswith("CSV headers")

    bad_file = upload(client, HEADER + "\n2026-2027,11,both,Term 1,GENBIO1,96", filename="offerings.txt")
    assert bad_file.status_code == 200
    assert bad_file.json()["errors"][0]["message"] == "Upload a .csv file."


def test_subject_offering_import_requires_admin(client, offering_data):
    client.app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "teacher",
    }

    response = upload(client, HEADER + "\n2026-2027,11,both,Term 1,GENBIO1,96")

    assert response.status_code == 403



def test_subject_offering_import_template_uses_canonical_genbio1_and_supports_legacy_aliases(client, db, offering_data):
    template_response = client.get("/api/v1/subject-offerings/import-template")
    assert template_response.status_code == 200
    assert ",GENBIO1," in template_response.text
    assert ",BIO1," not in template_response.text

    # Legacy code BIO1 in Grade 11 resolves to canonical active GENBIO1.
    legacy_upload = upload(
        client,
        "\n".join([
            HEADER,
            "2026-2027,Grade 11,stem_medical,Term 2,BIO1,96",
        ]),
    )
    assert legacy_upload.status_code == 200
    assert legacy_upload.json()["created_count"] == 1
    assert legacy_upload.json()["error_count"] == 0
    offering = db.query(SubjectOffering).one()
    assert offering.subject_id == offering_data["biology"].subject_id


def test_subject_offering_import_direct_match_beats_legacy_alias(client, db, offering_data):
    grade_9 = AcademicLevel(level_name="Grade 9", grade_level=9)
    db.add(grade_9)
    db.flush()
    math_9 = Subject(subject_name="Mathematics 9", subject_codename="MATH9", status="active", academic_level_id=grade_9.academic_level_id)
    enmath_9 = Subject(subject_name="Enhanced Mathematics 9", subject_codename="ENMATH9", status="active", academic_level_id=grade_9.academic_level_id)
    db.add_all([math_9, enmath_9])
    db.commit()

    response = upload(
        client,
        "\n".join([
            HEADER,
            "2026-2027,Grade 9,general,Term 1,MATH9,45",
        ]),
    )
    assert response.status_code == 200
    assert response.json()["created_count"] == 1
    offering = db.query(SubjectOffering).one()
    assert offering.subject_id == math_9.subject_id
