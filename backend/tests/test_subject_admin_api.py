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
from app.api.v1.routes.SubjectGroups import router as subject_groups_router
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
    test_app.include_router(subject_groups_router, prefix="/api/v1/subject-groups")
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


def add_group(db, name: str = "Specialized", threshold: float = 83.0, display_order: int = 1) -> SubjectGroup:
    group = SubjectGroup(name=name, passing_threshold=threshold, display_order=display_order)
    db.add(group)
    db.flush()
    return group


def add_subject(
    db,
    level: AcademicLevel,
    group: SubjectGroup,
    name: str = "General Biology 1",
    code: str = "GENBIO1",
    status: str = "active",
) -> Subject:
    subject = Subject(
        subject_name=name,
        subject_codename=code,
        subject_group_id=group.subject_group_id,
        hours=80,
        default_grading_template="Default SHS",
        description="STEM subject",
        status=status,
        academic_level_id=level.academic_level_id,
    )
    db.add(subject)
    db.flush()
    return subject


def subject_payload(level: AcademicLevel, group: SubjectGroup, **overrides):
    payload = {
        "subject_name": "General Biology 1",
        "subject_codename": "GENBIO1",
        "subject_group_id": group.subject_group_id,
        "hours": 80,
        "default_grading_template": "Default SHS",
        "description": "STEM subject",
        "academic_level_id": level.academic_level_id,
    }
    payload.update(overrides)
    return payload


def test_form_options_returns_usable_subject_data(client, db):
    grade_11 = add_level(db, "Grade 11", 11)
    grade_12 = add_level(db, "Grade 12", 12)
    group = add_group(db, "Specialized", 83.0)
    db.commit()

    response = client.get("/api/v1/subjects/form-options")

    assert response.status_code == 200
    body = response.json()
    assert body["academic_levels"] == [
        {"academic_level_id": grade_11.academic_level_id, "level_name": "Grade 11", "grade_level": 11},
        {"academic_level_id": grade_12.academic_level_id, "level_name": "Grade 12", "grade_level": 12},
    ]
    assert body["subject_groups"] == [
        {"subject_group_id": group.subject_group_id, "name": "Specialized", "passing_threshold": 83.0}
    ]
    assert body["statuses"] == ["active", "archived"]
    assert body["default_status"] == "active"
    assert body["grading_templates"]


def test_create_subject_works(client, db):
    level = add_level(db)
    group = add_group(db)
    db.commit()

    response = client.post("/api/v1/subjects", json=subject_payload(level, group))

    assert response.status_code == 201
    body = response.json()
    assert body["subject_name"] == "General Biology 1"
    assert body["subject_codename"] == "GENBIO1"
    assert body["subject_group"]["name"] == "Specialized"
    assert body["subject_group"]["passing_threshold"] == 83.0
    assert body["hours"] == 80
    assert body["status"] == "active"
    assert body["academic_level"]["academic_level_id"] == level.academic_level_id
    assert db.query(Subject).count() == 1


def test_duplicate_subject_code_in_same_academic_level_is_rejected(client, db):
    level = add_level(db)
    group = add_group(db)
    add_subject(db, level, group, code="GENBIO1")
    db.commit()

    response = client.post(
        "/api/v1/subjects",
        json=subject_payload(level, group, subject_name="General Biology Duplicate", subject_codename=" genbio1 "),
    )

    assert response.status_code == 409
    assert "already exists" in response.json()["detail"]
    assert db.query(Subject).count() == 1


def test_same_subject_code_in_different_academic_level_is_allowed(client, db):
    grade_11 = add_level(db, "Grade 11", 11)
    grade_12 = add_level(db, "Grade 12", 12)
    group = add_group(db)
    add_subject(db, grade_11, group, code="GENBIO1")
    db.commit()

    response = client.post(
        "/api/v1/subjects",
        json=subject_payload(grade_12, group, subject_name="General Biology 2", subject_codename="GENBIO1"),
    )

    assert response.status_code == 201
    assert db.query(Subject).count() == 2


def test_list_subjects_and_search_filter_work(client, db):
    grade_11 = add_level(db, "Grade 11", 11)
    grade_12 = add_level(db, "Grade 12", 12)
    group = add_group(db)
    add_subject(db, grade_12, group, name="Pre-Calculus", code="PRECAL", status="active")
    add_subject(db, grade_11, group, name="General Biology 1", code="GENBIO1", status="active")
    db.commit()

    response = client.get("/api/v1/subjects?search=bio")

    assert response.status_code == 200
    body = response.json()
    assert body["summary"] == {"total_subjects": 2, "active_subjects": 2, "archived_subjects": 0}
    assert [item["subject_name"] for item in body["subjects"]] == ["General Biology 1"]


