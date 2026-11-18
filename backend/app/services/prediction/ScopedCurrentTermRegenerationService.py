"""Guarded one-student inspection and regeneration for current-term predictions."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.engine import Connectable
from sqlalchemy.orm import Session

from app.models.academic.StudentCLass import StudentClass
from app.services.prediction import DevelopmentCurrentTermPredictionService as prediction_service
from app.services.prediction import DevelopmentCurrentTermRiskService as risk_service
from app.services.prediction.DevelopmentCurrentTermModelResolver import (
    resolve_selected_development_model,
)
from app.services.prediction.DevelopmentCurrentTermPredictionPersistenceService import (
    generate_and_persist_current_term,
)


def _require_active_enrollment(db: Session, student_id: UUID, class_id: int) -> None:
    enrollment = db.query(StudentClass).filter(
        StudentClass.student_id == student_id,
        StudentClass.class_id == class_id,
    ).one_or_none()
    if enrollment is None or (enrollment.enrollment_status or "").lower() != "enrolled":
        raise ValueError("The selected student does not have an active enrollment in the selected class.")


def inspect_scoped_current_term_regeneration(
    db: Session,
    *,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    period_id: int,
) -> dict:
    """Score one exact scope without adding or modifying database rows."""
    _require_active_enrollment(db, student_id, class_id)
    version = resolve_selected_development_model(db)
    prediction, prepared = prediction_service.prepare_development_current_term(
        db,
        student_id,
        class_id,
        subject_id,
        period_id,
        model_name=version.model_name,
    )
    if prepared is not None:
        prediction = prediction_service.score_prepared_development_current_term(
            prediction,
            prepared,
        )
    intervention = risk_service.assess_development_current_term_intervention(prediction)
    return {
        "mode": "DRY_RUN",
        "would_persist": prepared is not None,
        "prediction_status": prediction["status"],
        "readiness_status": "READY" if prediction["readiness_result"].get("ready") else "NOT_READY",
        "readiness_level": prediction["readiness_result"].get("readiness_level"),
        "reason_codes": list(prediction.get("readiness_reason_codes") or prediction.get("reason_codes") or []),
        "projected_final_term_grade": prediction.get("projected_final_term_grade"),
        "intervention_level": intervention["intervention_level"],
        "model_name": version.model_name,
        "model_version_id": version.model_version_id,
        "lifecycle_status": version.lifecycle_status,
        "is_provisional": prediction.get("is_provisional", False),
        "validation_status": prediction.get("validation_status"),
        "scope": {
            "student_id": str(student_id),
            "class_id": class_id,
            "subject_id": subject_id,
            "academic_period_id": period_id,
        },
    }


def apply_scoped_current_term_regeneration(
    db: Session,
    *,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    period_id: int,
    bind: Connectable,
) -> dict:
    """Generate only the supplied scope after repeating all persistence checks."""
    _require_active_enrollment(db, student_id, class_id)
    version = resolve_selected_development_model(db)
    return generate_and_persist_current_term(
        student_id,
        class_id,
        subject_id,
        period_id,
        model_version_id=version.model_version_id,
        bind=bind,
    )
