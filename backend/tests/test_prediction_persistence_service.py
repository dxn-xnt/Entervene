from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.services.prediction.PredictionPersistenceService as persistence_service
import app.services.prediction.PredictionEvidenceSnapshotService as snapshot_service
from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.prediction.PredictionPersistenceService import (
    score_and_persist_prediction,
    validate_required_identifiers,
)


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    AcademicPeriod.__table__,
    Class.__table__,
    Subject.__table__,
    AIModelVersion.__table__,
    AIPrediction.__table__,
    AIPredictionFeature.__table__,
]


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    lrn_check = next(
        (c for c in Student.__table__.constraints if isinstance(c, CheckConstraint) and c.name == "lrn_check"),
        None,
    )
    if lrn_check and lrn_check in Student.__table__.constraints:
        Student.__table__.constraints.remove(lrn_check)
    try:
        Base.metadata.create_all(bind=engine)
    finally:
        if lrn_check and lrn_check not in Student.__table__.constraints:
            Student.__table__.append_constraint(lrn_check)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture
def seeded(db):
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
        first_name="Synthetic",
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
    db.add_all([student, source_period, target_period, class_, subject, model_version])
    db.commit()
    return {
        "student": student,
        "class": class_,
        "subject": subject,
        "source_period": source_period,
        "target_period": target_period,
        "model_version": model_version,
    }


def fake_scoring_result(**overrides):
    result = {
        "model_version_id": 1,
        "predicted_period_grade": 87.81,
        "risk_level": "NEEDS_MONITORING",
        "risk_score": 37.29,
        "data_status": "SUFFICIENT",
        "reasons": ["Predicted next-period grade is between 82 and 88."],
        "recommended_action": "Continue monitoring and review recent learning activities.",
        "triggered_rules": ["predicted_grade_82_to_87"],
        "feature_columns_used": [
            "grade_level",
            "quarterly_assessment_percent",
            "source_period_grade",
            "assessment_completion_rate",
            "grade_trend_vs_previous_period",
            "subject_SCIENCE",
        ],
    }
    result.update(overrides)
    return result


def prediction_request(seeded, **feature_overrides):
    features = {
        "grade_level": 8,
        "quarterly_assessment_percent": 84.0,
        "source_period_grade": 87.0,
        "assessment_completion_rate": 0.95,
        "grade_trend_vs_previous_period": -2.0,
        "subject_SCIENCE": 1,
        "missing_activity_count": 0,
        "late_submission_count": 0,
        "data_coverage_ratio": 0.95,
    }
    features.update(feature_overrides)
    return {
        "student_id": str(seeded["student"].student_id),
        "class_id": seeded["class"].class_id,
        "subject_id": seeded["subject"].subject_id,
        "source_period_id": seeded["source_period"].academic_period_id,
        "target_period_id": seeded["target_period"].academic_period_id,
        "features": features,
    }


def patch_scoring(monkeypatch, result=None):
    monkeypatch.setattr(
        persistence_service,
        "score_student_prediction",
        lambda db, features, model_name="entervene_next_period_grade_rf": result or fake_scoring_result(),
    )


def audited_build(features):
    return {
        "ready": True,
        "readiness_level": "STRONG",
        "features": features,
        "readiness_reasons": [],
        "evidence_summary": {
            "completion_state": "AVAILABLE", "coverage_state": "AVAILABLE",
            "late_state": "AVAILABLE", "attendance_state": "AVAILABLE",
            "completed_count": 1, "graded_count": 1, "expected_count": 1,
            "attendance_total_days": 1, "generation_cutoff_date": "2025-08-31",
            "source_grade_provenance": "OFFICIAL",
            "source_record_ids": {"source_period_grade": [1]},
            "captured_source_values": {"source_period_grade": {"final_period_grade": 87}},
            "learning_participation": {"formula_version": "behavioral-engagement-v1", "resulting_score": 90},
        },
    }


def traced_scoring_result():
    return fake_scoring_result(execution_trace={
        "grade_model": {
            "status": "EXECUTED", "model_version_id": 1,
            "artifact_sha256": "test-digest",
            "ordered_feature_names": ["grade_level", "source_period_grade"],
            "ordered_model_values": [8.0, 87.0],
        },
        "model_transformations": [],
        "risk_engine": {"status": "EXECUTED", "ruleset_version": "risk-default-rules-v1", "triggered_rules": []},
    })


def test_required_identifiers_are_validated():
    with pytest.raises(ValueError, match="student_id"):
        validate_required_identifiers({"features": {}})


