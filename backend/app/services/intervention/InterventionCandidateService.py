"""Synchronize one corrected prediction revision with its intervention scope."""

from __future__ import annotations

import math
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.intervention.Intervention import Intervention
from app.services.grading.PassingThresholdReader import require_subject_passing_threshold
from app.services.intervention.InterventionDiagnosisService import build_candidate_diagnosis
from app.services.intervention.InterventionHistoryService import capture_resolution_history_snapshot
from app.services.intervention.InterventionNotificationService import stage_intervention_notification
from app.services.intervention.InterventionResolutionService import (
    REMEDIATION_IMPROVED_PREDICTION,
    evaluate_active_resolution_attribution,
)
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME, MODEL_NAMES


OPEN_STATUSES = ("CANDIDATE", "ACTIVE")
IMPROVED_PREDICTION = "IMPROVED_PREDICTION"
AUTOMATIC_CANDIDATE_LEVELS = frozenset({"HIGH_RISK", "MODERATE_RISK"})


def sync_intervention_for_persisted_prediction(
    db: Session,
    prediction: DevelopmentCurrentTermPrediction,
    *,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
    trigger_assignment_id: int | None = None,
    allow_active_auto_resolve: bool = True,
) -> Intervention | None:
    """Run inside the prediction transaction, immediately after its row is flushed.

    The caller supplies its intended scope independently so a mismatched source
    prediction cannot silently create or resolve another scope's intervention.
    """
    scope = (student_id, class_id, subject_id, academic_period_id)
    if (
        prediction.prediction_id is None
        or (prediction.student_id, prediction.class_id, prediction.subject_id, prediction.source_period_id) != scope
        or prediction.target_period_id != academic_period_id
    ):
        raise ValueError("Intervention prediction scope mismatch.")
    version = db.get(AIModelVersion, prediction.model_version_id)
    valid_development = (
        version is not None
        and version.lifecycle_status == "DEVELOPMENT"
        and not version.is_active
        and not version.production_validated
        and not version.independent_three_term_validation
    )
    valid_production = (
        version is not None
        and version.lifecycle_status == "PRODUCTION"
        and version.is_active
        and version.production_validated
        and version.independent_three_term_validation
    )
    if (
        version is None
        or version.model_name not in MODEL_NAMES
        or version.model_purpose != ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value
        or (valid_development and version.model_name != CORRECTED_MODEL_NAME)
        or not (valid_development or valid_production)
    ):
        raise ValueError("Intervention source must use an approved current-term model lifecycle.")
    snapshot = prediction.evidence_snapshot if isinstance(prediction.evidence_snapshot, dict) else {}
    readiness = snapshot.get("readiness")
    if not isinstance(readiness, dict) or readiness.get("status") != "READY":
        raise ValueError("Intervention source prediction is not READY.")
    # Numeric(6, 2) is for display/persistence; use the frozen model output at
    # the threshold so 84.999 is not rounded into a non-candidate 85.00.
    raw_grade = snapshot.get("projected_final_term_grade_raw")
    if raw_grade is None or isinstance(raw_grade, bool):
        raise ValueError("Intervention source prediction grade is invalid.")
    try:
        grade = float(raw_grade)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("Intervention source prediction grade is invalid.") from exc
    if not math.isfinite(grade) or not 0 <= grade <= 100:
        raise ValueError("Intervention source prediction grade is invalid.")

    latest = db.query(DevelopmentCurrentTermPrediction).filter_by(
        student_id=student_id,
        class_id=class_id,
        subject_id=subject_id,
        source_period_id=academic_period_id,
        target_period_id=academic_period_id,
        model_version_id=prediction.model_version_id,
    ).order_by(DevelopmentCurrentTermPrediction.revision.desc()).first()
    if latest is None or latest.prediction_id != prediction.prediction_id:
        raise ValueError("Intervention source prediction is not the latest revision.")

    period = db.get(AcademicPeriod, academic_period_id)
    if period is None:
        raise ValueError("Academic period not found.")
    threshold_resolution = require_subject_passing_threshold(
        db,
        academic_year_id=period.academic_year_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
    )
    passing_threshold = float(threshold_resolution.threshold)

    open_intervention = db.query(Intervention).filter_by(
        student_id=student_id,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
    ).filter(Intervention.status.in_(OPEN_STATUSES)).with_for_update().one_or_none()

    if grade >= passing_threshold:
        if open_intervention is not None:
            if open_intervention.status == "CANDIDATE":
                now = datetime.now(timezone.utc)
                plan = dict(open_intervention.remediation_plan or {})
                plan["resolution_review"] = {
                    "decision": "AUTO_RESOLVED",
                    "resolution_mode": "CANDIDATE_IMPROVED",
                    "decided_at": now.isoformat(),
                    "prediction_id": prediction.prediction_id,
                    "prediction_revision": prediction.revision,
                    "predicted_grade": grade,
                    "passing_threshold": passing_threshold,
                }
                plan["resolution_history_snapshot"] = capture_resolution_history_snapshot(
                    db,
                    open_intervention,
                    prediction=prediction,
                    predicted_grade=grade,
                )
                open_intervention.remediation_plan = plan
                open_intervention.status = "RESOLVED"
                open_intervention.resolution_reason = IMPROVED_PREDICTION
                open_intervention.resolved_at = now
                db.flush()
                stage_intervention_notification(
                    db, open_intervention, event=IMPROVED_PREDICTION, predicted_grade=grade,
                )
            elif open_intervention.status == "ACTIVE":
                attribution = evaluate_active_resolution_attribution(
                    db,
                    open_intervention,
                    prediction,
                    passing_threshold=passing_threshold,
                    trigger_assignment_id=trigger_assignment_id,
                )
                now = datetime.now(timezone.utc)
                plan = dict(open_intervention.remediation_plan or {})
                review = dict(plan.get("resolution_review")) if isinstance(plan.get("resolution_review"), dict) else {}

                if allow_active_auto_resolve and attribution.should_auto_resolve:
                    plan["resolution_review"] = {
                        "decision": "AUTO_RESOLVED",
                        "resolution_mode": "AUTOMATIC_REMEDIATION",
                        "decided_by_staff_id": None,
                        "decided_at": now.isoformat(),
                        "prediction_id": prediction.prediction_id,
                        "prediction_revision": prediction.revision,
                        "predicted_grade": grade,
                        "passing_threshold": passing_threshold,
                        **attribution.to_review_metadata(),
                    }
                    plan["resolution_history_snapshot"] = capture_resolution_history_snapshot(
                        db,
                        open_intervention,
                        prediction=prediction,
                        predicted_grade=grade,
                    )
                    open_intervention.remediation_plan = plan
                    open_intervention.status = "RESOLVED"
                    open_intervention.resolution_reason = REMEDIATION_IMPROVED_PREDICTION
                    open_intervention.resolved_at = now
                    db.flush()
                    stage_intervention_notification(
                        db,
                        open_intervention,
                        event="REMEDIATION_AUTO_RESOLVED",
                        predicted_grade=grade,
                        passing_threshold=passing_threshold,
                        reason_summary=attribution.reason_summary,
                        prediction_id=prediction.prediction_id,
                    )
                else:
                    # Keep ACTIVE open for teacher review whenever attribution is not
                    # verifiably pure graded remediation improvement.
                    review["latest_attribution"] = {
                        "prediction_id": prediction.prediction_id,
                        "prediction_revision": prediction.revision,
                        "predicted_grade": grade,
                        "passing_threshold": passing_threshold,
                        **attribution.to_review_metadata(),
                    }
                    already_continued = review.get("continued_prediction_id") == prediction.prediction_id
                    already_recommended = review.get("last_recommended_prediction_id") == prediction.prediction_id
                    if not already_continued and not already_recommended:
                        stage_intervention_notification(
                            db,
                            open_intervention,
                            event="RESOLUTION_RECOMMENDED",
                            predicted_grade=grade,
                            passing_threshold=passing_threshold,
                            reason_summary=attribution.reason_summary,
                            prediction_id=prediction.prediction_id,
                        )
                        review["last_recommended_prediction_id"] = prediction.prediction_id
                        review["last_recommended_prediction_revision"] = prediction.revision
                        review["last_recommended_at"] = now.isoformat()
                    plan["resolution_review"] = review
                    open_intervention.remediation_plan = plan
                    db.flush()
        return open_intervention

    # A non-triggering risk level must not erase an existing candidate or
    # ACTIVE intervention. It only prevents creation for a previously empty scope.
    if open_intervention is not None:
        return open_intervention
    if prediction.intervention_level not in AUTOMATIC_CANDIDATE_LEVELS:
        return None
    candidate = Intervention(
        student_id=student_id,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
        source_prediction_id=prediction.prediction_id,
        status="CANDIDATE",
        diagnosis_snapshot=build_candidate_diagnosis(db, prediction),
    )
    db.add(candidate)
    db.flush()
    stage_intervention_notification(db, candidate, event="CANDIDATE", predicted_grade=grade)
    return candidate
