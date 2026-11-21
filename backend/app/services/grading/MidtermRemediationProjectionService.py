"""Read-only AI estimate for capped WW/PT remediation what-if scenarios."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.services.grading.RemediationGradeCeiling import (
    apply_remediation_grade_ceiling,
    validate_predicted_grade_ceiling,
)
from app.services.prediction.CurrentPeriodFeatureBuilderService import (
    _validate_exclude_intervention_id,
)
from app.services.prediction.DevelopmentCurrentTermPredictionService import (
    STATUS_DEVELOPMENT_PREDICTION_AVAILABLE,
    predict_development_current_term,
    prepare_development_current_term,
    score_prepared_development_current_term,
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
    selected_grade_ceiling: float | None = None,
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
        "unremediated_baseline_predicted_term_grade": None,
        "selected_grade_ceiling": selected_grade_ceiling,
        "effective_grade_ceiling": None,
        "baseline_remediation_adjusted_predicted_term_grade": None,
        "baseline_was_ceiling_applied": False,
        "readiness": readiness or {},
        "target_estimates": [],
        "unavailable_reasons": reasons,
        "limitations": _limitations(),
    }


def _limitations() -> list[str]:
    return [
        "This is a provisional Random Forest what-if prediction, not an official or guaranteed subject grade.",
        "The after-value assumes each selected original classwork receives its maximum capped effective score.",
        "The model may predict a lower or unchanged grade even when a classwork score improves because its learned response uses the complete feature vector and is not forced to be monotonic.",
        "A lower or unchanged remediation score does not lower the student's actual classwork score or official subject grade.",
        "When a remediation predicted-grade ceiling is applied, the remediation-adjusted projection is a policy limit on remediation-related gains and does not alter the raw Random Forest prediction or official gradebook scores.",
        "Reproduction requires the same evidence and the same immutable model artifact registered for this model version.",
        "No missing Examination score is fabricated, and AI output is not used as academic evidence.",
        "The baseline is recomputed from current live evidence (including previous graded remediation adjustments), so it can differ from an older stored prediction snapshot.",
        "Hypothetical scores and predictions exist only for this calculation and are not submissions, awards, or persisted prediction snapshots.",
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
    predicted_grade_ceiling: object | None = None,
    exclude_intervention_id: int | None = None,
) -> dict[str, Any]:
    """Run read-only Random Forest inference for cumulative capped WW/PT and Exam scenarios.

    When predicted_grade_ceiling is supplied (validated <= 85), also computes the
    unremediated baseline via exclude_intervention_id and returns both the raw
    Random Forest prediction and the policy-capped remediation projection without
    altering the raw model output. When predicted_grade_ceiling is None, legacy
    behavior is preserved with no extra baseline inference.
    """
    selected_ceiling_dec = (
        validate_predicted_grade_ceiling(predicted_grade_ceiling)
        if predicted_grade_ceiling is not None
        else None
    )
    selected_ceiling_float = float(selected_ceiling_dec) if selected_ceiling_dec is not None else None
    excluded_id = _validate_exclude_intervention_id(exclude_intervention_id)

    if model_version_id is None or not model_name:
        return _unavailable(
            model_version_id=model_version_id,
            model_name=model_name,
            reasons=[_reason("MODEL_VERSION_UNAVAILABLE", "The intervention's prediction model version is unavailable.")],
            selected_grade_ceiling=selected_ceiling_float,
        )

    if selected_ceiling_dec is not None and excluded_id is None:
        return _unavailable(
            model_version_id=model_version_id,
            model_name=model_name,
            reasons=[_reason(
                "UNREMEDIATED_BASELINE_UNAVAILABLE",
                "An explicit exclude_intervention_id is required to compute the unremediated baseline when applying a remediation grade ceiling.",
            )],
            selected_grade_ceiling=selected_ceiling_float,
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
            selected_grade_ceiling=selected_ceiling_float,
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
            selected_grade_ceiling=selected_ceiling_float,
        )

    baseline_grade = float(baseline["projected_final_term_grade"])

    unremediated_baseline_grade: float | None = None
    effective_grade_ceiling: float | None = None
    baseline_capped_grade: float | None = None
    baseline_was_ceiling_applied = False
    if selected_ceiling_dec is not None:
        try:
            unremediated, prepared_unremediated = prepare_development_current_term(
                db,
                **scope,
                exclude_intervention_id=excluded_id,
            )
        except Exception:
            return _unavailable(
                model_version_id=model_version_id,
                model_name=model_name,
                reasons=[_reason(
                    "UNREMEDIATED_BASELINE_UNAVAILABLE",
                    "The selected prediction model could not evaluate the unremediated baseline evidence.",
                )],
                readiness=baseline.get("readiness_result"),
                selected_grade_ceiling=selected_ceiling_float,
            )
        if (
            unremediated["status"] != STATUS_DEVELOPMENT_PREDICTION_AVAILABLE
            or prepared_unremediated is None
        ):
            codes = list(unremediated.get("readiness_reason_codes") or []) or [unremediated["status"]]
            return _unavailable(
                model_version_id=model_version_id,
                model_name=model_name,
                reasons=[
                    _reason(
                        "UNREMEDIATED_BASELINE_UNAVAILABLE",
                        "The unremediated baseline prediction is unavailable for this intervention.",
                    ),
                    *[
                        _reason(code, "The existing prediction pipeline cannot produce an unremediated baseline.")
                        for code in codes
                    ],
                ],
                readiness=unremediated.get("readiness_result") or baseline.get("readiness_result"),
                selected_grade_ceiling=selected_ceiling_float,
            )
        if baseline_features and prepared_unremediated["features"] == baseline_features:
            unremediated_baseline_grade = baseline_grade
        else:
            try:
                scored_unremediated = score_prepared_development_current_term(
                    unremediated,
                    prepared_unremediated,
                )
            except Exception:
                return _unavailable(
                    model_version_id=model_version_id,
                    model_name=model_name,
                    reasons=[_reason(
                        "UNREMEDIATED_BASELINE_UNAVAILABLE",
                        "The selected prediction model could not score the unremediated baseline evidence.",
                    )],
                    readiness=unremediated.get("readiness_result") or baseline.get("readiness_result"),
                    selected_grade_ceiling=selected_ceiling_float,
                )
            unremediated_baseline_grade = float(scored_unremediated["projected_final_term_grade"])
        try:
            baseline_policy = apply_remediation_grade_ceiling(
                raw_prediction=baseline_grade,
                unremediated_baseline=unremediated_baseline_grade,
                selected_ceiling=selected_ceiling_dec,
            )
        except (TypeError, ValueError):
            return _unavailable(
                model_version_id=model_version_id,
                model_name=model_name,
                reasons=[_reason(
                    "MODEL_EVALUATION_UNAVAILABLE",
                    "The baseline prediction could not be evaluated against the remediation grade ceiling.",
                )],
                readiness=baseline.get("readiness_result"),
                selected_grade_ceiling=selected_ceiling_float,
            )
        effective_grade_ceiling = float(baseline_policy.effective_ceiling)
        baseline_capped_grade = float(baseline_policy.capped_projection)
        baseline_was_ceiling_applied = baseline_policy.was_ceiling_applied

    previous_grade = baseline_grade
    previous_capped_grade = baseline_capped_grade
    overrides: dict[int, float] = {}
    exam_overrides: dict[int, float] = {}
    estimates: list[dict[str, Any]] = []
    for target in target_projections:
        assignment_id = int(target["assignment_id"])
        maximum = target.get("maximum_hypothetical_effective_score")
        if not target.get("applied") or maximum is None:
            continue
        if assignment_id in overrides or assignment_id in exam_overrides:
            raise ValueError("Each original assignment may be adjusted only once in an AI what-if estimate.")
        if str(target.get("component") or "").upper() in {"EXAMINATION", "ASSESSMENT"}:
            exam_overrides[assignment_id] = float(maximum)
        else:
            overrides[assignment_id] = float(maximum)
        prepare_kwargs: dict[str, Any] = {
            **scope,
            "hypothetical_ww_pt_scores": overrides or None,
        }
        if exam_overrides:
            prepare_kwargs["hypothetical_exam_scores"] = exam_overrides
        try:
            hypothetical, prepared_hypothetical = prepare_development_current_term(
                db,
                **prepare_kwargs,
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
                selected_grade_ceiling=selected_ceiling_float,
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
                selected_grade_ceiling=selected_ceiling_float,
            )
        try:
            scored_hypothetical = score_prepared_development_current_term(
                hypothetical,
                prepared_hypothetical,
            )
        except Exception:
            return _unavailable(
                model_version_id=model_version_id,
                model_name=model_name,
                reasons=[_reason(
                    "MODEL_EVALUATION_UNAVAILABLE",
                    "The selected prediction model could not score the hypothetical evidence.",
                    assignment_id,
                )],
                readiness=hypothetical.get("readiness_result"),
                selected_grade_ceiling=selected_ceiling_float,
            )
        grade = float(scored_hypothetical["projected_final_term_grade"])

        remediation_adjusted_grade: float | None = None
        applied_ceiling: float | None = None
        was_ceiling_applied = False
        capped_step_diff: float | None = None
        capped_baseline_diff: float | None = None
        if selected_ceiling_dec is not None and unremediated_baseline_grade is not None:
            try:
                target_policy = apply_remediation_grade_ceiling(
                    raw_prediction=grade,
                    unremediated_baseline=unremediated_baseline_grade,
                    selected_ceiling=selected_ceiling_dec,
                )
            except (TypeError, ValueError):
                return _unavailable(
                    model_version_id=model_version_id,
                    model_name=model_name,
                    reasons=[_reason(
                        "MODEL_EVALUATION_UNAVAILABLE",
                        "The hypothetical prediction could not be evaluated against the remediation grade ceiling.",
                        assignment_id,
                    )],
                    readiness=hypothetical.get("readiness_result"),
                    selected_grade_ceiling=selected_ceiling_float,
                )
            remediation_adjusted_grade = float(target_policy.capped_projection)
            applied_ceiling = float(target_policy.effective_ceiling)
            was_ceiling_applied = target_policy.was_ceiling_applied
            if previous_capped_grade is not None and baseline_capped_grade is not None:
                capped_step_diff = round(remediation_adjusted_grade - previous_capped_grade, 6)
                capped_baseline_diff = round(remediation_adjusted_grade - baseline_capped_grade, 6)
            previous_capped_grade = remediation_adjusted_grade

        estimates.append({
            "assignment_id": assignment_id,
            "maximum_hypothetical_effective_score": float(maximum),
            "hypothetical_predicted_term_grade": grade,
            "raw_hypothetical_predicted_term_grade": grade,
            "remediation_adjusted_predicted_term_grade": remediation_adjusted_grade,
            "applied_grade_ceiling": applied_ceiling,
            "was_ceiling_applied": was_ceiling_applied,
            "step_estimated_difference": round(grade - previous_grade, 6),
            "estimated_difference_from_baseline": round(grade - baseline_grade, 6),
            "capped_step_estimated_difference": capped_step_diff,
            "capped_estimated_difference_from_baseline": capped_baseline_diff,
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
        "unremediated_baseline_predicted_term_grade": unremediated_baseline_grade,
        "selected_grade_ceiling": selected_ceiling_float,
        "effective_grade_ceiling": effective_grade_ceiling,
        "baseline_remediation_adjusted_predicted_term_grade": baseline_capped_grade,
        "baseline_was_ceiling_applied": baseline_was_ceiling_applied,
        "readiness": baseline.get("readiness_result") or {},
        "target_estimates": estimates,
        "unavailable_reasons": [],
        "limitations": _limitations(),
    }
