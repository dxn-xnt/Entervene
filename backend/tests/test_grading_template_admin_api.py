import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.GradingTemplates import router as grading_templates_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.Subject import Subject


TABLES = [
    AcademicLevel.__table__,
    Subject.__table__,
    GradingTemplate.__table__,
    GradingTemplateComponent.__table__,
]


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
    test_app.include_router(grading_templates_router, prefix="/api/v1/grading-templates")
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


def add_subject(db, level: AcademicLevel) -> Subject:
    subject = Subject(
        subject_name="General Biology 1",
        subject_codename="GENBIO1",
        subject_group="Specialized",
        hours=80,
        default_grading_template="Default SHS",
        description="STEM subject",
        status="active",
        academic_level_id=level.academic_level_id,
    )
    db.add(subject)
    db.flush()
    return subject


def template_payload(level: AcademicLevel | None = None, subject: Subject | None = None, **overrides):
    payload = {
        "template_name": "Default SHS Grading",
        "description": "Standard SHS grading weights",
        "academic_level_id": level.academic_level_id if level else None,
        "subject_id": subject.subject_id if subject else None,
        "components": [
            {"component_name": "Written Works", "weight": 25, "display_order": 1},
            {"component_name": "Performance Tasks", "weight": 50, "display_order": 2},
            {"component_name": "Quarterly/Term Assessment", "weight": 25, "display_order": 3},
        ],
    }
    payload.update(overrides)
    return payload


def create_template(db, level: AcademicLevel, name: str = "Default SHS Grading") -> GradingTemplate:
    template = GradingTemplate(
        template_name=name,
        description="Standard SHS grading weights",
        academic_level_id=level.academic_level_id,
        status="active",
    )
    template.components = [
        GradingTemplateComponent(component_name="Written Works", weight=25, display_order=1),
        GradingTemplateComponent(component_name="Performance Tasks", weight=50, display_order=2),
        GradingTemplateComponent(component_name="Quarterly/Term Assessment", weight=25, display_order=3),
    ]
    db.add(template)
    db.flush()
    return template


def test_form_options_returns_usable_data(client, db):
    level = add_level(db)
    subject = add_subject(db, level)
    db.commit()

    response = client.get("/api/v1/grading-templates/form-options")

    assert response.status_code == 200
    body = response.json()
    assert body["academic_levels"][0]["academic_level_id"] == level.academic_level_id
    assert body["subjects"][0]["subject_id"] == subject.subject_id
    assert body["subjects"][0]["academic_level_id"] == level.academic_level_id
    assert body["statuses"] == ["active", "archived"]
    assert body["default_status"] == "active"
    assert sum(component["weight"] for component in body["default_components"]) == 100


def test_create_template_with_components(client, db):
    level = add_level(db)
    subject = add_subject(db, level)
    db.commit()

    response = client.post("/api/v1/grading-templates", json=template_payload(level, subject))

    assert response.status_code == 201
    body = response.json()
    assert body["template_name"] == "Default SHS Grading"
    assert body["academic_level"]["academic_level_id"] == level.academic_level_id
    assert body["subject"]["subject_id"] == subject.subject_id
    assert body["total_weight"] == 100
    assert [component["component_name"] for component in body["components"]] == [
        "Written Works",
        "Performance Tasks",
        "Quarterly/Term Assessment",
    ]
    assert db.query(GradingTemplate).count() == 1
    assert db.query(GradingTemplateComponent).count() == 3


def test_reject_weights_not_totaling_100(client, db):
    level = add_level(db)
    db.commit()
    payload = template_payload(
        level,
        components=[
            {"component_name": "Written Works", "weight": 30, "display_order": 1},
            {"component_name": "Performance Tasks", "weight": 50, "display_order": 2},
            {"component_name": "Quarterly/Term Assessment", "weight": 25, "display_order": 3},
        ],
    )

    response = client.post("/api/v1/grading-templates", json=payload)

    assert response.status_code == 422
    assert "total 100" in response.json()["detail"]


def test_reject_duplicate_component_names(client, db):
    level = add_level(db)
    db.commit()
    payload = template_payload(
        level,
        components=[
            {"component_name": "Written Works", "weight": 25, "display_order": 1},
            {"component_name": "written works", "weight": 50, "display_order": 2},
            {"component_name": "Quarterly/Term Assessment", "weight": 25, "display_order": 3},
        ],
    )

    response = client.post("/api/v1/grading-templates", json=payload)

    assert response.status_code == 422
    assert "duplicated" in response.json()["detail"]


def test_reject_duplicate_template_name_in_same_scope(client, db):
    level = add_level(db)
    create_template(db, level)
    db.commit()

    response = client.post("/api/v1/grading-templates", json=template_payload(level))

    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]


def test_list_and_detail_work(client, db):
    level = add_level(db)
    template = create_template(db, level)
    db.commit()

    list_response = client.get("/api/v1/grading-templates?search=default")
    detail_response = client.get(f"/api/v1/grading-templates/{template.grading_template_id}")

    assert list_response.status_code == 200
    assert list_response.json()["summary"] == {
        "total_templates": 1,
        "active_templates": 1,
        "archived_templates": 0,
    }
    assert list_response.json()["grading_templates"][0]["grading_template_id"] == template.grading_template_id
    assert detail_response.status_code == 200
    assert detail_response.json()["component_count"] == 3


def test_update_template_works(client, db):
    level = add_level(db)
    template = create_template(db, level)
    db.commit()

    response = client.patch(
        f"/api/v1/grading-templates/{template.grading_template_id}",
        json={
            "template_name": "STEM Lab Grading",
            "components": [
                {"component_name": "Written Works", "weight": 20, "display_order": 1},
                {"component_name": "Performance Tasks", "weight": 60, "display_order": 2},
                {"component_name": "Term Assessment", "weight": 20, "display_order": 3},
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["template_name"] == "STEM Lab Grading"
    assert body["total_weight"] == 100
    assert [component["weight"] for component in body["components"]] == [20, 60, 20]


def test_archive_and_restore_work(client, db):
    level = add_level(db)
    template = create_template(db, level)
    db.commit()

    archived = client.patch(f"/api/v1/grading-templates/{template.grading_template_id}/archive")
    assert archived.status_code == 200
    assert archived.json()["status"] == "archived"

    restored = client.patch(f"/api/v1/grading-templates/{template.grading_template_id}/restore")
    assert restored.status_code == 200
    assert restored.json()["status"] == "active"


def test_non_admin_cannot_create_update_or_archive(client, db):
    level = add_level(db)
    template = create_template(db, level)
    db.commit()
    client.app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "teacher",
    }

    assert client.post("/api/v1/grading-templates", json=template_payload(level)).status_code == 403
    assert client.patch(
        f"/api/v1/grading-templates/{template.grading_template_id}",
        json={"template_name": "Blocked"},
    ).status_code == 403
    assert client.patch(f"/api/v1/grading-templates/{template.grading_template_id}/archive").status_code == 403

    del client.app.dependency_overrides[get_current_user]
    assert client.post("/api/v1/grading-templates", json=template_payload(level)).status_code == 401
