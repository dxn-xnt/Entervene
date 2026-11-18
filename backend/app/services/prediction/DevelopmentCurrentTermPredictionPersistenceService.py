from __future__ import annotations

import math
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Callable, Mapping
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.engine import Connectable
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.core.Config import settings
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.services.prediction import DevelopmentCurrentTermPredictionService as prediction_service
from app.services.prediction import DevelopmentCurrentTermRiskService as intervention_service
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from app.services.prediction.DevelopmentCurrentTermModelResolver import require_current_term_model
from app.services.prediction.CurrentPeriodFeatureBuilderService import build_current_period_features_from_records
from app.services.prediction.PredictionGenerationTransaction import run_prediction_generation_transaction
from app.services.intervention.InterventionCandidateService import sync_intervention_for_persisted_prediction


EVIDENCE_SNAPSHOT_VERSION = "CURRENT_TERM_V3_EVIDENCE_V2"


def _sync_current_term_intervention_if_enabled(
    db: Session,
    model_version: AIModelVersion,
    row: DevelopmentCurrentTermPrediction,
    *,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    period_id: int,
) -> None:
    readiness = row.evidence_snapshot.get("readiness") if isinstance(row.evidence_snapshot, dict) else None
    environment = settings.app_environment.lower()
    development_enabled = (
        environment in {"development", "test"}
        and settings.development_prediction_api_enabled
        and settings.development_current_term_model_name == CORRECTED_MODEL_NAME
        and model_version.lifecycle_status == "DEVELOPMENT"
    )
    production_enabled = (
        environment == "production"
        and model_version.lifecycle_status == "PRODUCTION"
        and model_version.is_active
        and model_version.production_validated
        and model_version.independent_three_term_validation
    )
    if (
        ((model_version.model_name == CORRECTED_MODEL_NAME and development_enabled) or production_enabled)
        and isinstance(readiness, dict)
        and readiness.get("status") == "READY"
    ):
        sync_intervention_for_persisted_prediction(
            db, row,
            student_id=student_id, class_id=class_id, subject_id=subject_id,
            academic_period_id=period_id,
        )


def _require_current_term_model(db: Session, model_version_id: int | None) -> AIModelVersion:
    return require_current_term_model(db, model_version_id)


def _prediction_scope(
    *,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    period_id: int,
    model_version_id: int,
) -> tuple[Any, ...]:
    return (
        DevelopmentCurrentTermPrediction.student_id == student_id,
        DevelopmentCurrentTermPrediction.class_id == class_id,
        DevelopmentCurrentTermPrediction.subject_id == subject_id,
        DevelopmentCurrentTermPrediction.source_period_id == period_id,
        DevelopmentCurrentTermPrediction.target_period_id == period_id,
        DevelopmentCurrentTermPrediction.model_version_id == model_version_id,
    )


def _material_evidence(
    model_version: AIModelVersion,
    features: dict[str, Any],
    examination_presentation: dict[str, Any],
) -> dict[str, Any]:
    columns = scorer.required_feature_columns(model_version.feature_schema_json)
    if len(columns) != 31:
        raise ValueError("The V3 feature schema must contain exactly 31 ordered values.")
    metadata = model_version.registry_metadata_json or {}
    return {
        "model_features": [{"name": name, "value": features[name]} for name in columns],
        "examination_presentation": examination_presentation,
        "feature_schema_sha256": metadata["feature_schema_sha256"],
        "artifact_sha256": metadata["artifact_sha256"],
        "training_dataset_version": metadata.get("training_dataset_version"),
    }


def _same_material_evidence(snapshot: object, material_evidence: dict[str, Any]) -> bool:
    return isinstance(snapshot, dict) and all(
        snapshot.get(name) == value for name, value in material_evidence.items()
    )


def _latest_prediction(db: Session, scope: tuple[Any, ...]) -> DevelopmentCurrentTermPrediction | None:
    return db.query(DevelopmentCurrentTermPrediction).filter(*scope).order_by(
        DevelopmentCurrentTermPrediction.revision.desc()
    ).first()


