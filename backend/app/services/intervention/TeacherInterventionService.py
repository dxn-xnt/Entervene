"""Current teacher review of frozen development Intervention candidates."""

from __future__ import annotations

import math
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.Config import settings
from app.models.academic.StudentCLass import StudentClass
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.intervention.Intervention import Intervention
from app.schemas.TeacherIntervention import (
    TeacherInterventionDetail, TeacherInterventionList, TeacherInterventionSummary,
)
from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService
from app.services.academic.SubstitutionService import SubstitutionService
from app.services.intervention.InterventionCandidateService import sync_intervention_for_persisted_prediction
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from app.services.prediction.DevelopmentCurrentTermPredictionPersistenceService import generate_and_persist_development_current_term


def _eligible_scope(db: Session, staff_id: str, row: Intervention) -> bool:
    load = SubjectLoadAuthorizationService.get_active_published_load(
        db, row.class_id, row.subject_id, row.academic_period_id,
    )
    if load is None:
        return False
    substitution = SubstitutionService.get_active_substitution(db, load.subject_load_id)
    responsible = substitution.substitute_staff_id if substitution is not None else load.staff_id
    if staff_id != responsible:
        return False
    return db.query(StudentClass.student_class_id).filter_by(
        student_id=row.student_id, class_id=row.class_id, enrollment_status="enrolled",
    ).first() is not None


def _require_scope(db: Session, staff_id: str, row: Intervention) -> None:
    if not _eligible_scope(db, staff_id, row):
        raise HTTPException(status_code=403, detail="You do not have active teaching permissions for this intervention scope")


def _source(db: Session, row: Intervention) -> DevelopmentCurrentTermPrediction:
    source = db.get(DevelopmentCurrentTermPrediction, row.source_prediction_id)
    if source is None or (
        source.student_id, source.class_id, source.subject_id, source.source_period_id, source.target_period_id
    ) != (row.student_id, row.class_id, row.subject_id, row.academic_period_id, row.academic_period_id):
        raise HTTPException(status_code=409, detail="Intervention source prediction is unavailable or mismatched")
    return source


def _summary(db: Session, row: Intervention) -> TeacherInterventionSummary:
    source = _source(db, row)
    diagnosis = row.diagnosis_snapshot if isinstance(row.diagnosis_snapshot, dict) else {}
    grade = source.evidence_snapshot.get("projected_final_term_grade_raw") if isinstance(source.evidence_snapshot, dict) else None
    return TeacherInterventionSummary(
        intervention_id=row.intervention_id,
        student_id=row.student_id,
        student_name=" ".join(part for part in (row.student.first_name, row.student.middle_name, row.student.last_name, row.student.suffix) if part),
        student_lrn=row.student.student_lrn,
        class_id=row.class_id, class_name=row.class_.section_name,
        subject_id=row.subject_id, subject_name=row.subject.subject_name,
        academic_period_id=row.academic_period_id, academic_period_name=row.academic_period.period_name,
        status=row.status,
        source_prediction_id=source.prediction_id, source_prediction_revision=source.revision,
        triggering_predicted_grade=float(grade if grade is not None else source.predicted_period_grade),
        triggering_intervention_level=source.intervention_level,
        created_at=row.created_at,
        diagnosis_summary={
            "snapshot_version": diagnosis.get("snapshot_version"),
            "weakest_supported_components": diagnosis.get("weakest_supported_components", []),
            "competency_detail_status": diagnosis.get("competency_detail_status"),
            "external_assessment_detail_status": diagnosis.get("external_assessment_detail_status"),
            "covered_competencies_for_teacher_review_count": len(diagnosis.get("covered_competencies_for_teacher_review") or []),
        },
    )


def list_teacher_candidates(db: Session, staff_id: str) -> TeacherInterventionList:
    candidates = db.query(Intervention).filter_by(status="CANDIDATE").order_by(
        Intervention.created_at.desc(), Intervention.intervention_id.desc(),
    ).all()
    items = [_summary(db, row) for row in candidates if _eligible_scope(db, staff_id, row)]
    return TeacherInterventionList(items=items, total=len(items))