def test_filter_by_academic_level_and_group(client, db):
    grade_11 = add_level(db, "Grade 11", 11)
    grade_12 = add_level(db, "Grade 12", 12)
    core = add_group(db, "Core", 85.0)
    spec = add_group(db, "Specialized", 83.0)
    add_subject(db, grade_11, spec, name="General Biology 1", code="GENBIO1", status="active")
    add_subject(db, grade_12, core, name="Reading and Writing", code="RW", status="active")
    db.commit()

    response = client.get(f"/api/v1/subjects?academic_level_id={grade_11.academic_level_id}&subject_group_id={spec.subject_group_id}")

    assert response.status_code == 200
    assert [item["subject_codename"] for item in response.json()["subjects"]] == ["GENBIO1"]


def test_update_subject_works_and_validates_duplicate_code(client, db):
    level = add_level(db)
    group = add_group(db)
    subject = add_subject(db, level, group, code="GENBIO1")
    add_subject(db, level, group, name="Pre-Calculus", code="PRECAL")
    db.commit()

    conflict = client.patch(f"/api/v1/subjects/{subject.subject_id}", json={"subject_codename": "precal"})
    assert conflict.status_code == 409

    response = client.patch(
        f"/api/v1/subjects/{subject.subject_id}",
        json={
            "subject_name": "General Biology Updated",
            "subject_codename": "GENBIO1A",
            "hours": 90,
            "default_grading_template": "STEM Written/Performance/Exam",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["subject_name"] == "General Biology Updated"
    assert body["subject_codename"] == "GENBIO1A"
    assert body["hours"] == 90


def test_non_admin_cannot_create_update_or_archive(client, db):
    level = add_level(db)
    group = add_group(db)
    subject = add_subject(db, level, group)
    db.commit()
    client.app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "teacher",
    }

    assert client.post("/api/v1/subjects", json=subject_payload(level, group)).status_code == 403
    assert client.patch(f"/api/v1/subjects/{subject.subject_id}", json={"subject_name": "Blocked"}).status_code == 403
    assert client.patch(f"/api/v1/subjects/{subject.subject_id}/archive").status_code == 403


# ── SubjectGroups CRUD Tests ──────────────────────────────────────────

def test_subject_groups_crud_flow(client, db):
    # 1. Create
    resp = client.post("/api/v1/subject-groups", json={"name": "Practicum", "passing_threshold": 80.0, "display_order": 10})
    assert resp.status_code == 201
    created = resp.json()
    group_id = created["subject_group_id"]
    assert created["name"] == "Practicum"
    assert created["passing_threshold"] == 80.0
    assert created["is_active"] is True
    assert created["subject_count"] == 0

    # 2. Duplicate name error (409)
    dup_resp = client.post("/api/v1/subject-groups", json={"name": "Practicum", "passing_threshold": 80.0})
    assert dup_resp.status_code == 409

    # 3. List
    list_resp = client.get("/api/v1/subject-groups")
    assert list_resp.status_code == 200
    assert any(g["name"] == "Practicum" for g in list_resp.json()["groups"])

    # 4. Update
    patch_resp = client.patch(f"/api/v1/subject-groups/{group_id}", json={"passing_threshold": 82.5, "name": "Practicum & Fieldwork"})
    assert patch_resp.status_code == 200
    assert patch_resp.json()["passing_threshold"] == 82.5
    assert patch_resp.json()["name"] == "Practicum & Fieldwork"

    # 5. Deactivate without subjects -> succeeds
    del_resp = client.delete(f"/api/v1/subject-groups/{group_id}")
    assert del_resp.status_code == 200

    # Verify deactivated
    g_db = db.get(SubjectGroup, group_id)
    assert g_db.is_active is False


def test_deactivate_group_with_assigned_subjects_returns_409(client, db):
    level = add_level(db)
    group = add_group(db, "Core", 85.0)
    add_subject(db, level, group, name="Math 1")
    db.commit()

    del_resp = client.delete(f"/api/v1/subject-groups/{group.subject_group_id}")
    assert del_resp.status_code == 409
    body = del_resp.json()
    assert "detail" in body
    assert "affected_subjects" in body["detail"]
    assert len(body["detail"]["affected_subjects"]) == 1
    assert body["detail"]["affected_subjects"][0]["subject_name"] == "Math 1"