def _reuse_latest_prediction(
    db: Session,
    *,
    model_version: AIModelVersion,
    latest: DevelopmentCurrentTermPrediction,
    prediction: dict[str, Any],
    student_id: UUID,
    class_id: int,
    subject_id: int,
    period_id: int,
) -> dict[str, Any]:
    _sync_current_term_intervention_if_enabled(
        db, model_version, latest,
        student_id=student_id, class_id=class_id, subject_id=subject_id,
        period_id=period_id,
    )
    snapshot = latest.evidence_snapshot if isinstance(latest.evidence_snapshot, dict) else {}
    return {
        "persisted": False,
        "unchanged": True,
        "prediction_id": latest.prediction_id,
        "model_version_id": latest.model_version_id,
        "revision": latest.revision,
        "prediction_status": prediction["status"],
        "projected_final_term_grade": float(latest.predicted_period_grade),
        "intervention_level": latest.intervention_level,
        "intervention_basis": latest.intervention_basis,
        "risk_score": None,
        "readiness_status": "READY",
        "readiness_level": snapshot.get("readiness", {}).get("level"),
        "readiness_reason_codes": list(snapshot.get("readiness", {}).get("reason_codes") or []),
        "source_period_id": period_id,
        "target_period_id": period_id,
        "prediction_purpose": prediction["prediction_purpose"],
        "model_name": model_version.model_name,
        "lifecycle_status": model_version.lifecycle_status,
        "development_status": prediction["model_development_status"],
        "generated_at": latest.generated_at,
        "is_provisional": snapshot.get("is_provisional", False),
        "validation_status": snapshot.get("validation_status", "VALIDATED_JHS"),
    }


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
    scored_features: dict[str, Any],
    material_evidence: dict[str, Any],
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
    lifecycle_reasons = prediction_service.current_term_lifecycle_reason_codes(
        db,
        class_id=class_id,
        subject_id=subject_id,
        period_id=period_id,
        lock=True,
    )
    if lifecycle_reasons:
        raise ValueError(
            "The current-term academic lifecycle scope changed; development prediction was not persisted "
            f"({', '.join(lifecycle_reasons)})."
        )

    scope_result = prediction_service.resolve_v3_scope(db, student_id, class_id, subject_id)
    if not scope_result["supported"]:
        raise ValueError("The academic scope is no longer supported by V3.")

    built = build_current_period_features_from_records(
        db, student_id, class_id, subject_id, period_id, cutoff_at=cutoff_at,
    )
    if not built["ready"]:
        raise ValueError("Current-term evidence is no longer ready for persistence.")
    features = prediction_service.canonicalize_v3_features(built["features"], scope_result)
    contract = scorer.compare_feature_contract(features, model_version.feature_schema_json)
    if contract["missing_features"] or contract["unexpected_features"] or contract["type_mismatches"]:
        raise ValueError("Current-term features no longer match the V3 schema.")
    if (
        features["subject"] != prediction["domain_result"]["subject"]
        or prediction_service._weight_pattern(features) != prediction["domain_result"]["weight_pattern"]
    ):
        raise ValueError("Current-term domain changed during prediction generation.")
    if features != scored_features:
        raise ValueError("Current-term model features changed between scoring and persistence.")
    features = scored_features
    rebuilt_material_evidence = _material_evidence(
        model_version,
        features,
        built["evidence_summary"]["examination"]["presentation"],
    )
    if rebuilt_material_evidence != material_evidence:
        raise ValueError("Current-term material evidence changed between freshness detection and persistence.")
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
        "projected_final_term_grade_raw": prediction["projected_final_term_grade"],
        "normalized_subject": features["subject"],
        "grading_weight_pattern": prediction["domain_result"]["weight_pattern"],
        "readiness": {
            "status": "READY",
            "level": prediction["readiness_result"]["readiness_level"],
            "reason_codes": list(prediction["readiness_reason_codes"]),
        },
        "intervention_reason_codes": list(intervention["triggered_reasons"]),
        "supporting_context": {
            "role": intervention_service.SUPPORTING_CONTEXT_ROLE,
            "signals": supporting_signals,
        },
        "is_provisional": prediction.get("is_provisional", False),
        "validation_status": prediction.get("validation_status", "VALIDATED_JHS"),
        **material_evidence,
    }
    scope = _prediction_scope(
        student_id=student_id,
        class_id=class_id,
        subject_id=subject_id,
        period_id=period_id,
        model_version_id=model_version.model_version_id,
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
    _sync_current_term_intervention_if_enabled(
        db, model_version, row,
        student_id=student_id, class_id=class_id, subject_id=subject_id,
        period_id=period_id,
    )
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
        "is_provisional": snapshot.get("is_provisional", False),
        "validation_status": snapshot.get("validation_status", "VALIDATED_JHS"),
    }


