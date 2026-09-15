"""Core generation lifecycle service for CURRENT_PERIOD_FINAL_GRADE_PROJECTION.

Produces immutable academic estimates without RiskEngine evaluation.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal
from hashlib import sha256
import json
import math
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.AIPrediction import (
    AIPrediction,
    RISK_ASSESSMENT_NOT_EVALUATED_CURRENT,
)
from app.models.ai.PredictionGenerationRequest import PredictionGenerationRequest
from app.models.ai.PredictionOutcome import PredictionOutcome
from app.models.people.Student import Student
from app.services.prediction.CurrentPeriodFeatureBuilderService import (
    CANONICAL_ASSESSMENT_HPS,
    MODEL_NAME as DEFAULT_CURRENT_MODEL_NAME,
    MODEL_PURPOSE as CURRENT_MODEL_PURPOSE,
    build_current_period_features_from_records,
    load_current_period_feature_schema,
    prepare_current_period_frame,
    validate_current_period_feature_contract,
)
from app.services.prediction.ModelRegistryExceptions import (
    ActiveModelNotFound,
    ArtifactIntegrityError,
    UnsupportedModelPurpose,
)
from app.services.prediction.ModelScoringService import (
    artifact_digest,
    get_active_model_version_by_purpose,
    load_model_artifact,
    resolve_artifact_path,
)
from app.services.prediction.ModelVersionService import compute_file_sha256, load_json
from app.services.prediction.PredictionGenerationTransaction import (
    run_prediction_generation_transaction,
)
from app.services.prediction.PredictionPersistenceService import (
    validate_prediction_risk_contract,
    validate_references,
)
from app.services.prediction.PredictionScopeService import (
    PredictionConflict,
    prediction_metadata,
)
from app.services.prediction.TeacherAssignmentResolver import (
    get_teacher_assigned_triplets,
)

SNAPSHOT_VERSION = "prediction-evidence-v3-current-period"
EVIDENCE_CONTRACT_VERSION = "stage6b-current-period-v1"
BLOCKING_WARNING_CODES = {
    "UNSUPPORTED_SUBJECT",
    "UNSUPPORTED_WEIGHT_PATTERN",
}


def canonical_hash(value: Any) -> str:
    return sha256(
        json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            default=str,
            allow_nan=False,
        ).encode("utf-8")
    ).hexdigest()


def _canonical_unordered(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _canonical_unordered(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        normalized = [_canonical_unordered(item) for item in value]
        return sorted(
            normalized, key=lambda item: json.dumps(item, sort_keys=True, default=str)
        )
    return value


def current_period_request_fingerprint(
    scope: dict[str, Any],
    reason: str = "MANUAL_GENERATION",
) -> str:
    """Return caller logical request fingerprint.

    Describes the caller's logical request independently from server-resolved
    active model versions so retries replay persisted predictions cleanly
    across subsequent model activations.
    """
    return canonical_hash({
        "purpose": ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
        "reason": reason,
        "scope": {
            "student_id": str(scope["student_id"]),
            "class_id": int(scope["class_id"]),
            "subject_id": int(scope["subject_id"]),
            "source_period_id": int(scope["source_period_id"]),
            "target_period_id": int(scope["target_period_id"]),
        },
    })


def build_current_period_evidence_fingerprint(
    *,
    scope: dict[str, Any],
    model_version: AIModelVersion,
    built: dict[str, Any],
    artifact_sha256: str | None,
    schema_sha256: str | None,
) -> str:
    """Return deterministic fingerprint representing exact current-period evidence."""
    summary = deepcopy(built["evidence_summary"])
    summary.pop("cutoff_at", None)

    material = {
        "artifact_sha256": artifact_sha256,
        "contract": SNAPSHOT_VERSION,
        "domain_warnings": _canonical_unordered(built.get("domain_warnings", [])),
        "evidence_summary": _canonical_unordered(summary),
        "features": built["features"],
        "model_purpose": ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
        "model_version_id": model_version.model_version_id,
        "readiness_level": built["readiness_level"],
        "readiness_reasons": sorted(built.get("readiness_reasons", [])),
        "schema_sha256": schema_sha256,
        "scope": {
            "student_id": str(scope["student_id"]),
            "class_id": int(scope["class_id"]),
            "subject_id": int(scope["subject_id"]),
            "source_period_id": int(scope["source_period_id"]),
            "target_period_id": int(scope["target_period_id"]),
        },
    }
    return canonical_hash(material)


def validate_current_period_scope(
    db: Session,
    scope: dict[str, Any],
    *,
    current_user: dict[str, Any] | None = None,
    is_admin: bool = False,
    staff_id: str | None = None,
) -> None:
    """Validate current-period scope and trusted authenticated permissions."""
    if int(scope["source_period_id"]) != int(scope["target_period_id"]):
        raise ValueError(
            "CURRENT_PERIOD_FINAL_GRADE_PROJECTION requires source_period_id == target_period_id."
        )

    period = db.get(AcademicPeriod, scope["source_period_id"])
    if period is None:
        raise ValueError("Referenced academic period was not found.")

    class_ = db.get(Class, scope["class_id"])
    if class_ is None or class_.academic_year_id != period.academic_year_id:
        raise ValueError("Class does not belong to the academic period's academic year.")

    enrolled = (
        db.query(StudentClass)
        .filter(
            StudentClass.student_id == scope["student_id"],
            StudentClass.class_id == scope["class_id"],
            StudentClass.academic_year_id == period.academic_year_id,
            func.lower(func.coalesce(StudentClass.enrollment_status, "enrolled")) == "enrolled",
        )
        .first()
    )
    if not enrolled:
        raise ValueError("Student is not enrolled in this class and academic year.")

    load = (
        db.query(SubjectLoad)
        .filter(
            SubjectLoad.class_id == scope["class_id"],
            SubjectLoad.subject_id == scope["subject_id"],
            SubjectLoad.academic_period_id == scope["source_period_id"],
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["active", "published"]),
        )
        .first()
    )
    if not load:
        raise ValueError("No valid class/subject load exists for this academic period.")

    # Trusted authorization derivation
    resolved_is_admin = is_admin
    resolved_staff_id = staff_id
    if current_user is not None:
        role = current_user.get("role")
        if role == "student":
            raise PermissionError("Students are not permitted to generate predictions.")
        if role == "admin":
            resolved_is_admin = True
        elif role == "teacher":
            resolved_is_admin = False
            resolved_staff_id = resolved_staff_id or current_user.get("staff_id")
        else:
            raise PermissionError(f"Unsupported role for prediction generation: {role}")

    if resolved_is_admin:
        return

    if not resolved_staff_id:
        raise PermissionError("Authentication required.")

    assigned = get_teacher_assigned_triplets(db, resolved_staff_id)
    triplet = (int(scope["class_id"]), int(scope["subject_id"]), int(scope["source_period_id"]))
    if triplet not in assigned:
        raise PermissionError("You are not assigned to this class, subject and academic period.")


def check_current_period_finalization(
    db: Session,
    scope: dict[str, Any],
) -> dict[str, Any] | None:
    """Return explicit response if academic period outcome is already officially finalized."""
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

    is_official = (
        grade is not None
        and grade.is_finalized is True
        and grade.final_period_grade is not None
    )
    if is_official or known_outcome is not None:
        return {
            "generation_status": "FINALIZED",
            "ready": False,
            "predicted_period_grade": None,
            "message": (
                "Academic period already has an official finalized grade or outcome; "
                "new current-period projection generation is closed."
            ),
            "final_period_grade": float(grade.final_period_grade) if grade and grade.final_period_grade is not None else None,
            "is_finalized": True,
        }
    return None


def verify_runtime_model_integrity(
    model_version: AIModelVersion,
    base_dir: Path | None = None,
) -> tuple[str, str]:
    """Verify actual runtime artifact and schema SHA-256 against manifest if present.

    Fails closed with ArtifactIntegrityError if either hash does not match.
    """
    resolved_artifact = resolve_artifact_path(model_version.artifact_path, base_dir=base_dir)
    if not resolved_artifact.exists() or not resolved_artifact.is_file():
        raise FileNotFoundError(f"Model artifact file not found: {resolved_artifact}")

    actual_model_sha = compute_file_sha256(resolved_artifact)
    schema_path = resolved_artifact.with_name(f"{model_version.model_name}_feature_schema.json")
    actual_schema_sha = compute_file_sha256(schema_path) if schema_path.exists() else ""

    manifest_path = resolved_artifact.with_name(f"{model_version.model_name}_manifest.json")
    if manifest_path.exists():
        manifest = load_json(manifest_path)
        hashes = manifest.get("artifact_hashes", {})
        expected_model_sha = hashes.get("model_sha256")
        if expected_model_sha and actual_model_sha != expected_model_sha:
            raise ArtifactIntegrityError(
                f"Model artifact SHA-256 mismatch: expected {expected_model_sha}, got {actual_model_sha}"
            )
        expected_schema_sha = hashes.get("feature_schema_sha256")
        if expected_schema_sha and actual_schema_sha and actual_schema_sha != expected_schema_sha:
            raise ArtifactIntegrityError(
                f"Feature schema SHA-256 mismatch: expected {expected_schema_sha}, got {actual_schema_sha}"
            )

    return actual_model_sha, actual_schema_sha


def score_current_period_prediction(
    db: Session,
    features: dict[str, Any],
    *,
    model_version: AIModelVersion,
    artifact_sha256: str | None = None,
) -> dict[str, Any]:
    """Score student prediction using active current model without RiskEngine."""
    schema = load_current_period_feature_schema()
    validate_current_period_feature_contract(features, schema)
    frame = prepare_current_period_frame(features, schema)

    artifact = load_model_artifact(model_version.artifact_path)
    model = artifact.get("pipeline") if isinstance(artifact, dict) else artifact
    if model is None and isinstance(artifact, dict):
        model = artifact.get("model")
    if model is None:
        model = artifact

    raw_prediction = model.predict(frame)
    predicted_val = float(raw_prediction[0])

    if math.isnan(predicted_val) or math.isinf(predicted_val):
        raise ValueError("Current-period model returned non-finite prediction.")
    if predicted_val < 0.0 or predicted_val > 100.0:
        raise ValueError(
            f"Current-period model prediction {predicted_val} is outside valid physical grade domain [0.0, 100.0]."
        )

    predicted_grade = round(predicted_val, 2)
    digest = artifact_sha256 or artifact_digest(model_version.artifact_path)

    return {
        "predicted_period_grade": predicted_grade,
        "model_version_id": model_version.model_version_id,
        "model_name": model_version.model_name,
        "feature_columns_used": list(schema["raw_feature_columns"]),
        "execution_trace": {
            "grade_model": {
                "status": "EXECUTED",
                "model_version_id": model_version.model_version_id,
                "model_name": model_version.model_name,
                "artifact_sha256": digest,
                "ordered_feature_names": list(schema["raw_feature_columns"]),
                "ordered_model_values": [features[col] for col in schema["raw_feature_columns"]],
            }
        },
    }


def _build_qa_provenance(summary: dict[str, Any], features: dict[str, Any]) -> dict[str, Any]:
    qa_bucket = summary.get("qa") or {}
    has_qa = int(features.get("qa_has_evidence", 0)) == 1
    return {
        "is_complete": has_qa,
        "canonical_assessment_hps": CANONICAL_ASSESSMENT_HPS,
        "canonical_points_earned": float(qa_bucket.get("points_earned_so_far", 0.0)),
        "canonical_points_possible": float(qa_bucket.get("points_possible_so_far", 0.0)),
        "composite_exam_percent": float(features.get("qa_percent_so_far", 0.0)),
        "configured_weight": float(features.get("qa_weight", 0.0)),
        "weighted_score": float(features.get("qa_weighted_score_so_far", 0.0)),
        "composite_formula": "0.30 * S1_percent + 0.30 * S2_percent + 0.40 * Term_percent",
        "activity_ids": list(qa_bucket.get("activity_ids", [])),
        "submission_ids": list(qa_bucket.get("submission_ids", [])),
    }


def build_current_period_evidence_snapshot(
    db: Session,
    *,
    scope: dict[str, Any],
    model_version: AIModelVersion,
    built: dict[str, Any],
    scoring_result: dict[str, Any],
    generation_request_id: str | None = None,
    staff_id: str | None = None,
    is_admin: bool = False,
    evidence_fingerprint: str,
    request_fingerprint: str,
    artifact_sha256: str,
    schema_sha256: str,
    cutoff_at: str,
    reason: str = "MANUAL_GENERATION",
) -> dict[str, Any]:
    period = db.get(AcademicPeriod, scope["source_period_id"])
    summary = built.get("evidence_summary") or {}
    features = built.get("features") or {}
    now = datetime.now(timezone.utc).isoformat()

    return {
        "snapshot_version": SNAPSHOT_VERSION,
        "evidence_contract_version": EVIDENCE_CONTRACT_VERSION,
        "captured_at": now,
        "prediction_purpose": ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
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
            "academic_year_id": period.academic_year_id if period else None,
            "academic_period_id": period.academic_period_id if period else None,
            "source_period_id": scope["source_period_id"],
            "target_period_id": scope["target_period_id"],
            "source_period_name": period.period_name if period else None,
            "target_period_name": period.period_name if period else None,
            "cutoff_at": cutoff_at,
            "generation_request_id": generation_request_id,
            "request_fingerprint": request_fingerprint,
        },
        "grading_context": {
            "template_id": summary.get("grading_template_id"),
            "template_name": summary.get("grading_template_name"),
            "weights": {
                "ww": features.get("ww_weight"),
                "pt": features.get("pt_weight"),
                "qa": features.get("qa_weight"),
            },
        },
        "canonical_evidence": {
            "components": {
                component: {
                    "available_activity_count": features.get(f"{component}_available_activity_count"),
                    "points_earned_so_far": features.get(f"{component}_points_earned_so_far"),
                    "points_possible_so_far": features.get(f"{component}_points_possible_so_far"),
                    "percent_so_far": features.get(f"{component}_percent_so_far"),
                    "weighted_score_so_far": features.get(f"{component}_weighted_score_so_far"),
                    "activity_ids": summary.get("component_activity_ids", {}).get(component, []),
                    "submission_ids": summary.get("component_submission_ids", {}).get(component, []),
                }
                for component in ("ww", "pt", "qa")
            },
            "qa_composite_provenance": _build_qa_provenance(summary, features),
            "ignored_records": {
                "ignored_ungraded_assignment_ids": summary.get("ignored_ungraded_assignment_ids", []),
                "ignored_future_submission_ids": summary.get("ignored_future_submission_ids", []),
                "unresolved_assignment_ids": summary.get("unresolved_assignment_ids", []),
                "ignored_outside_component_ids": summary.get("ignored_outside_component_ids", []),
            },
        },
        "raw_features_31": deepcopy(features),
        "evidence_summary": deepcopy(summary),
        "readiness": {
            "status": "READY" if built.get("ready") else "NOT_READY",
            "level": built.get("readiness_level"),
            "reasons": list(built.get("readiness_reasons") or []),
        },
        "domain_warnings": deepcopy(built.get("domain_warnings", [])),
        "scoring": {
            "predicted_period_grade": scoring_result["predicted_period_grade"],
            "risk_assessment_status": RISK_ASSESSMENT_NOT_EVALUATED_CURRENT,
            "grade_model_trace": scoring_result.get("execution_trace", {}).get("grade_model"),
        },
        "evidence_fingerprint": evidence_fingerprint,
        "generation": {
            "reason": reason,
            "staff_id": staff_id,
            "role": "admin" if is_admin else "teacher",
        },
    }


def persisted_current_prediction_response(
    prediction: AIPrediction,
    status: str = "REPLAYED",
) -> dict[str, Any]:
    snapshot = prediction.evidence_snapshot or {}
    readiness = snapshot.get("readiness") or {}
    metadata = prediction_metadata(prediction)

    return {
        **metadata,
        "prediction_id": prediction.prediction_id,
        "revision": prediction.revision,
        "generation_status": status,
        "duplicate": status != "CREATED",
        "prediction_mode": ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
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
        "features": deepcopy(snapshot.get("raw_features_31", {})),
        "evidence_summary": deepcopy(snapshot.get("evidence_summary", {})),
        "domain_warnings": deepcopy(snapshot.get("domain_warnings", [])),
        "evidence_snapshot": deepcopy(snapshot),
        "evidence_cutoff_at": snapshot.get("scope", {}).get("cutoff_at"),
    }


def _record_request(
    db: Session,
    key: str | None,
    fingerprint: str,
    prediction: AIPrediction,
) -> None:
    if key and key.strip():
        db.add(
            PredictionGenerationRequest(
                request_id=key.strip(),
                request_fingerprint=fingerprint,
                prediction_id=prediction.prediction_id,
            )
        )
        db.flush()


def generate_current_period_from_records(
    db: Session,
    scope: dict[str, Any],
    *,
    generation_request_id: str | None = None,
    current_user: dict[str, Any] | None = None,
    is_admin: bool = False,
    staff_id: str | None = None,
    preview: bool = False,
    reason: str = "MANUAL_GENERATION",
) -> dict[str, Any]:
    """Execute the core generation workflow for CURRENT_PERIOD_FINAL_GRADE_PROJECTION."""
    # Ensure source == target for current period
    normalized_scope = dict(scope)
    if "academic_period_id" in normalized_scope:
        period_id = normalized_scope["academic_period_id"]
        normalized_scope.setdefault("source_period_id", period_id)
        normalized_scope.setdefault("target_period_id", period_id)
    elif "source_period_id" in normalized_scope and "target_period_id" not in normalized_scope:
        normalized_scope["target_period_id"] = normalized_scope["source_period_id"]

    clean_scope = validate_references(db, normalized_scope)
    validate_current_period_scope(
        db,
        clean_scope,
        current_user=current_user,
        is_admin=is_admin,
        staff_id=staff_id,
    )

    # Completed-request idempotency lookup:
    # A generation_request_id that already successfully produced and persisted
    # a prediction represents a completed immutable execution.
    # After trusted reference/scope/authorization checks, resolve the completed
    # request ledger BEFORE:
    # - current-period finalization checks;
    # - active model resolution;
    # - artifact/schema runtime verification;
    # - feature rebuilding;
    # - readiness checks;
    # - domain checks;
    # - scoring.
    req_fp = current_period_request_fingerprint(clean_scope, reason=reason)
    if generation_request_id and not preview:
        key = generation_request_id.strip()
        if not key:
            raise ValueError("generation_request_id cannot be blank.")
        prior = db.get(PredictionGenerationRequest, key)
        if prior:
            if prior.request_fingerprint != req_fp:
                raise PredictionConflict(
                    "generation_request_id was already used for a different logical request."
                )
            prediction = db.get(AIPrediction, prior.prediction_id)
            if not prediction:
                raise PredictionConflict(
                    "generation_request_id points to a missing prediction record."
                )
            snapshot = prediction.evidence_snapshot or {}
            purpose = snapshot.get("prediction_purpose") or getattr(prediction, "prediction_mode", None)
            if (
                prediction.student_id != clean_scope["student_id"]
                or prediction.class_id != clean_scope["class_id"]
                or prediction.subject_id != clean_scope["subject_id"]
                or prediction.source_period_id != clean_scope["source_period_id"]
                or prediction.target_period_id != clean_scope["target_period_id"]
                or (purpose and purpose != ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value)
            ):
                raise PredictionConflict(
                    "generation_request_id points to a prediction with conflicting scope or purpose."
                )
            return persisted_current_prediction_response(prediction, "REPLAYED")

    # If no completed ledger entry exists, continue normal new-execution flow:
    # Finalization guard: return explicit outcome if academic period is officially closed
    finalization = check_current_period_finalization(db, clean_scope)
    if finalization is not None:
        return finalization

    # Resolve strict CURRENT model
    model = get_active_model_version_by_purpose(
        db, ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION
    )
    if model.feature_schema_json.get("model_purpose") != ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value:
        raise ValueError("Registered model purpose is incompatible with current-period projection.")

    # Verify runtime artifact and schema SHA-256 integrity against manifest
    artifact_sha256, schema_sha256 = verify_runtime_model_integrity(model)

    cutoff = db.info.get("prediction_evidence_cutoff_at") or datetime.now(timezone.utc).isoformat()
    cutoff_dt = datetime.fromisoformat(cutoff) if isinstance(cutoff, str) else cutoff

    built = build_current_period_features_from_records(
        db,
        clean_scope["student_id"],
        clean_scope["class_id"],
        clean_scope["subject_id"],
        clean_scope["source_period_id"],
        cutoff_at=cutoff_dt,
    )

    ev_fp = build_current_period_evidence_fingerprint(
        scope=clean_scope,
        model_version=model,
        built=built,
        artifact_sha256=artifact_sha256,
        schema_sha256=schema_sha256,
    )

    latest = (
        db.query(AIPrediction)
        .filter(
            *(getattr(AIPrediction, k) == v for k, v in clean_scope.items()),
            AIPrediction.model_version_id == model.model_version_id,
        )
        .order_by(AIPrediction.revision.desc())
        .first()
    )

    if not preview and latest and (latest.evidence_snapshot or {}).get("evidence_fingerprint") == ev_fp:
        _record_request(db, generation_request_id, req_fp, latest)
        return persisted_current_prediction_response(latest, "UNCHANGED")

    # Readiness Gate
    if not built["ready"]:
        return {
            "generation_status": "NOT_READY",
            "ready": False,
            "readiness_level": built["readiness_level"],
            "readiness_reasons": list(built.get("readiness_reasons") or []),
            "predicted_period_grade": None,
            "features": deepcopy(built["features"]),
            "evidence_summary": deepcopy(built.get("evidence_summary", {})),
            "domain_warnings": deepcopy(built.get("domain_warnings", [])),
            "prediction_mode": ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
        }

    # Two-Tier Domain Warnings:
    # Tier 1 Blocking defects: UNSUPPORTED_SUBJECT, UNSUPPORTED_WEIGHT_PATTERN halt generation.
    # Tier 2 Domain warnings (e.g. FEATURE_BELOW_TRAINING_RANGE, FEATURE_ABOVE_TRAINING_RANGE):
    # Inference may proceed under current policy but remains outside observed training support
    # and carries a domain warning. (No claim is made that tree ensembles handle out-of-range
    # evidence smoothly or that this implies model validation.)
    blocking_warnings = [
        w for w in built.get("domain_warnings", []) if w.get("code") in BLOCKING_WARNING_CODES
    ]
    if blocking_warnings:
        return {
            "generation_status": "DOMAIN_INCOMPATIBLE",
            "ready": False,
            "blocking_reasons": [w.get("message") for w in blocking_warnings],
            "readiness_level": built["readiness_level"],
            "predicted_period_grade": None,
            "features": deepcopy(built["features"]),
            "domain_warnings": deepcopy(built.get("domain_warnings", [])),
            "evidence_summary": deepcopy(built.get("evidence_summary", {})),
            "prediction_mode": ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
        }

    # Model inference without RiskEngine
    scoring = score_current_period_prediction(
        db,
        built["features"],
        model_version=model,
        artifact_sha256=artifact_sha256,
    )

    validate_prediction_risk_contract(
        model_purpose=ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION,
        risk_assessment_status=RISK_ASSESSMENT_NOT_EVALUATED_CURRENT,
        risk_level=None,
        risk_score=None,
        data_status=None,
    )

    response = {
        **scoring,
        "ready": built["ready"],
        "readiness_level": built["readiness_level"],
        "prediction_mode": ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
        "features": deepcopy(built["features"]),
        "domain_warnings": deepcopy(built.get("domain_warnings", [])),
        "evidence_summary": deepcopy(built.get("evidence_summary", {})),
    }

    if preview:
        return {**response, "generation_status": "PREVIEW", "evidence_cutoff_at": cutoff}

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
        risk_assessment_status=RISK_ASSESSMENT_NOT_EVALUATED_CURRENT,
        generation_request_id=generation_request_id.strip() if generation_request_id else None,
    )
    db.add(prediction)
    db.flush()

    resolved_is_admin = is_admin or (current_user.get("role") == "admin" if current_user else False)
    resolved_staff_id = staff_id or (current_user.get("staff_id") if current_user else None)

    snapshot = build_current_period_evidence_snapshot(
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
        artifact_sha256=artifact_sha256,
        schema_sha256=schema_sha256,
        cutoff_at=str(cutoff),
        reason=reason,
    )
    prediction.evidence_snapshot = snapshot
    db.flush()

    _record_request(db, generation_request_id, req_fp, prediction)
    return persisted_current_prediction_response(prediction, "CREATED")


def generate_current_period_prediction(
    scope: dict[str, Any],
    *,
    generation_request_id: str | None = None,
    current_user: dict[str, Any] | None = None,
    is_admin: bool = False,
    staff_id: str | None = None,
    preview: bool = False,
    bind: Any = None,
    model_name: str = DEFAULT_CURRENT_MODEL_NAME,
    reason: str = "MANUAL_GENERATION",
) -> dict[str, Any]:
    """Execute generation inside the PostgreSQL advisory lock & REPEATABLE READ snapshot."""
    normalized_scope = dict(scope)
    if "academic_period_id" in normalized_scope:
        period_id = normalized_scope["academic_period_id"]
        normalized_scope.setdefault("source_period_id", period_id)
        normalized_scope.setdefault("target_period_id", period_id)
    elif "source_period_id" in normalized_scope and "target_period_id" not in normalized_scope:
        normalized_scope["target_period_id"] = normalized_scope["source_period_id"]

    return run_prediction_generation_transaction(
        normalized_scope,
        model_name,
        lambda db: generate_current_period_from_records(
            db,
            normalized_scope,
            generation_request_id=generation_request_id,
            current_user=current_user,
            is_admin=is_admin,
            staff_id=staff_id,
            preview=preview,
            reason=reason,
        ),
        bind=bind,
        generation_request_id=generation_request_id,
    )


def refresh_current_period_prediction_workflow(
    db: Session,
    prediction: AIPrediction,
    *,
    payload: Any | None = None,
    current_user: dict[str, Any] | None = None,
    staff_id: str | None = None,
) -> dict[str, Any]:
    """Execute explicit purpose-aware refresh workflow for a CURRENT prediction.

    Performs advisory fast-fail eligibility evaluation before entering transactional boundary,
    then executes generate_current_period_prediction under PostgreSQL advisory locking with reason=MANUAL_REFRESH.
    All invariants are re-validated authoritatively inside the transaction.
    """
    scope = {
        "student_id": prediction.student_id,
        "class_id": prediction.class_id,
        "subject_id": prediction.subject_id,
        "source_period_id": prediction.source_period_id,
        "target_period_id": prediction.target_period_id,
    }
    key = payload.generation_request_id if payload else None
    is_admin = (current_user.get("role") == "admin") if current_user else False
    resolved_staff_id = staff_id or (current_user.get("staff_id") if current_user else None)

    # Advisory eligibility evaluation (fast-fail)
    from app.services.prediction.CurrentPeriodPredictionFreshnessService import (
        evaluate_current_period_prediction_status,
    )
    advisory = evaluate_current_period_prediction_status(
        db,
        prediction,
        current_user=current_user,
        staff_id=resolved_staff_id,
    )
    eligibility = advisory.get("refresh_eligibility", {})
    if not eligibility.get("eligible"):
        status_label = eligibility.get("status", "INELIGIBLE")
        reasons = eligibility.get("reasons", [])
        readiness = advisory.get("evidence_readiness", {})
        metadata = prediction_metadata(prediction)
        return {
            **metadata,
            "generation_status": status_label,
            "ready": False,
            "readiness_level": readiness.get("level", status_label),
            "prediction_mode": ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
            "predicted_period_grade": None,
            "risk_level": None,
            "risk_score": None,
            "data_status": None,
            "risk_assessment_status": RISK_ASSESSMENT_NOT_EVALUATED_CURRENT,
            "message": reasons[0] if reasons else f"Current-period refresh ineligible: {status_label}",
            "reasons": reasons,
            "warnings": reasons,
            "features": {},
            "evidence_summary": {},
            "prediction_id": prediction.prediction_id,
            "student_id": prediction.student_id,
            "class_id": prediction.class_id,
            "subject_id": prediction.subject_id,
            "source_period_id": prediction.source_period_id,
            "target_period_id": prediction.target_period_id,
        }

    # Authoritative execution inside transactional boundary with advisory lock
    return generate_current_period_prediction(
        scope,
        generation_request_id=key,
        current_user=current_user,
        is_admin=is_admin,
        staff_id=resolved_staff_id,
        reason="MANUAL_REFRESH",
        bind=db.get_bind(),
    )

