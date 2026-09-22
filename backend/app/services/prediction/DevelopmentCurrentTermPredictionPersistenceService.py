from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
from typing import Any, Mapping
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.engine import Connectable
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.services.prediction import DevelopmentCurrentTermPredictionService as prediction_service
from app.services.prediction import DevelopmentCurrentTermRiskService as intervention_service
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from app.services.prediction.CurrentPeriodFeatureBuilderService import build_current_period_features_from_records
from app.services.prediction.PredictionGenerationTransaction import run_prediction_generation_transaction


EVIDENCE_SNAPSHOT_VERSION = "CURRENT_TERM_V3_EVIDENCE_V1"
MODEL_TARGET_COLUMN = "target_final_period_grade"


def _digest_json(value: dict[str, Any]) -> str:
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _require_development_model(db: Session, model_version_id: int | None) -> AIModelVersion:
    if model_version_id is None:
        raise ValueError("A model_version_id is required for development current-term persistence.")
    version = db.get(AIModelVersion, model_version_id)
    if version is None:
        raise ValueError("The development model version was not found.")
    if (
        version.model_name != scorer.MODEL_NAME
        or version.model_type != "REGRESSOR"
        or version.model_purpose != ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value
        or version.target_column != MODEL_TARGET_COLUMN
        or version.lifecycle_status != "DEVELOPMENT"
        or version.is_active
        or version.production_validated
        or version.independent_three_term_validation
    ):
        raise ValueError("The model version does not match the inactive development V3 contract.")

    metadata = version.registry_metadata_json or {}
    if (
        set(metadata.get("supported_subjects") or []) != prediction_service.SUPPORTED_SUBJECTS
        or set(metadata.get("supported_weight_patterns") or []) != prediction_service.SUPPORTED_WEIGHT_PATTERNS
        or metadata.get("period_semantics") != "SOURCE_EQUALS_TARGET_SAME_TERM"
    ):
        raise ValueError("The model version's effective development domain does not match Task 3H.")
    schema = scorer.load_development_current_term_schema()
    if version.feature_schema_json != schema or metadata.get("feature_schema_sha256") != _digest_json(schema):
        raise ValueError("The model version's feature schema does not match the V3 scorer.")
    artifact = (Path(__file__).resolve().parents[3] / version.artifact_path).resolve()
    if artifact != scorer.MODEL_PATH.resolve() or not artifact.is_file():
        raise ValueError("The model version's artifact path does not match the V3 scorer.")
    if metadata.get("artifact_sha256") != sha256(artifact.read_bytes()).hexdigest():
        raise ValueError("The model version's artifact hash does not match the V3 scorer.")
    return version