def test_missing_referenced_record_fails_clearly(db, seeded, monkeypatch):
    patch_scoring(monkeypatch)
    request = prediction_request(seeded)
    request["student_id"] = str(uuid.uuid4())

    with pytest.raises(ValueError, match="student"):
        score_and_persist_prediction(db, request)


def test_scoring_service_result_is_saved_into_ai_prediction(db, seeded, monkeypatch):
    patch_scoring(monkeypatch)

    result = score_and_persist_prediction(db, prediction_request(seeded))

    prediction = db.get(AIPrediction, result["prediction_id"])
    assert prediction is not None
    assert float(prediction.predicted_period_grade) == pytest.approx(87.81)
    assert prediction.risk_level == "NEEDS_MONITORING"
    assert result["risk_score"] == pytest.approx(37.29)


def test_feature_rows_are_saved_into_ai_prediction_feature(db, seeded, monkeypatch):
    patch_scoring(monkeypatch)

    result = score_and_persist_prediction(db, prediction_request(seeded))

    rows = db.query(AIPredictionFeature).filter_by(prediction_id=result["prediction_id"]).all()
    names = {row.feature_name for row in rows}
    assert "grade_level" in names
    assert "quarterly_assessment_percent" in names
    assert result["feature_rows_created"] == len(rows)


def test_student_names_and_lrns_are_not_saved_as_feature_rows(db, seeded, monkeypatch):
    patch_scoring(monkeypatch)
    request = prediction_request(
        seeded,
        student_lrn="100000000001",
        synthetic_full_name="Synthetic Learner",
        learner_name="Synthetic Learner",
    )

    result = score_and_persist_prediction(db, request)

    names = {
        row.feature_name
        for row in db.query(AIPredictionFeature).filter_by(prediction_id=result["prediction_id"])
    }
    assert "student_lrn" not in names
    assert "synthetic_full_name" not in names
    assert "learner_name" not in names


def test_runtime_only_risk_fields_can_be_saved_as_feature_evidence(db, seeded, monkeypatch):
    patch_scoring(monkeypatch)
    request = prediction_request(seeded, missing_activity_count=2, late_submission_count=3)

    result = score_and_persist_prediction(db, request)

    rows = db.query(AIPredictionFeature).filter_by(prediction_id=result["prediction_id"]).all()
    values = {row.feature_name: row.feature_value for row in rows}
    assert values["missing_activity_count"] == 2
    assert values["late_submission_count"] == 3
    assert "data_coverage_ratio" in values


def test_audited_prediction_persists_immutable_execution_snapshot(db, seeded, monkeypatch):
    patch_scoring(monkeypatch, traced_scoring_result())
    request = prediction_request(seeded)
    result = score_and_persist_prediction(
        db, request, evidence_context=audited_build(request["features"]), generation_request_id="audit-one"
    )

    prediction = db.get(AIPrediction, result["prediction_id"])
    snapshot = prediction.evidence_snapshot
    assert snapshot["snapshot_version"] == "prediction-evidence-v1"
    assert snapshot["observed_evidence"]["source_period_grade"]["raw_observed_value"] == 87.0
    assert snapshot["grade_model"]["ordered_model_values"] == [8.0, 87.0]
    assert snapshot["risk_engine"]["status"] == "EXECUTED"

    frozen = snapshot
    seeded["source_period"].end_date = date(2025, 8, 30)
    db.commit()
    assert db.get(AIPrediction, result["prediction_id"]).evidence_snapshot == frozen


def test_generation_request_id_reuses_same_audited_snapshot_without_rescoring(db, seeded, monkeypatch):
    calls = []
    result = traced_scoring_result()
    monkeypatch.setattr(persistence_service, "score_student_prediction", lambda *args, **kwargs: calls.append(1) or result)
    request = prediction_request(seeded)
    built = audited_build(request["features"])
    first = score_and_persist_prediction(db, request, evidence_context=built, generation_request_id="same-request")
    saved_snapshot = db.get(AIPrediction, first["prediction_id"]).evidence_snapshot
    request["features"]["source_period_grade"] = 12
    second = score_and_persist_prediction(db, request, evidence_context=built, generation_request_id="same-request")

    assert first["prediction_id"] == second["prediction_id"]
    assert len(calls) == 1
    assert db.get(AIPrediction, first["prediction_id"]).evidence_snapshot == saved_snapshot


def test_generation_request_id_rejects_different_scope(db, seeded, monkeypatch):
    patch_scoring(monkeypatch, traced_scoring_result())
    request = prediction_request(seeded)
    score_and_persist_prediction(db, request, evidence_context=audited_build(request["features"]), generation_request_id="conflict")
    request["target_period_id"] = request["source_period_id"]

    with pytest.raises(ValueError, match="different request fingerprint"):
        score_and_persist_prediction(db, request, evidence_context=audited_build(request["features"]), generation_request_id="conflict")


