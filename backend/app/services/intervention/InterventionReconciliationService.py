"""Reconcile an existing latest corrected prediction without generating a revision."""

from __future__ import annotations

import math

from sqlalchemy.orm import Session

from app.core.Config import settings
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.intervention.Intervention import Intervention
from app.services.intervention.InterventionCandidateService import OPEN_STATUSES, sync_intervention_for_persisted_prediction
from app.services.prediction.CurrentPeriodFeatureBuilderService import build_current_period_features_from_records
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from app.services.prediction.DevelopmentCurrentTermPredictionService import canonicalize_v3_features, resolve_v3_scope


def reconcile_existing_candidate(db: Session, prediction_id: int, *, apply: bool = False) -> str:
    """Return a skip reason or create a candidate in the caller's transaction.

    The persisted prediction, live evidence, and exact scope are checked here;
    InterventionCandidateService remains the final eligibility authority.
    """
    if (
        settings.app_environment.lower() not in {"development", "test"}
        or not settings.development_prediction_api_enabled
        or settings.development_current_term_model_name != CORRECTED_MODEL_NAME
    ):
        raise ValueError("Intervention reconciliation is development-only")
    row = db.get(DevelopmentCurrentTermPrediction, prediction_id)
    if row is None:
        return "missing_prediction"
    version = db.get(AIModelVersion, row.model_version_id)
    if (
        version is None or version.model_name != CORRECTED_MODEL_NAME
        or version.model_purpose != ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value
        or version.lifecycle_status != "DEVELOPMENT" or version.is_active
        or version.production_validated or version.independent_three_term_validation
    ):
        return "wrong_model"
    selected_versions = db.query(AIModelVersion.model_version_id).filter(
        AIModelVersion.model_name == CORRECTED_MODEL_NAME,
        AIModelVersion.model_purpose == ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value,
        AIModelVersion.lifecycle_status == "DEVELOPMENT",
        AIModelVersion.production_validated.is_(False),
        AIModelVersion.independent_three_term_validation.is_(False),
        AIModelVersion.is_active.is_(False),
    ).all()
    if len(selected_versions) != 1 or selected_versions[0].model_version_id != row.model_version_id:
        return "wrong_model"
    if row.source_period_id != row.target_period_id:
        return "invalid_scope"
    latest = db.query(DevelopmentCurrentTermPrediction.prediction_id).filter_by(
        student_id=row.student_id, class_id=row.class_id, subject_id=row.subject_id,
        source_period_id=row.source_period_id, target_period_id=row.target_period_id,
        model_version_id=row.model_version_id,
    ).order_by(DevelopmentCurrentTermPrediction.revision.desc()).first()
    if latest is None or latest.prediction_id != prediction_id:
        return "stale_revision"
    snapshot = row.evidence_snapshot if isinstance(row.evidence_snapshot, dict) else {}
    readiness = snapshot.get("readiness")
    if not isinstance(readiness, dict) or readiness.get("status") != "READY":
        return "not_ready"
    raw = snapshot.get("projected_final_term_grade_raw")
    try:
        grade = float(raw) if not isinstance(raw, bool) else math.nan
    except (TypeError, ValueError, OverflowError):
        grade = math.nan
    if not math.isfinite(grade) or not 0 <= grade < 85:
        return "not_candidate_grade"
    period = db.get(AcademicPeriod, row.source_period_id)
    if period is None or not period.is_active:
        return "inactive_period"
    finalized = db.query(StudentPeriodGrade.period_grade_id).filter_by(
        student_id=row.student_id, class_id=row.class_id, subject_id=row.subject_id,
        academic_period_id=row.source_period_id, is_finalized=True,
    ).filter(StudentPeriodGrade.final_period_grade.isnot(None)).first()
    if finalized is not None:
        return "finalized_grade"
    enrolled = db.query(StudentClass.student_class_id).filter_by(
        student_id=row.student_id, class_id=row.class_id, enrollment_status="enrolled",
    ).first()
    if enrolled is None:
        return "not_enrolled"
    scope = resolve_v3_scope(db, row.student_id, row.class_id, row.subject_id)
    if not scope["supported"]:
        return "invalid_scope"
    live = build_current_period_features_from_records(
        db, row.student_id, row.class_id, row.subject_id, row.source_period_id,
    )
    if not live["ready"]:
        return "not_ready"
    features = canonicalize_v3_features(live["features"], scope)
    saved_features = snapshot.get("model_features")
    if (
        not isinstance(saved_features, list)
        or {item["name"]: item.get("value") for item in saved_features if isinstance(item, dict) and "name" in item} != features
        or snapshot.get("examination_presentation") != live["evidence_summary"]["examination"]["presentation"]
    ):
        return "changed_evidence"
    open_before = db.query(Intervention.intervention_id).filter_by(
        student_id=row.student_id, class_id=row.class_id, subject_id=row.subject_id,
        academic_period_id=row.source_period_id,
    ).filter(Intervention.status.in_(OPEN_STATUSES)).first()
    if not apply:
        return "already_open" if open_before is not None else "would_create"
    sync_intervention_for_persisted_prediction(
        db, row, student_id=row.student_id, class_id=row.class_id,
        subject_id=row.subject_id, academic_period_id=row.source_period_id,
    )
    return "already_open" if open_before is not None else "created"
