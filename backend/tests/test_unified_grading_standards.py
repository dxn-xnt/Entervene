import uuid
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.GradingTemplates import router as grading_templates_router
from app.api.v1.routes.Subjects import router as subjects_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.services.student_record.StudentRecordService import resolve_subject_grading_weights


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    try:
        level = AcademicLevel(level_name="Grade 7", grade_level=7)
        session.add(level)
        for name, threshold, weights in (
            ("Core", 87, (20, 50, 30)),
            ("Applied", 85, (20, 60, 20)),
            ("Specialized", 85, (20, 50, 30)),
        ):
            template = GradingTemplate(template_name=name, passing_threshold=threshold, status="active")
            template.components = [
                GradingTemplateComponent(component_name=component, weight=Decimal(weight), display_order=index)
                for index, (component, weight) in enumerate(zip(
                    ("Written Work", "Performance Tasks", "Exams"), weights,
                ), start=1)
            ]
            session.add(template)
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
    test_app.include_router(subjects_router, prefix="/api/v1/subjects")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: {"sub": str(uuid.uuid4()), "role": "admin"}
    with TestClient(test_app) as test_client:
        yield test_client


def test_three_templates_and_subject_foreign_key(client, db):
    listed = client.get("/api/v1/grading-templates")
    assert listed.status_code == 200
    templates = listed.json()["grading_templates"]
    assert {item["template_name"] for item in templates} == {"Core", "Applied", "Specialized"}
    created_template = client.post("/api/v1/grading-templates", json={
        "template_name": "Fourth", "passing_threshold": 80, "status": "active", "subject_ids": [],
        "components": [
            {"component_name": "Written Work", "weight": 20, "display_order": 1},
            {"component_name": "Performance Tasks", "weight": 50, "display_order": 2},
            {"component_name": "Exams", "weight": 30, "display_order": 3},
        ],
    })
    assert created_template.status_code == 201
    core = next(item for item in templates if item["template_name"] == "Core")
    applied = next(item for item in templates if item["template_name"] == "Applied")
    created = client.post("/api/v1/subjects", json={
        "subject_name": "New subject", "subject_codename": "NEW1", "academic_level_id": 1,
        "grading_template_id": applied["grading_template_id"],
    })
    assert created.status_code == 201, created.text
    subject = created.json()
    assert subject["grading_template"]["passing_threshold"] == 85
    weights = resolve_subject_grading_weights(db, subject["subject_id"])
    assert (weights.ww_weight, weights.pt_weight, weights.qa_weight) == (0.2, 0.6, 0.2)
    moved = client.patch(f'/api/v1/subjects/{subject["subject_id"]}', json={"grading_template_id": core["grading_template_id"]})
    assert moved.status_code == 200, moved.text
    assert moved.json()["grading_template"]["passing_threshold"] == 87
    obsolete = client.post("/api/v1/subjects", json={
        "subject_name": "Invalid", "academic_level_id": 1, "grading_template_id": 999,
    })
    assert obsolete.status_code == 422


def test_template_edit_validation_and_stale_version(client):
    template = next(t for t in client.get("/api/v1/grading-templates").json()["grading_templates"] if t["template_name"] == "Applied")
    template_id = template["grading_template_id"]
    url = f"/api/v1/grading-templates/{template_id}"
    payload = {"updated_at": template["updated_at"], "passing_threshold": 86,
               "components": [
                   {"component_name": "Written Work", "weight": 20, "display_order": 1},
                   {"component_name": "Performance Tasks", "weight": 60, "display_order": 2},
                   {"component_name": "Exams", "weight": 30, "display_order": 3},
               ]}
    assert client.patch(url, json=payload).status_code == 422
    payload["components"][2]["weight"] = 20
    changed = client.patch(url, json=payload)
    assert changed.status_code == 200, changed.text
    assert changed.json()["passing_threshold"] == 86
    assert client.patch(url, json=payload).status_code == 409
    renamed = client.patch(url, json={"updated_at": changed.json()["updated_at"], "template_name": "Fourth"})
    assert renamed.status_code == 200
