"""Synchronize one corrected prediction revision with its intervention scope."""

from __future__ import annotations

import math
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.intervention.Intervention import Intervention
from app.services.intervention.InterventionDiagnosisService import build_candidate_diagnosis
from app.services.intervention.InterventionNotificationService import stage_intervention_notification
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME


OPEN_STATUSES = ("CANDIDATE", "ACTIVE")
IMPROVED_PREDICTION = "IMPROVED_PREDICTION"


def sync_intervention_for_persisted_prediction(
    db: Session,
    prediction: DevelopmentCurrentTermPrediction,
    *,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
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
    if (
        version is None
        or version.model_name != CORRECTED_MODEL_NAME
        or version.model_purpose != ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value
        or version.lifecycle_status != "DEVELOPMENT"
        or version.is_active
    ):
        raise ValueError("Intervention source must use the inactive corrected development model.")
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

    open_intervention = db.query(Intervention).filter_by(
        student_id=student_id,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
    ).filter(Intervention.status.in_(OPEN_STATUSES)).with_for_update().one_or_none()

    if grade >= 85:
        if open_intervention is not None:
            open_intervention.status = "RESOLVED"
            open_intervention.resolution_reason = IMPROVED_PREDICTION
            open_intervention.resolved_at = datetime.now(timezone.utc)
            db.flush()
            stage_intervention_notification(db, open_intervention, event=IMPROVED_PREDICTION, predicted_grade=grade)
        return open_intervention

    if open_intervention is not None:
        return open_intervention
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
