"""Read-only AI estimate for capped WW/PT remediation what-if scenarios."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.services.prediction.DevelopmentCurrentTermPredictionService import (
    STATUS_DEVELOPMENT_PREDICTION_AVAILABLE,
    predict_development_current_term,
)


ESTIMATE_KIND = "AI_MIDTERM_WHAT_IF_ESTIMATE"


def _reason(code: str, message: str, assignment_id: int | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"code": code, "message": message}
    if assignment_id is not None:
        result["assignment_id"] = assignment_id
    return result


def _unavailable(
    *,
    model_version_id: int | None,
    model_name: str | None,
    reasons: list[dict[str, Any]],
    readiness: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "status": "UNAVAILABLE",
        "estimate_kind": ESTIMATE_KIND,
        "is_official_grade": False,
        "is_guaranteed": False,
        "model_version_id": model_version_id,
        "model_name": model_name,
        "prediction_purpose": "CURRENT_TERM_FINAL_GRADE_PROJECTION",
        "evidence_basis": "LIVE_ACTUAL_EVIDENCE_WITH_EPHEMERAL_CAPPED_WW_PT_OVERRIDES",
        "baseline_predicted_term_grade": None,
        "readiness": readiness or {},
        "target_estimates": [],
        "unavailable_reasons": reasons,
        "limitations": _limitations(),
    }


def _limitations() -> list[str]:
    return [
        "This is a development-model estimate, not an official or guaranteed subject grade.",
        "The estimate is associative rather than causal; a higher classwork score does not guarantee a higher model output.",
        "Reproduction requires the same evidence and the same immutable model artifact registered for this model version.",
        "A hypothetical feature combination may be less represented in training data than an observed evidence snapshot.",
        "No missing Examination score is fabricated, and AI output is not used as academic evidence.",
        "The baseline is recomputed from current live evidence, so it can differ from an older stored prediction snapshot.",
        "Hypothetical scores exist only for this calculation and are not submissions, awards, or persisted prediction snapshots.",
    ]


def calculate_ai_midterm_what_if(
    db: Session,
    *,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
    model_version_id: int | None,
    model_name: str | None,
    target_projections: list[dict[str, Any]],
) -> dict[str, Any]:
    """Replay the existing prediction pipeline with cumulative in-memory scores."""
    if model_version_id is None or not model_name:
        return _unavailable(
            model_version_id=model_version_id,
            model_name=model_name,
            reasons=[_reason("MODEL_VERSION_UNAVAILABLE", "The intervention's prediction model version is unavailable.")],
        )

    scope = {
        "student_id": student_id,
        "class_id": class_id,
        "subject_id": subject_id,
        "source_period_id": academic_period_id,
        "target_period_id": academic_period_id,
        "model_name": model_name,
    }
    try:
        baseline = predict_development_current_term(db, **scope)
    except Exception:
        return _unavailable(
            model_version_id=model_version_id,
            model_name=model_name,
            reasons=[_reason("MODEL_EVALUATION_UNAVAILABLE", "The selected prediction model could not evaluate the current evidence.")],
        )

    if baseline["status"] != STATUS_DEVELOPMENT_PREDICTION_AVAILABLE:
        codes = list(baseline.get("readiness_reason_codes") or []) or [baseline["status"]]
        return _unavailable(
            model_version_id=model_version_id,
            model_name=model_name,
            reasons=[
                _reason(code, "The existing prediction pipeline cannot produce a baseline for the current evidence.")
                for code in codes
            ],
            readiness=baseline.get("readiness_result"),
        )

    baseline_grade = float(baseline["projected_final_term_grade"])
    previous_grade = baseline_grade
    overrides: dict[int, float] = {}
    estimates: list[dict[str, Any]] = []
    for target in target_projections:
        assignment_id = int(target["assignment_id"])
        maximum = target.get("maximum_hypothetical_effective_score")
        if not target.get("applied") or maximum is None:
            continue
        if assignment_id in overrides:
            raise ValueError("Each original assignment may be adjusted only once in an AI what-if estimate.")
        overrides[assignment_id] = float(maximum)
        try:
            hypothetical = predict_development_current_term(
                db,
                **scope,
                hypothetical_ww_pt_scores=overrides,
            )
        except Exception:
            return _unavailable(
                model_version_id=model_version_id,
                model_name=model_name,
                reasons=[_reason(
                    "MODEL_EVALUATION_UNAVAILABLE",
                    "The selected prediction model could not evaluate the hypothetical evidence.",
                    assignment_id,
                )],
                readiness=baseline.get("readiness_result"),
            )
        if hypothetical["status"] != STATUS_DEVELOPMENT_PREDICTION_AVAILABLE:
            return _unavailable(
                model_version_id=model_version_id,
                model_name=model_name,
                reasons=[_reason(
                    "HYPOTHETICAL_PREDICTION_UNAVAILABLE",
                    "The existing prediction pipeline rejected the hypothetical evidence.",
                    assignment_id,
                )],
                readiness=hypothetical.get("readiness_result"),
            )
        grade = float(hypothetical["projected_final_term_grade"])
        estimates.append({
            "assignment_id": assignment_id,
            "maximum_hypothetical_effective_score": float(maximum),
            "hypothetical_predicted_term_grade": grade,
            "step_estimated_difference": grade - previous_grade,
            "estimated_difference_from_baseline": grade - baseline_grade,
        })
        previous_grade = grade

    return {
        "status": "AVAILABLE",
        "estimate_kind": ESTIMATE_KIND,
        "is_official_grade": False,
        "is_guaranteed": False,
        "model_version_id": model_version_id,
        "model_name": model_name,
        "prediction_purpose": baseline["prediction_purpose"],
        "evidence_basis": "LIVE_ACTUAL_EVIDENCE_WITH_EPHEMERAL_CAPPED_WW_PT_OVERRIDES",
        "baseline_predicted_term_grade": baseline_grade,
        "readiness": baseline.get("readiness_result") or {},
        "target_estimates": estimates,
        "unavailable_reasons": [],
        "limitations": _limitations(),
    }
