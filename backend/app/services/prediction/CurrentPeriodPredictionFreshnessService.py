"""Read-only, side-effect free freshness and model currency evaluator for CURRENT_PERIOD_FINAL_GRADE_PROJECTION.

Evaluates four distinct concepts:
- evidence_readiness: from CurrentPeriodFeatureBuilderService
- projection_freshness: compares live academic evidence against the persisted prediction's model context
- model_currency: compares persisted model_version_id against active CURRENT model
- refresh_eligibility: evaluates whether explicit refresh can proceed

Performs zero model scoring, zero database insertions, zero ledger writes, zero RiskEngine invocations,
and zero snapshot mutations.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.AIPrediction import AIPrediction
from app.services.prediction.CurrentPeriodFeatureBuilderService import (
    build_current_period_features_from_records,
    validate_current_period_schema_identity,
)
from app.services.prediction.CurrentPeriodPredictionGenerationService import (
    BLOCKING_WARNING_CODES,
    build_current_period_evidence_fingerprint,
    check_current_period_finalization,
    validate_current_period_scope,
)
from app.services.prediction.ModelRegistryExceptions import ActiveModelNotFound
from app.services.prediction.ModelScoringService import (
    get_active_model_version_by_purpose,
    resolve_artifact_path,
)
from app.services.prediction.ModelVersionService import compute_file_sha256, load_json
from app.services.prediction.PredictionScopeService import prediction_metadata


def _summarize_prediction(prediction: AIPrediction | None) -> dict[str, Any] | None:
    if prediction is None:
        return None
    snapshot = prediction.evidence_snapshot or {}
    readiness = snapshot.get("readiness") or {}
    metadata = prediction_metadata(prediction)
    return {
        **metadata,
        "prediction_id": prediction.prediction_id,
        "revision": prediction.revision,
        "model_version_id": prediction.model_version_id,
        "student_id": str(prediction.student_id),
        "class_id": prediction.class_id,
        "subject_id": prediction.subject_id,
        "source_period_id": prediction.source_period_id,
        "target_period_id": prediction.target_period_id,
        "predicted_period_grade": float(prediction.predicted_period_grade) if prediction.predicted_period_grade is not None else None,
        "risk_level": prediction.risk_level,
        "risk_score": float(prediction.risk_score) if prediction.risk_score is not None else None,
        "data_status": prediction.data_status,
        "risk_assessment_status": prediction.risk_assessment_status,
        "generated_at": prediction.generated_at,
        "ready": readiness.get("status") == "READY",
        "readiness_level": readiness.get("level", "UNKNOWN"),
        "readiness_reasons": readiness.get("reasons", []),
        "evidence_cutoff_at": snapshot.get("scope", {}).get("cutoff_at"),
        "evidence_fingerprint": snapshot.get("evidence_fingerprint"),
    }


def get_latest_current_period_prediction(
    db: Session,
    scope: dict[str, Any],
) -> tuple[AIPrediction | None, AIModelVersion | None, str]:
    """Return (prediction, active_model, currency_status) using deterministic 2-phase query rule.

    Phase 1: Check active CURRENT model predictions for this exact scope (highest revision).
    Phase 2: Historical fallback to most recent CURRENT prediction across older models (generated_at DESC, prediction_id DESC).
    """
    try:
        active_model = get_active_model_version_by_purpose(
            db, ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION
        )
    except (ActiveModelNotFound, Exception):
        active_model = None

    exact_scope = [
        AIPrediction.student_id == scope["student_id"],
        AIPrediction.class_id == scope["class_id"],
        AIPrediction.subject_id == scope["subject_id"],
        AIPrediction.source_period_id == scope["source_period_id"],
        AIPrediction.target_period_id == scope["target_period_id"],
    ]

    # Phase 1: Active-model prediction lookup
    if active_model is not None:
        active_pred = (
            db.query(AIPrediction)
            .filter(*exact_scope, AIPrediction.model_version_id == active_model.model_version_id)
            .order_by(AIPrediction.revision.desc(), AIPrediction.prediction_id.desc())
            .first()
        )
        if active_pred is not None:
            return active_pred, active_model, "CURRENT_MODEL"

    # Phase 2: Historical fallback across older model versions
    historical_pred = (
        db.query(AIPrediction)
        .join(AIModelVersion, AIPrediction.model_version_id == AIModelVersion.model_version_id)
        .filter(
            *exact_scope,
            AIModelVersion.model_purpose == ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
        )
        .order_by(AIPrediction.generated_at.desc(), AIPrediction.prediction_id.desc())
        .first()
    )

    if historical_pred is not None:
        currency = "MODEL_UPDATE_AVAILABLE" if active_model is not None else "MODEL_UNAVAILABLE"
        return historical_pred, active_model, currency

    currency = "NO_PROJECTION" if active_model is not None else "MODEL_UNAVAILABLE"
    return None, active_model, currency


def is_prebuilt_evidence_compatible(
    prebuilt_evidence: dict[str, Any],
    eval_target: AIPrediction,
    target_model: AIModelVersion,
) -> bool:
    """Verify exact persisted model/evidence contract before reusing prebuilt evidence.

    Before reusing prebuilt evidence for projection freshness, verify the exact
    persisted model/evidence contract using at least:
    - model_version_id
    - schema SHA-256 / schema identity
    - evidence contract version where applicable
    """
    snapshot = eval_target.evidence_snapshot or {}
    model_info = snapshot.get("model") or {}

    # 1. Model name / schema identity
    target_model_name = model_info.get("model_name") or target_model.model_name
    prebuilt_model_name = prebuilt_evidence.get("model_name")
    if prebuilt_model_name != target_model_name:
        return False

    # 2. Model version ID
    target_version_id = model_info.get("model_version_id") or eval_target.model_version_id
    prebuilt_version_id = prebuilt_evidence.get("model_version_id")
    if prebuilt_version_id is not None and target_version_id is not None:
        if prebuilt_version_id != target_version_id:
            return False

    # 3. Schema SHA-256 / schema identity
    target_schema_sha = model_info.get("schema_sha256")
    prebuilt_schema_sha = prebuilt_evidence.get("schema_sha256")
    if target_schema_sha and prebuilt_schema_sha:
        if target_schema_sha != prebuilt_schema_sha:
            return False

    # 4. Evidence contract version
    target_contract = snapshot.get("evidence_contract_version") or snapshot.get("snapshot_version")
    prebuilt_contract = (
        prebuilt_evidence.get("evidence_contract_version")
        or prebuilt_evidence.get("snapshot_version")
        or prebuilt_evidence.get("contract")
    )
    if target_contract and prebuilt_contract:
        if target_contract != prebuilt_contract:
            return False

    return True


def evaluate_current_period_prediction_status(
    db: Session,
    target: AIPrediction | dict[str, Any],
    *,
    current_user: dict[str, Any] | None = None,
    staff_id: str | None = None,
    prebuilt_evidence: dict[str, Any] | None = None,
    preloaded_active_model: AIModelVersion | None = None,
    preloaded_latest_prediction: AIPrediction | None = None,
    preloaded_finalization: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Execute read-only, side-effect free status evaluation for a CURRENT prediction or scope."""
    if isinstance(target, AIPrediction):
        requested_pred: AIPrediction | None = target
        clean_scope = {
            "student_id": target.student_id,
            "class_id": target.class_id,
            "subject_id": target.subject_id,
            "source_period_id": target.source_period_id,
            "target_period_id": target.target_period_id,
        }
    else:
        requested_pred = None
        clean_scope = {
            "student_id": UUID(str(target["student_id"])),
            "class_id": int(target["class_id"]),
            "subject_id": int(target["subject_id"]),
            "source_period_id": int(target["source_period_id"]),
            "target_period_id": int(target.get("target_period_id", target["source_period_id"])),
        }

    # Deterministic lookup of the latest CURRENT prediction for the scope
    if preloaded_latest_prediction is not None or preloaded_active_model is not None:
        latest_pred = preloaded_latest_prediction
        active_model = preloaded_active_model
    else:
        latest_pred, active_model, scope_currency = get_latest_current_period_prediction(db, clean_scope)
    eval_target = requested_pred or latest_pred

    # Build or reuse fresh live academic evidence without scoring or mutating anything
    built: dict[str, Any] | None = None
    target_model = None
    if eval_target is not None:
        target_model = eval_target.model_version or db.get(AIModelVersion, eval_target.model_version_id)

    if prebuilt_evidence is not None:
        if eval_target is None:
            built = prebuilt_evidence
        elif target_model is not None and is_prebuilt_evidence_compatible(prebuilt_evidence, eval_target, target_model):
            built = prebuilt_evidence

    if built is None:
        try:
            if eval_target is not None:
                # Rebuild using the persisted model/schema context
                if target_model is None:
                    built = None
                else:
                    target_schema = target_model.feature_schema_json
                    if target_schema is None and target_model.artifact_path:
                        try:
                            resolved = resolve_artifact_path(target_model.artifact_path)
                            schema_path = resolved.with_name(f"{target_model.model_name}_feature_schema.json")
                            if schema_path.exists():
                                target_schema = load_json(schema_path)
                        except Exception:
                            pass
                    if target_schema is None:
                        built = None
                    else:
                        validate_current_period_schema_identity(target_schema)
                        built = build_current_period_features_from_records(
                            db,
                            clean_scope["student_id"],
                            clean_scope["class_id"],
                            clean_scope["subject_id"],
                            clean_scope["source_period_id"],
                            schema=target_schema,
                        )
            else:
                built = build_current_period_features_from_records(
                    db,
                    clean_scope["student_id"],
                    clean_scope["class_id"],
                    clean_scope["subject_id"],
                    clean_scope["source_period_id"],
                )
        except Exception:
            built = None

    # 1. evidence_readiness: directly reuse CurrentPeriodFeatureBuilderService as single source of truth
    readiness_source = built or prebuilt_evidence or {}
    evidence_readiness = {
        "level": readiness_source.get("readiness_level", "INSUFFICIENT_EVIDENCE"),
        "ready": bool(readiness_source.get("ready", False)),
        "reasons": list(readiness_source.get("readiness_reasons") or []),
    }

    # 2. projection_freshness: evaluate against eval_target's persisted model context
    if eval_target is None:
        projection_freshness = {
            "status": "NO_PROJECTION",
            "saved_fingerprint": None,
            "current_fingerprint": None,
            "reasons": ["No projection exists for this scope."],
        }
    else:
        snapshot = eval_target.evidence_snapshot or {}
        stored_ev_fp = snapshot.get("evidence_fingerprint")
        target_model = target_model or eval_target.model_version or db.get(AIModelVersion, eval_target.model_version_id)
        model_info = snapshot.get("model") or {}
        artifact_sha = model_info.get("artifact_sha256")
        schema_sha = model_info.get("schema_sha256")

        if target_model is None or not stored_ev_fp or built is None:
            projection_freshness = {
                "status": "FRESHNESS_UNAVAILABLE",
                "saved_fingerprint": stored_ev_fp,
                "current_fingerprint": None,
                "reasons": ["Persisted model context is incomplete or unavailable for fingerprint comparison."],
            }
        else:
            try:
                fresh_ev_fp = build_current_period_evidence_fingerprint(
                    scope=clean_scope,
                    model_version=target_model,
                    built=built,
                    artifact_sha256=artifact_sha,
                    schema_sha256=schema_sha,
                )
                if fresh_ev_fp == stored_ev_fp:
                    projection_freshness = {
                        "status": "CURRENT",
                        "saved_fingerprint": stored_ev_fp,
                        "current_fingerprint": fresh_ev_fp,
                        "reasons": [],
                    }
                else:
                    projection_freshness = {
                        "status": "SOURCE_EVIDENCE_CHANGED",
                        "saved_fingerprint": stored_ev_fp,
                        "current_fingerprint": fresh_ev_fp,
                        "reasons": ["Source academic evidence has changed since this prediction was persisted."],
                    }
            except Exception as exc:
                projection_freshness = {
                    "status": "FRESHNESS_UNAVAILABLE",
                    "saved_fingerprint": stored_ev_fp,
                    "current_fingerprint": None,
                    "reasons": [f"Persisted model context cannot be safely reconstructed: {exc}"],
                }

    # 3. model_currency: evaluate eval_target against active_model
    if eval_target is None:
        if active_model is not None:
            model_currency = {
                "status": "NO_PROJECTION",
                "persisted_model_version_id": None,
                "active_model_version_id": active_model.model_version_id,
                "persisted_model_name": None,
                "active_model_name": active_model.model_name,
            }
        else:
            model_currency = {
                "status": "MODEL_UNAVAILABLE",
                "persisted_model_version_id": None,
                "active_model_version_id": None,
                "persisted_model_name": None,
                "active_model_name": None,
            }
    else:
        persisted_name = eval_target.model_version.model_name if eval_target.model_version else None
        if active_model is None:
            model_currency = {
                "status": "MODEL_UNAVAILABLE",
                "persisted_model_version_id": eval_target.model_version_id,
                "active_model_version_id": None,
                "persisted_model_name": persisted_name,
                "active_model_name": None,
            }
        elif eval_target.model_version_id == active_model.model_version_id:
            model_currency = {
                "status": "CURRENT_MODEL",
                "persisted_model_version_id": eval_target.model_version_id,
                "active_model_version_id": active_model.model_version_id,
                "persisted_model_name": persisted_name,
                "active_model_name": active_model.model_name,
            }
        else:
            model_currency = {
                "status": "MODEL_UPDATE_AVAILABLE",
                "persisted_model_version_id": eval_target.model_version_id,
                "active_model_version_id": active_model.model_version_id,
                "persisted_model_name": persisted_name,
                "active_model_name": active_model.model_name,
            }

    # 4. refresh_eligibility: advisory evaluation of whether explicit refresh can proceed
    if preloaded_finalization is not None:
        finalization = preloaded_finalization if preloaded_finalization.get("is_finalized") else None
    else:
        finalization = check_current_period_finalization(db, clean_scope)
    auth_error = None
    if current_user is not None or staff_id is not None:
        try:
            validate_current_period_scope(
                db,
                clean_scope,
                current_user=current_user,
                is_admin=(current_user.get("role") == "admin") if current_user else False,
                staff_id=staff_id or (current_user.get("staff_id") if current_user else None),
            )
        except PermissionError as exc:
            auth_error = str(exc)

    live_evidence = built or prebuilt_evidence or {}
    blocking_warnings = [
        w for w in live_evidence.get("domain_warnings", []) if w.get("code") in BLOCKING_WARNING_CODES
    ]

    if auth_error:
        refresh_eligibility = {
            "status": "UNAUTHORIZED",
            "eligible": False,
            "reasons": [auth_error],
        }
    elif finalization is not None:
        refresh_eligibility = {
            "status": "FINALIZED",
            "eligible": False,
            "reasons": [finalization.get("message", "Academic period is officially finalized.")],
        }
    elif active_model is None:
        refresh_eligibility = {
            "status": "MODEL_UNAVAILABLE",
            "eligible": False,
            "reasons": ["No active CURRENT model version is registered."],
        }
    elif not live_evidence.get("ready"):
        refresh_eligibility = {
            "status": "NOT_READY",
            "eligible": False,
            "reasons": list(live_evidence.get("readiness_reasons") or ["Live academic evidence is not ready."]),
        }
    elif blocking_warnings:
        refresh_eligibility = {
            "status": "OUT_OF_DOMAIN",
            "eligible": False,
            "reasons": [w.get("message") for w in blocking_warnings],
        }
    else:
        refresh_eligibility = {
            "status": "ELIGIBLE",
            "eligible": True,
            "reasons": [],
        }

    return {
        "evidence_readiness": evidence_readiness,
        "projection_freshness": projection_freshness,
        "model_currency": model_currency,
        "refresh_eligibility": refresh_eligibility,
        "requested_prediction": _summarize_prediction(requested_pred),
        "latest_prediction": _summarize_prediction(latest_pred),
        "domain_warnings": deepcopy(live_evidence.get("domain_warnings", [])),
    }
