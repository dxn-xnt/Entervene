from decimal import Decimal
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
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.Subject import Subject


TABLES = [
    AcademicLevel.__table__,
    GradingTemplate.__table__,
    GradingTemplateComponent.__table__,
    Subject.__table__,
]


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
    test_app.include_router(subjects_router, prefix="/api/v1/subjects")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "admin",
    }
    with TestClient(test_app) as test_client:
        yield test_client
    test_app.dependency_overrides.clear()


def add_level(db, name: str = "Grade 11", grade: int = 11) -> AcademicLevel:
    level = AcademicLevel(level_name=name, grade_level=grade)
    db.add(level)
    db.flush()
    return level


def add_template(
    db,
    name: str = "Core",
    threshold: float = 87.0,
    components: list[tuple[str, float]] | None = None,
) -> GradingTemplate:
    template = GradingTemplate(
        template_name=name,
        passing_threshold=Decimal(str(threshold)),
        status="active",
    )
    if components is None:
        components = [("Written Work", 20.0), ("Performance Tasks", 50.0), ("Exams", 30.0)]
    template.components = [
        GradingTemplateComponent(
            component_name=comp_name,
            weight=Decimal(str(weight)),
            display_order=i,
        )
        for i, (comp_name, weight) in enumerate(components, 1)
    ]
    db.add(template)
    db.flush()
    return template


def add_subject(
    db,
    level: AcademicLevel,
    template: GradingTemplate,
    name: str = "General Biology 1",
    code: str = "GENBIO1",
    status: str = "active",
) -> Subject:
    subject = Subject(
        subject_name=name,
        subject_codename=code,
        grading_template_id=template.grading_template_id,
        description="STEM subject",
        status=status,
        academic_level_id=level.academic_level_id,
    )
    db.add(subject)
    db.flush()
    return subject


def subject_payload(level: AcademicLevel, template: GradingTemplate, **overrides):
    payload = {
        "subject_name": "General Biology 1",
        "subject_codename": "GENBIO1",
        "grading_template_id": template.grading_template_id,
        "description": "STEM subject",
        "academic_level_id": level.academic_level_id,
    }
    payload.update(overrides)
    return payload


def test_form_options_returns_usable_subject_data(client, db):
    grade_11 = add_level(db, "Grade 11", 11)
    grade_12 = add_level(db, "Grade 12", 12)
    template = add_template(db, "Specialized", 85.0)
    db.commit()

    response = client.get("/api/v1/subjects/form-options")

    assert response.status_code == 200
    body = response.json()
    assert body["academic_levels"] == [
        {"academic_level_id": grade_11.academic_level_id, "level_name": "Grade 11", "grade_level": 11},
        {"academic_level_id": grade_12.academic_level_id, "level_name": "Grade 12", "grade_level": 12},
    ]
    assert body["statuses"] == ["active", "archived"]
    assert body["default_status"] == "active"
    assert "Specialized" in body["grading_templates"]
    assert any(t["template_name"] == "Specialized" and t["passing_threshold"] == 85.0 for t in body["grading_template_details"])


def test_create_subject_works(client, db):
    level = add_level(db)
    template = add_template(db)
    db.commit()

    response = client.post("/api/v1/subjects", json=subject_payload(level, template))

    assert response.status_code == 201
    body = response.json()
    assert body["subject_name"] == "General Biology 1"
    assert body["subject_codename"] == "GENBIO1"
    assert body["grading_template"]["template_name"] == template.template_name
    assert body["grading_template"]["passing_threshold"] == float(template.passing_threshold)
    assert body["status"] == "active"
    assert body["academic_level"]["academic_level_id"] == level.academic_level_id
    assert db.query(Subject).count() == 1


def test_duplicate_subject_code_in_same_academic_level_is_rejected(client, db):
    level = add_level(db)
    template = add_template(db)
    add_subject(db, level, template, code="GENBIO1")
    db.commit()

    response = client.post(
        "/api/v1/subjects",
        json=subject_payload(level, template, subject_name="General Biology Duplicate", subject_codename=" genbio1 "),
    )

    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]
    assert db.query(Subject).count() == 1


def test_same_subject_code_in_different_academic_level_is_allowed(client, db):
    grade_11 = add_level(db, "Grade 11", 11)
    grade_12 = add_level(db, "Grade 12", 12)
    template = add_template(db)
    add_subject(db, grade_11, template, code="GENBIO1")
    db.commit()

    response = client.post(
        "/api/v1/subjects",
        json=subject_payload(grade_12, template, subject_name="General Biology 2", subject_codename="GENBIO1"),
    )

    assert response.status_code == 201
    assert db.query(Subject).count() == 2


def test_list_subjects_and_search_filter_work(client, db):
    grade_11 = add_level(db, "Grade 11", 11)
    grade_12 = add_level(db, "Grade 12", 12)
    template = add_template(db)
    add_subject(db, grade_12, template, name="Pre-Calculus", code="PRECAL", status="active")
    add_subject(db, grade_11, template, name="General Biology 1", code="GENBIO1", status="active")
    db.commit()

    response = client.get("/api/v1/subjects?search=bio")

    assert response.status_code == 200
    body = response.json()
    assert body["summary"] == {"total_subjects": 2, "active_subjects": 2, "archived_subjects": 0}
    assert [item["subject_name"] for item in body["subjects"]] == ["General Biology 1"]


def test_filter_by_academic_level_and_grading_template(client, db):
    grade_11 = add_level(db, "Grade 11", 11)
    grade_12 = add_level(db, "Grade 12", 12)
    core = add_template(db, "Core", 87.0)
    spec = add_template(db, "Specialized", 85.0)
    add_subject(db, grade_11, spec, name="General Biology 1", code="GENBIO1", status="active")
    add_subject(db, grade_12, core, name="Reading and Writing", code="RW", status="active")
    db.commit()

    response = client.get(f"/api/v1/subjects?academic_level_id={grade_11.academic_level_id}&grading_template_id={spec.grading_template_id}")

    assert response.status_code == 200
    assert [item["subject_codename"] for item in response.json()["subjects"]] == ["GENBIO1"]


def test_update_subject_works_and_validates_duplicate_code(client, db):
    level = add_level(db)
    template = add_template(db)
    subject = add_subject(db, level, template, code="GENBIO1")
    add_subject(db, level, template, name="Pre-Calculus", code="PRECAL")
    db.commit()

    conflict = client.patch(f"/api/v1/subjects/{subject.subject_id}", json={"subject_codename": "precal"})
    assert conflict.status_code == 409

    response = client.patch(
        f"/api/v1/subjects/{subject.subject_id}",
        json={
            "subject_name": "General Biology Updated",
            "subject_codename": "GENBIO1A",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["subject_name"] == "General Biology Updated"
    assert body["subject_codename"] == "GENBIO1A"


def test_non_admin_cannot_create_update_or_archive(client, db):
    level = add_level(db)
    template = add_template(db)
    subject = add_subject(db, level, template)
    db.commit()
    client.app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "teacher",
    }

    assert client.post("/api/v1/subjects", json=subject_payload(level, template)).status_code == 403
    assert client.patch(f"/api/v1/subjects/{subject.subject_id}", json={"subject_name": "Blocked"}).status_code == 403
    assert client.patch(f"/api/v1/subjects/{subject.subject_id}/archive").status_code == 403