def _persist_successful_result(
    db: Session,
    *,
    model_version: AIModelVersion,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    period_id: int,
    cutoff_at: datetime,
    prediction: dict[str, Any],
    intervention: dict[str, Any],
) -> dict[str, Any]:
    if prediction["status"] != prediction_service.STATUS_DEVELOPMENT_PREDICTION_AVAILABLE:
        raise ValueError("Only successful development predictions may be persisted.")
    if intervention["intervention_level"] == intervention_service.INTERVENTION_NOT_ASSESSED:
        raise ValueError("A grade-derived intervention assessment is required.")
    if (
        prediction["model_name"] != model_version.model_name
        or prediction["prediction_purpose"] != model_version.model_purpose
        or prediction["model_development_status"] != "DEVELOPMENT_ONLY"
        or prediction["source_period_id"] != period_id
        or prediction["target_period_id"] != period_id
        or not prediction["readiness_result"].get("ready")
        or not prediction["domain_result"].get("supported")
    ):
        raise ValueError("The prediction result does not match the development model and same-term scope.")
    expected_intervention = intervention_service.assess_development_current_term_intervention(prediction)
    if any(
        intervention.get(field) != expected_intervention[field]
        for field in ("prediction_status", "projected_final_term_grade", "intervention_level", "intervention_basis", "triggered_reasons")
    ):
        raise ValueError("The intervention result does not match the projected grade rules.")
    if db.query(StudentPeriodGrade).filter(
        StudentPeriodGrade.student_id == student_id,
        StudentPeriodGrade.class_id == class_id,
        StudentPeriodGrade.subject_id == subject_id,
        StudentPeriodGrade.academic_period_id == period_id,
        StudentPeriodGrade.is_finalized.is_(True),
        StudentPeriodGrade.final_period_grade.isnot(None),
    ).first() is not None:
        raise ValueError("A finalized same-term grade exists; development prediction was not persisted.")

    built = build_current_period_features_from_records(
        db, student_id, class_id, subject_id, period_id, cutoff_at=cutoff_at,
    )
    if not built["ready"]:
        raise ValueError("Current-term evidence is no longer ready for persistence.")
    features = built["features"]
    contract = scorer.compare_feature_contract(features)
    if contract["missing_features"] or contract["unexpected_features"] or contract["type_mismatches"]:
        raise ValueError("Current-term features no longer match the V3 schema.")
    if (
        features["subject"] != prediction["domain_result"]["subject"]
        or prediction_service._weight_pattern(features) != prediction["domain_result"]["weight_pattern"]
    ):
        raise ValueError("Current-term domain changed during prediction generation.")

    columns = scorer.required_feature_columns(model_version.feature_schema_json)
    if len(columns) != 31:
        raise ValueError("The V3 feature schema must contain exactly 31 ordered values.")
    now = datetime.now(timezone.utc)
    metadata = model_version.registry_metadata_json or {}
    supporting_signals = {}
    for name, value in intervention["supporting_context"]["signals"].items():
        if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool) and math.isfinite(float(value)):
            supporting_signals[name] = float(value)
    snapshot = {
        "snapshot_version": EVIDENCE_SNAPSHOT_VERSION,
        "captured_at": now.isoformat(),
        "generation_cutoff_at": cutoff_at.isoformat(),
        "model_version_id": model_version.model_version_id,
        "prediction_purpose": prediction["prediction_purpose"],
        "source_period_id": period_id,
        "target_period_id": period_id,
        "feature_schema_version": metadata["feature_schema_version"],
        "feature_schema_sha256": metadata["feature_schema_sha256"],
        "artifact_sha256": metadata["artifact_sha256"],
        "training_dataset_version": metadata.get("training_dataset_version"),
        "projected_final_term_grade_raw": prediction["projected_final_term_grade"],
        "normalized_subject": features["subject"],
        "grading_weight_pattern": prediction["domain_result"]["weight_pattern"],
        "readiness": {
            "status": "READY",
            "level": prediction["readiness_result"]["readiness_level"],
            "reason_codes": list(prediction["readiness_reason_codes"]),
        },
        "model_features": [{"name": name, "value": features[name]} for name in columns],
        "intervention_reason_codes": list(intervention["triggered_reasons"]),
        "supporting_context": {
            "role": intervention_service.SUPPORTING_CONTEXT_ROLE,
            "signals": supporting_signals,
        },
    }
    scope = (
        DevelopmentCurrentTermPrediction.student_id == student_id,
        DevelopmentCurrentTermPrediction.class_id == class_id,
        DevelopmentCurrentTermPrediction.subject_id == subject_id,
        DevelopmentCurrentTermPrediction.source_period_id == period_id,
        DevelopmentCurrentTermPrediction.target_period_id == period_id,
        DevelopmentCurrentTermPrediction.model_version_id == model_version.model_version_id,
    )
    revision = (db.query(func.max(DevelopmentCurrentTermPrediction.revision)).filter(*scope).scalar() or 0) + 1
    row = DevelopmentCurrentTermPrediction(
        student_id=student_id,
        class_id=class_id,
        subject_id=subject_id,
        source_period_id=period_id,
        target_period_id=period_id,
        model_version_id=model_version.model_version_id,
        revision=revision,
        predicted_period_grade=Decimal(str(prediction["projected_final_term_grade"])),
        intervention_level=intervention["intervention_level"],
        intervention_basis=intervention["intervention_basis"],
        risk_score=None,
        evidence_snapshot=snapshot,
        generated_at=now,
    )
    db.add(row)
    db.flush()
    return {
        "persisted": True,
        "prediction_id": row.prediction_id,
        "model_version_id": row.model_version_id,
        "revision": row.revision,
        "prediction_status": prediction["status"],
        "projected_final_term_grade": float(row.predicted_period_grade),
        "intervention_level": row.intervention_level,
        "intervention_basis": row.intervention_basis,
        "risk_score": None,
        "readiness_status": "READY",
        "readiness_level": prediction["readiness_result"]["readiness_level"],
        "readiness_reason_codes": list(prediction["readiness_reason_codes"]),
        "source_period_id": period_id,
        "target_period_id": period_id,
        "prediction_purpose": prediction["prediction_purpose"],
        "model_name": model_version.model_name,
        "lifecycle_status": model_version.lifecycle_status,
        "development_status": prediction["model_development_status"],
        "generated_at": now,
    }


