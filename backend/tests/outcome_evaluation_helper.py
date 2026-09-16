"""Authoritative Outcome-Evaluation Revision Policy and Metrics Calculator.

Per Task 6E specifications:
1. For CURRENT:
   - Primary runtime evaluation = latest valid CURRENT prediction created BEFORE official period finalization.
   - Separate reporting for all historical revisions (e.g. revision 1 vs revision 2).
   - Strictly forbidden: selecting the revision with smallest error post hoc.
   - Reports: count, MAE, RMSE, median absolute error, within ±1, within ±2, within ±3.
2. For NEXT:
   - Evaluates persisted incoming Term N -> Term N+1 baseline against finalized target-period grade.
   - Never combines NEXT and CURRENT metrics.
"""

from __future__ import annotations

from datetime import datetime, timezone
import math
import statistics
from typing import Any
from collections import defaultdict

from sqlalchemy.orm import Session

from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.PredictionOutcome import PredictionOutcome


def compute_error_metrics(
    samples: list[dict[str, Any]],
) -> dict[str, Any]:
    """Compute count, MAE, RMSE, median absolute error, and ±1, ±2, ±3 tolerances."""
    if not samples:
        return {
            "count": 0,
            "mae": None,
            "rmse": None,
            "median_absolute_error": None,
            "within_pm_1": {"count": 0, "percentage": 0.0},
            "within_pm_2": {"count": 0, "percentage": 0.0},
            "within_pm_3": {"count": 0, "percentage": 0.0},
            "samples": [],
        }

    count = len(samples)
    errors = [s["error"] for s in samples]
    abs_errors = [abs(e) for e in errors]

    mae = sum(abs_errors) / count
    rmse = math.sqrt(sum(e ** 2 for e in errors) / count)
    median_ae = float(statistics.median(abs_errors))

    w1 = sum(1 for ae in abs_errors if ae <= 1.0 + 1e-9)
    w2 = sum(1 for ae in abs_errors if ae <= 2.0 + 1e-9)
    w3 = sum(1 for ae in abs_errors if ae <= 3.0 + 1e-9)

    return {
        "count": count,
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "median_absolute_error": round(median_ae, 4),
        "within_pm_1": {"count": w1, "percentage": round((w1 / count) * 100, 2)},
        "within_pm_2": {"count": w2, "percentage": round((w2 / count) * 100, 2)},
        "within_pm_3": {"count": w3, "percentage": round((w3 / count) * 100, 2)},
        "samples": samples,
    }


