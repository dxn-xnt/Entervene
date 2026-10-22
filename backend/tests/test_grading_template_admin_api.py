from datetime import datetime, timezone
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
from app.api.v1.routes.GradingTemplates import router as grading_templates_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject


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
        level = AcademicLevel(level_name="Grade 11", grade_level=11)
        session.add(level)
        templates_data = [
            ("Core", 87.0, [( "Written Work", 20.0), ("Performance Tasks", 50.0), ("Exams", 30.0)]),
            ("Applied", 85.0, [("Written Work", 20.0), ("Performance Tasks", 60.0), ("Exams", 20.0)]),
            ("Specialized", 85.0, [("Written Work", 20.0), ("Performance Tasks", 50.0), ("Exams", 30.0)]),
        ]
        for name, threshold, components in templates_data:
            tmpl = GradingTemplate(
                template_name=name,
                passing_threshold=Decimal(str(threshold)),
                status="active",
                updated_at=datetime.now(timezone.utc),
            )
            tmpl.components = [
                GradingTemplateComponent(
                    component_name=c_name,
                    weight=Decimal(str(w)),
                    display_order=i,
                )
                for i, (c_name, w) in enumerate(components, 1)
            ]
            session.add(tmpl)
        session.commit()
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
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


def test_form_options_returns_default_components(client):
    response = client.get("/api/v1/grading-templates/form-options")
    assert response.status_code == 200
    body = response.json()
    assert "default_components" in body
    assert sum(c["weight"] for c in body["default_components"]) == 100


def test_list_grading_templates_returns_three_templates(client):
    response = client.get("/api/v1/grading-templates")
    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["total_templates"] == 3
    assert body["summary"]["active_templates"] == 3
    assert body["summary"]["archived_templates"] == 0
    templates = body["grading_templates"]
    assert {t["template_name"] for t in templates} == {"Core", "Applied", "Specialized"}
    for t in templates:
        assert t["total_weight"] == 100
        assert t["component_count"] == 3
        assert t["is_locked"] is False


