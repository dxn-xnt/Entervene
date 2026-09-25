"""HTTP acceptance against the disposable Entervene_Demo_4M database only."""

import os
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.api.v1.routes.Auth import get_current_user
from app.core.Config import settings
from app.db.Session import get_db
from app.main import app
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.auth.UserAccount import UserAccount
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME, LEGACY_MODEL_NAME
from scripts.seed_current_term_demo import read_summary, require_demo_database


URL = os.getenv("DEMO_DATABASE_URL")
PATH = "/api/v1/development/current-term-predictions"


@pytest.mark.skipif(not URL, reason="Set DEMO_DATABASE_URL to the disposable 4M database")
def test_clean_demo_http_acceptance(monkeypatch):
    assert require_demo_database(URL).database in {"Entervene_Demo_4M", "Entervene_Demo_4N2"}
    engine = create_engine(URL)
    summary = read_summary(URL)
    scope = summary["scope"]
    monkeypatch.setattr(settings, "app_environment", "development")
    monkeypatch.setattr(settings, "development_prediction_api_enabled", True)
    monkeypatch.setattr(settings, "development_current_term_model_name", CORRECTED_MODEL_NAME)

    def db_override():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = db_override
    with Session(engine) as db:
        models = {row.model_name: row for row in db.scalars(select(AIModelVersion))}
        assert set(models) == {LEGACY_MODEL_NAME, CORRECTED_MODEL_NAME}
        corrected = models[CORRECTED_MODEL_NAME]
        legacy = models[LEGACY_MODEL_NAME]
        assert corrected.model_version_id != legacy.model_version_id
        assert (corrected.lifecycle_status, corrected.is_active, corrected.production_validated, corrected.independent_three_term_validation) == ("DEVELOPMENT", False, False, False)
        assert corrected.registry_metadata_json["artifact_sha256"] == "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc"
        assert corrected.registry_metadata_json["feature_schema_sha256"] == "36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562"
        ready = db.scalar(select(Student).where(Student.first_name == "Demo Avery"))
        insufficient = db.scalar(select(Student).where(Student.first_name == "Demo Jordan"))
        teacher = db.scalar(select(UserAccount).where(UserAccount.email == "demo-teacher@example.com"))
        level = db.scalar(select(AcademicLevel))
        period = db.get(AcademicPeriod, scope["academic_period_id"])
        subject = db.get(Subject, scope["subject_id"])
        submission = db.scalar(select(StudentSubmission).where(StudentSubmission.student_id == ready.student_id, StudentSubmission.grade.isnot(None)).order_by(StudentSubmission.submission_id))
        initial_revision = db.scalar(select(func.max(DevelopmentCurrentTermPrediction.revision)).where(DevelopmentCurrentTermPrediction.student_id == ready.student_id, DevelopmentCurrentTermPrediction.model_version_id == corrected.model_version_id))
        assert initial_revision >= 2
        ready_id, insufficient_id, teacher_id = ready.student_id, insufficient.student_id, teacher.user_id
        submission_id, original_grade = submission.submission_id, submission.grade

    payload = {"student_id": str(ready_id), "class_id": scope["class_id"], "subject_id": scope["subject_id"], "source_period_id": scope["academic_period_id"]}
    params = {"class_id": scope["class_id"], "subject_id": scope["subject_id"], "academic_period_id": scope["academic_period_id"]}
    app.dependency_overrides[get_current_user] = lambda: {"role": "admin"}
    client = TestClient(app)
    try:
        same = client.post(PATH, json=payload)
        assert same.status_code == 200, same.text
        assert same.json()["unchanged"] is True and same.json()["revision"] == initial_revision
        assert same.json()["model_name"] == CORRECTED_MODEL_NAME
        current = client.get(PATH, params=params)
        assert current.status_code == 200, current.text
        assert current.json()["total"] == 9
        assert len({row["student_id"] for row in current.json()["items"]}) == 9
        assert all(row["model_version_id"] == corrected.model_version_id for row in current.json()["items"])

        with Session(engine) as db:
            db.get(StudentSubmission, submission_id).grade = original_grade - Decimal("1")
            db.commit()
        changed = client.post(PATH, json=payload)
        assert changed.status_code == 200, changed.text
        assert changed.json()["persisted"] is True and changed.json()["revision"] == initial_revision + 1
        assert changed.json()["model_version_id"] == corrected.model_version_id
        grade = changed.json()["projected_final_term_grade"]
        expected_level = "HIGH_RISK" if grade < 75 else "MODERATE_RISK" if grade < 85 else "NEEDS_MONITORING" if grade < 90 else "LOW_RISK"
        assert changed.json()["intervention_level"] == expected_level
        with Session(engine) as db:
            row = db.get(DevelopmentCurrentTermPrediction, changed.json()["prediction_id"])
            assert row.model_version_id == corrected.model_version_id and row.revision == initial_revision + 1
            assert row.evidence_snapshot["artifact_sha256"] == corrected.registry_metadata_json["artifact_sha256"]
            assert row.evidence_snapshot["feature_schema_sha256"] == corrected.registry_metadata_json["feature_schema_sha256"]
            assert len(row.evidence_snapshot["model_features"]) == 31
            assert row.risk_score is None
        assert client.post(PATH, json=payload).json()["unchanged"] is True

        blocked = client.post(PATH, json={**payload, "student_id": str(insufficient_id)})
        assert blocked.status_code == 200 and blocked.json()["prediction_status"] == "INSUFFICIENT_EVIDENCE"
        assert blocked.json()["persisted"] is False

        with Session(engine) as db:
            db.get(AcademicPeriod, period.academic_period_id).is_active = False
            db.commit()
        try:
            response = client.post(PATH, json=payload)
            assert response.status_code == 200 and response.json()["prediction_status"] == "PERIOD_NOT_ACTIVE"
        finally:
            with Session(engine) as db:
                db.get(AcademicPeriod, period.academic_period_id).is_active = True
                db.commit()

        with Session(engine) as db:
            final = StudentPeriodGrade(student_id=ready_id, class_id=scope["class_id"], subject_id=scope["subject_id"], academic_period_id=scope["academic_period_id"], final_period_grade=Decimal("90"), is_finalized=True)
            db.add(final)
            db.commit()
            final_id = final.period_grade_id
        try:
            response = client.post(PATH, json=payload)
            assert response.status_code == 200 and response.json()["prediction_status"] == "FINALIZED_GRADE_EXISTS"
        finally:
            with Session(engine) as db:
                db.delete(db.get(StudentPeriodGrade, final_id))
                db.commit()

        with Session(engine) as db:
            db.get(Subject, subject.subject_id).subject_codename = "UNSUPPORTED_DEMO"
            db.commit()
        try:
            response = client.post(PATH, json=payload)
            assert response.status_code == 200 and response.json()["prediction_status"] == "UNSUPPORTED_DEVELOPMENT_DOMAIN"
        finally:
            with Session(engine) as db:
                db.get(Subject, subject.subject_id).subject_codename = "MATHEMATICS"
                db.commit()

        for grade_level in (11, 12):
            with Session(engine) as db:
                db.get(AcademicLevel, level.academic_level_id).grade_level = grade_level
                db.commit()
            try:
                response = client.post(PATH, json=payload)
                assert response.status_code == 200 and "UNSUPPORTED_GRADE_SCOPE" in response.json()["reason_codes"]
            finally:
                with Session(engine) as db:
                    db.get(AcademicLevel, level.academic_level_id).grade_level = 9
                    db.commit()

        monkeypatch.setattr(settings, "development_current_term_model_name", "unknown_demo_model")
        assert client.post(PATH, json=payload).status_code == 503
        monkeypatch.setattr(settings, "development_current_term_model_name", LEGACY_MODEL_NAME)
        rollback = client.post(PATH, json=payload)
        assert rollback.status_code == 200 and rollback.json()["model_version_id"] == legacy.model_version_id
        assert client.get(PATH, params=params).json()["total"] == 1
        monkeypatch.setattr(settings, "development_current_term_model_name", CORRECTED_MODEL_NAME)
        assert client.get(PATH, params=params).json()["total"] == 9
        assert client.get(PATH, params={**params, "model_version_id": legacy.model_version_id}).json()["total"] == 1
        assert client.post(PATH, json=payload).json()["unchanged"] is True

        app.dependency_overrides[get_current_user] = lambda: {"role": "teacher", "sub": str(teacher_id)}
        assert client.get(PATH, params=params).json()["total"] == 9
        assert client.post(PATH, json=payload).status_code == 403
        app.dependency_overrides[get_current_user] = lambda: {"role": "teacher", "sub": "00000000-0000-0000-0000-000000000000"}
        assert client.get(PATH, params=params).status_code == 403
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
