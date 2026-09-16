"""Generation lifecycle for UNIFIED_CURRENT_TERM_PROJECTION.

Keeps the existing immutable prediction/revision infrastructure while scoring
one same-period Projected Final Grade with the Unified V2 artifact.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal
import math
from typing import Any

from sqlalchemy.orm import Session

from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.AIPrediction import AIPrediction, RISK_ASSESSMENT_NOT_EVALUATED_UNIFIED
from app.models.ai.PredictionGenerationRequest import PredictionGenerationRequest
from app.models.ai.PredictionOutcome import PredictionOutcome
from app.services.prediction.CurrentPeriodPredictionGenerationService import (
    canonical_hash,
    _canonical_unordered,
    validate_current_period_scope,
    verify_runtime_model_integrity,
)
from app.services.prediction.ModelScoringService import get_active_model_version_by_purpose, load_model_artifact
from app.services.prediction.PredictionGenerationTransaction import run_prediction_generation_transaction
from app.services.prediction.PredictionPersistenceService import validate_prediction_risk_contract, validate_references
from app.services.prediction.PredictionScopeService import PredictionConflict, prediction_metadata
from app.services.prediction.UnifiedCurrentTermFeatureBuilderService import (
    BLOCKING_WARNING_CODES,
    EVIDENCE_CONTRACT_VERSION,
    MODEL_NAME as DEFAULT_UNIFIED_MODEL_NAME,
    MODEL_PURPOSE,
    SNAPSHOT_VERSION,
    build_unified_current_term_features_from_records,
    load_unified_feature_schema,
    prepare_unified_frame,
    validate_unified_feature_contract,
)


def unified_request_fingerprint(scope: dict[str, Any], reason: str = "MANUAL_GENERATION") -> str:
    return canonical_hash({
        "purpose": ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value,
        "reason": reason,
        "scope": {
            "student_id": str(scope["student_id"]),
            "class_id": int(scope["class_id"]),
            "subject_id": int(scope["subject_id"]),
            "source_period_id": int(scope["source_period_id"]),
            "target_period_id": int(scope["target_period_id"]),
        },
    })


def build_unified_evidence_fingerprint(
    *,
    scope: dict[str, Any],
    model_version: AIModelVersion,
    built: dict[str, Any],
    artifact_sha256: str | None,
    schema_sha256: str | None,
) -> str:
    summary = deepcopy(built.get("evidence_summary") or {})
    summary.pop("cutoff_at", None)
    return canonical_hash({
        "artifact_sha256": artifact_sha256,
        "contract": SNAPSHOT_VERSION,
        "domain_warnings": _canonical_unordered(built.get("domain_warnings", [])),
        "evidence_summary": _canonical_unordered(summary),
        "features": built["features"],
        "model_purpose": ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value,
        "model_version_id": model_version.model_version_id,
        "readiness_level": built.get("readiness_level"),
        "readiness_reasons": sorted(built.get("readiness_reasons") or []),
        "schema_sha256": schema_sha256,
        "scope": {
            "student_id": str(scope["student_id"]),
            "class_id": int(scope["class_id"]),
            "subject_id": int(scope["subject_id"]),
            "source_period_id": int(scope["source_period_id"]),
            "target_period_id": int(scope["target_period_id"]),
        },
    })


def check_unified_finalization(db: Session, scope: dict[str, Any]) -> dict[str, Any] | None:
    grade = (
        db.query(StudentPeriodGrade)
        .filter(
            StudentPeriodGrade.student_id == scope["student_id"],
            StudentPeriodGrade.class_id == scope["class_id"],
            StudentPeriodGrade.subject_id == scope["subject_id"],
            StudentPeriodGrade.academic_period_id == scope["source_period_id"],
        )
        .one_or_none()
    )
    known_outcome = (
        db.query(PredictionOutcome.outcome_id)
        .join(AIPrediction, PredictionOutcome.prediction_id == AIPrediction.prediction_id)
        .filter(
            AIPrediction.student_id == scope["student_id"],
            AIPrediction.class_id == scope["class_id"],
            AIPrediction.subject_id == scope["subject_id"],
            AIPrediction.target_period_id == scope["target_period_id"],
            PredictionOutcome.actual_period_grade.isnot(None),
        )
        .first()
    )
    if (grade and grade.is_finalized and grade.final_period_grade is not None) or known_outcome is not None:
        return {
            "generation_status": "FINALIZED",
            "ready": False,
            "readiness_level": "FINALIZED",
            "prediction_mode": ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value,
            "predicted_period_grade": None,
            "risk_level": None,
            "risk_score": None,
            "data_status": None,
            "risk_assessment_status": RISK_ASSESSMENT_NOT_EVALUATED_UNIFIED,
            "message": "Academic period is finalized; the official final grade supersedes ML projection generation.",
            "final_period_grade": float(grade.final_period_grade) if grade and grade.final_period_grade is not None else None,
            "is_finalized": True,
        }
    return None


def score_unified_prediction(
    features: dict[str, Any],
    *,
    model_version: AIModelVersion,
    artifact_sha256: str | None = None,
) -> dict[str, Any]:
    schema = load_unified_feature_schema()
    validate_unified_feature_contract(features, schema)
    frame = prepare_unified_frame(features, schema)
    artifact = load_model_artifact(model_version.artifact_path)
    model = artifact.get("pipeline") if isinstance(artifact, dict) else artifact
    if model is None and isinstance(artifact, dict):
        model = artifact.get("model")
    if model is None:
        model = artifact
    predicted_val = float(model.predict(frame)[0])
    if math.isnan(predicted_val) or math.isinf(predicted_val):
        raise ValueError("Unified model returned non-finite prediction.")
    if predicted_val < 0.0 or predicted_val > 100.0:
        raise ValueError(f"Unified model prediction {predicted_val} is outside valid grade domain [0, 100].")
    return {
        "predicted_period_grade": round(predicted_val, 2),
        "model_version_id": model_version.model_version_id,
        "model_name": model_version.model_name,
        "feature_columns_used": list(schema["raw_feature_columns"]),
        "execution_trace": {
            "grade_model": {
                "status": "EXECUTED",
                "model_version_id": model_version.model_version_id,
                "model_name": model_version.model_name,
                "artifact_sha256": artifact_sha256,
                "ordered_feature_names": list(schema["raw_feature_columns"]),
                "ordered_model_values": [features[col] for col in schema["raw_feature_columns"]],
            }
        },
    }


def build_unified_evidence_snapshot(
    db: Session,
    *,
    scope: dict[str, Any],
    model_version: AIModelVersion,
    built: dict[str, Any],
    scoring_result: dict[str, Any],
    generation_request_id: str | None,
    staff_id: str | None,
    is_admin: bool,
    evidence_fingerprint: str,
    request_fingerprint: str,
    artifact_sha256: str,
    schema_sha256: str,
    cutoff_at: str,
    reason: str,
) -> dict[str, Any]:
    snapshot = {
        "snapshot_version": SNAPSHOT_VERSION,
        "evidence_contract_version": EVIDENCE_CONTRACT_VERSION,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "prediction_purpose": ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value,
        "model": {
            "model_version_id": model_version.model_version_id,
            "model_name": model_version.model_name,
            "model_purpose": model_version.model_purpose,
            "artifact_sha256": artifact_sha256,
            "schema_sha256": schema_sha256,
        },
        "scope": {
            "student_id": str(scope["student_id"]),
            "class_id": scope["class_id"],
            "subject_id": scope["subject_id"],
            "academic_period_id": scope["source_period_id"],
            "source_period_id": scope["source_period_id"],
            "target_period_id": scope["target_period_id"],
            "cutoff_at": cutoff_at,
            "generation_request_id": generation_request_id,
            "request_fingerprint": request_fingerprint,
        },
        "raw_features_34": deepcopy(built["features"]),
        "evidence_summary": deepcopy(built.get("evidence_summary", {})),
        "readiness": {
            "status": "READY" if built.get("ready") else "NOT_READY",
            "level": built.get("readiness_level"),
            "reasons": list(built.get("readiness_reasons") or []),
        },
        "domain_warnings": deepcopy(built.get("domain_warnings", [])),
        "scoring": {
            "predicted_period_grade": scoring_result["predicted_period_grade"],
            "risk_assessment_status": RISK_ASSESSMENT_NOT_EVALUATED_UNIFIED,
            "grade_model_trace": scoring_result.get("execution_trace", {}).get("grade_model"),
        },
        "evidence_fingerprint": evidence_fingerprint,
        "generation": {"reason": reason, "staff_id": staff_id, "role": "admin" if is_admin else "teacher"},
    }
    return snapshot


def persisted_unified_prediction_response(prediction: AIPrediction, status: str = "REPLAYED") -> dict[str, Any]:
    snapshot = prediction.evidence_snapshot or {}
    readiness = snapshot.get("readiness") or {}
    metadata = prediction_metadata(prediction)
    return {
        **metadata,
        "prediction_id": prediction.prediction_id,
        "latest_prediction_id": prediction.prediction_id,
        "revision": prediction.revision,
        "generation_status": status,
        "duplicate": status != "CREATED",
        "prediction_mode": ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value,
        "model_version_id": prediction.model_version_id,
        "student_id": str(prediction.student_id),
        "class_id": prediction.class_id,
        "subject_id": prediction.subject_id,
        "source_period_id": prediction.source_period_id,
        "target_period_id": prediction.target_period_id,
        "predicted_period_grade": float(prediction.predicted_period_grade) if prediction.predicted_period_grade is not None else None,
        "risk_level": None,
        "risk_score": None,
        "data_status": None,
        "risk_assessment_status": prediction.risk_assessment_status,
        "generated_at": prediction.generated_at,
        "ready": readiness.get("status") == "READY",
        "readiness_level": readiness.get("level", "UNKNOWN"),
        "readiness_reasons": readiness.get("reasons", []),
        "features": deepcopy(snapshot.get("raw_features_34", {})),
        "evidence_summary": deepcopy(snapshot.get("evidence_summary", {})),
        "domain_warnings": deepcopy(snapshot.get("domain_warnings", [])),
        "evidence_snapshot": deepcopy(snapshot),
        "evidence_cutoff_at": snapshot.get("scope", {}).get("cutoff_at"),
    }


def _record_request(db: Session, key: str | None, fingerprint: str, prediction: AIPrediction) -> None:
    if key and key.strip():
        db.add(PredictionGenerationRequest(
            request_id=key.strip(),
            request_fingerprint=fingerprint,
            prediction_id=prediction.prediction_id,
        ))
        db.flush()


def latest_unified_prediction_for_scope(db: Session, scope: dict[str, Any]) -> AIPrediction | None:
    return (
        db.query(AIPrediction)
        .join(AIModelVersion, AIPrediction.model_version_id == AIModelVersion.model_version_id)
        .filter(
            AIPrediction.student_id == scope["student_id"],
            AIPrediction.class_id == scope["class_id"],
            AIPrediction.subject_id == scope["subject_id"],
            AIPrediction.source_period_id == scope["source_period_id"],
            AIPrediction.target_period_id == scope["target_period_id"],
            AIModelVersion.model_purpose == ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value,
        )
        .order_by(AIPrediction.revision.desc(), AIPrediction.prediction_id.desc())
        .first()
    )


def evaluate_unified_projection_status(
    db: Session,
    target: AIPrediction | dict[str, Any],
    *,
    prebuilt_evidence: dict[str, Any] | None = None,
    preloaded_active_model: AIModelVersion | None = None,
    preloaded_latest_prediction: AIPrediction | None = None,
    preloaded_finalization: dict[str, Any] | None = None,
) -> dict[str, Any]:
    scope = {
        "student_id": target.student_id if isinstance(target, AIPrediction) else target["student_id"],
        "class_id": target.class_id if isinstance(target, AIPrediction) else target["class_id"],
        "subject_id": target.subject_id if isinstance(target, AIPrediction) else target["subject_id"],
        "source_period_id": target.source_period_id if isinstance(target, AIPrediction) else target["source_period_id"],
        "target_period_id": target.target_period_id if isinstance(target, AIPrediction) else target["target_period_id"],
    }
    finalization = preloaded_finalization or {"is_finalized": False}
    try:
        model = preloaded_active_model or get_active_model_version_by_purpose(db, ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION)
    except Exception:
        model = None
    latest = preloaded_latest_prediction
    if latest is None and isinstance(target, AIPrediction):
        latest = latest_unified_prediction_for_scope(db, scope)
    if finalization.get("is_finalized"):
        return {
            "evidence_readiness": {"level": "FINALIZED", "ready": False, "reasons": ["This grading period is already finalized."]},
            "projection_freshness": {"status": "FINALIZED", "saved_fingerprint": None, "current_fingerprint": None, "reasons": ["Official outcome is available."]},
            "model_currency": {"status": "CURRENT" if model else "MODEL_UNAVAILABLE", "persisted_model_version_id": latest.model_version_id if latest else None, "active_model_version_id": model.model_version_id if model else None},
            "refresh_eligibility": {"status": "FINALIZED", "eligible": False, "reasons": ["Official final grade supersedes projection generation."]},
            "domain_warnings": [],
        }
    if model is None:
        return {
            "evidence_readiness": {"level": "MODEL_UNAVAILABLE", "ready": False, "reasons": ["Unified prediction model is unavailable."]},
            "projection_freshness": {"status": "FRESHNESS_UNAVAILABLE", "saved_fingerprint": None, "current_fingerprint": None, "reasons": ["Unified prediction model is unavailable."]},
            "model_currency": {"status": "MODEL_UNAVAILABLE", "persisted_model_version_id": latest.model_version_id if latest else None, "active_model_version_id": None},
            "refresh_eligibility": {"status": "MODEL_UNAVAILABLE", "eligible": False, "reasons": ["Unified prediction model is unavailable."]},
            "domain_warnings": [],
        }
    built = prebuilt_evidence or build_unified_current_term_features_from_records(db, scope["student_id"], scope["class_id"], scope["subject_id"], scope["source_period_id"])
    try:
        artifact_sha, schema_sha = verify_runtime_model_integrity(model)
        current_fp = build_unified_evidence_fingerprint(scope=scope, model_version=model, built=built, artifact_sha256=artifact_sha, schema_sha256=schema_sha)
    except Exception:
        current_fp = None
    blocking = [w for w in built.get("domain_warnings", []) if w.get("code") in BLOCKING_WARNING_CODES]
    if blocking:
        eligibility = {"status": "DOMAIN_UNSUPPORTED", "eligible": False, "reasons": [w.get("message") for w in blocking]}
    elif not built.get("ready"):
        eligibility = {"status": "INSUFFICIENT_EVIDENCE", "eligible": False, "reasons": list(built.get("readiness_reasons") or [])}
    else:
        eligibility = {"status": "ELIGIBLE", "eligible": True, "reasons": []}
    saved_fp = (latest.evidence_snapshot or {}).get("evidence_fingerprint") if latest else None
    if latest is None:
        freshness = {"status": "NO_PROJECTION", "saved_fingerprint": None, "current_fingerprint": current_fp, "reasons": []}
    elif current_fp and saved_fp == current_fp:
        freshness = {"status": "CURRENT", "saved_fingerprint": saved_fp, "current_fingerprint": current_fp, "reasons": []}
    else:
        freshness = {"status": "SOURCE_EVIDENCE_CHANGED", "saved_fingerprint": saved_fp, "current_fingerprint": current_fp, "reasons": ["Academic evidence has changed since the saved projection."]}
    model_currency = {
        "status": "CURRENT" if latest is None or latest.model_version_id == model.model_version_id else "MODEL_UPDATE_AVAILABLE",
        "persisted_model_version_id": latest.model_version_id if latest else None,
        "active_model_version_id": model.model_version_id,
        "persisted_model_name": latest.model_version.model_name if latest and latest.model_version else None,
        "active_model_name": model.model_name,
    }
    if latest is not None and eligibility["eligible"] and freshness["status"] == "CURRENT" and model_currency["status"] == "CURRENT":
        eligibility = {"status": "CURRENT", "eligible": False, "reasons": ["Projection is already current."]}
    return {
        "evidence_readiness": {"level": built.get("readiness_level"), "ready": bool(built.get("ready")), "reasons": list(built.get("readiness_reasons") or [])},
        "projection_freshness": freshness,
        "model_currency": model_currency,
        "refresh_eligibility": eligibility,
        "requested_prediction": None,
        "latest_prediction": persisted_unified_prediction_response(latest) if latest else None,
        "domain_warnings": deepcopy(built.get("domain_warnings", [])),
    }


def existing_unified_projection_response(prediction: AIPrediction) -> dict[str, Any]:
    response = persisted_unified_prediction_response(prediction, "EXISTING_PROJECTION")
    response.update({
        "latest_prediction_id": prediction.prediction_id,
        "duplicate": True,
        "message": "A projected final grade already exists for this scope. Use refresh to create a successor revision when eligible.",
    })
    return response


def generate_unified_from_records(
    db: Session,
    scope: dict[str, Any],
    *,
    generation_request_id: str | None = None,
    current_user: dict[str, Any] | None = None,
    is_admin: bool = False,
    staff_id: str | None = None,
    preview: bool = False,
    reason: str = "MANUAL_GENERATION",
    initial_only: bool = False,
) -> dict[str, Any]:
    normalized = dict(scope)
    if "academic_period_id" in normalized:
        normalized.setdefault("source_period_id", normalized["academic_period_id"])
        normalized.setdefault("target_period_id", normalized["academic_period_id"])
    elif "source_period_id" in normalized and "target_period_id" not in normalized:
        normalized["target_period_id"] = normalized["source_period_id"]
    clean_scope = validate_references(db, normalized)
    validate_current_period_scope(db, clean_scope, current_user=current_user, is_admin=is_admin, staff_id=staff_id)
    req_fp = unified_request_fingerprint(clean_scope, reason=reason)
    if generation_request_id and not preview:
        key = generation_request_id.strip()
        if not key:
            raise ValueError("generation_request_id cannot be blank.")
        prior = db.get(PredictionGenerationRequest, key)
        if prior:
            if prior.request_fingerprint != req_fp:
                raise PredictionConflict("generation_request_id was already used for a different logical request.")
            prediction = db.get(AIPrediction, prior.prediction_id)
            if not prediction:
                raise PredictionConflict("generation_request_id points to a missing prediction record.")
            if (
                prediction.student_id != clean_scope["student_id"]
                or prediction.class_id != clean_scope["class_id"]
                or prediction.subject_id != clean_scope["subject_id"]
                or prediction.source_period_id != clean_scope["source_period_id"]
                or prediction.target_period_id != clean_scope["target_period_id"]
            ):
                raise PredictionConflict("generation_request_id points to a prediction with conflicting scope.")
            return persisted_unified_prediction_response(prediction, "REPLAYED")
    if initial_only and not preview:
        existing = latest_unified_prediction_for_scope(db, clean_scope)
        if existing is not None:
            return existing_unified_projection_response(existing)
    finalization = check_unified_finalization(db, clean_scope)
    if finalization is not None:
        return finalization
    model = get_active_model_version_by_purpose(db, ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION)
    if model.feature_schema_json.get("model_purpose") != ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value:
        raise ValueError("Registered model purpose is incompatible with Unified projection.")
    artifact_sha, schema_sha = verify_runtime_model_integrity(model)
    cutoff = db.info.get("prediction_evidence_cutoff_at") or datetime.now(timezone.utc).isoformat()
    cutoff_dt = datetime.fromisoformat(cutoff) if isinstance(cutoff, str) else cutoff
    built = build_unified_current_term_features_from_records(db, clean_scope["student_id"], clean_scope["class_id"], clean_scope["subject_id"], clean_scope["source_period_id"], cutoff_at=cutoff_dt)
    ev_fp = build_unified_evidence_fingerprint(scope=clean_scope, model_version=model, built=built, artifact_sha256=artifact_sha, schema_sha256=schema_sha)
    latest = latest_unified_prediction_for_scope(db, clean_scope)
    if not preview and latest and (latest.evidence_snapshot or {}).get("evidence_fingerprint") == ev_fp and latest.model_version_id == model.model_version_id:
        _record_request(db, generation_request_id, req_fp, latest)
        return persisted_unified_prediction_response(latest, "UNCHANGED")
    blocking = [w for w in built.get("domain_warnings", []) if w.get("code") in BLOCKING_WARNING_CODES]
    if blocking:
        return {
            "generation_status": "DOMAIN_UNSUPPORTED",
            "ready": False,
            "blocking_reasons": [w.get("message") for w in blocking],
            "readiness_level": built["readiness_level"],
            "predicted_period_grade": None,
            "risk_level": None,
            "risk_score": None,
            "data_status": None,
            "risk_assessment_status": RISK_ASSESSMENT_NOT_EVALUATED_UNIFIED,
            "features": deepcopy(built["features"]),
            "domain_warnings": deepcopy(built.get("domain_warnings", [])),
            "evidence_summary": deepcopy(built.get("evidence_summary", {})),
            "prediction_mode": ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value,
        }
    if not built["ready"]:
        return {
            "generation_status": "NOT_READY",
            "ready": False,
            "readiness_level": built["readiness_level"],
            "readiness_reasons": list(built.get("readiness_reasons") or []),
            "predicted_period_grade": None,
            "risk_level": None,
            "risk_score": None,
            "data_status": None,
            "risk_assessment_status": RISK_ASSESSMENT_NOT_EVALUATED_UNIFIED,
            "features": deepcopy(built["features"]),
            "evidence_summary": deepcopy(built.get("evidence_summary", {})),
            "domain_warnings": deepcopy(built.get("domain_warnings", [])),
            "prediction_mode": ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value,
        }
    scoring = score_unified_prediction(built["features"], model_version=model, artifact_sha256=artifact_sha)
    validate_prediction_risk_contract(
        model_purpose=ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION,
        risk_assessment_status=RISK_ASSESSMENT_NOT_EVALUATED_UNIFIED,
        risk_level=None,
        risk_score=None,
        data_status=None,
    )
    if preview:
        return {**scoring, "generation_status": "PREVIEW", "ready": True, "readiness_level": built["readiness_level"], "prediction_mode": ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value, "features": deepcopy(built["features"]), "domain_warnings": deepcopy(built.get("domain_warnings", [])), "evidence_summary": deepcopy(built.get("evidence_summary", {})), "evidence_cutoff_at": cutoff}
    prediction = AIPrediction(
        student_id=clean_scope["student_id"],
        class_id=clean_scope["class_id"],
        subject_id=clean_scope["subject_id"],
        source_period_id=clean_scope["source_period_id"],
        target_period_id=clean_scope["target_period_id"],
        model_version_id=model.model_version_id,
        revision=(latest.revision + 1 if latest else 1),
        predicted_period_grade=Decimal(str(scoring["predicted_period_grade"])),
        risk_score=None,
        risk_level=None,
        data_status=None,
        risk_assessment_status=RISK_ASSESSMENT_NOT_EVALUATED_UNIFIED,
        generation_request_id=generation_request_id.strip() if generation_request_id else None,
    )
    db.add(prediction)
    db.flush()
    resolved_is_admin = is_admin or (current_user.get("role") == "admin" if current_user else False)
    resolved_staff_id = staff_id or (current_user.get("staff_id") if current_user else None)
    prediction.evidence_snapshot = build_unified_evidence_snapshot(
        db,
        scope=clean_scope,
        model_version=model,
        built=built,
        scoring_result=scoring,
        generation_request_id=generation_request_id,
        staff_id=resolved_staff_id,
        is_admin=resolved_is_admin,
        evidence_fingerprint=ev_fp,
        request_fingerprint=req_fp,
        artifact_sha256=artifact_sha,
        schema_sha256=schema_sha,
        cutoff_at=str(cutoff),
        reason=reason,
    )
    db.flush()
    _record_request(db, generation_request_id, req_fp, prediction)
    return persisted_unified_prediction_response(prediction, "CREATED")


def generate_unified_prediction(
    scope: dict[str, Any],
    *,
    generation_request_id: str | None = None,
    current_user: dict[str, Any] | None = None,
    is_admin: bool = False,
    staff_id: str | None = None,
    preview: bool = False,
    bind: Any = None,
    model_name: str = DEFAULT_UNIFIED_MODEL_NAME,
    reason: str = "MANUAL_GENERATION",
    initial_only: bool = False,
) -> dict[str, Any]:
    normalized = dict(scope)
    if "academic_period_id" in normalized:
        normalized.setdefault("source_period_id", normalized["academic_period_id"])
        normalized.setdefault("target_period_id", normalized["academic_period_id"])
    elif "source_period_id" in normalized and "target_period_id" not in normalized:
        normalized["target_period_id"] = normalized["source_period_id"]
    return run_prediction_generation_transaction(
        normalized,
        model_name,
        lambda db: generate_unified_from_records(db, normalized, generation_request_id=generation_request_id, current_user=current_user, is_admin=is_admin, staff_id=staff_id, preview=preview, reason=reason, initial_only=initial_only),
        bind=bind,
        generation_request_id=generation_request_id,
    )


def refresh_unified_prediction_workflow(
    db: Session,
    prediction: AIPrediction,
    *,
    payload: Any | None = None,
    current_user: dict[str, Any] | None = None,
    staff_id: str | None = None,
) -> dict[str, Any]:
    scope = {
        "student_id": prediction.student_id,
        "class_id": prediction.class_id,
        "subject_id": prediction.subject_id,
        "source_period_id": prediction.source_period_id,
        "target_period_id": prediction.target_period_id,
    }
    advisory = evaluate_unified_projection_status(db, prediction)
    eligibility = advisory.get("refresh_eligibility", {})
    key = payload.generation_request_id if payload else None
    if not eligibility.get("eligible"):
        readiness = advisory.get("evidence_readiness", {})
        return {
            **prediction_metadata(prediction),
            "generation_status": eligibility.get("status", "INELIGIBLE"),
            "ready": False,
            "readiness_level": readiness.get("level", eligibility.get("status", "INELIGIBLE")),
            "prediction_mode": ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value,
            "predicted_period_grade": None,
            "risk_level": None,
            "risk_score": None,
            "data_status": None,
            "risk_assessment_status": RISK_ASSESSMENT_NOT_EVALUATED_UNIFIED,
            "message": (eligibility.get("reasons") or ["Unified refresh is not eligible."])[0],
            "reasons": eligibility.get("reasons", []),
            "warnings": eligibility.get("reasons", []),
            "features": {},
            "evidence_summary": {},
            "prediction_id": prediction.prediction_id,
            "student_id": prediction.student_id,
            "class_id": prediction.class_id,
            "subject_id": prediction.subject_id,
            "source_period_id": prediction.source_period_id,
            "target_period_id": prediction.target_period_id,
        }
    return generate_unified_prediction(
        scope,
        generation_request_id=key,
        current_user=current_user,
        is_admin=(current_user.get("role") == "admin") if current_user else False,
        staff_id=staff_id or (current_user.get("staff_id") if current_user else None),
        reason="MANUAL_REFRESH",
        bind=db.get_bind(),
    )
