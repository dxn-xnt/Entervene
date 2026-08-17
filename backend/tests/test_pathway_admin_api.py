import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Pathways import router as pathways_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicPathway import AcademicPathway
from app.models.academic.DepedCluster import DepedCluster


TABLES = [
    DepedCluster.__table__,
    AcademicPathway.__table__,
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
    test_app.include_router(pathways_router, prefix="/api/v1/pathways")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "admin",
    }
    with TestClient(test_app) as test_client:
        yield test_client
    test_app.dependency_overrides.clear()


def test_list_pathways_empty(client):
    res = client.get("/api/v1/pathways")
    assert res.status_code == 200
    assert res.json()["pathways"] == []


def test_create_and_get_pathway(client, db):
    cluster = DepedCluster(code="stem", name="STEM", category="ACADEMIC", sort_order=1)
    db.add(cluster)
    db.commit()

    payload = {
        "code": "medical-courses",
        "name": "Medical Courses and Sciences Related",
        "is_enabled": True,
        "sort_order": 1,
        "deped_cluster_id": cluster.id,
    }
    res = client.post("/api/v1/pathways", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert data["code"] == "medical-courses"
    assert data["name"] == "Medical Courses and Sciences Related"
    assert data["deped_cluster"]["code"] == "stem"

    list_res = client.get("/api/v1/pathways")
    assert list_res.status_code == 200
    assert len(list_res.json()["pathways"]) == 1


def test_create_duplicate_code_fails(client):
    payload = {
        "code": "medical-courses",
        "name": "Medical Pathway",
    }
    res1 = client.post("/api/v1/pathways", json=payload)
    assert res1.status_code == 201

    res2 = client.post("/api/v1/pathways", json=payload)
    assert res2.status_code == 409


def test_patch_pathway_toggle_enabled(client):
    create_res = client.post("/api/v1/pathways", json={"code": "engineering-math", "name": "Engineering Pathway"})
    pathway_id = create_res.json()["id"]

    patch_res = client.patch(f"/api/v1/pathways/{pathway_id}", json={"is_enabled": False, "name": "Updated Engineering"})
    assert patch_res.status_code == 200
    assert patch_res.json()["is_enabled"] is False
    assert patch_res.json()["name"] == "Updated Engineering"

    # Verify filtering by is_enabled
    enabled_res = client.get("/api/v1/pathways?is_enabled=true")
    assert len(enabled_res.json()["pathways"]) == 0

    all_res = client.get("/api/v1/pathways")
    assert len(all_res.json()["pathways"]) == 1