def test_snapshot_failure_rolls_back_prediction_and_feature_rows(db, seeded, monkeypatch):
    patch_scoring(monkeypatch, traced_scoring_result())
    monkeypatch.setattr(snapshot_service, "build_evidence_snapshot", lambda *_, **__: (_ for _ in ()).throw(RuntimeError("snapshot failure")))
    request = prediction_request(seeded)

    with pytest.raises(RuntimeError, match="snapshot failure"):
        score_and_persist_prediction(db, request, evidence_context=audited_build(request["features"]))

    assert db.query(AIPrediction).count() == 0
    assert db.query(AIPredictionFeature).count() == 0


def test_snapshot_keeps_zero_observation_and_model_fallback_separate(db, seeded, monkeypatch):
    trace = traced_scoring_result()
    trace["execution_trace"]["model_transformations"] = [{
        "feature": "quarterly_assessment_percent", "model_value": 0.0, "transformation": "NO_DATA_DEFAULT"
    }]
    patch_scoring(monkeypatch, trace)
    request = prediction_request(seeded, source_period_grade=0.0, quarterly_assessment_percent=None)
    built = audited_build(request["features"])
    built["evidence_summary"]["source_grade_provenance"] = "OFFICIAL"
    result = score_and_persist_prediction(db, request, evidence_context=built)
    snapshot = db.get(AIPrediction, result["prediction_id"]).evidence_snapshot

    assert snapshot["observed_evidence"]["source_period_grade"]["raw_observed_value"] == 0.0
    assert snapshot["observed_evidence"]["quarterly_assessment_percent"]["raw_observed_value"] is None
    assert snapshot["model_transformations"] == trace["execution_trace"]["model_transformations"]
    assert snapshot["observed_evidence"]["assessment_completion_rate"]["unit"] == "PERCENTAGE"
    assert snapshot["observed_evidence"]["assessment_completion_rate"]["scale"] == "ZERO_TO_ONE"


def test_transaction_rolls_back_if_feature_insert_fails(db, seeded, monkeypatch):
    patch_scoring(monkeypatch)

    def bad_feature_rows(prediction, features, scoring_result):
        return [
            AIPredictionFeature(
                prediction=prediction,
                feature_name="bad",
                feature_value=1,
                direction="NOT_ALLOWED",
                explanation_method="RULE",
            )
        ]

    monkeypatch.setattr(persistence_service, "build_prediction_feature_rows", bad_feature_rows)
    with pytest.raises(Exception):
        score_and_persist_prediction(db, prediction_request(seeded))

    assert db.query(AIPrediction).count() == 0
    assert db.query(AIPredictionFeature).count() == 0


def test_duplicate_prediction_handling_returns_existing_row(db, seeded, monkeypatch):
    patch_scoring(monkeypatch)
    first = score_and_persist_prediction(db, prediction_request(seeded))
    second = score_and_persist_prediction(db, prediction_request(seeded))

    assert second["duplicate"] is True
    assert second["prediction_id"] == first["prediction_id"]
    assert db.query(AIPrediction).count() == 1


def test_replace_existing_updates_prediction_safely(db, seeded, monkeypatch):
    patch_scoring(monkeypatch)
    first = score_and_persist_prediction(db, prediction_request(seeded))
    patch_scoring(
        monkeypatch,
        fake_scoring_result(
            predicted_period_grade=80.5,
            risk_level="MODERATE_RISK",
            risk_score=62.0,
            triggered_rules=["predicted_grade_75_to_81"],
        ),
    )

    second = score_and_persist_prediction(db, prediction_request(seeded), replace_existing=True)

    assert second["prediction_id"] == first["prediction_id"]
    assert second["duplicate"] is False
    assert second["predicted_period_grade"] == pytest.approx(80.5)
    assert db.query(AIPrediction).count() == 1
    assert db.get(AIPrediction, first["prediction_id"]).risk_level == "MODERATE_RISK"


def test_returned_result_includes_prediction_summary(db, seeded, monkeypatch):
    patch_scoring(monkeypatch)

    result = score_and_persist_prediction(db, prediction_request(seeded))

    assert result["prediction_id"] is not None
    assert result["predicted_period_grade"] == pytest.approx(87.81)
    assert result["risk_level"] == "NEEDS_MONITORING"
    assert result["risk_score"] == pytest.approx(37.29)
    assert result["feature_rows_created"] > 0
