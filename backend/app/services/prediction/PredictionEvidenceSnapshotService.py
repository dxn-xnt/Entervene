"""Immutable Stage 3B execution snapshots for audited predictions."""

from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
from typing import Any

from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.services.prediction.FeatureCatalog import feature_definition


SNAPSHOT_VERSION = "prediction-evidence-v1"
EVIDENCE_CONTRACT_VERSION = "phase1-stage3b-v1"


def generation_request_fingerprint(scope: dict[str, Any], model_name: str) -> str:
    material = "|".join(str(scope.get(name)) for name in (
        "student_id", "class_id", "subject_id", "source_period_id", "target_period_id"
    )) + f"|{model_name}"
    return sha256(material.encode("utf-8")).hexdigest()


def _state(feature: str, value: Any, summary: dict[str, Any]) -> str:
    mapping = {
        "assessment_completion_rate": summary.get("completion_state"),
        "data_coverage_ratio": summary.get("coverage_state"),
        "late_submission_count": summary.get("late_state"),
        "risk_adjusted_attendance_rate": summary.get("attendance_state"),
    }
    state = mapping.get(feature)
    if state:
        return state
    if feature == "source_period_grade":
        return "AVAILABLE" if summary.get("source_grade_provenance") != "NONE" else "NO_RECORDED_DATA"
    return "AVAILABLE" if value is not None else "NO_RECORDED_DATA"


def _observed_evidence(features: dict[str, Any], summary: dict[str, Any]) -> dict[str, Any]:
    observations: dict[str, Any] = {}
    count_metadata = {
        "assessment_completion_rate": (summary.get("completed_count"), summary.get("expected_count")),
        "data_coverage_ratio": (summary.get("graded_count"), summary.get("expected_count")),
        "risk_adjusted_attendance_rate": (summary.get("attendance_total_days"), None),
    }
    for identifier, value in features.items():
        definition = feature_definition(identifier)
        numerator, denominator = count_metadata.get(identifier, (None, None))
        unit = definition.unit if definition else "NUMERIC"
        scale = definition.scale if definition else "MODEL_NATIVE"
        if identifier in {"assessment_completion_rate", "data_coverage_ratio"}:
            unit, scale = "PERCENTAGE", "ZERO_TO_ONE"
        elif identifier in {"risk_adjusted_attendance_rate", "behavioral_engagement_score"}:
            unit, scale = "SCORE", "ZERO_TO_100"
        observations[identifier] = {
            "canonical_feature_identifier": definition.identifier if definition else identifier,
            "raw_observed_value": value,
            "unit": unit,
            "scale": scale,
            "evidence_state": _state(identifier, value, summary),
            "numerator": numerator,
            "denominator": denominator,
            "source_type": "PREDICTION_FEATURE_BUILD",
            "source_record_ids": summary.get("source_record_ids", {}).get(identifier, []),
            "captured_source_values": summary.get("captured_source_values", {}).get(identifier),
            "grade_provenance": summary.get("source_grade_provenance") if identifier == "source_period_grade" else None,
        }
    return observations


def build_evidence_snapshot(
    db: Session,
    *,
    scope: dict[str, Any],
    model_name: str,
    built: dict[str, Any],
    scoring_result: dict[str, Any] | None,
    generation_request_id: str | None = None,
) -> dict[str, Any]:
    source = db.get(AcademicPeriod, scope["source_period_id"])
    target = db.get(AcademicPeriod, scope["target_period_id"])
    if source is None or target is None:
        raise ValueError("Prediction snapshot scope periods were not found.")
    summary = built.get("evidence_summary") or {}
    features = built.get("features") or {}
    now = datetime.now(timezone.utc).isoformat()
    readiness = {
        "status": "READY" if built.get("ready") else "NOT_READY",
        "level": built.get("readiness_level"),
        "checks_evaluated": {
            "source_period_grade": features.get("source_period_grade"),
            "activity_completion_rate": features.get("assessment_completion_rate"),
            "grade_coverage_ratio": features.get("data_coverage_ratio"),
            "completion_threshold": 0.50,
            "coverage_threshold": 0.50,
        },
        "failures": list(built.get("readiness_reasons") or []),
        "model_vector_validation": (
            {"status": "VALIDATED"} if built.get("ready") else {"status": "SKIPPED", "reason": "READINESS_NOT_MET"}
        ),
    }
    if scoring_result is None:
        grade_model = {"status": "SKIPPED", "reason": readiness["failures"] or ["READINESS_NOT_MET"]}
        risk_engine = {"status": "SKIPPED", "reason": "GRADE_MODEL_NOT_EXECUTED"}
        transformations: list[dict[str, Any]] = []
    else:
        trace = scoring_result.get("execution_trace") or {}
        grade_model = trace.get("grade_model") or {"status": "EXECUTED"}
        risk_engine = trace.get("risk_engine") or {"status": "EXECUTED"}
        transformations = trace.get("model_transformations") or []
    return {
        "snapshot_version": SNAPSHOT_VERSION,
        "evidence_contract_version": EVIDENCE_CONTRACT_VERSION,
        "captured_at": now,
        "scope": {
            "student_id": str(scope["student_id"]), "class_id": scope["class_id"], "subject_id": scope["subject_id"],
            "academic_year_id": source.academic_year_id,
            "source_period_id": source.academic_period_id, "target_period_id": target.academic_period_id,
            "source_period_name": source.period_name,
            "target_period_name": target.period_name,
            "source_period_boundaries": {"start": source.start_date.isoformat(), "end": source.end_date.isoformat()},
            "target_period_boundaries": {"start": target.start_date.isoformat(), "end": target.end_date.isoformat()},
            "generation_cutoff": summary.get("generation_cutoff_date"),
            "generation_request_id": generation_request_id,
            "request_fingerprint": generation_request_fingerprint(scope, model_name),
        },
        "observed_evidence": _observed_evidence(features, summary),
        "learning_participation": summary.get("learning_participation"),
        "model_transformations": transformations,
        "readiness": readiness,
        "grade_model": grade_model,
        "risk_engine": risk_engine,
    }