def test_get_grading_template_detail(client, db):
    core = db.query(GradingTemplate).filter(GradingTemplate.template_name == "Core").one()
    response = client.get(f"/api/v1/grading-templates/{core.grading_template_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["template_name"] == "Core"
    assert body["passing_threshold"] == 87.0
    assert body["total_weight"] == 100
    assert len(body["components"]) == 3


def test_patch_grading_template_success(client, db):
    applied = db.query(GradingTemplate).filter(GradingTemplate.template_name == "Applied").one()
    url = f"/api/v1/grading-templates/{applied.grading_template_id}"
    payload = {
        "updated_at": applied.updated_at.isoformat(),
        "components": [
            {"component_name": "Written Work", "weight": 25.0, "display_order": 1},
            {"component_name": "Performance Tasks", "weight": 55.0, "display_order": 2},
            {"component_name": "Exams", "weight": 20.0, "display_order": 3},
        ],
    }
    response = client.patch(url, json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["passing_threshold"] == 85.0
    assert [c["weight"] for c in body["components"]] == [25.0, 55.0, 20.0]


def test_patch_grading_template_rejects_weights_not_100(client, db):
    applied = db.query(GradingTemplate).filter(GradingTemplate.template_name == "Applied").one()
    url = f"/api/v1/grading-templates/{applied.grading_template_id}"
    payload = {
        "updated_at": applied.updated_at.isoformat(),
        "components": [
            {"component_name": "Written Work", "weight": 30.0, "display_order": 1},
            {"component_name": "Performance Tasks", "weight": 60.0, "display_order": 2},
            {"component_name": "Exams", "weight": 20.0, "display_order": 3},
        ],
    }
    response = client.patch(url, json=payload)
    assert response.status_code == 422
    assert "total 100" in response.json()["detail"]


def test_patch_grading_template_rejects_invalid_or_duplicate_component_names(client, db):
    applied = db.query(GradingTemplate).filter(GradingTemplate.template_name == "Applied").one()
    url = f"/api/v1/grading-templates/{applied.grading_template_id}"

    # Non-standard component name
    invalid_name = {
        "updated_at": applied.updated_at.isoformat(),
        "components": [
            {"component_name": "Homework", "weight": 20.0, "display_order": 1},
            {"component_name": "Performance Tasks", "weight": 60.0, "display_order": 2},
            {"component_name": "Exams", "weight": 20.0, "display_order": 3},
        ],
    }
    response = client.patch(url, json=invalid_name)
    assert response.status_code == 422
    assert "Written Work, Performance Tasks, and Exams" in response.json()["detail"]

    # Duplicate component name
    duplicate = {
        "updated_at": applied.updated_at.isoformat(),
        "components": [
            {"component_name": "Written Work", "weight": 20.0, "display_order": 1},
            {"component_name": "written work", "weight": 60.0, "display_order": 2},
            {"component_name": "Exams", "weight": 20.0, "display_order": 3},
        ],
    }
    response = client.patch(url, json=duplicate)
    assert response.status_code == 422
    assert "duplicated" in response.json()["detail"]


def test_patch_grading_template_allows_unique_name_change(client, db):
    applied = db.query(GradingTemplate).filter(GradingTemplate.template_name == "Applied").one()
    url = f"/api/v1/grading-templates/{applied.grading_template_id}"
    payload = {
        "updated_at": applied.updated_at.isoformat(),
        "template_name": "Modified Name",
    }
    response = client.patch(url, json=payload)
    assert response.status_code == 200
    assert response.json()["template_name"] == "Modified Name"


def test_create_template_and_assign_ungraded_subject(client, db):
    level = db.query(AcademicLevel).first()
    core = db.query(GradingTemplate).filter(GradingTemplate.template_name == "Core").one()
    subject = Subject(subject_name="Media Literacy", subject_codename="MIL11",
                      grading_template_id=core.grading_template_id,
                      academic_level_id=level.academic_level_id, status="active")
    db.add(subject)
    db.commit()
    response = client.post("/api/v1/grading-templates", json={
        "template_name": "Creative Studies", "description": "Practice template",
        "passing_threshold": 82, "status": "active", "subject_ids": [subject.subject_id],
        "components": [
            {"component_name": "Written Work", "weight": 30, "display_order": 1},
            {"component_name": "Performance Tasks", "weight": 50, "display_order": 2},
            {"component_name": "Exams", "weight": 20, "display_order": 3},
        ],
    })
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["template_name"] == "Creative Studies"
    assert body["assigned_subject_count"] == 1
    db.refresh(subject)
    assert subject.grading_template_id == body["grading_template_id"]


def test_create_template_rejects_duplicate_name_and_invalid_weights(client):
    base = {
        "template_name": "core", "passing_threshold": 85, "status": "active", "subject_ids": [],
        "components": [
            {"component_name": "Written Work", "weight": 20, "display_order": 1},
            {"component_name": "Performance Tasks", "weight": 60, "display_order": 2},
            {"component_name": "Exams", "weight": 20, "display_order": 3},
        ],
    }
    assert client.post("/api/v1/grading-templates", json=base).status_code == 409
    base["template_name"] = "New Template"
    base["components"][2]["weight"] = 30
    assert client.post("/api/v1/grading-templates", json=base).status_code == 422


def test_patch_grading_template_rejects_stale_timestamp(client, db):
    applied = db.query(GradingTemplate).filter(GradingTemplate.template_name == "Applied").one()
    url = f"/api/v1/grading-templates/{applied.grading_template_id}"
    stale_payload = {
        "updated_at": "2020-01-01T00:00:00Z",
        "template_name": "Stale edit",
    }
    response = client.patch(url, json=stale_payload)
    assert response.status_code == 409
    assert "Reload it before saving" in response.json()["detail"]


def test_patch_grading_template_rejects_when_locked(client, db):
    core = db.query(GradingTemplate).filter(GradingTemplate.template_name == "Core").one()
    level = db.query(AcademicLevel).first()
    subject = Subject(
        subject_name="Mathematics 7",
        subject_codename="MATH7",
        grading_template_id=core.grading_template_id,
        academic_level_id=level.academic_level_id,
        status="active",
    )
    db.add(subject)
    db.flush()

    grade = StudentPeriodGrade(
        student_id=uuid.uuid4(),
        class_id=1,
        subject_id=subject.subject_id,
        academic_period_id=1,
        transmuted_grade=Decimal("90.0"),
        is_finalized=True,
    )
    db.add(grade)
    db.commit()

    url = f"/api/v1/grading-templates/{core.grading_template_id}"
    payload = {
        "updated_at": core.updated_at.isoformat(),
        "template_name": "Protected edit",
    }
    response = client.patch(url, json=payload)
    assert response.status_code == 409
    assert "locked" in response.json()["detail"].lower()


def test_non_admin_cannot_access_or_patch(client, db):
    core = db.query(GradingTemplate).filter(GradingTemplate.template_name == "Core").one()
    url = f"/api/v1/grading-templates/{core.grading_template_id}"

    client.app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "teacher",
    }
    assert client.get("/api/v1/grading-templates").status_code == 403
    assert client.patch(url, json={"updated_at": core.updated_at.isoformat()}).status_code == 403

    del client.app.dependency_overrides[get_current_user]
    assert client.get("/api/v1/grading-templates").status_code == 401