def get_teacher_candidate(db: Session, staff_id: str, intervention_id: int) -> TeacherInterventionDetail:
    row = db.get(Intervention, intervention_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Intervention not found")
    _require_scope(db, staff_id, row)
    if row.status != "CANDIDATE":
        raise HTTPException(status_code=409, detail="Intervention is no longer a candidate")
    return TeacherInterventionDetail(
        **_summary(db, row).model_dump(),
        diagnosis_snapshot=row.diagnosis_snapshot,
        activated_at=row.activated_at, activated_by_staff_id=row.activated_by_staff_id,
        resolved_at=row.resolved_at, resolution_reason=row.resolution_reason,
    )


def activate_teacher_candidate(db: Session, staff_id: str, intervention_id: int) -> TeacherInterventionDetail:
    if (
        settings.app_environment.lower() not in {"development", "test"}
        or not settings.development_prediction_api_enabled
        or settings.development_current_term_model_name != CORRECTED_MODEL_NAME
    ):
        raise HTTPException(status_code=404, detail="Not found")
    candidate = db.get(Intervention, intervention_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Intervention not found")
    _require_scope(db, staff_id, candidate)
    if candidate.status != "CANDIDATE":
        raise HTTPException(status_code=409, detail="Intervention is no longer a candidate")
    source = _source(db, candidate)
    scope = (candidate.student_id, candidate.class_id, candidate.subject_id, candidate.academic_period_id)
    model_version_id = source.model_version_id
    version = db.get(AIModelVersion, model_version_id)
    if version is None or version.model_name != CORRECTED_MODEL_NAME:
        raise HTTPException(status_code=409, detail="Candidate source is not the corrected development model")
    outcome: dict[str, str] = {}

    def approve_if_current(transaction: Session, result: dict) -> None:
        outcome.clear()
        row = transaction.query(Intervention).filter_by(intervention_id=intervention_id).with_for_update().one_or_none()
        if row is None:
            outcome["error"] = "Intervention no longer exists"
            return
        if not _eligible_scope(transaction, staff_id, row):
            outcome["error"] = "Teacher no longer handles this intervention scope"
            return
        if row.status != "CANDIDATE":
            outcome["error"] = "Intervention is no longer a candidate"
            return
        versions = transaction.query(AIModelVersion).filter(
            AIModelVersion.model_name == CORRECTED_MODEL_NAME,
            AIModelVersion.model_purpose == ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value,
            AIModelVersion.lifecycle_status == "DEVELOPMENT",
            AIModelVersion.is_active.is_(False),
        ).all()
        if len(versions) != 1 or versions[0].model_version_id != model_version_id:
            outcome["error"] = "Current corrected model differs from the candidate source"
            return
        if result.get("readiness_status") != "READY" or result.get("prediction_status") != "DEVELOPMENT_PREDICTION_AVAILABLE":
            outcome["error"] = "Current prediction evidence is not READY"
            return
        latest = transaction.query(DevelopmentCurrentTermPrediction).filter_by(
            student_id=scope[0], class_id=scope[1], subject_id=scope[2],
            source_period_id=scope[3], target_period_id=scope[3], model_version_id=model_version_id,
        ).order_by(DevelopmentCurrentTermPrediction.revision.desc()).first()
        if latest is None or latest.prediction_id != result.get("prediction_id") or (
            not isinstance(latest.evidence_snapshot, dict)
            or latest.evidence_snapshot.get("readiness", {}).get("status") != "READY"
        ):
            outcome["error"] = "Current corrected prediction is unavailable"
            return
        raw_grade = latest.evidence_snapshot.get("projected_final_term_grade_raw")
        try:
            grade = float(raw_grade) if not isinstance(raw_grade, bool) else math.nan
        except (TypeError, ValueError, OverflowError):
            grade = math.nan
        if not math.isfinite(grade):
            outcome["error"] = "Current corrected prediction grade is invalid"
            return
        if grade >= 85:
            sync_intervention_for_persisted_prediction(
                transaction, latest, student_id=scope[0], class_id=scope[1],
                subject_id=scope[2], academic_period_id=scope[3],
            )
            outcome["error"] = "Current prediction improved to at least 85"
            return
        row.status = "ACTIVE"
        row.activated_at = datetime.now(timezone.utc)
        row.activated_by_staff_id = staff_id
        transaction.flush()

    try:
        generate_and_persist_development_current_term(
            *scope, model_version_id=model_version_id, bind=db.get_bind(), after_result=approve_if_current,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if "error" in outcome:
        raise HTTPException(status_code=409, detail=outcome["error"])
    db.expire_all()
    active = db.get(Intervention, intervention_id)
    if active is None or active.status != "ACTIVE":
        raise HTTPException(status_code=409, detail="Intervention activation did not complete")
    return TeacherInterventionDetail(
        **_summary(db, active).model_dump(),
        diagnosis_snapshot=active.diagnosis_snapshot,
        activated_at=active.activated_at, activated_by_staff_id=active.activated_by_staff_id,
        resolved_at=active.resolved_at, resolution_reason=active.resolution_reason,
    )
