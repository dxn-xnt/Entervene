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
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.Subject import Subject


TABLES = [
    AcademicLevel.__table__,
    GradingTemplate.__table__,
    Subject.__table__,
]

HEADER = "subject_name,grade_level,grading_template,description"
LEGACY_HEADER = f"subject_code,{HEADER}"


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()

    # Seed required three grading templates
    core = GradingTemplate(template_name="Core", passing_threshold=87.0, status="active")
    applied = GradingTemplate(template_name="Applied", passing_threshold=85.0, status="active")
    spec = GradingTemplate(template_name="Specialized", passing_threshold=85.0, status="active")
    session.add_all([core, applied, spec])
    session.commit()

    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
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
    seeded = {
        grade: AcademicLevel(level_name=f"Grade {grade}", grade_level=grade)
        for grade in (7, 8, 9, 11, 12)
    }
    db.add_all(seeded.values())
    db.commit()
    return seeded


def upload(client, content: str | bytes, filename: str = "subjects.csv"):
    raw = content.encode("utf-8") if isinstance(content, str) else content
    return client.post(
        "/api/v1/subjects/import",
        files={"file": (filename, raw, "text/csv")},
    )


def preview(client, content: str | bytes, filename: str = "subjects.csv"):
    raw = content.encode("utf-8") if isinstance(content, str) else content
    return client.post(
        "/api/v1/subjects/import-preview",
        files={"file": (filename, raw, "text/csv")},
    )


def test_subject_import_template_downloads_csv(client):
    response = client.get("/api/v1/subjects/import-template")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    lines = response.text.splitlines()
    assert lines[0] == HEADER
    # The template examples are derived from the available Grade 7-12 levels
    # and active templates rather than being fixed legacy sample rows.
    assert lines[1].startswith("Science 12,12,")
    assert lines[2].startswith("English 7,7,")
    assert "subject_catalog_import_template.csv" in response.headers["content-disposition"]


def test_subject_import_creates_valid_rows(client, db, levels):
    content = "\n".join([
        HEADER,
        "General Biology 1,11,Specialized,STEM subject",
        "Pre-Calculus,11,Core,Math subject",
    ])

    response = upload(client, content)

    assert response.status_code == 200
    body = response.json()
    assert body["total_rows"] == 2
    assert body["created_count"] == 2
    assert body["skipped_count"] == 0
    assert body["error_count"] == 0
    assert body["errors"] == []
    assert [subject.subject_codename for subject in db.query(Subject).order_by(Subject.subject_codename).all()] == ["GENBIO1", "PRECAL11"]


def test_subject_import_returns_row_errors_for_names_codes_and_archived_records(client, db, levels):
    core_template = db.query(GradingTemplate).filter(GradingTemplate.template_name == "Core").one()
    db.add_all([
        Subject(
            subject_name="English 7",
            subject_codename="ENG7",
            grading_template_id=core_template.grading_template_id,
            academic_level_id=levels[7].academic_level_id,
            status="active",
        ),
        Subject(
            subject_name="Araling Panlipunan 9",
            subject_codename="AP9",
            grading_template_id=core_template.grading_template_id,
            academic_level_id=levels[9].academic_level_id,
            status="archived",
        ),
        Subject(
            subject_name="Advanced Robotics Laboratory",
            subject_codename="ARL11",
            grading_template_id=core_template.grading_template_id,
            academic_level_id=levels[11].academic_level_id,
            status="active",
        ),
    ])
    db.commit()
    content = "\n".join([
        HEADER,
        "English 7,7,Core,Existing active subject",
        "Araling Panlipunan 9,9,Core,Existing archived subject",
        "Enhanced Mathematics 8,8,Core,Valid",
        " enhanced-mathematics 8 ,8,Core,Duplicate in file",
        "Applied Reasoning Lab,11,Core,Generated code conflict",
        "Bad Grade,99,Specialized,Invalid grade",
    ])

    response = upload(client, content)

    assert response.status_code == 200
    body = response.json()
    assert body["total_rows"] == 6
    assert body["created_count"] == 1
    assert body["skipped_count"] == 5
    assert body["error_count"] == 5
    assert db.query(Subject).filter(Subject.subject_codename == "ENMATH8").count() == 1
    error_messages = [e["message"] for e in body["errors"]]
    assert "Subject already exists in this grade." in error_messages
    assert "Subject is archived. Restore it instead." in error_messages
    assert any("Duplicate subject name already appears on CSV row" in m for m in error_messages)
    assert any('Generated subject code "ARL11" is already used' in m for m in error_messages)
    assert any("grade_level must match" in m for m in error_messages)