def generate_and_persist_current_term(
    student_id: UUID,
    class_id: int,
    subject_id: int,
    period_id: int,
    *,
    model_version_id: int | None,
    cutoff_at: datetime | None = None,
    supporting_context: Mapping[str, Any] | None = None,
    bind: Connectable | None = None,
    after_result: Callable[[Session, dict[str, Any]], None] | None = None,
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
        version = _require_current_term_model(db, model_version_id)
        prediction, prepared = prediction_service.prepare_development_current_term(
            db, student_id, class_id, subject_id, period_id, cutoff_at=cutoff,
            model_name=version.model_name,
        )
        if prepared is not None:
            lifecycle_reasons = prediction_service.current_term_lifecycle_reason_codes(
                db,
                class_id=class_id,
                subject_id=subject_id,
                period_id=period_id,
                lock=True,
            )
            if lifecycle_reasons:
                raise ValueError(
                    "The current-term academic lifecycle scope changed before persistence "
                    f"({', '.join(lifecycle_reasons)})."
                )
            material_evidence = _material_evidence(
                version,
                prepared["features"],
                prepared["evidence_summary"]["examination"]["presentation"],
            )
            prediction_scope = _prediction_scope(
                student_id=student_id,
                class_id=class_id,
                subject_id=subject_id,
                period_id=period_id,
                model_version_id=version.model_version_id,
            )
            latest = _latest_prediction(db, prediction_scope)
            if latest is not None and _same_material_evidence(latest.evidence_snapshot, material_evidence):
                return _reuse_latest_prediction(
                    db,
                    model_version=version,
                    latest=latest,
                    prediction=prediction,
                    student_id=student_id,
                    class_id=class_id,
                    subject_id=subject_id,
                    period_id=period_id,
                )

            scored_features: dict[str, Any] = {}
            prediction = prediction_service.score_prepared_development_current_term(
                prediction,
                prepared,
                scored_features_out=scored_features,
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
                "is_provisional": prediction.get("is_provisional", False),
                "validation_status": prediction.get("validation_status"),
            }
        if prepared is None:
            raise AssertionError("Assessed development prediction is missing prepared evidence.")
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
            scored_features=scored_features,
            material_evidence=material_evidence,
        )

    def operation_with_followup(db: Session) -> dict[str, Any]:
        result = operation(db)
        if after_result is not None:
            after_result(db, result)
        return result

    for attempt in range(3):
        try:
            return run_prediction_generation_transaction(scope, str(model_version_id), operation_with_followup, bind=bind)
        except DBAPIError as exc:
            code = getattr(exc.orig, "sqlstate", None) or getattr(exc.orig, "pgcode", None)
            constraint = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
            retryable = code == "40001" or (
                code == "23505" and constraint in {
                    "uq_development_current_term_scope_revision", "uq_intervention_open_scope",
                }
            )
            if not retryable or attempt == 2:
                raise
    raise AssertionError("Unreachable development prediction retry state.")


# Compatibility alias for the development/test API and existing intervention
# callers. New lifecycle-neutral callers should use generate_and_persist_current_term.
generate_and_persist_development_current_term = generate_and_persist_current_term