def evaluate_dual_purpose_outcomes(
    db: Session,
    *,
    class_id: int | None = None,
    subject_id: int | None = None,
    academic_period_id: int | None = None,
) -> dict[str, Any]:
    """Evaluate finalized outcomes strictly separated by prediction purpose."""
    # 1. Query finalized student period grades
    q = db.query(StudentPeriodGrade).filter(
        StudentPeriodGrade.final_period_grade.isnot(None),
    )
    if hasattr(StudentPeriodGrade, "is_finalized"):
        q = q.filter(StudentPeriodGrade.is_finalized == True)
    if class_id is not None:
        q = q.filter(StudentPeriodGrade.class_id == class_id)
    if subject_id is not None:
        q = q.filter(StudentPeriodGrade.subject_id == subject_id)
    if academic_period_id is not None:
        q = q.filter(StudentPeriodGrade.academic_period_id == academic_period_id)

    finalized_grades = q.all()

    current_primary_samples: list[dict[str, Any]] = []
    current_revisions_samples: dict[int, list[dict[str, Any]]] = defaultdict(list)
    next_baseline_samples: list[dict[str, Any]] = []

    for spg in finalized_grades:
        actual = float(spg.final_period_grade)
        cutoff_dt = getattr(spg, "finalized_at", None)
        if cutoff_dt is None:
            # Fallback to current time if finalized_at was unpopulated
            cutoff_dt = datetime.now(timezone.utc)

        # ------------------------------------------------------------------
        # A. CURRENT Period Projections (source == target == focal period)
        # ------------------------------------------------------------------
        current_preds = (
            db.query(AIPrediction)
            .join(AIModelVersion, AIPrediction.model_version_id == AIModelVersion.model_version_id)
            .filter(
                AIPrediction.student_id == spg.student_id,
                AIPrediction.class_id == spg.class_id,
                AIPrediction.subject_id == spg.subject_id,
                AIPrediction.source_period_id == spg.academic_period_id,
                AIPrediction.target_period_id == spg.academic_period_id,
                AIModelVersion.model_purpose == ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
                AIPrediction.predicted_period_grade.isnot(None),
            )
            .order_by(
                AIPrediction.revision.desc(),
                AIPrediction.generated_at.desc().nullslast(),
                AIPrediction.prediction_id.desc(),
            )
            .all()
        )

        # Filter strictly to predictions created BEFORE or AT official finalization
        valid_pre_finalization_preds = [
            p for p in current_preds
            if p.generated_at is None or p.generated_at <= cutoff_dt
        ]

        if valid_pre_finalization_preds:
            # POLICY: Primary runtime evaluation = latest valid CURRENT prediction created BEFORE finalization
            # Order is revision.desc(), generated_at.desc(), so index 0 is the latest
            primary_pred = valid_pre_finalization_preds[0]
            pred_val = float(primary_pred.predicted_period_grade)
            err = actual - pred_val
            current_primary_samples.append({
                "student_id": str(spg.student_id),
                "class_id": spg.class_id,
                "subject_id": spg.subject_id,
                "academic_period_id": spg.academic_period_id,
                "prediction_id": primary_pred.prediction_id,
                "revision": primary_pred.revision,
                "predicted_grade": pred_val,
                "actual_grade": actual,
                "error": err,
                "absolute_error": abs(err),
                "generated_at": primary_pred.generated_at.isoformat() if primary_pred.generated_at else None,
            })

            # Also report all revisions separately (e.g. revision 1 vs revision 2)
            for p in valid_pre_finalization_preds:
                rev_num = p.revision or 1
                p_val = float(p.predicted_period_grade)
                p_err = actual - p_val
                current_revisions_samples[rev_num].append({
                    "student_id": str(spg.student_id),
                    "prediction_id": p.prediction_id,
                    "revision": rev_num,
                    "predicted_grade": p_val,
                    "actual_grade": actual,
                    "error": p_err,
                    "absolute_error": abs(p_err),
                })

        # ------------------------------------------------------------------
        # B. NEXT Period Baseline Forecast (target == focal period, source < target)
        # ------------------------------------------------------------------
        next_preds = (
            db.query(AIPrediction)
            .join(AIModelVersion, AIPrediction.model_version_id == AIModelVersion.model_version_id)
            .filter(
                AIPrediction.student_id == spg.student_id,
                AIPrediction.class_id == spg.class_id,
                AIPrediction.subject_id == spg.subject_id,
                AIPrediction.target_period_id == spg.academic_period_id,
                AIPrediction.source_period_id != spg.academic_period_id,
                AIModelVersion.model_purpose == ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value,
                AIPrediction.predicted_period_grade.isnot(None),
            )
            .order_by(
                AIModelVersion.is_active.desc(),
                AIPrediction.revision.desc(),
                AIPrediction.generated_at.desc().nullslast(),
                AIPrediction.prediction_id.desc(),
            )
            .all()
        )

        if next_preds:
            # Latest incoming baseline forecast
            baseline_pred = next_preds[0]
            b_val = float(baseline_pred.predicted_period_grade)
            b_err = actual - b_val
            next_baseline_samples.append({
                "student_id": str(spg.student_id),
                "class_id": spg.class_id,
                "subject_id": spg.subject_id,
                "source_period_id": baseline_pred.source_period_id,
                "target_period_id": spg.academic_period_id,
                "prediction_id": baseline_pred.prediction_id,
                "revision": baseline_pred.revision,
                "predicted_grade": b_val,
                "actual_grade": actual,
                "error": b_err,
                "absolute_error": abs(b_err),
                "risk_level": baseline_pred.risk_level,
                "generated_at": baseline_pred.generated_at.isoformat() if baseline_pred.generated_at else None,
            })

    # Metrics computation
    current_primary_metrics = compute_error_metrics(current_primary_samples)
    current_revisions_metrics = {
        f"revision_{rev}": compute_error_metrics(samples)
        for rev, samples in sorted(current_revisions_samples.items())
    }
    next_baseline_metrics = compute_error_metrics(next_baseline_samples)

    return {
        "policy": {
            "current_selection_rule": "latest_valid_created_before_official_finalization",
            "cherry_picking_prohibited": True,
            "purposes_strictly_separated": True,
        },
        "current_period_projections": {
            "primary_runtime_evaluation": current_primary_metrics,
            "historical_revisions_breakdown": current_revisions_metrics,
        },
        "next_period_baseline_forecasts": {
            "baseline_evaluation": next_baseline_metrics,
        },
    }