def test_subject_import_preview_generates_codes_and_does_not_write(client, db, levels):
    content = "\n".join([
        HEADER,
        "Enhanced Mathematics 8,8,Core,Math",
        "Enhanced Science 9,9,Core,Science",
        "Araling Panlipunan 9,9,Core,Social studies",
    ])

    response = preview(client, content)

    assert response.status_code == 200
    body = response.json()
    assert body["valid_count"] == 3
    assert body["error_count"] == 0
    assert [row["subject_code"] for row in body["rows"]] == ["ENMATH8", "ENSCI9", "AP9"]
    assert db.query(Subject).count() == 0


def test_subject_import_accepts_legacy_header_but_ignores_submitted_code(client, db, levels):
    response = upload(
        client,
        LEGACY_HEADER + "\nCLIENTCODE,General Biology 1,11,Specialized,STEM subject",
    )

    assert response.status_code == 200
    assert response.json()["created_count"] == 1
    subject = db.query(Subject).one()
    assert subject.subject_codename == "GENBIO1"


def test_subject_import_rejects_bad_headers_and_file_type(client, levels):
    bad_headers = upload(client, "subject_code,subject_name\nGENBIO1,Bio")
    assert bad_headers.status_code == 200
    assert bad_headers.json()["errors"][0]["message"].startswith("CSV headers")

    bad_file = upload(client, HEADER + "\nBio,11,Specialized,STEM", filename="subjects.txt")
    assert bad_file.status_code == 200
    assert bad_file.json()["errors"][0]["message"] == "Upload a .csv file."


def test_subject_import_requires_admin(client, levels):
    client.app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "teacher",
    }

    response = upload(client, HEADER + "\nBio,11,Specialized,STEM")

    assert response.status_code == 403


def test_subject_import_preview_matches_final_import(client, db, levels):
    core_template = db.query(GradingTemplate).filter(GradingTemplate.template_name == "Core").one()
    db.add_all([
        Subject(
            subject_name="English 7",
            subject_codename="ENG7",
            grading_template_id=core_template.grading_template_id,
            academic_level_id=levels[7].academic_level_id,
            status="active",
        ),
        Subject(
            subject_name="Araling Panlipunan 9",
            subject_codename="AP9",
            grading_template_id=core_template.grading_template_id,
            academic_level_id=levels[9].academic_level_id,
            status="archived",
        ),
    ])
    db.commit()
    content = "\n".join([
        LEGACY_HEADER,
        "IGNORED,english 7,7,Core,Active duplicate",
        "IGNORED,Araling Panlipunan 9,9,Core,Archived duplicate",
        "IGNORED,Advanced Robotics Lab,11,Core,First ARL11",
        "IGNORED,Applied Reasoning Lab,11,Core,In-file generated code collision",
        "IGNORED,Mathematics,10,,Grade 10 is seeded and template defaults",
        "IGNORED,Unknown Template Subject,11,UnknownTemplate,Invalid template",
    ])

    preview_body = preview(client, content).json()
    assert db.query(Subject).count() == 2

    import_body = upload(client, content).json()

    assert preview_body["valid_count"] == import_body["created_count"] == 2
    assert preview_body["error_count"] == import_body["error_count"] == 4
    assert preview_body["errors"] == import_body["errors"]
    preview_codes = [row["subject_code"] for row in preview_body["rows"] if not row["errors"]]
    assert preview_codes == ["ARL11", "MATH10"]
    created = {
        subject.subject_codename
        for subject in db.query(Subject).all()
        if subject.subject_codename not in {"ENG7", "AP9"}
    }
    assert created == set(preview_codes)
    messages = [error["message"] for error in import_body["errors"]]
    assert "Subject already exists in this grade." in messages
    assert "Subject is archived. Restore it instead." in messages
    assert any('Generated subject code "ARL11" is already used' in m for m in messages)
    assert any("grading_template" in m for m in messages)


def test_subject_import_active_conflict_wins_over_archived_duplicate(client, db, levels):
    core_template = db.query(GradingTemplate).filter(GradingTemplate.template_name == "Core").one()
    db.add_all([
        Subject(
            subject_name="English7",
            subject_codename=None,
            grading_template_id=core_template.grading_template_id,
            academic_level_id=levels[7].academic_level_id,
            status="archived",
        ),
        Subject(
            subject_name="English 7",
            subject_codename="ENG7",
            grading_template_id=core_template.grading_template_id,
            academic_level_id=levels[7].academic_level_id,
            status="active",
        ),
    ])
    db.commit()

    body = preview(client, HEADER + "\nEnglish 7,7,Core,Duplicate check").json()
    assert body["valid_count"] == 0
    assert body["error_count"] == 1
    assert body["errors"][0]["message"] == "Subject already exists in this grade."
