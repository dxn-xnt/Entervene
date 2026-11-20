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
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
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
    # Form options intentionally provision the standard Grade 7-12 catalog
    # levels while retaining already-seeded level identities.
    assert [level["grade_level"] for level in body["academic_levels"]] == [7, 8, 9, 10, 11, 12]
    assert next(level for level in body["academic_levels"] if level["grade_level"] == 11) == {
        "academic_level_id": grade_11.academic_level_id,
        "level_name": "Grade 11",
        "grade_level": 11,
    }
    assert next(level for level in body["academic_levels"] if level["grade_level"] == 12) == {
        "academic_level_id": grade_12.academic_level_id,
        "level_name": "Grade 12",
        "grade_level": 12,
    }
    assert body["statuses"] == ["active", "archived"]
    assert body["default_status"] == "active"
    assert "Specialized" in body["grading_templates"]
    assert any(t["template_name"] == "Specialized" and t["passing_threshold"] == 85.0 for t in body["grading_template_details"])


def test_create_subject_uses_backend_generated_code(client, db):
    level = add_level(db)
    template = add_template(db)
    db.commit()

    response = client.post(
        "/api/v1/subjects",
        json=subject_payload(level, template, subject_codename="UNTRUSTED CLIENT CODE"),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["subject_name"] == "General Biology 1"
    assert body["subject_codename"] == "GENBIO1"
    assert body["grading_template"]["template_name"] == template.template_name
    assert body["grading_template"]["passing_threshold"] == float(template.passing_threshold)
    assert body["status"] == "active"
    assert body["academic_level"]["academic_level_id"] == level.academic_level_id
    assert db.query(Subject).count() == 1


def test_duplicate_normalized_subject_name_including_archived_is_rejected(client, db):
    level = add_level(db, "Grade 7", 7)
    template = add_template(db)
    add_subject(db, level, template, name="English 7", code="ENG 7", status="archived")
    db.commit()

    response = client.post(
        "/api/v1/subjects",
        json=subject_payload(level, template, subject_name=" english7 ", subject_codename="IGNORED"),
    )

    assert response.status_code == 409
    assert "including archived subjects" in response.json()["detail"]
    assert db.query(Subject).count() == 1


def test_generated_subject_code_conflict_is_global(client, db):
    grade_11 = add_level(db, "Grade 11", 11)
    grade_12 = add_level(db, "Grade 12", 12)
    template = add_template(db)
    add_subject(db, grade_11, template, name="General Biology 1", code="GENBIO1")
    db.commit()

    response = client.post(
        "/api/v1/subjects",
        json=subject_payload(grade_12, template, subject_name="General Biology 1", subject_codename="DIFFERENT"),
    )

    assert response.status_code == 409
    assert 'Generated subject code "GENBIO1" is already used' in response.json()["detail"]
    assert db.query(Subject).count() == 1


def test_subject_code_preview_uses_backend_generation(client, db):
    level = add_level(db, "Grade 8", 8)
    db.commit()

    response = client.get(
        "/api/v1/subjects/code-preview",
        params={"subject_name": " Enhanced---Science8 ", "academic_level_id": level.academic_level_id},
    )

    assert response.status_code == 200
    assert response.json() == {"subject_codename": "ENSCI8"}


def test_subject_code_preview_preserves_legacy_code_until_edit_changes_name(client, db):
    level = add_level(db, "Grade 8", 8)
    template = add_template(db)
    subject = add_subject(
        db,
        level,
        template,
        name="Enhanced Mathematics 8",
        code="EMATH8",
    )
    db.commit()

    unchanged = client.get(
        "/api/v1/subjects/code-preview",
        params={
            "subject_name": " enhanced mathematics8 ",
            "academic_level_id": level.academic_level_id,
            "subject_id": subject.subject_id,
        },
    )
    renamed = client.get(
        "/api/v1/subjects/code-preview",
        params={
            "subject_name": "Enhanced Science 8",
            "academic_level_id": level.academic_level_id,
            "subject_id": subject.subject_id,
        },
    )

    assert unchanged.status_code == 200
    assert unchanged.json() == {"subject_codename": "EMATH8"}
    assert renamed.status_code == 200
    assert renamed.json() == {"subject_codename": "ENSCI8"}


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


def test_list_subjects_exposes_grading_template_assignment_lock(client, db):
    level = add_level(db)
    template = add_template(db)
    subject = add_subject(db, level, template)
    db.flush()
    db.add(StudentPeriodGrade(
        student_id=uuid.uuid4(), class_id=1, subject_id=subject.subject_id,
        academic_period_id=1, transmuted_grade=Decimal("90"), is_finalized=True,
    ))
    db.commit()

    response = client.get("/api/v1/subjects")
    assert response.status_code == 200
    item = response.json()["subjects"][0]
    assert item["grading_template_assignment_locked"] is True
    assert "Recorded period grades" in item["grading_template_assignment_lock_reason"]


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


def test_update_preserves_code_until_name_changes_then_regenerates(client, db):
    level = add_level(db)
    template = add_template(db)
    subject = add_subject(db, level, template, code="GENBIO1")
    db.commit()

    preserved = client.patch(
        f"/api/v1/subjects/{subject.subject_id}",
        json={"description": "Updated without renaming"},
    )
    assert preserved.status_code == 200
    assert preserved.json()["subject_codename"] == "GENBIO1"

    response = client.patch(
        f"/api/v1/subjects/{subject.subject_id}",
        json={"subject_name": "Enhanced Science 11"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["subject_name"] == "Enhanced Science 11"
    assert body["subject_codename"] == "ENSCI11"


def test_update_rejects_client_selected_code(client, db):
    level = add_level(db)
    template = add_template(db)
    subject = add_subject(db, level, template, code="GENBIO1")
    db.commit()

    response = client.patch(
        f"/api/v1/subjects/{subject.subject_id}",
        json={"subject_codename": "CLIENTCODE"},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "Subject codes are generated automatically. Change the subject name to generate a new code."
    )
    db.refresh(subject)
    assert subject.subject_codename == "GENBIO1"


def test_update_name_rejects_duplicate_and_code_conflict(client, db):
    grade_11 = add_level(db, "Grade 11", 11)
    grade_12 = add_level(db, "Grade 12", 12)
    template = add_template(db)
    subject = add_subject(db, grade_12, template, name="Work Immersion", code="WI12")
    add_subject(db, grade_12, template, name="English 12", code="ENG12", status="archived")
    add_subject(db, grade_11, template, name="General Biology 1", code="GENBIO1")
    db.commit()

    duplicate_name = client.patch(
        f"/api/v1/subjects/{subject.subject_id}",
        json={"subject_name": "english12"},
    )
    assert duplicate_name.status_code == 409
    assert "including archived subjects" in duplicate_name.json()["detail"]

    code_conflict = client.patch(
        f"/api/v1/subjects/{subject.subject_id}",
        json={"subject_name": "General Biology 1"},
    )
    assert code_conflict.status_code == 409
    assert 'Generated subject code "GENBIO1" is already used' in code_conflict.json()["detail"]


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
    assert client.get(
        "/api/v1/subjects/code-preview",
        params={"subject_name": "English 11", "academic_level_id": level.academic_level_id},
    ).status_code == 403
    assert client.patch(f"/api/v1/subjects/{subject.subject_id}", json={"subject_name": "Blocked"}).status_code == 403
    assert client.patch(f"/api/v1/subjects/{subject.subject_id}/archive").status_code == 403



def test_restore_rejects_archived_duplicate_and_patch_status_cannot_bypass(client, db):
    grade_7 = add_level(db, "Grade 7", 7)
    template = add_template(db)
    active_eng7 = add_subject(db, grade_7, template, name="English 7", code="ENG7", status="active")
    archived_dup = add_subject(db, grade_7, template, name="English7", code=None, status="archived")
    db.commit()

    restore_resp = client.patch(f"/api/v1/subjects/{archived_dup.subject_id}/restore")
    assert restore_resp.status_code == 409
    assert "active subject" in restore_resp.json()["detail"].lower()

    patch_resp = client.patch(
        f"/api/v1/subjects/{archived_dup.subject_id}",
        json={"status": "active"},
    )
    assert patch_resp.status_code == 409
    assert "active subject" in patch_resp.json()["detail"].lower()

    # Even if the active subject is archived, the codeless duplicate still cannot steal ENG7.
    active_eng7.status = "archived"
    db.commit()
    restore_while_both_archived = client.patch(f"/api/v1/subjects/{archived_dup.subject_id}/restore")
    assert restore_while_both_archived.status_code == 409
    assert 'Generated subject code "ENG7" is already used' in restore_while_both_archived.json()["detail"]

    db.refresh(archived_dup)
    assert archived_dup.status == "archived"
    assert archived_dup.subject_codename is None
