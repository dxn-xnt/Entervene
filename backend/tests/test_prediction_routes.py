from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.services.prediction.PredictionPersistenceService as persistence_service
import app.api.v1.routes.Predictions as predictions_route
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Predictions import router as predictions_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AssessmentItem import AssessmentItem
from app.models.academic.Class_ import Class
from app.models.academic.StudentAssessmentScore import StudentAssessmentScore
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.models.ai.PredictionOutcome import PredictionOutcome
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    AcademicPeriod.__table__,
    Class.__table__,
    Subject.__table__,
    AssessmentItem.__table__,
    StudentAssessmentScore.__table__,
    Classwork.__table__,
    ClassworkAssignment.__table__,
    StudentSubmission.__table__,
    StudentPeriodGrade.__table__,
    AIModelVersion.__table__,
    AIPrediction.__table__,
    AIPredictionFeature.__table__,
    PredictionOutcome.__table__,
]


@pytest.fixture
def prediction_api_context():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    lrn_check = next(
        constraint
        for constraint in Student.__table__.constraints
        if isinstance(constraint, CheckConstraint) and constraint.name == "lrn_check"
    )
    Student.__table__.constraints.remove(lrn_check)
    Base.metadata.create_all(bind=engine, tables=TABLES)
    Student.__table__.append_constraint(lrn_check)
    db = sessionmaker(bind=engine)()

    year = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 8", grade_level=8)
    db.add_all([year, level])
    db.flush()
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000001",
        first_name="Prediction",
        last_name="Learner",
        academic_level_id=level.academic_level_id,
    )
    other_student = Student(
        student_id=uuid.uuid4(),
        student_lrn="100000000002",
        first_name="Other",
        last_name="Learner",
        academic_level_id=level.academic_level_id,
    )
    source_period = AcademicPeriod(
        period_name="Quarter 1",
        period_type="QUARTER",
        period_sequence=1,
        total_periods_in_year=4,
        period_progress_ratio=0.25,
        start_date=date(2025, 6, 1),
        end_date=date(2025, 8, 31),
        academic_year_id=year.academic_year_id,
    )
    target_period = AcademicPeriod(
        period_name="Quarter 2",
        period_type="QUARTER",
        period_sequence=2,
        total_periods_in_year=4,
        period_progress_ratio=0.5,
        start_date=date(2025, 9, 1),
        end_date=date(2025, 11, 30),
        academic_year_id=year.academic_year_id,
    )
    later_target_period = AcademicPeriod(
        period_name="Quarter 3",
        period_type="QUARTER",
        period_sequence=3,
        total_periods_in_year=4,
        period_progress_ratio=0.75,
        start_date=date(2025, 12, 1),
        end_date=date(2026, 1, 31),
        academic_year_id=year.academic_year_id,
    )
    class_ = Class(
        section_name="Einstein",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    subject = Subject(subject_name="Science", academic_level_id=level.academic_level_id)
    model_version = AIModelVersion(
        model_version_id=1,
        model_name="entervene_next_period_grade_rf",
        model_type="REGRESSOR",
        algorithm="RandomForestRegressor",
        artifact_path="data/models/model.joblib",
        is_active=True,
    )
    db.add_all([
        student,
        other_student,
        source_period,
        target_period,
        later_target_period,
        class_,
        subject,
        model_version,
    ])
    db.commit()

    identity = {"sub": str(uuid.uuid4()), "role": "admin"}
    app = FastAPI()
    app.include_router(predictions_router, prefix="/api/v1/predictions")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: identity
    with TestClient(app, raise_server_exceptions=False) as client:
        yield {
            "client": client,
            "db": db,
            "identity": identity,
            "student": student,
            "other_student": other_student,
            "class": class_,
            "subject": subject,
            "source_period": source_period,
            "target_period": target_period,
            "later_target_period": later_target_period,
            "model_version": model_version,
        }
    db.close()
    Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
    engine.dispose()


def fake_scoring_result(**overrides):
    result = {
        "model_version_id": 1,
        "model_name": "entervene_next_period_grade_rf",
        "model_type": "REGRESSOR",
        "algorithm": "RandomForestRegressor",
        "predicted_period_grade": 87.81,
        "risk_level": "NEEDS_MONITORING",
        "risk_score": 37.29,
        "data_status": "SUFFICIENT",
        "reasons": ["Predicted next-period grade is between 82 and 88."],
        "recommended_action": "Continue monitoring and review recent learning activities.",
        "triggered_rules": ["predicted_grade_82_to_87"],
        "feature_columns_used": [
            "grade_level",
            "periodical_assessment_percent",
            "source_period_grade",
            "assessment_completion_rate",
            "grade_trend_vs_previous_period",
            "subject_SCIENCE",
        ],
        "warnings": [],
    }
    result.update(overrides)
    return result


def prediction_payload(context, **overrides):
    features = {
        "grade_level": 8,
        "periodical_assessment_percent": 84.0,
        "source_period_grade": 87.0,
        "assessment_completion_rate": 0.95,
        "grade_trend_vs_previous_period": -2.0,
        "subject_SCIENCE": 1,
        "missing_activity_count": 0,
        "late_submission_count": 0,
        "data_coverage_ratio": 0.95,
        "has_previous_period": True,
    }
    payload = {
        "student_id": str(context["student"].student_id),
        "class_id": context["class"].class_id,
        "subject_id": context["subject"].subject_id,
        "source_period_id": context["source_period"].academic_period_id,
        "target_period_id": context["target_period"].academic_period_id,
        "features": features,
    }
    payload.update(overrides)
    return payload


def patch_scoring(monkeypatch, result=None):
    monkeypatch.setattr(
        predictions_route,
        "score_student_prediction",
        lambda db, features, model_name="entervene_next_period_grade_rf": result or fake_scoring_result(),
    )
    monkeypatch.setattr(
        persistence_service,
        "score_student_prediction",
        lambda db, features, model_name="entervene_next_period_grade_rf": result or fake_scoring_result(),
    )


def add_prediction(context, **overrides):
    values = {
        "student_id": context["student"].student_id,
        "class_id": context["class"].class_id,
        "subject_id": context["subject"].subject_id,
        "source_period_id": context["source_period"].academic_period_id,
        "target_period_id": context["target_period"].academic_period_id,
        "predicted_period_grade": 87.81,
        "risk_score": 37.29,
        "risk_level": "NEEDS_MONITORING",
        "data_status": "SUFFICIENT",
        "model_version_id": context["model_version"].model_version_id,
        "generated_at": datetime.now(timezone.utc),
    }
    values.update(overrides)
    prediction = AIPrediction(**values)
    context["db"].add(prediction)
    context["db"].flush()
    return prediction


def add_period_grade(context, grade=86):
    row = StudentPeriodGrade(
        student_id=context["student"].student_id,
        class_id=context["class"].class_id,
        subject_id=context["subject"].subject_id,
        academic_period_id=context["source_period"].academic_period_id,
        final_period_grade=grade,
    )
    context["db"].add(row)
    context["db"].commit()
    return row


def add_assessment(context, component, item_number, raw_score=None, max_score=100, status="RECORDED"):
    assessment = AssessmentItem(
        class_id=context["class"].class_id,
        subject_id=context["subject"].subject_id,
        academic_period_id=context["source_period"].academic_period_id,
        component_type=component,
        item_number=item_number,
        max_score=max_score,
    )
    context["db"].add(assessment)
    context["db"].flush()
    if raw_score is not None or status != "MISSING_NOT_ENCODED":
        context["db"].add(
            StudentAssessmentScore(
                assessment_id=assessment.assessment_id,
                student_id=context["student"].student_id,
                raw_score=raw_score,
                score_status=status,
            )
        )
    context["db"].commit()
    return assessment


def seed_ready_record_features(context):
    add_period_grade(context, grade=86)
    add_assessment(context, "WRITTEN_WORK", 1, raw_score=84)
    add_assessment(context, "PERFORMANCE_TASK", 1, raw_score=88)
    add_assessment(context, "PERIODICAL_ASSESSMENT", 1, raw_score=82)


def test_preview_endpoint_calls_scoring_and_returns_risk_fields(prediction_api_context, monkeypatch):
    patch_scoring(monkeypatch)

    response = prediction_api_context["client"].post(
        "/api/v1/predictions/preview",
        json={"features": prediction_payload(prediction_api_context)["features"]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["predicted_period_grade"] == 87.81
    assert body["risk_level"] == "NEEDS_MONITORING"
    assert body["risk_score"] == 37.29
    assert body["triggered_rules"] == ["predicted_grade_82_to_87"]


def test_preview_endpoint_does_not_create_prediction_rows(prediction_api_context, monkeypatch):
    patch_scoring(monkeypatch)

    response = prediction_api_context["client"].post(
        "/api/v1/predictions/preview",
        json={"features": prediction_payload(prediction_api_context)["features"]},
    )

    assert response.status_code == 200
    assert prediction_api_context["db"].query(AIPrediction).count() == 0


def test_save_endpoint_creates_prediction_and_feature_rows(prediction_api_context, monkeypatch):
    patch_scoring(monkeypatch)

    response = prediction_api_context["client"].post(
        "/api/v1/predictions",
        json=prediction_payload(prediction_api_context),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["prediction_id"] is not None
    assert body["predicted_period_grade"] == 87.81
    assert body["feature_rows_created"] > 0
    assert prediction_api_context["db"].query(AIPrediction).count() == 1
    assert prediction_api_context["db"].query(AIPredictionFeature).count() == body["feature_rows_created"]


def test_save_endpoint_duplicate_behavior_returns_existing_prediction(prediction_api_context, monkeypatch):
    patch_scoring(monkeypatch)
    client = prediction_api_context["client"]
    payload = prediction_payload(prediction_api_context)
    first = client.post("/api/v1/predictions", json=payload).json()

    second_response = client.post("/api/v1/predictions", json=payload)

    assert second_response.status_code == 200
    second = second_response.json()
    assert second["duplicate"] is True
    assert second["prediction_id"] == first["prediction_id"]
    assert prediction_api_context["db"].query(AIPrediction).count() == 1


def test_save_endpoint_replace_existing_updates_prediction_evidence(prediction_api_context, monkeypatch):
    patch_scoring(monkeypatch)
    client = prediction_api_context["client"]
    first = client.post("/api/v1/predictions", json=prediction_payload(prediction_api_context)).json()
    patch_scoring(
        monkeypatch,
        fake_scoring_result(
            predicted_period_grade=80.5,
            risk_level="MODERATE_RISK",
            risk_score=62.0,
            triggered_rules=["predicted_grade_75_to_81"],
        ),
    )

    response = client.post(
        "/api/v1/predictions",
        json=prediction_payload(prediction_api_context, replace_existing=True),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["prediction_id"] == first["prediction_id"]
    assert body["duplicate"] is False
    assert body["predicted_period_grade"] == 80.5
    assert prediction_api_context["db"].get(AIPrediction, first["prediction_id"]).risk_level == "MODERATE_RISK"


def test_latest_endpoint_returns_most_recent_matching_prediction(prediction_api_context):
    older = add_prediction(
        prediction_api_context,
        generated_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    newer = add_prediction(
        prediction_api_context,
        target_period_id=prediction_api_context["later_target_period"].academic_period_id,
        predicted_period_grade=89.25,
        risk_level="LOW_RISK",
        risk_score=12.0,
        generated_at=datetime.now(timezone.utc),
    )
    prediction_api_context["db"].commit()

    response = prediction_api_context["client"].get(
        "/api/v1/predictions/latest",
        params={
            "student_id": str(prediction_api_context["student"].student_id),
            "class_id": prediction_api_context["class"].class_id,
            "subject_id": prediction_api_context["subject"].subject_id,
        },
    )

    assert response.status_code == 200
    assert response.json()["prediction_id"] == newer.prediction_id
    assert response.json()["prediction_id"] != older.prediction_id


def test_latest_endpoint_returns_404_when_no_prediction_exists(prediction_api_context):
    response = prediction_api_context["client"].get(
        "/api/v1/predictions/latest",
        params={
            "student_id": str(prediction_api_context["student"].student_id),
            "class_id": prediction_api_context["class"].class_id,
            "subject_id": prediction_api_context["subject"].subject_id,
        },
    )

    assert response.status_code == 404


def test_class_risk_list_endpoint_returns_paginated_items(prediction_api_context):
    add_prediction(prediction_api_context)
    add_prediction(
        prediction_api_context,
        student_id=prediction_api_context["other_student"].student_id,
        predicted_period_grade=74.0,
        risk_level="HIGH_RISK",
        risk_score=88.0,
    )
    prediction_api_context["db"].commit()

    response = prediction_api_context["client"].get(
        f"/api/v1/predictions/classes/{prediction_api_context['class'].class_id}/risks",
        params={"limit": 1, "offset": 0},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert body["limit"] == 1
    assert len(body["items"]) == 1


def test_class_risk_list_endpoint_supports_risk_level_filter(prediction_api_context):
    add_prediction(prediction_api_context, risk_level="LOW_RISK", risk_score=10.0)
    high = add_prediction(
        prediction_api_context,
        student_id=prediction_api_context["other_student"].student_id,
        predicted_period_grade=74.0,
        risk_level="HIGH_RISK",
        risk_score=88.0,
    )
    prediction_api_context["db"].commit()

    response = prediction_api_context["client"].get(
        f"/api/v1/predictions/classes/{prediction_api_context['class'].class_id}/risks",
        params={"risk_level": "HIGH_RISK"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["prediction_id"] == high.prediction_id
    assert body["items"][0]["risk_level"] == "HIGH_RISK"


def test_feature_endpoint_returns_saved_feature_rows(prediction_api_context):
    prediction = add_prediction(prediction_api_context)
    prediction_api_context["db"].add_all([
        AIPredictionFeature(
            prediction=prediction,
            feature_name="source_period_grade",
            feature_value=87,
            direction="NEUTRAL",
            feature_rank=1,
            explanation_method="RULE",
        ),
        AIPredictionFeature(
            prediction=prediction,
            feature_name="assessment_completion_rate",
            feature_value=0.95,
            direction="NEUTRAL",
            feature_rank=2,
            explanation_method="RULE",
        ),
    ])
    prediction_api_context["db"].commit()

    response = prediction_api_context["client"].get(f"/api/v1/predictions/{prediction.prediction_id}/features")

    assert response.status_code == 200
    body = response.json()
    assert body["prediction_id"] == prediction.prediction_id
    assert [feature["feature_name"] for feature in body["features"]] == [
        "source_period_grade",
        "assessment_completion_rate",
    ]


def test_outcome_evaluate_endpoint_creates_outcome(prediction_api_context):
    prediction = add_prediction(prediction_api_context, predicted_period_grade=82.5)
    prediction_api_context["db"].commit()

    response = prediction_api_context["client"].post(
        f"/api/v1/predictions/{prediction.prediction_id}/outcome/evaluate",
        json={"actual_period_grade": 86.5, "passing_grade": 75},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["prediction_id"] == prediction.prediction_id
    assert body["outcome_id"] is not None
    assert body["actual_period_grade"] == 86.5
    assert body["predicted_period_grade"] == 82.5
    assert body["outcome_status"] == "EVALUATED"
    assert body["evaluated_at"] is not None
    assert prediction_api_context["db"].query(PredictionOutcome).count() == 1


def test_outcome_evaluate_endpoint_updates_existing_outcome(prediction_api_context):
    prediction = add_prediction(prediction_api_context, predicted_period_grade=82.5)
    prediction_api_context["db"].commit()
    client = prediction_api_context["client"]
    first = client.post(
        f"/api/v1/predictions/{prediction.prediction_id}/outcome/evaluate",
        json={"actual_period_grade": 86.5, "passing_grade": 75},
    ).json()

    second_response = client.post(
        f"/api/v1/predictions/{prediction.prediction_id}/outcome/evaluate",
        json={"actual_period_grade": 90.0, "passing_grade": 75},
    )

    assert second_response.status_code == 200
    second = second_response.json()
    assert second["outcome_id"] == first["outcome_id"]
    assert second["actual_period_grade"] == 90.0
    assert prediction_api_context["db"].query(PredictionOutcome).count() == 1


def test_outcome_evaluate_endpoint_returns_404_for_missing_prediction(prediction_api_context):
    response = prediction_api_context["client"].post(
        "/api/v1/predictions/99999/outcome/evaluate",
        json={"actual_period_grade": 86.5, "passing_grade": 75},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Prediction not found."
    assert prediction_api_context["db"].query(PredictionOutcome).count() == 0


def test_outcome_evaluate_endpoint_returns_error_values(prediction_api_context):
    prediction = add_prediction(prediction_api_context, predicted_period_grade=82.5)
    prediction_api_context["db"].commit()

    response = prediction_api_context["client"].post(
        f"/api/v1/predictions/{prediction.prediction_id}/outcome/evaluate",
        json={"actual_period_grade": 78.0, "passing_grade": 75},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["prediction_error"] == -4.5
    assert body["absolute_error"] == 4.5


def test_outcome_evaluate_endpoint_marks_actual_passed_true(prediction_api_context):
    prediction = add_prediction(prediction_api_context, predicted_period_grade=82.5)
    prediction_api_context["db"].commit()

    response = prediction_api_context["client"].post(
        f"/api/v1/predictions/{prediction.prediction_id}/outcome/evaluate",
        json={"actual_period_grade": 75.0, "passing_grade": 75},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["actual_passed"] is True
    assert body["actual_risk_label"] == "LOW_RISK"


def test_outcome_evaluate_endpoint_marks_actual_passed_false(prediction_api_context):
    prediction = add_prediction(prediction_api_context, predicted_period_grade=82.5)
    prediction_api_context["db"].commit()

    response = prediction_api_context["client"].post(
        f"/api/v1/predictions/{prediction.prediction_id}/outcome/evaluate",
        json={"actual_period_grade": 74.99, "passing_grade": 75},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["actual_passed"] is False
    assert body["actual_risk_label"] == "HIGH_RISK"


def test_prediction_endpoints_reject_unauthenticated_access(prediction_api_context):
    app = FastAPI()
    app.include_router(predictions_router, prefix="/api/v1/predictions")
    app.dependency_overrides[get_db] = lambda: prediction_api_context["db"]
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post("/api/v1/predictions/preview", json={"features": {}})

    assert response.status_code == 401


def test_prediction_responses_do_not_return_classifier_fields(prediction_api_context, monkeypatch):
    patch_scoring(monkeypatch)

    response = prediction_api_context["client"].post(
        "/api/v1/predictions/preview",
        json={"features": prediction_payload(prediction_api_context)["features"]},
    )

    assert response.status_code == 200
    body = response.json()
    assert "at_risk_probability" not in body
    assert "is_at_risk" not in body
    assert "classification" not in body


def test_build_features_endpoint_returns_computed_features_and_evidence(prediction_api_context):
    seed_ready_record_features(prediction_api_context)

    response = prediction_api_context["client"].post(
        "/api/v1/predictions/build-features",
        json={
            "student_id": str(prediction_api_context["student"].student_id),
            "class_id": prediction_api_context["class"].class_id,
            "subject_id": prediction_api_context["subject"].subject_id,
            "source_period_id": prediction_api_context["source_period"].academic_period_id,
            "target_period_id": prediction_api_context["target_period"].academic_period_id,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is True
    assert body["features"]["source_period_grade"] == 86.0
    assert body["features"]["written_work_percent"] == 84.0
    assert body["features"]["performance_task_percent"] == 88.0
    assert body["features"]["periodical_assessment_percent"] == 82.0
    assert body["evidence_summary"]["expected_assessment_count"] == 3


def test_from_records_preview_returns_insufficient_without_calling_model(prediction_api_context, monkeypatch):
    def fail_scoring(*args, **kwargs):
        raise AssertionError("scoring should not be called")

    monkeypatch.setattr(predictions_route, "score_student_prediction", fail_scoring)
    add_assessment(prediction_api_context, "WRITTEN_WORK", 1, raw_score=None, status="MISSING_NOT_ENCODED")

    response = prediction_api_context["client"].post(
        "/api/v1/predictions/from-records/preview",
        json={
            "student_id": str(prediction_api_context["student"].student_id),
            "class_id": prediction_api_context["class"].class_id,
            "subject_id": prediction_api_context["subject"].subject_id,
            "source_period_id": prediction_api_context["source_period"].academic_period_id,
            "target_period_id": prediction_api_context["target_period"].academic_period_id,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is False
    assert body["risk_level"] == "INSUFFICIENT_DATA"
    assert body["predicted_period_grade"] is None
    assert "insufficient_prediction_readiness" in body["triggered_rules"]


def test_from_records_preview_calls_scoring_when_ready(prediction_api_context, monkeypatch):
    seed_ready_record_features(prediction_api_context)
    captured = {}

    def fake_score(db, features, model_name="entervene_next_period_grade_rf"):
        captured["features"] = features
        return fake_scoring_result(predicted_period_grade=88.5, risk_level="LOW_RISK", risk_score=18.0)

    monkeypatch.setattr(predictions_route, "score_student_prediction", fake_score)

    response = prediction_api_context["client"].post(
        "/api/v1/predictions/from-records/preview",
        json={
            "student_id": str(prediction_api_context["student"].student_id),
            "class_id": prediction_api_context["class"].class_id,
            "subject_id": prediction_api_context["subject"].subject_id,
            "source_period_id": prediction_api_context["source_period"].academic_period_id,
            "target_period_id": prediction_api_context["target_period"].academic_period_id,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is True
    assert body["predicted_period_grade"] == 88.5
    assert captured["features"]["source_period_grade"] == 86.0
    assert captured["features"]["written_work_percent"] == 84.0


def test_from_records_save_does_not_persist_when_not_ready(prediction_api_context, monkeypatch):
    def fail_scoring(*args, **kwargs):
        raise AssertionError("scoring should not be called")

    monkeypatch.setattr(persistence_service, "score_student_prediction", fail_scoring)

    response = prediction_api_context["client"].post(
        "/api/v1/predictions/from-records",
        json={
            "student_id": str(prediction_api_context["student"].student_id),
            "class_id": prediction_api_context["class"].class_id,
            "subject_id": prediction_api_context["subject"].subject_id,
            "source_period_id": prediction_api_context["source_period"].academic_period_id,
            "target_period_id": prediction_api_context["target_period"].academic_period_id,
        },
    )

    assert response.status_code == 200
    assert response.json()["risk_level"] == "INSUFFICIENT_DATA"
    assert prediction_api_context["db"].query(AIPrediction).count() == 0


def test_from_records_save_persists_prediction_when_ready(prediction_api_context, monkeypatch):
    seed_ready_record_features(prediction_api_context)
    patch_scoring(monkeypatch)

    response = prediction_api_context["client"].post(
        "/api/v1/predictions/from-records",
        json={
            "student_id": str(prediction_api_context["student"].student_id),
            "class_id": prediction_api_context["class"].class_id,
            "subject_id": prediction_api_context["subject"].subject_id,
            "source_period_id": prediction_api_context["source_period"].academic_period_id,
            "target_period_id": prediction_api_context["target_period"].academic_period_id,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is True
    assert body["prediction_id"] is not None
    assert body["feature_rows_created"] > 0
    assert prediction_api_context["db"].query(AIPrediction).count() == 1


def test_from_records_response_does_not_return_classifier_fields(prediction_api_context, monkeypatch):
    seed_ready_record_features(prediction_api_context)
    patch_scoring(monkeypatch)

    response = prediction_api_context["client"].post(
        "/api/v1/predictions/from-records/preview",
        json={
            "student_id": str(prediction_api_context["student"].student_id),
            "class_id": prediction_api_context["class"].class_id,
            "subject_id": prediction_api_context["subject"].subject_id,
            "source_period_id": prediction_api_context["source_period"].academic_period_id,
            "target_period_id": prediction_api_context["target_period"].academic_period_id,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert "at_risk_probability" not in body
    assert "is_at_risk" not in body
    assert "probability" not in body
