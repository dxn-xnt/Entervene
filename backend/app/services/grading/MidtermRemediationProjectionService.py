"""Read-only AI estimate for capped WW/PT remediation what-if scenarios."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.services.prediction.DevelopmentCurrentTermPredictionService import (
    STATUS_DEVELOPMENT_PREDICTION_AVAILABLE,
     predict_development_current_term,
    prepare_development_current_term,
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
        "This is a provisional AI-assisted remediation estimate, not a raw model prediction or an official or guaranteed subject grade.",
        "The what-if estimate combines the live AI baseline prediction with the mathematically justified weighted component grade impact of the capped classwork gain.",
        "A lower or unchanged remediation score does not lower the student's actual classwork score or official subject grade.",
        "Reproduction requires the same evidence and the same immutable model artifact registered for this model version.",
        "No missing Examination score is fabricated, and AI output is not used as academic evidence.",
        "The baseline is recomputed from current live evidence (including previous graded remediation adjustments), so it can differ from an older stored prediction snapshot.",
        "Hypothetical scores exist only for this calculation and are not submissions, awards, or persisted prediction snapshots.",
    ]


def _calculate_weighted_component_grade_gain(
    *,
    baseline_features: dict[str, Any],
    hypothetical_features: dict[str, Any],
) -> float | None:
    """Compute the deterministic weighted subject-grade impact from capped WW/PT score gains.

    For each component c in {ww, pt}:
        delta_earned_c = E_c_hyp - E_c_base
        delta_ps_c = (delta_earned_c / P_c) * 100
        delta_ws_c = delta_ps_c * (W_c / 100) = (delta_earned_c / P_c) * W_c
    """
    total_weighted_gain = 0.0
    for prefix in ("ww", "pt"):
        base_earned = float(baseline_features.get(f"{prefix}_points_earned_so_far") or 0.0)
        hyp_earned = float(hypothetical_features.get(f"{prefix}_points_earned_so_far") or 0.0)
        delta_earned = hyp_earned - base_earned
        if abs(delta_earned) <= 1e-12:
            continue
        if delta_earned < -1e-12:
            return None
        possible = float(hypothetical_features.get(f"{prefix}_points_possible_so_far") or 0.0)
        weight = float(hypothetical_features.get(f"{prefix}_weight") or 0.0)
        if possible <= 0.0 or weight <= 0.0:
            return None
        total_weighted_gain += (delta_earned / possible) * weight
    return round(total_weighted_gain, 6)


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
    """Combine the live AI baseline prediction with cumulative weighted WW/PT remediation impacts."""
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
    baseline_features: dict[str, Any] = {}
    try:
        baseline = predict_development_current_term(
            db,
            **scope,
            scored_features_out=baseline_features,
        )
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
            hypothetical, prepared_hypothetical = prepare_development_current_term(
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
        if (
            hypothetical["status"] != STATUS_DEVELOPMENT_PREDICTION_AVAILABLE
            or prepared_hypothetical is None
        ):
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
        weighted_gain = _calculate_weighted_component_grade_gain(
            baseline_features=baseline_features,
            hypothetical_features=prepared_hypothetical["features"],
        )
        if weighted_gain is None:
            return _unavailable(
                model_version_id=model_version_id,
                model_name=model_name,
                reasons=[_reason(
                    "GRADING_WEIGHT_UNAVAILABLE",
                    "Component possible points or grading weights are unavailable for hybrid impact calculation.",
                    assignment_id,
                )],
                readiness=hypothetical.get("readiness_result"),
            )
        grade = min(100.0, round(baseline_grade + weighted_gain, 6))
        estimates.append({
            "assignment_id": assignment_id,
            "maximum_hypothetical_effective_score": float(maximum),
            "hypothetical_predicted_term_grade": grade,
            "step_estimated_difference": round(grade - previous_grade, 6),
            "estimated_difference_from_baseline": round(grade - baseline_grade, 6),
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