def generate_and_persist_development_current_term(
    student_id: UUID,
    class_id: int,
    subject_id: int,
    period_id: int,
    *,
    model_version_id: int | None,
    cutoff_at: datetime | None = None,
    supporting_context: Mapping[str, Any] | None = None,
    bind: Connectable | None = None,
) -> dict[str, Any]:
    cutoff = cutoff_at or datetime.now(timezone.utc)
    scope = {
        "student_id": student_id,
        "class_id": class_id,
        "subject_id": subject_id,
        "source_period_id": period_id,
        "target_period_id": period_id,
    }

    def operation(db: Session) -> dict[str, Any]:
        version = _require_development_model(db, model_version_id)
        prediction = prediction_service.predict_development_current_term(
            db, student_id, class_id, subject_id, period_id, cutoff_at=cutoff,
        )
        intervention = intervention_service.assess_development_current_term_intervention(
            prediction, supporting_context=supporting_context,
        )
        if intervention["intervention_level"] == intervention_service.INTERVENTION_NOT_ASSESSED:
            return {
                "persisted": False,
                "prediction_status": prediction["status"],
                "intervention_level": intervention["intervention_level"],
                "reason_codes": intervention["upstream_reason_codes"],
                "readiness_status": "NOT_READY" if not prediction["readiness_result"].get("ready") else "READY",
                "readiness_level": prediction["readiness_result"].get("readiness_level"),
                "readiness_reason_codes": list(prediction["readiness_reason_codes"]),
                "source_period_id": period_id,
                "target_period_id": period_id,
                "prediction_purpose": prediction["prediction_purpose"],
                "model_name": version.model_name,
                "model_version_id": version.model_version_id,
                "lifecycle_status": version.lifecycle_status,
                "development_status": prediction["model_development_status"],
            }
        return _persist_successful_result(
            db,
            model_version=version,
            student_id=student_id,
            class_id=class_id,
            subject_id=subject_id,
            period_id=period_id,
            cutoff_at=cutoff,
            prediction=prediction,
            intervention=intervention,
        )

    for attempt in range(3):
        try:
            return run_prediction_generation_transaction(scope, scorer.MODEL_NAME, operation, bind=bind)
        except DBAPIError as exc:
            code = getattr(exc.orig, "sqlstate", None) or getattr(exc.orig, "pgcode", None)
            constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
            retryable = code == "40001" or (
                code == "23505" and constraint == "uq_development_current_term_scope_revision"
            )
            if not retryable or attempt == 2:
                raise
    raise AssertionError("Unreachable development prediction retry state.")
